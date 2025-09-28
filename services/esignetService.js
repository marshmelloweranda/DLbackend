const axios = require("axios");
const jose = require("jose");
const { importJWK, SignJWT, compactDecrypt, flattenedDecrypt, generalDecrypt, decodeJwt } = require("jose");
const User = require("../models/userModel");

// Temporary storage for pending applications (until payment is confirmed)
// In production, you might want to use Redis or database for this
const pendingApplications = new Map();

const { ESIGNET_SERVICE_URL, ESIGNET_AUD_URL, CLIENT_ASSERTION_TYPE, CLIENT_PRIVATE_KEY, USERINFO_RESPONSE_TYPE, JWE_USERINFO_PRIVATE_KEY } = require("../config");

const baseUrl = ESIGNET_SERVICE_URL ? ESIGNET_SERVICE_URL.trim() : '';
const getTokenEndPoint = "/oauth/v2/token";
const getUserInfoEndPoint = "/oidc/userinfo";

const alg = "RS256";
const jweEncryAlgo = "RSA-OAEP-256";
const expirationTime = "1h";

// Initialize database tables (handle properly)
User.initTables().catch(error => {
  console.error('Failed to initialize database tables:', error);
});

/**
 * Triggers /oauth/v2/token API on esignet service to fetch access token
 * @param {string} code auth code
 * @param {string} client_id registered client id
 * @param {string} redirect_uri validated redirect_uri
 * @param {string} grant_type grant_type
 * @returns access token
 */
const post_GetToken = async ({
  code,
  client_id,
  redirect_uri,
  grant_type
}) => {
  if (!baseUrl) {
    throw new Error("ESIGNET_SERVICE_URL is not configured");
  }

  let request = new URLSearchParams({
    code: code,
    client_id: client_id,
    redirect_uri: redirect_uri,
    grant_type: grant_type,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: await generateSignedJwt(client_id),
  });
  
  const endpoint = baseUrl + getTokenEndPoint;
  console.log('Token endpoint:', endpoint);
  
  try {
    const response = await axios.post(endpoint, request, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching token:', error.message);
    throw error;
  }
};

/**
 * Triggers /oidc/userinfo API on esignet service to fetch userInformation
 * @param {string} access_token valid access token
 * @returns decrypted/decoded json user information
 */
const get_GetUserInfo = async (access_token) => {
  if (!baseUrl) {
    throw new Error("ESIGNET_SERVICE_URL is not configured");
  }

  const endpoint = baseUrl + getUserInfoEndPoint;
  
  try {
    const response = await axios.get(endpoint, {
      headers: {
        Authorization: "Bearer " + access_token,
      },
    });

    const userInfo = await decodeUserInfoResponse(response.data);
    
    // Save user information to database (but don't break flow if it fails)
    try {
      await saveUserToDatabase(userInfo);
    } catch (dbError) {
      console.error('Database save failed, but continuing with user info:', dbError.message);
    }
    
    return userInfo;
  } catch (error) {
    console.error('Error fetching user info:', error.message);
    throw error;
  }
};

/**
 * Save user information to PostgreSQL database
 * @param {Object} userInfo User information from eSignet
 */
const saveUserToDatabase = async (userInfo) => {
  try {
    console.log('Raw userInfo from eSignet:', JSON.stringify(userInfo, null, 2));
    
    // Extract user data with proper validation
    const userData = {
      sub: userInfo.sub || userInfo.user_id,
      name: userInfo.name || 'Unknown',
      email: userInfo.email || null,
      phone: userInfo.phone_number || userInfo.phone || null,
      date_of_birth: userInfo.birthdate || null,
      address: userInfo.address ? 
        (typeof userInfo.address === 'string' ? userInfo.address : JSON.stringify(userInfo.address)) : 
        null
    };
    
    // Validate required fields
    if (!userData.sub) {
      throw new Error('User subject identifier (sub) is required');
    }

    if (!userData.name || userData.name === 'Unknown') {
      console.warn('User name not provided, using fallback');
      userData.name = `User_${userData.sub.substring(0, 10)}`;
    }

    console.log('Processed user data for saving:', userData);
    
    const savedUser = await User.saveUser(userData);
    console.log('User saved to database:', savedUser.sub);
    
    return savedUser;
  } catch (error) {
    console.error('Error saving user to database:', error);
    // Don't throw the error to prevent breaking the main flow
    return null;
  }
};

/**
 * Generates client assertion signedJWT
 * @param {string} clientId registered client id
 * @returns client assertion signedJWT
 */
async function generateSignedJwt(clientId) {
  if (!CLIENT_PRIVATE_KEY) {
    throw new Error("CLIENT_PRIVATE_KEY is not configured");
  }

  const privateKey = await importJWK(CLIENT_PRIVATE_KEY, alg);
  
  const tokenEndpoint = ESIGNET_SERVICE_URL + "/oauth/v2/token";

  const jwt = await new SignJWT({
      iss: clientId,
      sub: clientId,  
      aud: tokenEndpoint,
      jti: generateUniqueId()
    })
    .setProtectedHeader({ 
      alg: alg,
      typ: "JWT" 
    })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  return jwt;
}

// Helper function to generate unique ID
function generateUniqueId() {
  return Math.random().toString(36).substring(2) + 
         Date.now().toString(36);
}

/**
 * decrypts and decodes the user information fetched from esignet services
 * @param {string} userInfoResponse JWE encrypted or JWT encoded user information
 * @returns decrypted/decoded json user information
 */
const decodeUserInfoResponse = async (userInfoResponse) => {
  let response = userInfoResponse;

  if (USERINFO_RESPONSE_TYPE && USERINFO_RESPONSE_TYPE.toLowerCase() === "jwe") {
    if (!JWE_USERINFO_PRIVATE_KEY) {
      throw new Error("JWE_USERINFO_PRIVATE_KEY is required for JWE decryption");
    }

    try {
      const decodeKey = Buffer.from(JWE_USERINFO_PRIVATE_KEY, 'base64')?.toString();
      const jwkObject = JSON.parse(decodeKey);
      const privateKeyObj = await importJWK(jwkObject, jweEncryAlgo);

      try {
        const { plaintext } = await compactDecrypt(response, privateKeyObj);
        response = new TextDecoder().decode(plaintext);
      } catch (error) {
        try {
          const { plaintext } = await flattenedDecrypt(response, privateKeyObj);
          response = new TextDecoder().decode(plaintext);
        } catch (error) {
          const { plaintext } = await generalDecrypt(response, privateKeyObj);
          response = new TextDecoder().decode(plaintext);
        }
      }
    } catch (error) {
      console.error('Error decrypting JWE response:', error);
      throw error;
    }
  }
  
  // Handle both JWT and JSON responses
  try {
    // Try to decode as JWT
    return decodeJwt(response);
  } catch (error) {
    // If it's not a JWT, try to parse as JSON
    try {
      return typeof response === 'string' ? JSON.parse(response) : response;
    } catch (parseError) {
      console.error('Failed to parse user info response:', parseError);
      throw new Error('Invalid user info response format');
    }
  }
};

// ====================================================================
// UPDATED METHODS FOR LICENCE CATEGORIES (NOW FROM DATABASE)
// ====================================================================

/**
 * Retrieves available licence categories with their details from database.
 * @returns {Array} List of licence categories
 */
const getLicenceCategories = async () => {
  try {
    const categories = await User.getLicenceCategories();
    return categories;
  } catch (error) {
    console.error('Error fetching licence categories from database:', error);
    throw error;
  }
};

/**
 * Get specific licence category by code from database.
 * @param {string} categoryCode - Licence category code (e.g., 'A1', 'B')
 * @returns {Object} Licence category details
 */
const getLicenceCategoryByCode = async (categoryCode) => {
  try {
    const category = await User.getLicenceCategoryByCode(categoryCode);
    if (!category) {
      throw new Error(`Licence category '${categoryCode}' not found`);
    }
    return category;
  } catch (error) {
    console.error('Error fetching licence category from database:', error);
    throw error;
  }
};

/**
 * Add new licence category to database.
 * @param {Object} categoryData - Category data to add
 * @returns {Object} Added category details
 */
const addLicenceCategory = async (categoryData) => {
  try {
    const newCategory = await User.addLicenceCategory(categoryData);
    return newCategory;
  } catch (error) {
    console.error('Error adding licence category to database:', error);
    throw error;
  }
};

/**
 * Update existing licence category in database.
 * @param {string} categoryCode - Category code to update
 * @param {Object} categoryData - Updated category data
 * @returns {Object} Updated category details
 */
const updateLicenceCategory = async (categoryCode, categoryData) => {
  try {
    const updatedCategory = await User.updateLicenceCategory(categoryCode, categoryData);
    return updatedCategory;
  } catch (error) {
    console.error('Error updating licence category in database:', error);
    throw error;
  }
};

/**
 * Delete licence category (soft delete) from database.
 * @param {string} categoryCode - Category code to delete
 * @returns {Object} Deleted category details
 */
const deleteLicenceCategory = async (categoryCode) => {
  try {
    const deletedCategory = await User.deleteLicenceCategory(categoryCode);
    return deletedCategory;
  } catch (error) {
    console.error('Error deleting licence category from database:', error);
    throw error;
  }
};

/**
 * Calculates the total payment based on selected licence categories from database.
 * @param {Array} categories - Array of selected licence categories
 * @returns {Object} Payment calculation result
 */
const calculatePayment = async (categories) => {
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    throw new Error("An array of 'categories' is required.");
  }

  let totalAmount = 0;
  const breakdown = [];

  // Fetch each category from database to get current fees
  for (const categoryCode of categories) {
    try {
      const category = await User.getLicenceCategoryByCode(categoryCode);
      if (category) {
        const fee = parseFloat(category.fee);
        if (isNaN(fee)) {
          console.warn(`Invalid fee for category ${categoryCode}: ${category.fee}`);
          continue;
        }
        totalAmount += fee;
        breakdown.push({ 
          category: categoryCode, 
          fee: fee,
          description: category.description
        });
      }
    } catch (error) {
      console.warn(`Category ${categoryCode} not found in database:`, error.message);
    }
  }

  if (totalAmount === 0) {
    throw new Error("None of the provided categories are valid or have valid fees.");
  }

  return { totalAmount, breakdown };
};

/**
 * Fetches a mock medical certificate based on a user's NIC.
 * @param {string} sub - User's subject identifier
 * @returns {Object} Medical certificate data
 */
const getMedicalCertificate = async (sub) => {
  if (!sub) {
    throw new Error("Subject identifier is required.");
  }

  // Verify user exists in database
  const user = await User.findBySub(sub);
  if (!user) {
    throw new Error("User not found in database.");
  }

  const medicalCertificate = {
    certificateId: `MC-${Math.floor(10000 + Math.random() * 90000)}`,
    issuedDate: new Date().toISOString().split('T')[0],
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 1 year from now
    doctorName: "Dr. A. Silva",
    hospital: "National Hospital of Sri Lanka",
    bloodGroup: "O+",
    isFitToDrive: true,
    vision: "6/6 (Corrected)",
    hearing: "Normal",
    remarks: "Fit to operate all classes of motor vehicles."
  };

  return medicalCertificate;
};

/**
 * Get application history for a user
 * @param {string} sub - User's subject identifier
 * @returns {Array} User's application history
 */
const getApplicationHistory = async (sub) => {
  if (!sub) {
    throw new Error("Subject identifier is required.");
  }

  const applications = await User.getUserApplications(sub);
  return applications;
};

/**
 * Get application details by ID
 * @param {string} applicationId - Application ID
 * @returns {Object} Application details
 */
const getApplicationDetails = async (applicationId) => {
  if (!applicationId) {
    throw new Error("Application ID is required.");
  }

  const application = await User.findApplicationById(applicationId);
  if (!application) {
    throw new Error("Application not found.");
  }

  return application;
};


/**
 * Confirm payment status from external payment gateway
 * @param {string} paymentReferenceId - Payment reference ID
 * @param {boolean} paymentSuccess - Payment success status
 * @param {string} transactionId - Transaction ID from payment gateway
 * @returns {Object} Payment confirmation result
 */
const confirmPayment = async (formData) => {
  try {
    console.log('=== confirmPayment called ===');
    console.log('Form Data Received:', formData);

    // Debug: Check what selected_categories actually contains
    console.log('Type of selected_categories:', typeof formData.selectedCategories);
    console.log('Raw selected_categories value:', formData.selectedCategories);
    console.log('Is array?', Array.isArray(formData.selectedCategories));

    // Get selected_categories from formData
    let selectCategories = formData.selectedCategories;
    
    // Since we can see it's already an array ['B'], we can simplify the logic
    if (typeof selectCategories === 'string') {
      try {
        selectCategories = JSON.parse(selectCategories);
        console.log('Parsed selected categories from string:', selectCategories);
      } catch (parseError) {
        console.error('Error parsing selected_categories as JSON:', parseError);
        // If simple string, convert to array
        selectCategories = [selectCategories];
      }
    }

    // // Ensure it's an array (it should already be based on your data)
    // if (!Array.isArray(selectedCategories)) {
    //   // If it's not an array but exists, convert it
    //   if (selectedCategories !== null && selectedCategories !== undefined) {
    //     selectedCategories = [selectedCategories];
    //   } else {
    //     selectedCategories = [];
    //   }
    // }

    // console.log('Final selected categories:', selectedCategories);

    // Prepare application data for saving with all properties
    const applicationData = {
      // Personal Information
      sub: formData.sub,
      fullName: formData.fullName,
      email: formData.email,
      phone: formData.phone,
      dob: formData.dob,
      gender: formData.gender,
      blood_group: formData.bloodGroup,
      
      // Medical Certificate Information
      medical_certificate_id: formData.certificateId,
      doctorName: formData.doctorName,
      hospital: formData.hospital,
      issuedDate: formData.issuedDate,
      expiryDate: formData.expiryDate,
      isFitToDrive: formData.isFitToDrive,
      vision: formData.vision,
      hearing: formData.hearing,
      remarks: formData.remarks,
      photoUrl: formData.photoUrl,

      // Test Results
      writtenTest: formData.writtenTest,
      practicalTest: formData.practicalTest,

      // Application Details
      selectCategories: selectCategories,
      application_id: formData.certificateId, // Using certificateId as application_id
      status: formData.status || 'pending',
      
      // Payment Information (if available)
      total_amount: formData.total_amount || 0,
      payment_reference_id: formData.payment_reference_id,
      payment_transaction_id: formData.payment_transaction_id
    };

    console.log('Application data prepared:', applicationData);

    // Save the application
    const savedApp = await User.saveApplication(applicationData);
    console.log('Application saved successfully:', savedApp);

    return { 
      success: true, 
      applicationId: applicationData.application_id,
      status: applicationData.status
    };
  } catch (error) {
    console.error('Error in confirmPayment:', error);
    throw error;
  }
};
/**
 * Fetches written test results based on user's NIC
 * @param {string} sub - User's subject identifier
 * @returns {Object} Written test results
 */
const getWrittenTestResults = async (sub) => {
  if (!sub) {
    throw new Error("Subject identifier is required.");
  }

  // Verify user exists in database
  const user = await User.findBySub(sub);
  if (!user) {
    throw new Error("User not found in database.");
  }

  // Mock written test results - in real implementation, this would come from a test database
  const writtenTest = {
    testId: `WT-${Math.floor(10000 + Math.random() * 90000)}`,
    testDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days ago
    score: Math.floor(60 + Math.random() * 40), // Random score between 60-100
    totalQuestions: 50,
    correctAnswers: Math.floor(30 + Math.random() * 20),
    timeTaken: `${Math.floor(20 + Math.random() * 40)} minutes`,
    examinerName: "Mr. K. Perera",
    testCenter: "Colombo Driving Test Center",
    remarks: "Completed within allocated time"
  };

  return writtenTest;
};

/**
 * Fetches practical test results based on user's NIC
 * @param {string} sub - User's subject identifier
 * @returns {Object} Practical test results
 */
const getPracticalTestResults = async (sub) => {
  if (!sub) {
    throw new Error("Subject identifier is required.");
  }

  // Verify user exists in database
  const user = await User.findBySub(sub);
  if (!user) {
    throw new Error("User not found in database.");
  }

  // Mock practical test results
  const practicalTest = {
    testId: `PT-${Math.floor(10000 + Math.random() * 90000)}`,
    testDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 15 days ago
    testType: "Road Test",
    vehicleCategory: "B",
    score: Math.floor(70 + Math.random() * 30), // Random score between 70-100
    maxScore: 100,
    examinerName: "Mrs. S. Fernando",
    testRoute: "City Center Route",
    passed: Math.random() > 0.3, // 70% pass rate
    remarks: "Good vehicle control, needs improvement on parallel parking"
  };

  return practicalTest;
};

/**
 * Stores medical certificate for a user
 * @param {string} sub - User's subject identifier
 * @param {Object} certificateData - Medical certificate data
 * @returns {Object} Operation result
 */
const setMedicalCertificate = async (sub, certificateData) => {
  if (!sub || !certificateData) {
    throw new Error("Subject identifier and certificate data are required.");
  }

  // Verify user exists
  const user = await User.findBySub(sub);
  if (!user) {
    throw new Error("User not found in database.");
  }

  // In a real implementation, you would save this to a medical_certificates table
  // For now, we'll just return a success message
  console.log(`Medical certificate stored for user ${sub}:`, certificateData);
  
  return {
    success: true,
    message: "Medical certificate stored successfully",
    certificateId: certificateData.certificateId || `MC-${Date.now()}`,
    timestamp: new Date().toISOString()
  };
};

/**
 * Bulk update licence categories
 * @param {Array} categories - Array of category objects
 * @returns {Object} Operation result
 */
const setLicenceCategories = async (categories) => {
  if (!categories || !Array.isArray(categories)) {
    throw new Error("An array of categories is required.");
  }

  let updatedCount = 0;
  let addedCount = 0;
  const results = [];

  for (const category of categories) {
    try {
      // Check if category exists
      const existingCategory = await User.getLicenceCategoryByCode(category.category_code);
      
      if (existingCategory) {
        // Update existing category
        const updated = await User.updateLicenceCategory(category.category_code, category);
        results.push({ action: 'updated', category: category.category_code, data: updated });
        updatedCount++;
      } else {
        // Add new category
        const added = await User.addLicenceCategory(category);
        results.push({ action: 'added', category: category.category_code, data: added });
        addedCount++;
      }
    } catch (error) {
      results.push({ action: 'error', category: category.category_code, error: error.message });
    }
  }

  return {
    success: true,
    summary: {
      totalProcessed: categories.length,
      added: addedCount,
      updated: updatedCount,
      errors: categories.length - (addedCount + updatedCount)
    },
    details: results
  };
};

// Export all functions
module.exports = {
  post_GetToken,
  get_GetUserInfo,
  getMedicalCertificate,
  calculatePayment,
  getLicenceCategories,
  getLicenceCategoryByCode,
  addLicenceCategory,
  updateLicenceCategory,
  deleteLicenceCategory,
  getApplicationHistory,
  getApplicationDetails,
  confirmPayment,
  getWrittenTestResults,
  getPracticalTestResults,
  setMedicalCertificate,
  setLicenceCategories
};