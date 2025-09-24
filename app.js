const express = require("express");
const { PORT } = require("./config");
const { 
  post_GetToken, 
  get_GetUserInfo, 
  getMedicalCertificate, 
  calculatePayment, 
  getLicenceCategories,
  getLicenceCategoryByCode,
  addLicenceCategory,
  updateLicenceCategory,
  deleteLicenceCategory,
  initiatePayment,
  getApplicationHistory,
  getApplicationDetails,
  confirmPayment
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
    console.log("Fetching user info from eSignet...");
    const tokenResponse = await post_GetToken(req.body);
    console.log("Token response received");
    
    if (tokenResponse.error) {
      return res.status(400).json(tokenResponse);
    }
    
    const userInfo = await get_GetUserInfo(tokenResponse.access_token);
    res.json(userInfo);
  } catch (error) {
    console.error("Error in fetchUserInfo:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ====================================================================
// NEW ENDPOINTS FOR DRIVING LICENCE APPLICATION FLOW
// ====================================================================

/**
 * @route   POST /api/medical-certificate
 * @desc    Fetches a mock medical certificate based on a user's subject identifier.
 * @access  Public (in a real app, this would be protected)
 * @body    { "sub": "user-subject-identifier" }
 */
app.post("/api/medical-certificate", async (req, res) => {
  try {
    const { sub } = req.body;

    if (!sub) {
      return res.status(400).json({ error: "User subject identifier (sub) is required." });
    }

    const medicalCertificate = await getMedicalCertificate(sub);
    res.json(medicalCertificate);
  } catch (error) {
    console.error("Error fetching medical certificate:", error.message);
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
    res.json(paymentResult);
  } catch (error) {
    console.error("Error calculating payment:", error.message);
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
    res.json(categories);
  } catch (error) {
    console.error("Error fetching licence categories:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/licence-categories/:categoryCode
 * @desc    Get specific licence category by code
 * @access  Public
 */
app.get("/api/licence-categories/:categoryCode", async (req, res) => {
  try {
    const { categoryCode } = req.params;
    const category = await getLicenceCategoryByCode(categoryCode);
    res.json(category);
  } catch (error) {
    console.error("Error fetching licence category:", error.message);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/licence-categories
 * @desc    Add new licence category (Admin function)
 * @access  Public (should be protected in production)
 */
app.post("/api/licence-categories", async (req, res) => {
  try {
    const categoryData = req.body;
    
    if (!categoryData.code || !categoryData.description || !categoryData.fee) {
      return res.status(400).json({ error: "Code, description, and fee are required fields." });
    }
    
    const newCategory = await addLicenceCategory(categoryData);
    res.status(201).json(newCategory);
  } catch (error) {
    console.error("Error adding licence category:", error.message);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route   PUT /api/licence-categories/:categoryCode
 * @desc    Update existing licence category (Admin function)
 * @access  Public (should be protected in production)
 */
app.put("/api/licence-categories/:categoryCode", async (req, res) => {
  try {
    const { categoryCode } = req.params;
    const categoryData = req.body;
    
    if (Object.keys(categoryData).length === 0) {
      return res.status(400).json({ error: "No data provided for update." });
    }
    
    const updatedCategory = await updateLicenceCategory(categoryCode, categoryData);
    res.json(updatedCategory);
  } catch (error) {
    console.error("Error updating licence category:", error.message);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route   DELETE /api/licence-categories/:categoryCode
 * @desc    Delete licence category (soft delete - Admin function)
 * @access  Public (should be protected in production)
 */
app.delete("/api/licence-categories/:categoryCode", async (req, res) => {
  try {
    const { categoryCode } = req.params;
    const deletedCategory = await deleteLicenceCategory(categoryCode);
    
    res.json({ 
      message: `Category ${categoryCode} deleted successfully`,
      category: deletedCategory 
    });
  } catch (error) {
    console.error("Error deleting licence category:", error.message);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
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

    // Validate required fields
    const { userInfo, medicalCertificate, selectedCategories, paymentDetails } = applicationData;
    
    if (!userInfo || !medicalCertificate || !selectedCategories || !paymentDetails) {
      return res.status(400).json({ 
        error: "Incomplete application data. userInfo, medicalCertificate, selectedCategories, and paymentDetails are required." 
      });
    }

  
    if (!userInfo.sub) {
      return res.status(400).json({ error: "User subject identifier (sub) is required." });
    }

    const paymentResponse = await initiatePayment(applicationData);
    res.json(paymentResponse);
  } catch (error) {
    console.error("Error initiating payment:", error.message);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route   POST /api/confirm-payment
 * @desc    Confirm payment status from payment gateway callback
 * @access  Public (this would be called by payment gateway)
 * @body    { "paymentReferenceId": "PAY-123", "paymentSuccess": true, "transactionId": "TXN-456" }
 */
app.post("/api/confirm-payment", async (req, res) => {
  try {
    const { paymentReferenceId, paymentSuccess, transactionId } = req.body;

    if (!paymentReferenceId || typeof paymentSuccess === 'undefined') {
      return res.status(400).json({ 
        error: "paymentReferenceId and paymentSuccess are required." 
      });
    }

    const paymentResult = await confirmPayment(paymentReferenceId, paymentSuccess, transactionId);
    res.json(paymentResult);
  } catch (error) {
    console.error("Error confirming payment:", error.message);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @route   GET /api/application-history/:sub
 * @desc    Get application history for a user
 * @access  Public (should be protected in production)
 */
app.get("/api/application-history/:sub", async (req, res) => {
  try {
    const { sub } = req.params;
    
    if (!sub) {
      return res.status(400).json({ error: "User subject identifier (sub) is required." });
    }

    const applications = await getApplicationHistory(sub);
    res.json(applications);
  } catch (error) {
    console.error("Error fetching application history:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/application-details/:applicationId
 * @desc    Get application details by ID
 * @access  Public (should be protected in production)
 */
app.get("/api/application-details/:applicationId", async (req, res) => {
  try {
    const { applicationId } = req.params;
    
    if (!applicationId) {
      return res.status(400).json({ error: "Application ID is required." });
    }

    const application = await getApplicationDetails(applicationId);
    res.json(application);
  } catch (error) {
    console.error("Error fetching application details:", error.message);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /dmt/payment
 * @desc    Redirect endpoint for payment (placeholder)
 * @access  Public
 */
app.get('/dmt/payment', (req, res) => {
  console.log(`[${new Date().toLocaleTimeString('en-LK')}] Received payment redirect request`);
  res.json({ 
    message: "Payment redirect endpoint", 
    note: "This would typically redirect to a payment gateway" 
  });
});

// ====================================================================
// ERROR HANDLING MIDDLEWARE
// ====================================================================

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error" });
});

// PORT ENVIRONMENT VARIABLE
const port = PORT || 8888;
app.listen(port, () => {
  console.log(`Driving Licence Application API server listening on port ${port}`);
  console.log(`CORS enabled for: http://localhost:3001`);
});