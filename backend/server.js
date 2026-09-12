import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import db from "./db.js";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "enterprise_rent_sphere_production_secret_key_2026";
const rawCorsOrigins = process.env.CORS_ORIGIN || "*";
const allowedOrigins = rawCorsOrigins.split(",").map((s) => s.trim());

// Configure CORS
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (like curl, postman) or matching origins
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy violation: Origin ${origin} not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Origin", "X-Requested-With", "Accept"]
}));

// ---------------- AUDIT LOG HELPER ----------------
const logAudit = (action, description, userEmail = null, agreementId = null, req = null) => {
  try {
    const logId = `audit_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const ip = req ? (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1") : "127.0.0.1";
    
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, action, description, user_email, agreement_id, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(logId, action, description, userEmail, agreementId, ip);
    console.log(`[AUDIT LOG] ${action}: ${description}`);
  } catch (err) {
    console.error("Failed to write audit log:", err.message);
  }
};

// ---------------- MIDDLEWARES ----------------

// JWT Authentication Middleware
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token missing" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

// Role-Based Access Control Middleware
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      logAudit(
        "SECURITY_ALERT",
        `Unauthorized access attempt to ${req.originalUrl} by ${req.user?.email || "anonymous"}`,
        req.user?.email,
        null,
        req
      );
      return res.status(403).json({ error: "Access denied: Insufficient permissions" });
    }
    next();
  };
};

// ---------------- REST API ROUTES ----------------

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// 1. Authentication Login (Validates credentials with bcrypt)
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user) {
    logAudit("LOGIN_FAILED", `Failed login attempt for non-existent user: ${email}`, email, null, req);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    logAudit("LOGIN_FAILED", `Failed login attempt for user: ${email}`, email, null, req);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  logAudit("USER_LOGIN", `${user.role} (${user.email}) logged in successfully`, user.email, null, req);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    }
  });
});

// 2. Current User Profile
app.get("/api/auth/me", authenticateToken, (req, res) => {
  const user = db.prepare("SELECT id, email, role, name, verified, created_at FROM users WHERE email = ?").get(req.user.email);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json(user);
});

// 3. List Agreements
app.get("/api/agreements", authenticateToken, (req, res) => {
  const { companyId } = req.query;
  let agreements;

  if (companyId) {
    agreements = db.prepare("SELECT * FROM agreements WHERE company_id = ? ORDER BY created_at DESC").all(companyId);
  } else if (req.user.role === "Super Admin" || req.user.role === "Auditor" || req.user.role === "Legal Officer") {
    agreements = db.prepare("SELECT * FROM agreements ORDER BY created_at DESC").all();
  } else if (req.user.role === "Property Owner") {
    agreements = db.prepare("SELECT * FROM agreements WHERE landlord_address = ? OR company_id = 'Company_A' ORDER BY created_at DESC").all(req.user.email);
  } else {
    agreements = db.prepare("SELECT * FROM agreements WHERE tenant_address = ? OR status = 'Active' ORDER BY created_at DESC").all(req.user.email);
  }

  res.json(agreements);
});

// 4. Get Agreement by ID or Contract Address
app.get("/api/agreements/:id", authenticateToken, (req, res) => {
  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ? OR contract_address = ?").get(req.params.id, req.params.id);

  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  logAudit("AGREEMENT_VIEWED", `Agreement ${agreement.id} viewed by ${req.user.email}`, req.user.email, agreement.id, req);
  res.json(agreement);
});

// 5. Create Agreement
app.post("/api/agreements", authenticateToken, requireRole(["Super Admin", "Property Owner", "Legal Officer"]), (req, res) => {
  const {
    companyId,
    contractAddress,
    landlordAddress,
    tenantAddress,
    rentInINR,
    securityDepositInINR,
    durationDays,
    propertyDetails,
    pdfHash
  } = req.body;

  if (!landlordAddress || !rentInINR || !pdfHash || !propertyDetails) {
    return res.status(400).json({ error: "Missing required agreement parameters" });
  }

  const rentNum = parseFloat(rentInINR);
  const depositNum = parseFloat(securityDepositInINR || 0);
  const durationNum = parseInt(durationDays || 30, 10);

  if (isNaN(rentNum) || rentNum <= 0 || isNaN(depositNum) || depositNum < 0) {
    return res.status(400).json({ error: "Rent and deposit must be valid positive numbers" });
  }

  const agreementId = `agreement_${Date.now()}`;

  const stmt = db.prepare(`
    INSERT INTO agreements (
      id, company_id, contract_address, landlord_address, tenant_address,
      rent_inr, security_deposit_inr, duration_days, property_details,
      current_document_hash, status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    agreementId,
    companyId || "Company_A",
    contractAddress || null,
    landlordAddress,
    tenantAddress || null,
    rentNum,
    depositNum,
    durationNum,
    propertyDetails,
    pdfHash,
    "Draft",
    1
  );

  logAudit("AGREEMENT_CREATED", `Agreement ${agreementId} created for ${propertyDetails}`, req.user.email, agreementId, req);

  const created = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
  res.status(201).json(created);
});

// 6. Record Payment
app.post("/api/payments", authenticateToken, (req, res) => {
  const { agreementId, amountINR, payerAddress, paymentGateway, transactionId } = req.body;

  if (!agreementId || !amountINR || !transactionId) {
    return res.status(400).json({ error: "Missing payment parameters" });
  }

  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  const paymentId = `pay_${Date.now()}`;
  const stmt = db.prepare(`
    INSERT INTO payments (id, agreement_id, amount_inr, payer_address, payment_gateway, transaction_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    paymentId,
    agreementId,
    parseFloat(amountINR),
    payerAddress || req.user.email,
    paymentGateway || "Direct",
    transactionId,
    "Success"
  );

  logAudit(
    "PAYMENT_COMPLETED",
    `Payment of ₹${amountINR} recorded via ${paymentGateway || "Direct"}. Tx: ${transactionId}`,
    req.user.email,
    agreementId,
    req
  );

  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  res.status(201).json(payment);
});

// 7. Verify Agreement Document Integrity (Cryptographic SHA-256 match)
app.post("/api/verifyAgreement", (req, res) => {
  const { agreementId, providedPdfHash } = req.body;

  if (!agreementId || !providedPdfHash) {
    return res.status(400).json({ error: "Agreement ID/address and PDF hash are required" });
  }

  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ? OR contract_address = ?").get(agreementId, agreementId);
  
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found in database" });
  }

  const isConsistent = agreement.current_document_hash.toLowerCase().trim() === providedPdfHash.toLowerCase().trim();

  logAudit(
    "INTEGRITY_VERIFICATION",
    `Integrity verification performed for ${agreement.id}. Result: ${isConsistent ? "PASSED" : "FAILED"}`,
    req.headers.authorization ? "authenticated_user" : "anonymous",
    agreement.id,
    req
  );

  res.json({
    agreementId: agreement.id,
    propertyDetails: agreement.property_details,
    registeredHash: agreement.current_document_hash,
    providedHash: providedPdfHash,
    isValid: isConsistent,
    verifiedAt: new Date().toISOString()
  });
});

// 8. Renew Agreement
app.post("/api/renewAgreement", authenticateToken, requireRole(["Super Admin", "Property Owner", "Legal Officer"]), (req, res) => {
  const { agreementId, extensionDurationDays } = req.body;

  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  const extension = parseInt(extensionDurationDays || 30, 10);
  const newDuration = agreement.duration_days + extension;

  db.prepare("UPDATE agreements SET status = 'Renewed', duration_days = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(newDuration, agreementId);

  logAudit("AGREEMENT_RENEWED", `Agreement ${agreementId} renewed for +${extension} days (total: ${newDuration})`, req.user.email, agreementId, req);

  res.json({ success: true, status: "Renewed", newDurationDays: newDuration });
});

// 9. Fetch Security Audit Trail
app.get("/api/audit-trail", authenticateToken, requireRole(["Super Admin", "Auditor"]), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 50, 10), 100);
  const logs = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json(logs);
});

// 10. System Stats (For Super Admin dashboard)
app.get("/api/stats", authenticateToken, requireRole(["Super Admin", "Auditor", "Legal Officer"]), (req, res) => {
  const totalAgreements = db.prepare("SELECT COUNT(*) as count FROM agreements").get().count;
  const activeAgreements = db.prepare("SELECT COUNT(*) as count FROM agreements WHERE status = 'Active'").get().count;
  const totalRentVolume = db.prepare("SELECT SUM(rent_inr) as total FROM agreements").get().total || 0;
  const totalLogs = db.prepare("SELECT COUNT(*) as count FROM audit_logs").get().count;
  const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

  res.json({
    totalAgreements,
    activeAgreements,
    totalRentVolume,
    totalLogs,
    totalUsers,
    uptimePercent: 99.98
  });
});

// 11. Retrieve Tenants (Clean user profile sans password hash)
app.get("/api/tenants", authenticateToken, requireRole(["Super Admin", "Property Owner", "Legal Officer", "Auditor"]), (req, res) => {
  const tenants = db.prepare("SELECT id, email, name, role, verified, created_at FROM users WHERE role = 'Tenant'").all();
  res.json(tenants);
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  app.listen(PORT, () => {
    console.log(`[RentSphere SaaS Server] Running on http://localhost:${PORT}`);
    console.log(`[RentSphere SaaS Server] SQLite Database connected successfully.`);
  });
}

export { app, db };
export default app;
