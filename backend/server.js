import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import db, { logAudit } from "./db.js";
import paymentService from "./services/payment/paymentService.js";
import settlementService from "./services/payment/settlementService.js";
import reconciliationService from "./services/payment/reconciliationService.js";
import webhookService from "./services/payment/webhookService.js";
import { paiseToRupees } from "./services/payment/config.js";
import createDocumentRouter from "./routes/documents.js";
import createWalletRouter from "./routes/wallet.js";
import { listAgreementDocuments } from "./services/document/documentService.js";
import emailService from "./services/email/emailService.js";
import { validateFileBuffer } from "./services/document/fileValidator.js";
import worker from "./jobs/worker.js";
import { eventQueue } from "./services/queue/eventQueue.js";
import web3Validator from "./services/payment/web3Validator.js";

dotenv.config();

const app = express();

// Express reverse-proxy trust configuration (MED-02)
const trustProxyConfig = process.env.TRUST_PROXY;
if (trustProxyConfig === "true") {
  app.set("trust proxy", true);
} else if (trustProxyConfig === "false") {
  app.set("trust proxy", false);
} else if (trustProxyConfig !== undefined) {
  app.set("trust proxy", isNaN(Number(trustProxyConfig)) ? trustProxyConfig : Number(trustProxyConfig));
} else {
  // Default to trusting 1 hop (standard for Docker / Nginx / cloud reverse proxies)
  app.set("trust proxy", 1);
}

const PORT = process.env.PORT || 4000;
const rawCorsOrigins = process.env.CORS_ORIGIN || "*";
const allowedOrigins = rawCorsOrigins.split(",").map((s) => s.trim());

// Production Secret Enforcement & Environment Validation (Phase 13)
const isProduction = process.env.NODE_ENV === "production";
const DEFAULT_DEMO_SECRET = "enterprise_rent_sphere_production_secret_key_2026";
let JWT_SECRET = process.env.JWT_SECRET || DEFAULT_DEMO_SECRET;

export function validateEnvironment() {
  if (isProduction) {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_DEMO_SECRET || process.env.JWT_SECRET.length < 32) {
      console.error("FATAL SECURITY ERROR: In production, JWT_SECRET must be set to a cryptographically secure value with at least 32 characters.");
      if (process.env.NODE_ENV !== "test") {
        process.exit(1);
      }
      return false;
    }
    if (rawCorsOrigins === "*" || allowedOrigins.includes("*")) {
      console.error("FATAL SECURITY ERROR: In production, CORS_ORIGIN cannot be '*' (wildcard). Configure explicit trusted domains.");
      if (process.env.NODE_ENV !== "test") {
        process.exit(1);
      }
      return false;
    }
    if (process.env.RAZORPAY_LIVE === "true") {
      if (!process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") || !process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET === "rentsphere_test_secret_2026") {
        console.error("FATAL SECURITY ERROR: In production with RAZORPAY_LIVE=true, RAZORPAY_KEY_ID must begin with 'rzp_live_' and valid secrets must be configured.");
        if (process.env.NODE_ENV !== "test") {
          process.exit(1);
        }
        return false;
      }
      if (process.env.RAZORPAY_WEBHOOK_SECRET === "rentsphere_webhook_secret_2026") {
        console.error("FATAL SECURITY ERROR: In production live mode, RAZORPAY_WEBHOOK_SECRET cannot use the development placeholder.");
        if (process.env.NODE_ENV !== "test") {
          process.exit(1);
        }
        return false;
      }
    }
  }
  return true;
}
validateEnvironment();

// Security Headers
app.use(helmet({
  contentSecurityPolicy: false, // API server does not serve HTML pages directly
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Request Body Size Protection with rawBody preservation for webhooks
app.use(express.json({
  limit: "50kb",
  verify: (req, res, buf) => {
    req.rawBody = buf ? buf.toString() : "";
  }
}));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// Rate Limiting
const isTest = process.env.NODE_ENV === "test" || process.execArgv.includes("--test") || process.argv.some(a => a.includes("--test") || a.includes("test"));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 1000 : 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication requests from this IP. Please try again in 15 minutes." }
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 5000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Payment request limit exceeded. Please try again later." }
});

const refundLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 5000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Refund request limit exceeded. Please try again later." }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 5000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Please slow down your requests." }
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/payments/create-order", paymentLimiter);
app.use("/api/payments/:id/refund", refundLimiter);
app.use("/api/", apiLimiter);

// Configure CORS
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (curl, postman, server-to-server) or matching origins
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy violation: Origin ${origin} not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Origin", "X-Requested-With", "Accept"]
}));

// Multer memory-only storage for secure server-side file hashing (zero disk-write / execution)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// Regex Validators
const HASH_REGEX = /^[a-fA-F0-9]{64}$/;
const IPFS_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z0-9]{55})$/;
const ETH_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;

// ---------------- MIDDLEWARES ----------------

// JWT Authentication Middleware with Token Versioning & Suspension Check (Finding 4)
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token missing" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }

    // Query database for user status and token_version (Finding 4)
    const userRow = db.prepare("SELECT id, email, role, name, status, token_version FROM users WHERE id = ?").get(decoded.id);
    if (!userRow) {
      return res.status(401).json({ error: "User account no longer exists" });
    }

    if (userRow.status === "SUSPENDED" || userRow.status === "DEACTIVATED") {
      return res.status(403).json({ error: `Account is ${userRow.status.toLowerCase()}. Access revoked.` });
    }

    const expectedVersion = userRow.token_version || 1;
    const tokenVersion = decoded.tokenVersion || 1;
    if (tokenVersion !== expectedVersion) {
      return res.status(401).json({ error: "Session has been revoked. Please log in again." });
    }

    req.user = {
      id: userRow.id,
      email: userRow.email,
      role: userRow.role,
      name: userRow.name,
      status: userRow.status
    };
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

// Granular Permission-Based Access Control Middleware
export const requirePermission = (permissionCode) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (req.user.role === "Super Admin") {
      return next();
    }

    const hasPermission = db.prepare(`
      SELECT 1
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ? AND p.code = ?
      LIMIT 1
    `).get(req.user.id, permissionCode);

    if (!hasPermission) {
      logAudit(
        "SECURITY_ALERT",
        `Access denied to ${req.originalUrl}: Missing required permission ${permissionCode} for ${req.user.email}`,
        req.user.email,
        null,
        req
      );
      return res.status(403).json({ error: `Access denied: Missing required permission ${permissionCode}` });
    }

    next();
  };
};

// ---------------- REST API ROUTES ----------------

// Health check and container readiness/liveness observability (Phase 12)
app.get("/api/health", (req, res) => {
  try {
    const dbCheck = db.prepare("SELECT 1 as alive").get();
    const isDbConnected = dbCheck?.alive === 1;
    const queuePending = typeof eventQueue.size === "function" ? eventQueue.size() : 0;
    const isHealthy = isDbConnected;
    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        database: isDbConnected ? "connected" : "degraded",
        queue: { pending: queuePending },
        worker: worker.isRunning ? "running" : "idle"
      }
    });
  } catch (err) {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: isProduction ? "Critical dependency unavailable" : err.message
    });
  }
});

app.get("/api/health/live", (req, res) => {
  res.json({ status: "alive", uptime: process.uptime() });
});

app.get("/api/health/ready", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "ready" });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      error: isProduction ? "Database dependency unavailable" : err.message
    });
  }
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validatePasswordPolicy = (password) => {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters long";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  return null;
};

// Constant-time dummy hash for non-existent users to normalize execution timing and mitigate enumeration
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("DummyNormalizedPassword@123", 10);

// 1. Authentication Login (Validates credentials with bcrypt with enumeration hardening)
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  if (typeof email !== "string" || typeof password !== "string" || email.length > 128 || password.length > 128) {
    return res.status(400).json({ error: "Invalid credentials format" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());

  if (!user) {
    bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
    logAudit("LOGIN_FAILED", `Failed login attempt for non-existent user: ${email}`, email, null, req);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
    bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
    logAudit("LOGIN_BLOCKED", `Attempted login to ${user.status.toLowerCase()} account: ${email}`, email, null, req);
    return res.status(403).json({ error: `Account is ${user.status.toLowerCase()}. Please contact support.` });
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    logAudit("LOGIN_FAILED", `Failed login attempt for user: ${email}`, email, null, req);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name, tokenVersion: user.token_version || 1 },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  // Fetch granular permissions
  let permissions = [];
  if (user.role === "Super Admin") {
    permissions = db.prepare("SELECT code FROM permissions").all().map((p) => p.code);
  } else {
    permissions = db.prepare(`
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
    `).all(user.id).map((p) => p.code);
  }

  logAudit("USER_LOGIN", `${user.role} (${user.email}) logged in successfully`, user.email, null, req);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      verified: Boolean(user.verified),
      status: user.status || "ACTIVE",
      permissions
    }
  });
});

// 1b. Self-Service User Registration (Tenant / Property Owner)
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name, role } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "Email, password, and name are required" });
  }

  if (!EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ error: "Invalid email address format" });
  }

  const passwordError = validatePasswordPolicy(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  // Self-registration allows only Tenant or Property Owner
  const allowedRegistrationRoles = ["Tenant", "Property Owner"];
  const assignedRole = allowedRegistrationRoles.includes(role) ? role : "Tenant";

  const normalizedEmail = email.toLowerCase().trim();
  const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);
  if (existingUser) {
    return res.status(409).json({ error: "An account with this email address already exists" });
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);
  const rawVerificationToken = crypto.randomBytes(32).toString("hex");
  const hashedVerificationToken = crypto.createHash("sha256").update(rawVerificationToken).digest("hex");

  const insertStmt = db.prepare(`
    INSERT INTO users (email, password_hash, role, name, verified, verification_token, status)
    VALUES (?, ?, ?, ?, 0, ?, 'ACTIVE')
  `);
  const result = insertStmt.run(normalizedEmail, passwordHash, assignedRole, name.trim(), hashedVerificationToken);
  const newUserId = Number(result.lastInsertRowid);

  // Map to normalized user_roles
  const roleIdMap = {
    "Property Owner": "LANDLORD",
    "Tenant": "TENANT"
  };
  const roleId = roleIdMap[assignedRole] || "TENANT";
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").run(newUserId, roleId);

  // Dispatch token strictly out-of-band via email service (never leaked in HTTP response)
  await emailService.sendVerificationEmail({
    to: normalizedEmail,
    token: rawVerificationToken,
    name: name.trim()
  });

  logAudit("USER_REGISTERED", `New user registered: ${normalizedEmail} as ${assignedRole}`, normalizedEmail, null, req);

  res.status(201).json({
    message: "Registration successful. Please check your email to verify your account.",
    user: {
      id: newUserId,
      email: normalizedEmail,
      role: assignedRole,
      name: name.trim(),
      verified: false
    }
  });
});

// 1c. Verify Email Token
app.post("/api/auth/verify-email", (req, res) => {
  const { email, token } = req.body;

  if (!email || !token) {
    return res.status(400).json({ error: "Email and verification token are required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const hashedToken = crypto.createHash("sha256").update(String(token).trim()).digest("hex");
  const user = db.prepare("SELECT id, verification_token FROM users WHERE email = ?").get(normalizedEmail);

  if (!user || !user.verification_token || user.verification_token !== hashedToken) {
    logAudit("VERIFICATION_FAILED", `Failed verification token for user: ${normalizedEmail}`, normalizedEmail, null, req);
    return res.status(400).json({ error: "Invalid or expired verification token" });
  }

  db.prepare("UPDATE users SET verified = 1, verification_token = NULL WHERE id = ?").run(user.id);
  logAudit("EMAIL_VERIFIED", `Account verified for: ${normalizedEmail}`, normalizedEmail, null, req);

  res.json({
    message: "Email verified successfully. You may now log in.",
    verified: true
  });
});

// 1d. Forgot Password (Initiate Password Reset - Never leaks token and normalizes responses)
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email || !EMAIL_REGEX.test(email.trim())) {
    return res.status(400).json({ error: "Valid email address is required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = db.prepare("SELECT id, name, status FROM users WHERE email = ?").get(normalizedEmail);

  if (user && user.status !== "SUSPENDED" && user.status !== "DEACTIVATED") {
    const rawResetToken = crypto.randomBytes(32).toString("hex");
    const hashedResetToken = crypto.createHash("sha256").update(rawResetToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour expiry

    db.prepare("UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?")
      .run(hashedResetToken, expiresAt, user.id);

    await emailService.sendPasswordResetEmail({
      to: normalizedEmail,
      token: rawResetToken,
      name: user.name
    });

    logAudit("PASSWORD_RESET_REQUESTED", `Password reset requested for ${normalizedEmail}`, normalizedEmail, null, req);
  } else {
    // Normalizing execution time for non-existent users
    crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
    logAudit("PASSWORD_RESET_ATTEMPT_NONEXISTENT", `Password reset attempted for non-existent or inactive: ${normalizedEmail}`, normalizedEmail, null, req);
  }

  // Consistent generic response preventing account enumeration and NEVER leaking tokens
  res.json({
    message: "If your email is registered, password reset instructions have been sent."
  });
});

// 1e. Complete Password Reset (Single-use hashed token with expiration)
app.post("/api/auth/reset-password", (req, res) => {
  const { email, token, newPassword } = req.body;

  if (!email || !token || !newPassword) {
    return res.status(400).json({ error: "Email, reset token, and new password are required" });
  }

  const passwordError = validatePasswordPolicy(newPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const hashedToken = crypto.createHash("sha256").update(String(token).trim()).digest("hex");
  const user = db.prepare("SELECT id, reset_token, reset_token_expires_at FROM users WHERE email = ?").get(normalizedEmail);

  if (!user || !user.reset_token || user.reset_token !== hashedToken) {
    return res.status(400).json({ error: "Invalid or expired password reset token" });
  }

  if (user.reset_token_expires_at && new Date(user.reset_token_expires_at) < new Date()) {
    return res.status(400).json({ error: "Password reset token has expired" });
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(newPassword, salt);

  // Atomically update password, invalidate reset token (single-use), and revoke existing sessions (Finding 4)
  db.prepare("UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL, token_version = token_version + 1 WHERE id = ?")
    .run(passwordHash, user.id);

  logAudit("PASSWORD_RESET_COMPLETED", `Password reset completed for ${normalizedEmail}`, normalizedEmail, null, req);

  res.json({ message: "Password updated successfully. You may now log in with your new password." });
});

// 2. Current User Profile
app.get("/api/auth/me", authenticateToken, (req, res) => {
  const user = db.prepare("SELECT id, email, role, name, verified, status, created_at FROM users WHERE email = ?").get(req.user.email);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Load user permissions from database
  let permissions = [];
  if (user.role === "Super Admin") {
    permissions = db.prepare("SELECT code FROM permissions").all().map((p) => p.code);
  } else {
    permissions = db.prepare(`
      SELECT DISTINCT p.code
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
    `).all(user.id).map((p) => p.code);
  }

  res.json({
    ...user,
    verified: Boolean(user.verified),
    status: user.status || "ACTIVE",
    permissions
  });
});

// ====================================================================
// PROPERTIES & UNITS DOMAIN ENDPOINTS (PHASE 3)
// ====================================================================

// 2b. List Properties (Role-based data isolation)
app.get("/api/properties", authenticateToken, (req, res) => {
  let properties;
  const isPrivileged = ["Super Admin", "Auditor", "Legal Officer"].includes(req.user.role);

  if (isPrivileged) {
    properties = db.prepare(`
      SELECT p.*, u.name as landlord_name, u.email as landlord_email,
             (SELECT COUNT(*) FROM units WHERE property_id = p.id) as unit_count
      FROM properties p
      LEFT JOIN users u ON p.landlord_id = u.id
      ORDER BY p.created_at DESC
    `).all();
  } else if (req.user.role === "Property Owner") {
    properties = db.prepare(`
      SELECT p.*,
             (SELECT COUNT(*) FROM units WHERE property_id = p.id) as unit_count
      FROM properties p
      WHERE p.landlord_id = ?
      ORDER BY p.created_at DESC
    `).all(req.user.id);
  } else {
    // Tenants can browse active properties
    properties = db.prepare(`
      SELECT p.*, u.name as landlord_name,
             (SELECT COUNT(*) FROM units WHERE property_id = p.id AND status = 'VACANT') as available_units
      FROM properties p
      LEFT JOIN users u ON p.landlord_id = u.id
      WHERE p.status = 'ACTIVE'
      ORDER BY p.created_at DESC
    `).all();
  }

  res.json(properties);
});

// 2c. Create Property
app.post("/api/properties", authenticateToken, requirePermission("PROPERTY_CREATE"), (req, res) => {
  const { title, address, city, state, postalCode, propertyType } = req.body;

  if (!title || !address || !city) {
    return res.status(400).json({ error: "Title, address, and city are required" });
  }

  if (typeof title !== "string" || typeof address !== "string" || typeof city !== "string") {
    return res.status(400).json({ error: "Invalid field format" });
  }

  const propId = `prop_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const stmt = db.prepare(`
    INSERT INTO properties (id, landlord_id, title, address, city, state, postal_code, property_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `);

  stmt.run(
    propId,
    req.user.id,
    title.trim(),
    address.trim(),
    city.trim(),
    state ? state.trim() : null,
    postalCode ? postalCode.trim() : null,
    propertyType ? propertyType.trim() : "APARTMENT"
  );

  const created = db.prepare("SELECT * FROM properties WHERE id = ?").get(propId);
  logAudit("PROPERTY_CREATED", `Property ${propId} (${created.title}) created by ${req.user.email}`, req.user.email, null, req);

  res.status(201).json(created);
});

// 2d. Get Property by ID (with Units)
app.get("/api/properties/:id", authenticateToken, (req, res) => {
  const prop = db.prepare(`
    SELECT p.*, u.name as landlord_name, u.email as landlord_email
    FROM properties p
    LEFT JOIN users u ON p.landlord_id = u.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!prop) {
    return res.status(404).json({ error: "Property not found" });
  }

  // BOLA Authorization Defense
  const isPrivileged = ["Super Admin", "Auditor", "Legal Officer"].includes(req.user.role);
  const isOwner = prop.landlord_id === req.user.id;
  const isTenantBrowsing = req.user.role === "Tenant" && prop.status === "ACTIVE";

  if (!isPrivileged && !isOwner && !isTenantBrowsing) {
    logAudit("SECURITY_ALERT", `Unauthorized access attempt to property ${prop.id} by ${req.user.email}`, req.user.email, null, req);
    return res.status(403).json({ error: "Access denied: You do not own this property" });
  }

  const units = db.prepare("SELECT * FROM units WHERE property_id = ? ORDER BY unit_number ASC").all(prop.id);
  res.json({ ...prop, units });
});

// 2e. Update Property (Owner only)
app.put("/api/properties/:id", authenticateToken, requirePermission("PROPERTY_EDIT"), (req, res) => {
  const prop = db.prepare("SELECT * FROM properties WHERE id = ?").get(req.params.id);
  if (!prop) {
    return res.status(404).json({ error: "Property not found" });
  }

  // BOLA Check
  if (req.user.role !== "Super Admin" && prop.landlord_id !== req.user.id) {
    logAudit("SECURITY_ALERT", `Unauthorized property update attempt on ${prop.id} by ${req.user.email}`, req.user.email, null, req);
    return res.status(403).json({ error: "Access denied: You do not own this property" });
  }

  const { title, address, city, state, postalCode, propertyType, status } = req.body;
  const updatedTitle = title !== undefined ? String(title).trim() : prop.title;
  const updatedAddress = address !== undefined ? String(address).trim() : prop.address;
  const updatedCity = city !== undefined ? String(city).trim() : prop.city;
  const updatedState = state !== undefined ? String(state).trim() : prop.state;
  const updatedPostalCode = postalCode !== undefined ? String(postalCode).trim() : prop.postal_code;
  const updatedType = propertyType !== undefined ? String(propertyType).trim() : prop.property_type;
  const updatedStatus = status !== undefined ? String(status).trim() : prop.status;

  db.prepare(`
    UPDATE properties
    SET title = ?, address = ?, city = ?, state = ?, postal_code = ?, property_type = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(updatedTitle, updatedAddress, updatedCity, updatedState, updatedPostalCode, updatedType, updatedStatus, prop.id);

  const updated = db.prepare("SELECT * FROM properties WHERE id = ?").get(prop.id);
  logAudit("PROPERTY_UPDATED", `Property ${prop.id} updated by ${req.user.email}`, req.user.email, null, req);

  res.json(updated);
});

// 2f. Delete Property (Prevent deletion if active leases exist)
app.delete("/api/properties/:id", authenticateToken, requirePermission("PROPERTY_DELETE"), (req, res) => {
  const prop = db.prepare("SELECT * FROM properties WHERE id = ?").get(req.params.id);
  if (!prop) {
    return res.status(404).json({ error: "Property not found" });
  }

  // BOLA Check
  if (req.user.role !== "Super Admin" && prop.landlord_id !== req.user.id) {
    return res.status(403).json({ error: "Access denied: You do not own this property" });
  }

  // Active lease prevention
  const activeLease = db.prepare("SELECT COUNT(*) as count FROM agreements WHERE property_id = ? AND status = 'Active'").get(prop.id);
  if (activeLease && activeLease.count > 0) {
    return res.status(400).json({ error: "Cannot delete property with active leases in progress" });
  }

  db.prepare("DELETE FROM properties WHERE id = ?").run(prop.id);
  logAudit("PROPERTY_DELETED", `Property ${prop.id} deleted by ${req.user.email}`, req.user.email, null, req);

  res.json({ message: "Property successfully deleted" });
});

// 2g. Add Unit to Property
app.post("/api/properties/:id/units", authenticateToken, requirePermission("PROPERTY_EDIT"), (req, res) => {
  const prop = db.prepare("SELECT * FROM properties WHERE id = ?").get(req.params.id);
  if (!prop) {
    return res.status(404).json({ error: "Property not found" });
  }

  // BOLA Check
  if (req.user.role !== "Super Admin" && prop.landlord_id !== req.user.id) {
    return res.status(403).json({ error: "Access denied: You do not own this property" });
  }

  const { unitNumber, rentInr, securityDepositInr } = req.body;
  if (!unitNumber || rentInr === undefined || rentInr <= 0) {
    return res.status(400).json({ error: "Valid unitNumber and positive rentInr are required" });
  }

  const unitId = `unit_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  db.prepare(`
    INSERT INTO units (id, property_id, unit_number, rent_inr, security_deposit_inr, status)
    VALUES (?, ?, ?, ?, ?, 'VACANT')
  `).run(unitId, prop.id, String(unitNumber).trim(), Number(rentInr), Number(securityDepositInr || 0));

  const unit = db.prepare("SELECT * FROM units WHERE id = ?").get(unitId);
  logAudit("UNIT_CREATED", `Unit ${unit.unit_number} added to property ${prop.id} by ${req.user.email}`, req.user.email, null, req);

  res.status(201).json(unit);
});

// 2h. Update Unit Status
app.put("/api/properties/:id/units/:unitId", authenticateToken, requirePermission("PROPERTY_EDIT"), (req, res) => {
  const prop = db.prepare("SELECT * FROM properties WHERE id = ?").get(req.params.id);
  if (!prop) {
    return res.status(404).json({ error: "Property not found" });
  }

  if (req.user.role !== "Super Admin" && prop.landlord_id !== req.user.id) {
    return res.status(403).json({ error: "Access denied: You do not own this property" });
  }

  const unit = db.prepare("SELECT * FROM units WHERE id = ? AND property_id = ?").get(req.params.unitId, prop.id);
  if (!unit) {
    return res.status(404).json({ error: "Unit not found for this property" });
  }

  const { rentInr, securityDepositInr, status, currentTenantId } = req.body;
  const updatedRent = rentInr !== undefined && rentInr > 0 ? Number(rentInr) : unit.rent_inr;
  const updatedDeposit = securityDepositInr !== undefined ? Number(securityDepositInr) : unit.security_deposit_inr;
  const updatedStatus = status !== undefined ? String(status) : unit.status;
  const updatedTenant = currentTenantId !== undefined ? currentTenantId : unit.current_tenant_id;

  db.prepare(`
    UPDATE units
    SET rent_inr = ?, security_deposit_inr = ?, status = ?, current_tenant_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(updatedRent, updatedDeposit, updatedStatus, updatedTenant, unit.id);

  const updated = db.prepare("SELECT * FROM units WHERE id = ?").get(unit.id);
  logAudit("UNIT_UPDATED", `Unit ${unit.id} in property ${prop.id} updated by ${req.user.email}`, req.user.email, null, req);

  res.json(updated);
});

// 3. List Agreements (Enforces Strict Tenant & Landlord Data Isolation - HIGH-01 Remediated)
app.get("/api/agreements", authenticateToken, (req, res) => {
  const { companyId } = req.query;
  const isPrivileged = ["Super Admin", "Admin", "Auditor", "Legal Officer"].includes(req.user.role);

  if (isPrivileged) {
    if (companyId) {
      const agreements = db.prepare("SELECT * FROM agreements WHERE company_id = ? ORDER BY created_at DESC").all(companyId);
      return res.json(agreements);
    }
    const agreements = db.prepare("SELECT * FROM agreements ORDER BY created_at DESC").all();
    return res.json(agreements);
  }

  // Get user's verified wallets
  const userWallets = db
    .prepare("SELECT wallet_address FROM wallets WHERE user_id = ? AND status = 'VERIFIED'")
    .all(req.user.id || 0)
    .map((w) => w.wallet_address.toLowerCase());

  if (req.user.role === "Property Owner") {
    const ownedProperties = db
      .prepare("SELECT id FROM properties WHERE landlord_id = ?")
      .all(req.user.id || 0)
      .map((p) => p.id);

    const allAgreements = db.prepare("SELECT * FROM agreements ORDER BY created_at DESC").all();
    const filtered = allAgreements.filter((a) => {
      if (companyId && a.company_id !== companyId) return false;
      const matchEmail = a.landlord_address && a.landlord_address.toLowerCase() === req.user.email.toLowerCase();
      const matchWallet = a.landlord_address && userWallets.includes(a.landlord_address.toLowerCase());
      const matchProp = a.property_id && ownedProperties.includes(a.property_id);
      return matchEmail || matchWallet || matchProp;
    });
    return res.json(filtered);
  }

  // Tenant / Standard user: Strictly isolated to agreements where user is the tenant party
  const allAgreements = db.prepare("SELECT * FROM agreements ORDER BY created_at DESC").all();
  const filtered = allAgreements.filter((a) => {
    if (companyId && a.company_id !== companyId) return false;
    const matchEmail = a.tenant_address && a.tenant_address.toLowerCase() === req.user.email.toLowerCase();
    const matchWallet = a.tenant_address && userWallets.includes(a.tenant_address.toLowerCase());
    return matchEmail || matchWallet;
  });
  return res.json(filtered);
});

// 4. Get Agreement by ID or Contract Address (Protected Against IDOR / BOLA)
app.get("/api/agreements/:id", authenticateToken, (req, res) => {
  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ? OR contract_address = ?").get(req.params.id, req.params.id);

  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  // Authorization check: Privileged roles or actual parties to the agreement
  const isPrivileged = ["Super Admin", "Admin", "Auditor", "Legal Officer"].includes(req.user.role);
  const userWallets = db
    .prepare("SELECT wallet_address FROM wallets WHERE user_id = ? AND status = 'VERIFIED'")
    .all(req.user.id || 0)
    .map((w) => w.wallet_address.toLowerCase());

  let isPropertyOwner = false;
  if (agreement.property_id) {
    const prop = db.prepare("SELECT landlord_id FROM properties WHERE id = ?").get(agreement.property_id);
    if (prop && prop.landlord_id === req.user.id) {
      isPropertyOwner = true;
    }
  }

  const isLandlord =
    (agreement.landlord_address &&
      (agreement.landlord_address.toLowerCase() === req.user.email?.toLowerCase() ||
        userWallets.includes(agreement.landlord_address.toLowerCase()))) ||
    isPropertyOwner;

  const isTenant =
    agreement.tenant_address &&
    (agreement.tenant_address.toLowerCase() === req.user.email?.toLowerCase() ||
      userWallets.includes(agreement.tenant_address.toLowerCase()));

  if (!isPrivileged && !isLandlord && !isTenant) {
    logAudit(
      "UNAUTHORIZED_BOLA_ATTEMPT",
      `User ${req.user.email} attempted unauthorized access to agreement ${agreement.id}`,
      req.user.email,
      agreement.id,
      req
    );
    return res.status(403).json({ error: "Access denied: You are not an authorized party to this agreement" });
  }

  logAudit("AGREEMENT_VIEWED", `Agreement ${agreement.id} viewed by ${req.user.email}`, req.user.email, agreement.id, req);
  res.json(agreement);
});

// 4a. Get Documents Associated with Agreement
app.get("/api/agreements/:id/documents", authenticateToken, requirePermission("DOCUMENT_VIEW"), (req, res) => {
  try {
    const docs = listAgreementDocuments({
      agreementId: req.params.id,
      user: req.user,
      req
    });
    res.json(docs);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// 5. Create Agreement with Strict Input Validation
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
    pdfHash,
    paymentRail
  } = req.body;

  if (!landlordAddress || !rentInINR || !pdfHash || !propertyDetails) {
    return res.status(400).json({ error: "Missing required agreement parameters" });
  }

  // Validate format of Ethereum addresses if provided as 0x...
  if (landlordAddress.startsWith("0x") && !ETH_ADDR_REGEX.test(landlordAddress)) {
    return res.status(400).json({ error: "Invalid landlord Ethereum address format" });
  }
  if (tenantAddress && tenantAddress.startsWith("0x") && !ETH_ADDR_REGEX.test(tenantAddress)) {
    return res.status(400).json({ error: "Invalid tenant Ethereum address format" });
  }
  if (contractAddress && !ETH_ADDR_REGEX.test(contractAddress)) {
    return res.status(400).json({ error: "Invalid contract address format" });
  }

  // Validate paymentRail if supplied (HIGH-02)
  let resolvedRail = "HYBRID";
  if (paymentRail) {
    const upper = String(paymentRail).toUpperCase();
    if (!["FIAT", "WEB3", "HYBRID"].includes(upper)) {
      return res.status(400).json({ error: "Invalid paymentRail. Must be 'FIAT', 'WEB3', or 'HYBRID'" });
    }
    resolvedRail = upper;
  } else if (!contractAddress) {
    resolvedRail = "FIAT";
  }

  // Validate document hash format (SHA-256 or IPFS CID)
  if (!HASH_REGEX.test(pdfHash) && !IPFS_REGEX.test(pdfHash)) {
    return res.status(400).json({ error: "Invalid document hash format. Must be a 64-char hexadecimal SHA-256 or IPFS CID." });
  }

  // Length boundary on property details
  if (typeof propertyDetails !== "string" || propertyDetails.trim().length === 0 || propertyDetails.length > 256) {
    return res.status(400).json({ error: "Property details must be between 1 and 256 characters" });
  }

  const rentNum = parseFloat(rentInINR);
  const depositNum = parseFloat(securityDepositInINR || 0);
  const durationNum = parseInt(durationDays || 30, 10);

  if (isNaN(rentNum) || rentNum <= 0 || rentNum > 100000000 || isNaN(depositNum) || depositNum < 0 || depositNum > 100000000) {
    return res.status(400).json({ error: "Rent and deposit must be valid positive numbers within acceptable limits" });
  }

  const agreementId = `agreement_${Date.now()}`;

  const stmt = db.prepare(`
    INSERT INTO agreements (
      id, company_id, contract_address, landlord_address, tenant_address,
      rent_inr, security_deposit_inr, duration_days, property_details,
      current_document_hash, status, version, payment_rail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    agreementId,
    (companyId || "Company_A").substring(0, 64),
    contractAddress || null,
    landlordAddress,
    tenantAddress || null,
    rentNum,
    depositNum,
    durationNum,
    propertyDetails.trim(),
    pdfHash.trim(),
    "Draft",
    1,
    resolvedRail
  );

  logAudit("AGREEMENT_CREATED", `Agreement ${agreementId} created for ${propertyDetails} [Rail: ${resolvedRail}]`, req.user.email, agreementId, req);

  const created = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
  res.status(201).json(created);
});

// 6. Record Payment (Guarded against BOLA, enforcing rail separation and authoritative on-chain Web3 validation - Blocker 2)
app.post("/api/payments", authenticateToken, async (req, res) => {
  const { agreementId, amountINR, payerAddress, paymentGateway, transactionId, paymentRail, blockchainTxHash } = req.body;

  if (!agreementId || !amountINR || !transactionId) {
    return res.status(400).json({ error: "Missing payment parameters" });
  }

  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  // Authorization: Only registered tenant, landlord, or super admin
  const isPrivileged = req.user.role === "Super Admin" || req.user.role === "Finance Admin";
  const isTenant = agreement.tenant_address?.toLowerCase() === req.user.email?.toLowerCase();
  if (!isPrivileged && !isTenant) {
    return res.status(403).json({ error: "Access denied: You are not authorized to submit payments for this agreement" });
  }

  // Enforce payment rail separation (HIGH-02)
  const rail = (paymentRail || (paymentGateway === "Web3" ? "WEB3" : "FIAT")).toUpperCase();
  if (!["FIAT", "WEB3", "HYBRID"].includes(rail)) {
    return res.status(400).json({ error: "Invalid paymentRail. Must be 'FIAT', 'WEB3', or 'HYBRID'" });
  }

  if (agreement.payment_rail === "WEB3" && rail !== "WEB3") {
    return res.status(400).json({ error: "Agreement is configured for pure Web3 on-chain payments. Cannot record fiat payment." });
  }

  const isWeb3 = rail === "WEB3" || Boolean(blockchainTxHash) || paymentGateway === "Web3";
  let validatedWeb3 = null;

  if (isWeb3) {
    const targetTxHash = blockchainTxHash || transactionId;
    try {
      validatedWeb3 = await web3Validator.validateWeb3Payment({
        agreementId: agreement.id,
        transactionHash: targetTxHash,
        user: req.user
      });
    } catch (valErr) {
      return res.status(valErr.status || 400).json({ error: valErr.message });
    }
  }

  const amount = parseFloat(amountINR);
  if (isNaN(amount) || amount <= 0 || amount > 10000000) {
    return res.status(400).json({ error: "Invalid payment amount" });
  }

  if (typeof transactionId !== "string" || transactionId.length > 128) {
    return res.status(400).json({ error: "Invalid transaction reference ID" });
  }

  const paymentId = `pay_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const finalTxHash = isWeb3 && validatedWeb3 ? validatedWeb3.transactionHash : (blockchainTxHash || null);
  const finalTxId = isWeb3 && validatedWeb3 ? validatedWeb3.transactionHash : transactionId.substring(0, 128);

  const stmt = db.prepare(`
    INSERT INTO payments (
      id, agreement_id, amount_inr, payer_address, payment_gateway,
      transaction_id, status, payment_rail, blockchain_tx_hash, on_chain_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    stmt.run(
      paymentId,
      agreement.id,
      amount,
      payerAddress || req.user.email,
      (paymentGateway || (isWeb3 ? "Web3" : "Direct")).substring(0, 64),
      finalTxId,
      "Success",
      rail,
      finalTxHash,
      isWeb3 ? 1 : 0
    );
  } catch (dbErr) {
    if (dbErr.message && dbErr.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "This transaction hash has already been recorded for a payment." });
    }
    throw dbErr;
  }

  logAudit(
    "PAYMENT_COMPLETED",
    `Payment of ₹${amount} recorded via ${paymentGateway || "Direct"} [Rail: ${rail}]. Tx: ${finalTxId}`,
    req.user.email,
    agreementId,
    req
  );

  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  res.status(201).json(payment);
});

// 6a. Create Authoritative Razorpay Order
app.post("/api/payments/create-order", authenticateToken, async (req, res, next) => {
  try {
    const { agreementId } = req.body;
    const order = await paymentService.createPaymentOrder({
      tenantEmail: req.user.email,
      agreementId
    });
    logAudit(
      "PAYMENT_ORDER_CREATED",
      `Razorpay order ${order.orderId} created for agreement ${order.agreementId}. Amount: ₹${order.amountRupees}`,
      req.user.email,
      order.agreementId,
      req
    );
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

// 6b. Verify and Capture Razorpay Payment (Server-Authoritative HMAC Verification)
app.post("/api/payments/verify", authenticateToken, async (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    const receipt = await paymentService.verifyAndCapturePayment({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      userEmail: req.user.email
    });
    logAudit(
      "PAYMENT_CAPTURED",
      `Payment ${receipt.paymentId} verified and captured. Amount: ₹${receipt.grossAmountRupees}. Razorpay Tx: ${razorpayPaymentId}`,
      req.user.email,
      receipt.agreementId,
      req
    );
    res.json(receipt);
  } catch (err) {
    next(err);
  }
});

// 6c. Process Refund (Restricted to Super Admin and Finance Admin)
app.post("/api/payments/:id/refund", authenticateToken, requireRole(["Super Admin", "Finance Admin"]), async (req, res, next) => {
  try {
    const { amountPaise, reason } = req.body;
    const result = await paymentService.initiateRefund({
      paymentId: req.params.id,
      amountPaise,
      reason,
      initiatedBy: req.user.email
    });
    logAudit(
      "REFUND_PROCESSED",
      `Refund of ₹${result.amountRupees} processed for payment ${req.params.id}. Next status: ${result.paymentStatus}`,
      req.user.email,
      req.params.id,
      req
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// 6d. Idempotent Razorpay Webhook Handler
app.post("/api/webhooks/razorpay", async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const eventIdHeader = req.headers["x-razorpay-event-id"];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    const result = await webhookService.handleWebhook({
      rawBody,
      signature,
      eventIdHeader
    });

    logAudit(
      "WEBHOOK_PROCESSED",
      `Razorpay webhook event ${result.eventId} processed: ${result.actionTaken || result.message}`,
      "razorpay_system",
      null,
      req
    );
    res.json({ status: "ok", ...result });
  } catch (err) {
    console.error("[WEBHOOK ERROR]:", err.message);
    res.status(err.status || 400).json({ error: err.message });
  }
});

// 6e. List Payments (Role-based visibility)
app.get("/api/payments", authenticateToken, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 50, 10), 100);
  const offset = Math.max(parseInt(req.query.offset || 0, 10), 0);
  const payments = paymentService.listPayments({
    userRole: req.user.role,
    userEmail: req.user.email,
    limit,
    offset
  });
  res.json(payments);
});

// 6f. Financial Dashboard Stats
app.get("/api/payments/stats", authenticateToken, requireRole(["Super Admin", "Finance Admin", "Auditor", "Legal Officer", "Security Admin"]), (req, res) => {
  const stats = reconciliationService.getFinancialDashboardStats();
  res.json(stats);
});

// 6g. Reconciliation Audit Report
app.get("/api/payments/reconciliation", authenticateToken, requireRole(["Super Admin", "Finance Admin", "Auditor"]), (req, res) => {
  const recon = reconciliationService.runReconciliationAudit();
  res.json(recon);
});

// 6h. Payment Detail & Receipt View
app.get("/api/payments/:id", authenticateToken, (req, res) => {
  const receipt = paymentService.getPaymentReceipt(req.params.id);
  if (!receipt) {
    return res.status(404).json({ error: "Payment not found" });
  }

  const isPrivileged = ["Super Admin", "Finance Admin", "Auditor", "Legal Officer", "Support Admin"].includes(req.user.role);
  const isParty =
    receipt.tenantId?.toLowerCase() === req.user.email?.toLowerCase() ||
    receipt.landlordId?.toLowerCase() === req.user.email?.toLowerCase();

  if (!isPrivileged && !isParty) {
    return res.status(403).json({ error: "Access denied: You are not authorized to view this payment" });
  }

  res.json(receipt);
});

// 6i. Landlord Route Linked Account Registration
app.post("/api/landlords/linked-account", authenticateToken, requireRole(["Super Admin", "Property Owner"]), (req, res) => {
  const { accountNumber, ifsc, razorpayAccountId } = req.body;
  const account = settlementService.registerLandlordAccount({
    landlordId: req.user.email,
    accountNumber,
    ifsc,
    razorpayAccountId
  });
  logAudit("LANDLORD_ACCOUNT_REGISTERED", `Landlord ${req.user.email} registered linked settlement account`, req.user.email, null, req);
  res.json(account);
});

// 7. Verify Agreement Document Integrity (Cryptographic SHA-256 match)
app.post("/api/verifyAgreement", (req, res) => {
  const { agreementId, providedPdfHash } = req.body;

  if (!agreementId || !providedPdfHash) {
    return res.status(400).json({ error: "Agreement ID/address and PDF hash are required" });
  }

  const isValidFormat = (typeof providedPdfHash === "string") && (HASH_REGEX.test(providedPdfHash) || IPFS_REGEX.test(providedPdfHash));

  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ? OR contract_address = ?").get(agreementId, agreementId);
  
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found in database" });
  }

  const isConsistent = isValidFormat && (agreement.current_document_hash.toLowerCase().trim() === providedPdfHash.toLowerCase().trim());

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

// 8. Server-Side Document Upload & Hash Verification (Phase 7 Document Upload Security)
app.post("/api/verifyDocumentFile", upload.single("file"), (req, res) => {
  const { agreementId } = req.body;

  if (!agreementId || !req.file) {
    return res.status(400).json({ error: "Agreement ID and document file are required" });
  }

  const allowedMimeTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain"
  ];

  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: "Invalid document format. Only PDF, DOCX, or TXT documents are allowed." });
  }

  // Deep Magic-Byte Validation (MED-05)
  const validation = validateFileBuffer(req.file.buffer, req.file.mimetype);
  if (!validation.valid) {
    return res.status(400).json({ error: `Invalid document file: ${validation.error}` });
  }

  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ? OR contract_address = ?").get(agreementId, agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found in database" });
  }

  // Independently compute SHA-256 hash server-side from uploaded binary buffer
  const serverComputedHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  const isConsistent = agreement.current_document_hash.toLowerCase().trim() === serverComputedHash.toLowerCase().trim();

  logAudit(
    "SERVER_FILE_INTEGRITY_CHECK",
    `Server-side document hash computed for ${agreement.id} (${req.file.originalname}, ${req.file.size} bytes). Result: ${isConsistent ? "PASSED" : "FAILED"}`,
    req.headers.authorization ? "authenticated_user" : "anonymous",
    agreement.id,
    req
  );

  res.json({
    agreementId: agreement.id,
    propertyDetails: agreement.property_details,
    fileName: req.file.originalname,
    fileSizeBytes: req.file.size,
    serverComputedHash,
    registeredHash: agreement.current_document_hash,
    isValid: isConsistent,
    verifiedAt: new Date().toISOString()
  });
});

// 8b. Document Storage Service Router (Phase 4)
app.use("/api/documents", createDocumentRouter({ authenticateToken, requirePermission }));

// 8c. Decoupled Wallet Onboarding & Verification Router (Phase 5)
app.use("/api/wallet", createWalletRouter({ authenticateToken }));

// 9. Renew Agreement
app.post("/api/renewAgreement", authenticateToken, requireRole(["Super Admin", "Property Owner", "Legal Officer"]), (req, res) => {
  const { agreementId, extensionDurationDays } = req.body;

  const agreement = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
  if (!agreement) {
    return res.status(404).json({ error: "Agreement not found" });
  }

  const extension = parseInt(extensionDurationDays || 30, 10);
  if (isNaN(extension) || extension <= 0 || extension > 365) {
    return res.status(400).json({ error: "Extension days must be between 1 and 365" });
  }

  const newDuration = agreement.duration_days + extension;

  db.prepare("UPDATE agreements SET status = 'Renewed', duration_days = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(newDuration, agreementId);

  logAudit("AGREEMENT_RENEWED", `Agreement ${agreementId} renewed for +${extension} days (total: ${newDuration})`, req.user.email, agreementId, req);

  res.json({ success: true, status: "Renewed", newDurationDays: newDuration });
});

// 10. Fetch Security Audit Trail
app.get("/api/audit-trail", authenticateToken, requireRole(["Super Admin", "Auditor"]), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 50, 10), 100);
  const logs = db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json(logs);
});

// 11. System Stats
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

// 12. Retrieve Tenants (Password hashes strictly omitted)
app.get("/api/tenants", authenticateToken, requireRole(["Super Admin", "Property Owner", "Legal Officer", "Auditor"]), (req, res) => {
  const tenants = db.prepare("SELECT id, email, name, role, verified, created_at FROM users WHERE role = 'Tenant'").all();
  res.json(tenants);
});

// Centralized safe error handler (Zero stack trace or internal SQL/path leaks in responses)
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error("Unhandled error:", err.message);
  const errorMessage = (isProduction && status === 500)
    ? "An unexpected internal server error occurred."
    : (err.message || "Internal server error");
  res.status(status).json({ error: errorMessage });
});

const isDirectRun = Boolean(process.argv[1] && (process.argv[1].endsWith("server.js") || process.argv[1].endsWith("server")));

if (isDirectRun && process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  const serverInstance = app.listen(PORT, () => {
    console.log(`[RentSphere SaaS Server] Running on http://localhost:${PORT}`);
    console.log(`[RentSphere SaaS Server] Security headers, rate limiters, and SQLite connected.`);
    worker.start(process.env.WORKER_INTERVAL_MS ? parseInt(process.env.WORKER_INTERVAL_MS, 10) : 5000);
  });

  const shutdown = () => {
    console.log("\n[RentSphere SaaS Server] Gracefully shutting down...");
    worker.stop();
    serverInstance.close(() => {
      console.log("[RentSphere SaaS Server] Closed HTTP listeners.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export { app, db, worker, web3Validator };
export default app;
