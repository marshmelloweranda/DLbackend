const express = require("express");
const { PORT } = require("./config");
const { post_GetToken, get_GetUserInfo } = require("./esignetService");
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
    const tokenResponse = await post_GetToken(req.body);
    res.send(await get_GetUserInfo(tokenResponse.access_token));
  } catch (error) {
    console.log(error)
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
app.post("/api/medical-certificate", (req, res) => {
  const { nic } = req.body;

  if (!nic) {
    return res.status(400).json({ error: "NIC number is required in the request body." });
  }

  // Simple mock logic: If NIC's last digit before 'V' is even, success. If odd, fail.
  // This helps you test both success and failure scenarios on the frontend.
 
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
    res.status(200).json(medicalCertificate);
  } 
);


/**
 * @route   POST /api/calculate-payment
 * @desc    Calculates the total payment based on selected licence categories.
 * @access  Public
 * @body    { "categories": ["A1", "B"] }
 */
app.post("/api/calculate-payment", (req, res) => {
    const { categories } = req.body;

    if (!categories || !Array.isArray(categories) || categories.length === 0) {
        return res.status(400).json({ error: "An array of 'categories' is required." });
    }

    // Predefined fees for each driving licence category
    const categoryFees = {
        'A1': 1500.00,
        'A':  1500.00,
        'B1': 2000.00,
        'B':  2500.00,
        'C1': 3000.00,
        'C':  3500.00,
    };

    let totalAmount = 0;
    const breakdown = [];

    categories.forEach(category => {
        if (categoryFees[category]) {
            totalAmount += categoryFees[category];
            breakdown.push({ category: category, fee: categoryFees[category] });
        }
    });

    if (totalAmount === 0) {
        return res.status(400).json({ error: "None of the provided categories are valid." });
    }

    res.status(200).json({ totalAmount, breakdown });
});

app.get("/api/licence-categories", (req, res) => {
  // In a real application, this data would come from a database.
  const categories = [
    { id: 'A1', label: 'A1', description: 'Light Motor Cycle', fee: 1500.00 },
    { id: 'A',  label: 'A',  description: 'Motor Cycle', fee: 1500.00 },
    { id: 'B1', label: 'B1', description: 'Motor Tricycle', fee: 2000.00 },
    { id: 'B',  label: 'B',  description: 'Light Motor Car', fee: 2500.00 },
    { id: 'C1', label: 'C1', description: 'Light Motor Lorry', fee: 3000.00 },
    { id: 'C',  label: 'C',  description: 'Heavy Motor Lorry', fee: 3500.00 }
  ];
  res.status(200).json(categories);
});


/**
 * @route   POST /api/initiate-payment
 * @desc    Simulates the final step of initiating payment for the application.
 * @access  Public
 * @body    { "userInfo": {...}, "medicalCertificate": {...}, "selectedCategories": [...], "paymentDetails": {...} }
 */
app.post("/api/initiate-payment", (req, res) => {
    const { userInfo, medicalCertificate, selectedCategories, paymentDetails } = req.body;

    // Basic validation to ensure the payload from the frontend is correct
    if (!userInfo || !medicalCertificate || !selectedCategories || !paymentDetails) {
        return res.status(400).json({ error: "Incomplete application data. Required fields are missing." });
    }

    if (!userInfo.nic || !paymentDetails.totalAmount) {
         return res.status(400).json({ error: "User NIC and total amount are mandatory." });
    }

    // Mock success response with generated reference IDs
    const response = {
        status: "success",
        message: "Payment initiated. You will be redirected shortly.",
        paymentReferenceId: `PAY-${Date.now()}`,
        applicationId: `DMT-${userInfo.nic.slice(0, 5)}-${Math.floor(1000 + Math.random() * 9000)}`,
        // In a real application, you would generate and return a URL for a payment gateway
        paymentGatewayUrl: `https://mock-payment-gateway.com/pay?ref=PAY-${Date.now()}`
    };

    res.status(200).json(response);
});


//PORT ENVIRONMENT VARIABLE
const port = PORT || 8888; // Ensure a default port
app.listen(port, () => console.log(`Listening on port ${port}..`));
