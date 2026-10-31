import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH || path.join(__dirname, "rental_database.sqlite");
const db = new DatabaseSync(dbPath);

// Enable busy timeout first for multi-process concurrency, then WAL mode and foreign keys
db.exec("PRAGMA busy_timeout = 10000;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    verified INTEGER DEFAULT 1,
    token_version INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agreements (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    contract_address TEXT,
    landlord_address TEXT NOT NULL,
    tenant_address TEXT,
    property_id TEXT,
    unit_id TEXT,
    rent_inr REAL NOT NULL,
    security_deposit_inr REAL NOT NULL,
    duration_days INTEGER NOT NULL,
    property_details TEXT NOT NULL,
    current_document_hash TEXT NOT NULL,
    status TEXT DEFAULT 'Draft',
    payment_rail TEXT DEFAULT 'HYBRID',
    version INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    agreement_id TEXT NOT NULL,
    amount_inr REAL NOT NULL,
    payer_address TEXT,
    payment_gateway TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    status TEXT DEFAULT 'Success',
    payment_rail TEXT DEFAULT 'FIAT',
    on_chain_synced INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id)
  );

  CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL,
    razorpay_refund_id TEXT,
    amount INTEGER NOT NULL,
    reason TEXT,
    status TEXT NOT NULL,
    initiated_by TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (payment_id) REFERENCES payments(id)
  );

  CREATE TABLE IF NOT EXISTS landlord_accounts (
    id TEXT PRIMARY KEY,
    landlord_id TEXT NOT NULL,
    account_number_masked TEXT,
    ifsc TEXT,
    razorpay_account_id TEXT,
    status TEXT DEFAULT 'REGISTERED',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    processed_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reconciliation_records (
    id TEXT PRIMARY KEY,
    payment_id TEXT,
    status TEXT NOT NULL,
    details TEXT,
    checked_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    description TEXT NOT NULL,
    user_email TEXT,
    agreement_id TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL,
    role_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    wallet_type TEXT DEFAULT 'EVM',
    network TEXT DEFAULT 'Sepolia',
    status TEXT DEFAULT 'VERIFIED',
    nonce TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    landlord_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT,
    postal_code TEXT,
    property_type TEXT DEFAULT 'APARTMENT',
    status TEXT DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (landlord_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL,
    unit_number TEXT NOT NULL,
    rent_inr REAL NOT NULL,
    security_deposit_inr REAL NOT NULL,
    status TEXT DEFAULT 'VACANT',
    current_tenant_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    FOREIGN KEY (current_tenant_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    agreement_id TEXT,
    storage_key TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_by TEXT NOT NULL,
    status TEXT DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id)
  );

  CREATE TABLE IF NOT EXISTS platform_fees (
    id TEXT PRIMARY KEY,
    fee_percentage REAL NOT NULL,
    fee_type TEXT DEFAULT 'PERCENTAGE',
    active INTEGER DEFAULT 1,
    description TEXT,
    updated_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'INFO',
    is_read INTEGER DEFAULT 0,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS security_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    severity TEXT DEFAULT 'INFO',
    user_email TEXT,
    ip_address TEXT,
    user_agent TEXT,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS queued_jobs (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    max_retries INTEGER DEFAULT 3,
    retry_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'QUEUED',
    failure_reason TEXT,
    available_at INTEGER NOT NULL,
    processing_started_at INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Non-destructive column migrations for payments table
const existingColumns = db.prepare("PRAGMA table_info(payments)").all().map((c) => c.name);

const requiredColumns = [
  { name: "tenant_id", type: "TEXT" },
  { name: "landlord_id", type: "TEXT" },
  { name: "currency", type: "TEXT DEFAULT 'INR'" },
  { name: "gross_amount", type: "INTEGER DEFAULT 0" },
  { name: "platform_fee_percentage", type: "REAL DEFAULT 0.03" },
  { name: "platform_fee_amount", type: "INTEGER DEFAULT 0" },
  { name: "gateway_fee_amount", type: "INTEGER DEFAULT 0" },
  { name: "landlord_amount", type: "INTEGER DEFAULT 0" },
  { name: "razorpay_order_id", type: "TEXT" },
  { name: "razorpay_payment_id", type: "TEXT" },
  { name: "razorpay_transfer_id", type: "TEXT" },
  { name: "failure_reason", type: "TEXT" },
  { name: "blockchain_tx_hash", type: "TEXT" },
  { name: "captured_at", type: "TEXT" },
  { name: "settled_at", type: "TEXT" },
  { name: "refunded_at", type: "TEXT" },
  { name: "payment_rail", type: "TEXT DEFAULT 'FIAT'" },
  { name: "on_chain_synced", type: "INTEGER DEFAULT 0" }
];

for (const col of requiredColumns) {
  if (!existingColumns.includes(col.name)) {
    try {
      db.exec(`ALTER TABLE payments ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {
      // Column might already exist in some environments
    }
  }
}

// Ensure unique index on blockchain_tx_hash to prevent duplicate payment recording
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_blockchain_tx_hash
  ON payments(blockchain_tx_hash)
  WHERE blockchain_tx_hash IS NOT NULL AND blockchain_tx_hash != '';
`);

// Non-destructive column migrations for agreements table
const existingAgreementColumns = db.prepare("PRAGMA table_info(agreements)").all().map((c) => c.name);
const requiredAgreementColumns = [
  { name: "property_id", type: "TEXT" },
  { name: "unit_id", type: "TEXT" },
  { name: "payment_rail", type: "TEXT DEFAULT 'HYBRID'" }
];
for (const col of requiredAgreementColumns) {
  if (!existingAgreementColumns.includes(col.name)) {
    try {
      db.exec(`ALTER TABLE agreements ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {}
  }
}

// Non-destructive column migrations for users table
const existingUserColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
const requiredUserColumns = [
  { name: "status", type: "TEXT DEFAULT 'ACTIVE'" },
  { name: "verification_token", type: "TEXT" },
  { name: "reset_token", type: "TEXT" },
  { name: "reset_token_expires_at", type: "TEXT" },
  { name: "token_version", type: "INTEGER DEFAULT 1" }
];
for (const col of requiredUserColumns) {
  if (!existingUserColumns.includes(col.name)) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
    } catch (e) {}
  }
}

// Non-destructive column migrations for queued_jobs table
const existingQueuedColumns = db.prepare("PRAGMA table_info(queued_jobs)").all().map((c) => c.name);
if (!existingQueuedColumns.includes("processing_started_at")) {
  try {
    db.exec("ALTER TABLE queued_jobs ADD COLUMN processing_started_at INTEGER DEFAULT NULL");
  } catch (e) {}
}

// Seed default users if empty
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

const isProdEnv = process.env.NODE_ENV === "production";
const allowDemoSeed = process.env.ALLOW_DEMO_SEED === "true";

if (userCount === 0) {
  if (isProdEnv && !allowDemoSeed) {
    console.warn("[DB] Production environment detected: Skipping automatic default user seeding with demo password 'Password@123'. Provision initial admin via secure CLI or set ALLOW_DEMO_SEED=true.");
  } else {
    const defaultSalt = bcrypt.genSaltSync(10);
    const defaultPasswordHash = bcrypt.hashSync("Password@123", defaultSalt);

    const insertUser = db.prepare(`
      INSERT INTO users (email, password_hash, role, name)
      VALUES (?, ?, ?, ?)
    `);

    insertUser.run("admin@rentsphere.com", defaultPasswordHash, "Super Admin", "RentSphere Admin");
    insertUser.run("finance@rentsphere.com", defaultPasswordHash, "Finance Admin", "RentSphere Finance Officer");
    insertUser.run("support@rentsphere.com", defaultPasswordHash, "Support Admin", "RentSphere Support Lead");
    insertUser.run("security@rentsphere.com", defaultPasswordHash, "Security Admin", "RentSphere Security Officer");
    insertUser.run("legal@rentsphere.com", defaultPasswordHash, "Legal Officer", "Senior Legal Counsel");
    insertUser.run("auditor@rentsphere.com", defaultPasswordHash, "Auditor", "Independent Compliance Auditor");
    insertUser.run("landlord@gmail.com", defaultPasswordHash, "Property Owner", "Jane Landlord");
    insertUser.run("tenant@gmail.com", defaultPasswordHash, "Tenant", "John Tenant");

    console.log("[DB] Seeded standard users with default password 'Password@123'");
  }
} else if (!isProdEnv || allowDemoSeed) {
  // Ensure all standard enterprise accounts exist if users already partially seeded in development
  const standardUsers = [
    ["admin@rentsphere.com", "Super Admin", "RentSphere Admin"],
    ["finance@rentsphere.com", "Finance Admin", "RentSphere Finance Officer"],
    ["support@rentsphere.com", "Support Admin", "RentSphere Support Lead"],
    ["security@rentsphere.com", "Security Admin", "RentSphere Security Officer"],
    ["legal@rentsphere.com", "Legal Officer", "Senior Legal Counsel"],
    ["auditor@rentsphere.com", "Auditor", "Independent Compliance Auditor"],
    ["landlord@gmail.com", "Property Owner", "Jane Landlord"],
    ["tenant@gmail.com", "Tenant", "John Tenant"]
  ];

  const defaultSalt = bcrypt.genSaltSync(10);
  const defaultPasswordHash = bcrypt.hashSync("Password@123", defaultSalt);

  for (const [email, role, name] of standardUsers) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (!existing) {
      db.prepare("INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)").run(
        email,
        defaultPasswordHash,
        role,
        name
      );
    }
  }
}

// Seed sample agreement if empty
const agreementCount = db.prepare("SELECT COUNT(*) as count FROM agreements").get().count;

if (agreementCount === 0) {
  const insertAgreement = db.prepare(`
    INSERT INTO agreements (
      id, company_id, contract_address, landlord_address, tenant_address,
      rent_inr, security_deposit_inr, duration_days, property_details,
      current_document_hash, status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertAgreement.run(
    "agreement_001",
    "Company_A",
    "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    15000,
    30000,
    30,
    "742 Evergreen Terrace, Springfield",
    "a2b585dd299e03d12fa4293bc5de4111afa1a4b94908f83103eb1f1706367c2e",
    "Active",
    1
  );

  const insertLog = db.prepare(`
    INSERT INTO audit_logs (id, action, description, user_email, agreement_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertLog.run(
    `audit_init_${Date.now()}`,
    "SYSTEM_INIT",
    "Seeded baseline lease agreement agreement_001 for demonstration.",
    "system@rentsphere.com",
    "agreement_001"
  );
}

// Seed Normalized Roles & Permissions
const roleCount = db.prepare("SELECT COUNT(*) as count FROM roles").get().count;
if (roleCount === 0) {
  const insertRole = db.prepare("INSERT INTO roles (id, name, description) VALUES (?, ?, ?)");
  insertRole.run("SUPER_ADMIN", "Super Admin", "Full system and SaaS platform control");
  insertRole.run("ADMIN", "Admin", "General platform administration");
  insertRole.run("FINANCE_ADMIN", "Finance Admin", "Financial operations, refunds, and reconciliation");
  insertRole.run("SUPPORT_ADMIN", "Support Admin", "Tenant and landlord customer support");
  insertRole.run("SECURITY_ADMIN", "Security Admin", "Security monitoring and audit access");
  insertRole.run("LEGAL_OFFICER", "Legal Officer", "Legal compliance and document integrity review");
  insertRole.run("AUDITOR", "Auditor", "Independent compliance verification");
  insertRole.run("LANDLORD", "Property Owner", "Property listing, lease deployment, and rent collection");
  insertRole.run("TENANT", "Tenant", "Rental search, agreement signing, and rent payment");

  const permissionsList = [
    ["PROPERTY_CREATE", "Create new rental properties"],
    ["PROPERTY_EDIT", "Edit existing rental properties"],
    ["PROPERTY_VIEW", "View rental properties"],
    ["PROPERTY_DELETE", "Delete rental properties"],
    ["AGREEMENT_CREATE", "Draft and deploy rental agreements"],
    ["AGREEMENT_EDIT", "Edit rental agreements"],
    ["AGREEMENT_VIEW", "View rental agreements"],
    ["AGREEMENT_SIGN", "Sign rental agreements as tenant"],
    ["AGREEMENT_TERMINATE", "Terminate or end rental agreements"],
    ["DOCUMENT_UPLOAD", "Upload lease documents and contracts"],
    ["DOCUMENT_VIEW", "View and download stored documents"],
    ["DOCUMENT_VERIFY", "Verify document cryptographic SHA-256 integrity"],
    ["RENT_VIEW", "View rent schedule and payment statuses"],
    ["RENT_PAY", "Pay rent via fiat or cryptocurrency"],
    ["RENT_COLLECT", "Collect and claim rent payments"],
    ["PAYMENT_VIEW", "View payment transactions and receipts"],
    ["PAYMENT_INITIATE", "Initiate payment orders"],
    ["REFUND_REQUEST", "Request payment refund"],
    ["REFUND_APPROVE", "Approve and execute payment refunds"],
    ["SETTLEMENT_VIEW", "View landlord settlements and Route transfers"],
    ["SETTLEMENT_TRIGGER", "Trigger landlord settlement transfers"],
    ["USER_VIEW", "View registered users and profiles"],
    ["USER_MANAGE", "Manage user accounts and roles"],
    ["FEE_CONFIG_VIEW", "View platform fee configuration"],
    ["FEE_CONFIG_EDIT", "Edit platform fee configuration"],
    ["AUDIT_VIEW", "View security and compliance audit logs"],
    ["SECURITY_VIEW", "View security alerts and incidents"]
  ];

  const insertPerm = db.prepare("INSERT INTO permissions (id, code, description) VALUES (?, ?, ?)");
  for (const [code, desc] of permissionsList) {
    insertPerm.run(`perm_${code.toLowerCase()}`, code, desc);
  }

  const insertRolePerm = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
  for (const [code] of permissionsList) {
    insertRolePerm.run("SUPER_ADMIN", `perm_${code.toLowerCase()}`);
    insertRolePerm.run("ADMIN", `perm_${code.toLowerCase()}`);
  }

  const financePerms = ["RENT_VIEW", "PAYMENT_VIEW", "REFUND_REQUEST", "REFUND_APPROVE", "SETTLEMENT_VIEW", "SETTLEMENT_TRIGGER", "FEE_CONFIG_VIEW", "AUDIT_VIEW"];
  for (const code of financePerms) {
    insertRolePerm.run("FINANCE_ADMIN", `perm_${code.toLowerCase()}`);
  }

  const landlordPerms = ["PROPERTY_CREATE", "PROPERTY_EDIT", "PROPERTY_VIEW", "PROPERTY_DELETE", "AGREEMENT_CREATE", "AGREEMENT_VIEW", "DOCUMENT_UPLOAD", "DOCUMENT_VIEW", "DOCUMENT_VERIFY", "RENT_VIEW", "RENT_COLLECT", "PAYMENT_VIEW", "SETTLEMENT_VIEW"];
  for (const code of landlordPerms) {
    insertRolePerm.run("LANDLORD", `perm_${code.toLowerCase()}`);
  }

  const tenantPerms = ["PROPERTY_VIEW", "AGREEMENT_VIEW", "AGREEMENT_SIGN", "DOCUMENT_VIEW", "DOCUMENT_VERIFY", "RENT_VIEW", "RENT_PAY", "PAYMENT_VIEW", "PAYMENT_INITIATE"];
  for (const code of tenantPerms) {
    insertRolePerm.run("TENANT", `perm_${code.toLowerCase()}`);
  }
}

// Ensure LANDLORD always has perm_property_delete even if database was initialized prior
try {
  db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)").run("LANDLORD", "perm_property_delete");
} catch (e) {}

// Ensure all seeded/existing users have mapped user_roles
const allUsers = db.prepare("SELECT id, role FROM users").all();
const insertUserRole = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)");
const roleMap = {
  "Super Admin": "SUPER_ADMIN",
  "Finance Admin": "FINANCE_ADMIN",
  "Support Admin": "SUPPORT_ADMIN",
  "Security Admin": "SECURITY_ADMIN",
  "Legal Officer": "LEGAL_OFFICER",
  "Auditor": "AUDITOR",
  "Property Owner": "LANDLORD",
  "Tenant": "TENANT"
};
for (const u of allUsers) {
  const rId = roleMap[u.role] || "TENANT";
  insertUserRole.run(u.id, rId);
}

// Seed platform_fees if empty
const feeCount = db.prepare("SELECT COUNT(*) as count FROM platform_fees").get().count;
if (feeCount === 0) {
  db.prepare(`
    INSERT INTO platform_fees (id, fee_percentage, fee_type, active, description, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "fee_standard_001",
    0.0300,
    "PERCENTAGE",
    1,
    "Standard platform monetization fee (3% bearing on landlord)",
    "system@rentsphere.com"
  );
}

// Seed sample properties and units for landlord if empty
const propertyCount = db.prepare("SELECT COUNT(*) as count FROM properties").get().count;
if (propertyCount === 0) {
  const landlordUser = db.prepare("SELECT id FROM users WHERE email = ?").get("landlord@gmail.com");
  if (landlordUser) {
    db.prepare(`
      INSERT INTO properties (id, landlord_id, title, address, city, state, postal_code, property_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "prop_springfield_001",
      landlordUser.id,
      "Evergreen Residence Tower A",
      "742 Evergreen Terrace",
      "Springfield",
      "IL",
      "62704",
      "APARTMENT",
      "ACTIVE"
    );

    db.prepare(`
      INSERT INTO units (id, property_id, unit_number, rent_inr, security_deposit_inr, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "unit_springfield_101",
      "prop_springfield_001",
      "Suite 101",
      15000,
      30000,
      "OCCUPIED"
    );

    db.prepare("UPDATE agreements SET property_id = ?, unit_id = ? WHERE id = 'agreement_001'")
      .run("prop_springfield_001", "unit_springfield_101");
  }
}

export function logAudit(action, description, userEmail = null, agreementId = null, req = null) {
  try {
    const logId = `audit_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const ip = req ? (req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1") : "127.0.0.1";
    
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, action, description, user_email, agreement_id, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(logId, action, description, userEmail, agreementId, ip);
    console.log(`[AUDIT LOG] ${action}: ${description}`);
  } catch (err) {
    console.error("Failed to write audit log:", err.message);
  }
}

/**
 * Execute callback within an ACID SQLite transaction (MED-01)
 */
export function runTransaction(callback) {
  db.exec("BEGIN TRANSACTION");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export { db };
export default db;
