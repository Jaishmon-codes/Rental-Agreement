import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH || path.join(__dirname, "rental_database.sqlite");
const db = new DatabaseSync(dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    verified INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agreements (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    contract_address TEXT,
    landlord_address TEXT NOT NULL,
    tenant_address TEXT,
    rent_inr REAL NOT NULL,
    security_deposit_inr REAL NOT NULL,
    duration_days INTEGER NOT NULL,
    property_details TEXT NOT NULL,
    current_document_hash TEXT NOT NULL,
    status TEXT DEFAULT 'Draft',
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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agreement_id) REFERENCES agreements(id)
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
`);

// Seed default users if empty
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

if (userCount === 0) {
  const defaultSalt = bcrypt.genSaltSync(10);
  const defaultPasswordHash = bcrypt.hashSync("Password@123", defaultSalt);

  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, role, name)
    VALUES (?, ?, ?, ?)
  `);

  insertUser.run("admin@rentsphere.com", defaultPasswordHash, "Super Admin", "RentSphere Admin");
  insertUser.run("legal@rentsphere.com", defaultPasswordHash, "Legal Officer", "Senior Legal Counsel");
  insertUser.run("auditor@rentsphere.com", defaultPasswordHash, "Auditor", "Independent Compliance Auditor");
  insertUser.run("landlord@gmail.com", defaultPasswordHash, "Property Owner", "Jane Landlord");
  insertUser.run("tenant@gmail.com", defaultPasswordHash, "Tenant", "John Tenant");

  console.log("[DB] Seeded 5 standard users with default password 'Password@123'");
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
    "a2b585dd299e03d12FA4293BC5de4111afa1a4b94908f83103eb1f1706367c2e6",
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

export default db;
