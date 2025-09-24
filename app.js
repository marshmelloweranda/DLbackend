const express = require("express");
const { PORT } = require("./config");
const { 
  post_GetToken, 
  get_GetUserInfo, 
  getMedicalCertificate, 
  calculatePayment, 
  getLicenceCategories, 
  initiatePayment 
} = require("./esignetService");
const app = express();
app.use(express.json());

// You need to enable CORS for your frontend to communicate with this backend
const cors = require('cors');

// Allow requests from your React App's origin (http://localhost:3001)
app.use(cors({
    origin: 'http://localhost:3001'
}));

app.get("/", (req, res) => {
  res.send("Welcome to Mock Relying Party REST APIs!!");
});

// ====================================================================
// AUTHENTICATION FLOW (Existing Endpoint)
// ====================================================================

/**
 * @route   POST /delegate/fetchUserInfo
 * @desc    Exchanges the authorization code for an access token and fetches user info.
 * @access  Public
 */
app.post("/delegate/fetchUserInfo", async (req, res) => {
  try {
    console.log("HI");
    const tokenResponse = await post_GetToken(req.body);
    console.log("token response", tokenResponse);
    if (tokenResponse.error) {
      return res.status(400).send(tokenResponse);
    }
    res.send(await get_GetUserInfo(tokenResponse.access_token));
  } catch (error) {
    console.log(error + " app js error");
    res.status(500).send(error);
  }
});

// ====================================================================
// NEW ENDPOINTS FOR DRIVING LICENCE APPLICATION FLOW
// ====================================================================

/**
 * @route   POST /api/medical-certificate
 * @desc    Fetches a mock medical certificate based on a user's NIC.
 * @access  Public (in a real app, this would be protected)
 * @body    { "nic": "199012345V" }
 */
app.post("/api/medical-certificate", async (req, res) => {
  try {
    const { nic } = req.body;

    if (!nic) {
      return res.status(400).json({ error: "NIC number is required in the request body." });
    }

    const medicalCertificate = await getMedicalCertificate(nic);
    res.status(200).json(medicalCertificate);
  } catch (error) {
    console.error("Error fetching medical certificate:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/calculate-payment
 * @desc    Calculates the total payment based on selected licence categories.
 * @access  Public
 * @body    { "categories": ["A1", "B"] }
 */
app.post("/api/calculate-payment", async (req, res) => {
  try {
    const { categories } = req.body;

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: "An array of 'categories' is required." });
    }

    const paymentResult = await calculatePayment(categories);
    res.status(200).json(paymentResult);
  } catch (error) {
    console.error("Error calculating payment:", error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route   GET /api/licence-categories
 * @desc    Retrieves available driving licence categories.
 * @access  Public
 */
app.get("/api/licence-categories", async (req, res) => {
  try {
    const categories = await getLicenceCategories();
    res.status(200).json(categories);
  } catch (error) {
    console.error("Error fetching licence categories:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/initiate-payment
 * @desc    Simulates the final step of initiating payment for the application.
 * @access  Public
 * @body    { "userInfo": {...}, "medicalCertificate": {...}, "selectedCategories": [...], "paymentDetails": {...} }
 */
app.post("/api/initiate-payment", async (req, res) => {
  try {
    const applicationData = req.body;

    if (!applicationData) {
      return res.status(400).json({ error: "Application data is required." });
    }

    const paymentResponse = await initiatePayment(applicationData);
    res.status(200).json(paymentResponse);
  } catch (error) {
    console.error("Error initiating payment:", error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/dmt/payment', (req, res) => {
  // Log to the console to show that the backend received the request before redirecting.
  // This is useful for debugging.
  console.log(`[${new Date().toLocaleTimeString('en-LK')}] Received request. Redirecting to: ${FRONTEND_URL}`);
  
  // Use the res.redirect() method to perform the redirection.
  // A 302 status code (Found - temporary redirect) is sent by default.
  res.redirect("c");
});

// PORT ENVIRONMENT VARIABLE
const port = PORT || 8888; // Ensure a default port
app.listen(port, () => console.log(`Listening on port ${port}..`));