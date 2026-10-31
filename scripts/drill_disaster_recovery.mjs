import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { runBackup } from "./backup_db.js";
import { runRestore } from "./restore_db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const liveDbPath = path.resolve(__dirname, "../backend/rental_database.sqlite");
const backupDir = path.resolve(__dirname, "../backups");

console.log("=================================================");
console.log("    RENTSPHERE DISASTER RECOVERY DRILL (PHASE 7) ");
console.log("=================================================");

// Step 1: Create known test data in live database
console.log("\n--- STEP 1: Creating Known Test Data in Live Database ---");
const db = new DatabaseSync(liveDbPath);
const testId = `agree_drill_${Date.now()}`;
db.prepare(`
  INSERT INTO agreements (
    id, company_id, contract_address, landlord_address, tenant_address,
    rent_inr, security_deposit_inr, duration_days, property_details,
    current_document_hash, status, payment_rail
  ) VALUES (?, 'Company_Drill', '0x1234567890123456789012345678901234567890',
            'landlord@gmail.com', 'tenant@gmail.com', 45000, 90000, 30,
            'Disaster Recovery Test Penthouse', 'drill_hash_sha256', 'Active', 'FIAT')
`).run(testId);
console.log(`[DRILL] Seeded test record: ${testId}`);
db.close();

// Step 2: Create Backup
console.log("\n--- STEP 2: Executing Online ACID Backup ---");
const backupResult = runBackup({ sourceDbPath: liveDbPath, backupDir });
console.log(`[DRILL] Backup created at: ${backupResult.backupPath}`);

// Step 3: Verify Backup Integrity
console.log("\n--- STEP 3: Verifying Backup File Integrity ---");
if (!fs.existsSync(backupResult.backupPath) || backupResult.integrity !== "ok") {
  throw new Error("Backup file failed pre-restore verification!");
}
console.log(`[DRILL] Backup integrity check confirmed: ${backupResult.integrity}`);

// Step 4: Simulate Database Loss
console.log("\n--- STEP 4: Simulating Total Database Loss ---");
fs.unlinkSync(liveDbPath);
if (fs.existsSync(`${liveDbPath}-wal`)) fs.unlinkSync(`${liveDbPath}-wal`);
if (fs.existsSync(`${liveDbPath}-shm`)) fs.unlinkSync(`${liveDbPath}-shm`);
console.log(`[DRILL] Live database files deleted. Database exists: ${fs.existsSync(liveDbPath)}`);

// Step 5: Restore Database
console.log("\n--- STEP 5: Restoring Database from Backup Snapshot ---");
const restoreResult = runRestore({ backupFilePath: backupResult.backupPath, targetDbPath: liveDbPath });
console.log(`[DRILL] Restore completed: ${restoreResult.success}, Table count: ${restoreResult.tablesCount}`);

// Step 6 & 7: Verify Critical Records in Restored DB
console.log("\n--- STEP 6 & 7: Verifying Restored Database & Test Record ---");
const restoredDb = new DatabaseSync(liveDbPath);
const recoveredRecord = restoredDb.prepare("SELECT * FROM agreements WHERE id = ?").get(testId);
if (!recoveredRecord || recoveredRecord.rent_inr !== 45000) {
  throw new Error(`Critical record ${testId} was not recovered!`);
}
console.log(`[DRILL] SUCCESS: Recovered record ${recoveredRecord.id} (${recoveredRecord.property_details}, Rent: ₹${recoveredRecord.rent_inr})`);

// Cleanup drill record
restoredDb.prepare("DELETE FROM agreements WHERE id = ?").run(testId);
restoredDb.close();

// Cleanup drill backup file
if (fs.existsSync(backupResult.backupPath)) fs.unlinkSync(backupResult.backupPath);

console.log("\n=================================================");
console.log("   DISASTER RECOVERY DRILL: PASSED (100%)        ");
console.log("=================================================");
