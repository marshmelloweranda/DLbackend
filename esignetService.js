const axios = require("axios");
const jose = require("jose");
const { importJWK, SignJWT, decodeJwt } = require("jose");

const { ESIGNET_SERVICE_URL, ESIGNET_AUD_URL, CLIENT_ASSERTION_TYPE, CLIENT_PRIVATE_KEY, USERINFO_RESPONSE_TYPE, JWE_USERINFO_PRIVATE_KEY } = require("./config");

const baseUrl = ESIGNET_SERVICE_URL.trim();
const getTokenEndPoint = "/oauth/v2/token";
const getUserInfoEndPoint = "/oidc/userinfo";

const alg = "RS256";
const jweEncryAlgo = "RSA-OAEP-256";
const expirationTime = "1h";

// Predefined fees for each driving licence category
const categoryFees = {
    'A1': 1500.00,
    'A':  1500.00,
    'B1': 2000.00,
    'B':  2500.00,
    'C1': 3000.00,
    'C':  3500.00,
};

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

  return decodeUserInfoResponse(response.data);
};

/**
 * Generates client assertion signedJWT
 * @param {string} clientId registered client id
 * @returns client assertion signedJWT
 */
async function generateSignedJwt(clientId) {
  const privateKey = await importJWK(CLIENT_PRIVATE_KEY, alg);
  
  // Token endpoint URL - THIS IS CRITICAL!
  const tokenEndpoint = ESIGNET_SERVICE_URL+"/oauth/v2/token";

  const jwt = await new SignJWT({
      iss: clientId,    // Must equal client_id
      sub: clientId,    // Must equal client_id  
      aud: tokenEndpoint, // Must be EXACT token endpoint URL
      jti: generateUniqueId() // REQUIRED: Unique token ID
    })
    .setProtectedHeader({ 
      alg: "RS256",     // Typically RS256 for OAuth
      typ: "JWT" 
    })
    .setIssuedAt()
    .setExpirationTime("5m")  // 5-10 minutes max!
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
  // console.log("userInfoResponse", response);
  return await new jose.decodeJwt(response);
};

// ====================================================================
// NEW METHODS FOR DRIVING LICENCE APPLICATION FLOW
// ====================================================================

/**
 * Fetches a mock medical certificate based on a user's NIC.
 * @param {string} nic - User's NIC number
 * @returns {Object} Medical certificate data
 */
const getMedicalCertificate = async (nic) => {
  if (!nic) {
    throw new Error("NIC number is required.");
  }

  // Mock success response
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
 * Calculates the total payment based on selected licence categories.
 * @param {Array} categories - Array of selected licence categories
 * @returns {Object} Payment calculation result
 */
const calculatePayment = async (categories) => {
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    throw new Error("An array of 'categories' is required.");
  }

  let totalAmount = 0;
  const breakdown = [];

  categories.forEach(category => {
    if (categoryFees[category]) {
      totalAmount += categoryFees[category];
      breakdown.push({ category: category, fee: categoryFees[category] });
    }
  });

  if (totalAmount === 0) {
    throw new Error("None of the provided categories are valid.");
  }

  return { totalAmount, breakdown };
};

/**
 * Retrieves available licence categories with their details.
 * @returns {Array} List of licence categories
 */
const getLicenceCategories = async () => {
  const categories = [
    { id: 'A1', label: 'A1', description: 'Light Motor Cycle', fee: 1500.00 },
    { id: 'A',  label: 'A',  description: 'Motor Cycle', fee: 1500.00 },
    { id: 'B1', label: 'B1', description: 'Motor Tricycle', fee: 2000.00 },
    { id: 'B',  label: 'B',  description: 'Light Motor Car', fee: 2500.00 },
    { id: 'C1', label: 'C1', description: 'Light Motor Lorry', fee: 3000.00 },
    { id: 'C',  label: 'C',  description: 'Heavy Motor Lorry', fee: 3500.00 }
  ];
  
  return categories;
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

  // Mock success response with generated reference IDs
  const response = {
    status: "success",
    message: "Payment initiated. You will be redirected shortly.",
    paymentReferenceId: `PAY-${Date.now()}`,
    applicationId: `DMT-${userInfo.nic.slice(0, 5)}-${Math.floor(1000 + Math.random() * 9000)}`,
    paymentGatewayUrl: `https://mock-payment-gateway.com/pay?ref=PAY-${Date.now()}`
  };

  return response;
};

module.exports = {
  post_GetToken: post_GetToken,
  get_GetUserInfo: get_GetUserInfo,
  getMedicalCertificate: getMedicalCertificate,
  calculatePayment: calculatePayment,
  getLicenceCategories: getLicenceCategories,
  initiatePayment: initiatePayment
};