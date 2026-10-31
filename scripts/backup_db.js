#!/usr/bin/env node
/**
 * RentSphere Production Database Online Backup Utility
 *
 * Uses SQLite's atomic VACUUM INTO to create an ACID point-in-time snapshot
 * without locking database readers or writers in WAL mode.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runBackup(options = {}) {
  const sourceDbPath = options.sourceDbPath || process.env.DB_PATH || path.resolve(__dirname, "../backend/rental_database.sqlite");
  const backupDir = options.backupDir || path.resolve(__dirname, "../backups");

  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Source database not found at ${sourceDbPath}`);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `rentsphere_backup_${timestamp}.sqlite`;
  const targetBackupPath = path.join(backupDir, backupFileName);

  console.log(`[BACKUP] Initiating online snapshot of ${sourceDbPath}...`);
  const db = new DatabaseSync(sourceDbPath);

  try {
    // Perform zero-downtime hot snapshot
    db.exec(`VACUUM INTO '${targetBackupPath.replace(/'/g, "''")}';`);

    const stat = fs.statSync(targetBackupPath);
    console.log(`[BACKUP] Snapshot written to ${targetBackupPath} (${(stat.size / 1024).toFixed(2)} KB)`);

    // Verify integrity of the backup file
    const backupDb = new DatabaseSync(targetBackupPath);
    const integrityResult = backupDb.prepare("PRAGMA integrity_check;").get();
    backupDb.close();

    if (integrityResult?.integrity_check !== "ok") {
      throw new Error(`Backup integrity check failed: ${JSON.stringify(integrityResult)}`);
    }

    console.log(`[BACKUP] Integrity verification PASSED (PRAGMA integrity_check = ok)`);

    return {
      success: true,
      backupPath: targetBackupPath,
      sizeBytes: stat.size,
      timestamp,
      integrity: "ok"
    };
  } finally {
    db.close();
  }
}

const isDirectRun = Boolean(process.argv[1] && process.argv[1].endsWith("backup_db.js"));
if (isDirectRun) {
  try {
    const result = runBackup();
    console.log("[BACKUP] Backup completed successfully:", result);
    process.exit(0);
  } catch (err) {
    console.error("[BACKUP] Backup failed:", err.message);
    process.exit(1);
  }
}
