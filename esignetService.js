const axios = require("axios");
const jose = require("jose");
const { importJWK, SignJWT, decodeJwt } = require("jose");
const User = require("./models/userModel");

const { ESIGNET_SERVICE_URL, ESIGNET_AUD_URL, CLIENT_ASSERTION_TYPE, CLIENT_PRIVATE_KEY, USERINFO_RESPONSE_TYPE, JWE_USERINFO_PRIVATE_KEY } = require("./config");

const baseUrl = ESIGNET_SERVICE_URL.trim();
const getTokenEndPoint = "/oauth/v2/token";
const getUserInfoEndPoint = "/oidc/userinfo";

const alg = "RS256";
const jweEncryAlgo = "RSA-OAEP-256";
const expirationTime = "1h";

// Initialize database tables
User.initTables().catch(console.error);

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
  let request = new URLSearchParams({
    code: code,
    client_id: client_id,
    redirect_uri: redirect_uri,
    grant_type: grant_type,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: await generateSignedJwt(client_id),
  });
  const endpoint = baseUrl + getTokenEndPoint;
  console.log(endpoint);
  console.log(request);
  
  const response = await axios.post(endpoint, request, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  }).catch((e)=>console.log(e.message));
  
  return response.data;
};

/**
 * Triggers /oidc/userinfo API on esignet service to fetch userInformation
 * @param {string} access_token valid access token
 * @returns decrypted/decoded json user information
 */
const get_GetUserInfo = async (access_token) => {
  const endpoint = baseUrl + getUserInfoEndPoint;
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
    // Continue with the user info even if database save fails
  }
  
  return userInfo;
};

/**
 * Save user information to PostgreSQL database
 * @param {Object} userInfo User information from eSignet
 */
/**
 * Save user information to PostgreSQL database
 * @param {Object} userInfo User information from eSignet
 */
const saveUserToDatabase = async (userInfo) => {
  try {
    console.log('Raw userInfo from eSignet:', JSON.stringify(userInfo, null, 2));
    
    // Extract the actual NIC from eSignet response
    // eSignet might provide NIC in different fields - adjust based on actual response
    let nic = userInfo.nic || userInfo.sub;
    
    // If sub is a UUID and too long, try to find a proper NIC field
    if (nic && nic.length > 50) {
      console.warn('NIC value appears to be a UUID, looking for alternative NIC field');
      
      // Check common fields that might contain the actual NIC
      nic = userInfo.nic_number || userInfo.personal_number || userInfo.national_id || 
            userInfo.username || userInfo.preferred_username || userInfo.nic;
      
      // If still no proper NIC, use a truncated version or generate a placeholder
      if (!nic || nic.length > 50) {
        // Use the first 50 characters of sub as fallback
        nic = userInfo.sub.substring(0, 50);
        console.warn(`Using truncated sub as NIC: ${nic}`);
      }
    }
    
    // Validate NIC is present and not too long
    if (!nic) {
      throw new Error('NIC not found in eSignet response');
    }
    
    if (nic.length > 255) {
      nic = nic.substring(0, 255);
      console.warn(`NIC truncated to 255 characters: ${nic}`);
    }
    
    // Extract other user data with proper validation
    const userData = {
      nic: nic,
      name: userInfo.name || 'Unknown',
      email: userInfo.email || null,
      phone: userInfo.phone_number || userInfo.phone || null,
      date_of_birth: userInfo.birthdate || null,
      address: userInfo.address ? 
        (typeof userInfo.address === 'string' ? userInfo.address : JSON.stringify(userInfo.address)) : 
        null
    };
    
    // Validate required fields
    if (!userData.name || userData.name === 'Unknown') {
      console.warn('User name not provided, using fallback');
      userData.name = `User_${nic.substring(0, 10)}`;
    }

    console.log('Processed user data for saving:', userData);
    
    const savedUser = await User.saveUser(userData);
    console.log('User saved to database:', savedUser.nic);
    
    return savedUser;
  } catch (error) {
    console.error('Error saving user to database:', error);
    
    // Don't throw the error to prevent breaking the main flow
    // Just log it and continue
    console.log('Continuing without saving user to database...');
    return null;
  }
};

/**
 * Generates client assertion signedJWT
 * @param {string} clientId registered client id
 * @returns client assertion signedJWT
 */
async function generateSignedJwt(clientId) {
  const privateKey = await importJWK(CLIENT_PRIVATE_KEY, alg);
  
  const tokenEndpoint = ESIGNET_SERVICE_URL+"/oauth/v2/token";

  const jwt = await new SignJWT({
      iss: clientId,
      sub: clientId,  
      aud: tokenEndpoint,
      jti: generateUniqueId()
    })
    .setProtectedHeader({ 
      alg: "RS256",
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

  if (USERINFO_RESPONSE_TYPE.toLowerCase() === "jwe") {
    var decodeKey = Buffer.from(JWE_USERINFO_PRIVATE_KEY, 'base64')?.toString();
    const jwkObject = JSON.parse(decodeKey);
    const privateKeyObj = await jose.importJWK(jwkObject, jweEncryAlgo);

    try {
      const { plaintext, protectedHeader } = await jose.compactDecrypt(response, privateKeyObj)
      response = new TextDecoder().decode(plaintext);
    } catch (error) {
      try {
        const { plaintext } = await jose.flattenedDecrypt(response, privateKeyObj)
        response = new TextDecoder().decode(plaintext);
      } catch (error) {
        const { plaintext } = await jose.generalDecrypt(response, privateKeyObj)
        response = new TextDecoder().decode(plaintext);
      }
    }
  }
  return await new jose.decodeJwt(response);
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
        totalAmount += parseFloat(category.fee);
        breakdown.push({ 
          category: categoryCode, 
          fee: category.fee,
          description: category.description
        });
      }
    } catch (error) {
      console.warn(`Category ${categoryCode} not found in database`);
    }
  }

  if (totalAmount === 0) {
    throw new Error("None of the provided categories are valid.");
  }

  return { totalAmount, breakdown };
};

/**
 * Fetches a mock medical certificate based on a user's NIC.
 * @param {string} nic - User's NIC number
 * @returns {Object} Medical certificate data
 */
const getMedicalCertificate = async (nic) => {
  if (!nic) {
    throw new Error("NIC number is required.");
  }

  // Verify user exists in database
  const user = await User.findByNIC(nic);
  if (!user) {
    throw new Error("User not found in database.");
  }

  const medicalCertificate = {
    certificateId: `MC-${Math.floor(10000 + Math.random() * 90000)}`,
    issuedDate: "2025-08-15",
    expiryDate: "2026-08-14",
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
 * Simulates the final step of initiating payment for the application.
 * @param {Object} applicationData - Complete application data
 * @returns {Object} Payment initiation response
 */
const initiatePayment = async (applicationData) => {
  const { userInfo, medicalCertificate, selectedCategories, paymentDetails } = applicationData;

  if (!userInfo || !medicalCertificate || !selectedCategories || !paymentDetails) {
    throw new Error("Incomplete application data. Required fields are missing.");
  }

  if (!userInfo.nic || !paymentDetails.totalAmount) {
    throw new Error("User NIC and total amount are mandatory.");
  }

  // Find user in database
  const user = await User.findByNIC(userInfo.nic);
  if (!user) {
    throw new Error("User not found in database.");
  }

  const paymentReferenceId = `PAY-${Date.now()}`;
  const applicationId = `DMT-${userInfo.nic.slice(0, 5)}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Save application to database
  const applicationDataToSave = {
    user_id: user.id,
    application_id: applicationId,
    medical_certificate_id: medicalCertificate.certificateId,
    selected_categories: selectedCategories,
    total_amount: paymentDetails.totalAmount,
    payment_reference_id: paymentReferenceId
  };

  await User.saveApplication(applicationDataToSave);

  const response = {
    status: "success",
    message: "Payment initiated. You will be redirected shortly.",
    paymentReferenceId: paymentReferenceId,
    applicationId: applicationId,
    paymentGatewayUrl: `https://mock-payment-gateway.com/pay?ref=${paymentReferenceId}`
  };

  return response;
};

/**
 * Get application history for a user
 * @param {string} nic - User's NIC number
 * @returns {Array} User's application history
 */
const getApplicationHistory = async (nic) => {
  if (!nic) {
    throw new Error("NIC number is required.");
  }

  const applications = await User.getUserApplications(nic);
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

module.exports = {
  post_GetToken: post_GetToken,
  get_GetUserInfo: get_GetUserInfo,
  getMedicalCertificate: getMedicalCertificate,
  calculatePayment: calculatePayment,
  getLicenceCategories: getLicenceCategories,
  getLicenceCategoryByCode: getLicenceCategoryByCode,
  addLicenceCategory: addLicenceCategory,
  updateLicenceCategory: updateLicenceCategory,
  deleteLicenceCategory: deleteLicenceCategory,
  initiatePayment: initiatePayment,
  getApplicationHistory: getApplicationHistory,
  getApplicationDetails: getApplicationDetails
};