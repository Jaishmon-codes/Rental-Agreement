import express from "express";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

// Enable CORS manual headers
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const JWT_SECRET = "enterprise_rent_sphere_secret_key_2026";

// Mock Database (Requirement 15: In-memory tables)
const db = {
  users: [
    { id: 1, email: "admin@rentsphere.com", role: "Super Admin", verified: true },
    { id: 2, email: "legal@rentsphere.com", role: "Legal Officer", verified: true },
    { id: 3, email: "landlord@gmail.com", role: "Property Owner", verified: true },
    { id: 4, email: "tenant@gmail.com", role: "Tenant", verified: true },
    { id: 5, email: "auditor@rentsphere.com", role: "Auditor", verified: true }
  ],
  agreements: [
    {
      id: "agreement_001",
      companyId: "Company_A", // Multi-Tenant separation
      landlordAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      tenantAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      rentInINR: 15000,
      securityDepositInINR: 30000,
      propertyDetails: "742 Evergreen Terrace, Springfield",
      currentDocumentHash: "a2b585dd299e03d12FA4293BC5de4111afa1a4b94908f83103eb1f1706367c2e6", // SHA256 of document
      status: "Active",
      version: 1
    }
  ],
  payments: [],
  auditLogs: []
};

// ---------------- MIDDLEWARES ----------------

// Authentication Middleware (Requirement 2)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Access token missing" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
};

// Role-Based Access Control Middleware (Requirement 1, 15)
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      // Log failed access attempt for security auditing
      logAudit("SECURITY_ALERT", `Unauthorized access attempt to ${req.originalUrl} by ${req.user?.email || "anonymous"}`);
      return res.status(403).json({ error: "Access denied: Insufficient permissions" });
    }
    next();
  };
};

// Logger helper for Audit Trail (Requirement 6)
const logAudit = (action, description, agreementId = null) => {
  const logEntry = {
    id: `audit_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    action,
    description,
    agreementId,
    timestamp: new Date().toISOString()
  };
  db.auditLogs.push(logEntry);
  console.log(`[AUDIT LOG] ${action}: ${description}`);
};

// ---------------- REST API ROUTES (Requirement 19) ----------------

// 1. Mock Authentication Login (Generates JWT)
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(u => u.email === email);

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Simple mock login (In production, use bcrypt/Argon2 password hashing)
  const token = jwt.sign({ email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "1h" });
  logAudit("USER_LOGIN", `${user.role} (${user.email}) logged in successfully`);
  
  res.json({ token, role: user.role, email: user.email });
});

// 2. Create Agreement (Requirement 19 - POST /agreements)
app.post("/api/agreements", authenticateToken, requireRole(["Super Admin", "Property Owner", "Legal Officer"]), (req, res) => {
  const { companyId, landlordAddress, tenantAddress, rentInINR, securityDepositInINR, propertyDetails, pdfHash } = req.body;

  if (!landlordAddress || !tenantAddress || !rentInINR || !pdfHash) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const newAgreement = {
    id: `agreement_${Date.now()}`,
    companyId,
    landlordAddress,
    tenantAddress,
    rentInINR,
    securityDepositInINR,
    propertyDetails,
    currentDocumentHash: pdfHash, // Blockchain ready SHA256 (Requirement 4)
    status: "Draft",
    version: 1
  };

  db.agreements.push(newAgreement);
  logAudit("AGREEMENT_CREATED", `Agreement draft ${newAgreement.id} created for property: ${propertyDetails}`, newAgreement.id);

  res.status(201).json(newAgreement);
});

// 3. Get Agreement by ID (Requirement 19 - GET /agreements/{id})
app.get("/api/agreements/:id", authenticateToken, requireRole(["Super Admin", "Property Owner", "Tenant", "Legal Officer", "Auditor"]), (req, res) => {
  const agreement = db.agreements.find(a => a.id === req.params.id);

  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  logAudit("AGREEMENT_VIEWED", `Agreement ${agreement.id} viewed by ${req.user.email}`, agreement.id);
  res.json(agreement);
});

// 4. Record Payment (Requirement 19 - POST /payments)
app.post("/api/payments", authenticateToken, requireRole(["Super Admin", "Tenant"]), (req, res) => {
  const { agreementId, amountINR, paymentGateway, transactionId } = req.body;

  const agreement = db.agreements.find(a => a.id === agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  const payment = {
    id: `pay_${Date.now()}`,
    agreementId,
    amountINR,
    paymentGateway, // e.g. Razorpay / Stripe (Requirement 9)
    transactionId,
    status: "Success",
    timestamp: new Date().toISOString()
  };

  db.payments.push(payment);
  logAudit("PAYMENT_COMPLETED", `INR Payment of ₹${amountINR} logged via ${paymentGateway}. Tx: ${transactionId}`, agreementId);

  res.status(201).json(payment);
});

// 5. Retrieve Tenants (Requirement 19 - GET /tenants)
app.get("/api/tenants", authenticateToken, requireRole(["Super Admin", "Property Owner", "Legal Officer", "Auditor"]), (req, res) => {
  const tenants = db.users.filter(u => u.role === "Tenant");
  res.json(tenants);
});

// 6. Verify Agreement integrity on-chain (Requirement 19 - POST /verifyAgreement)
app.post("/api/verifyAgreement", (req, res) => {
  const { agreementId, providedPdfHash } = req.body;

  const agreement = db.agreements.find(a => a.id === agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found in database" });
  }

  // Verifying SHA256 integrity (Requirement 4)
  const isConsistent = agreement.currentDocumentHash === providedPdfHash;

  logAudit("INTEGRITY_VERIFICATION", `Agreement integrity check executed. Result: ${isConsistent ? "PASSED" : "FAILED"}`, agreementId);

  res.json({
    agreementId,
    onChainHash: agreement.currentDocumentHash,
    providedHash: providedPdfHash,
    isValid: isConsistent
  });
});

// 7. Renew Agreement (Requirement 19 - POST /renewAgreement)
app.post("/api/renewAgreement", authenticateToken, requireRole(["Super Admin", "Property Owner", "Legal Officer"]), (req, res) => {
  const { agreementId, extensionDurationDays } = req.body;

  const agreement = db.agreements.find(a => a.id === agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  agreement.status = "Renewed";
  logAudit("AGREEMENT_RENEWED", `Agreement ${agreementId} renewed for another ${extensionDurationDays} days`, agreementId);

  res.json({ success: true, status: agreement.status });
});

// 8. Fetch Security Audit Trail logs (Requirement 6, 15)
app.get("/api/audit-trail", authenticateToken, requireRole(["Super Admin", "Auditor"]), (req, res) => {
  res.json(db.auditLogs);
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`[RentSphere SaaS Server] Running on http://localhost:${PORT}`);
  console.log(`[RBAC] Access rules and REST APIs initialized successfully.`);
});
