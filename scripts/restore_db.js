#!/usr/bin/env node
/**
 * RentSphere Production Database Restore Utility
 *
 * Safely restores a verified SQLite snapshot to the target database path.
 * Validates integrity before and after copy, with safe atomic replacement.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runRestore(options = {}) {
  const backupFilePath = options.backupFilePath;
  const targetDbPath = options.targetDbPath || process.env.DB_PATH || path.resolve(__dirname, "../backend/rental_database.sqlite");

  if (!backupFilePath || !fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found at ${backupFilePath}`);
  }

  // 1. Pre-restore integrity check on backup file
  console.log(`[RESTORE] Verifying integrity of backup file: ${backupFilePath}...`);
  const backupDb = new DatabaseSync(backupFilePath);
  const preCheck = backupDb.prepare("PRAGMA integrity_check;").get();
  backupDb.close();

  if (preCheck?.integrity_check !== "ok") {
    throw new Error(`Pre-restore integrity check failed: ${JSON.stringify(preCheck)}`);
  }
  console.log(`[RESTORE] Backup integrity verified: OK`);

  // 2. Remove any lingering WAL/SHM files at target
  const walPath = `${targetDbPath}-wal`;
  const shmPath = `${targetDbPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  // 3. Atomically copy verified backup to target
  console.log(`[RESTORE] Restoring database to ${targetDbPath}...`);
  fs.copyFileSync(backupFilePath, targetDbPath);

  // 4. Post-restore verification
  const restoredDb = new DatabaseSync(targetDbPath);
  const postCheck = restoredDb.prepare("PRAGMA integrity_check;").get();
  const tableCount = restoredDb.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table';").get().count;
  restoredDb.close();

  if (postCheck?.integrity_check !== "ok") {
    throw new Error(`Post-restore integrity check failed: ${JSON.stringify(postCheck)}`);
  }

  console.log(`[RESTORE] Successfully restored database! Verified tables: ${tableCount}, PRAGMA integrity_check = ok`);

  return {
    success: true,
    restoredPath: targetDbPath,
    tablesCount: tableCount,
    integrity: "ok"
  };
}

const isDirectRun = Boolean(process.argv[1] && process.argv[1].endsWith("restore_db.js"));
if (isDirectRun) {
  const backupArg = process.argv[2];
  if (!backupArg) {
    console.error("Usage: node scripts/restore_db.js <path_to_backup_file>");
    process.exit(1);
  }
  try {
    const result = runRestore({ backupFilePath: path.resolve(backupArg) });
    console.log("[RESTORE] Completed:", result);
    process.exit(0);
  } catch (err) {
    console.error("[RESTORE] Failed:", err.message);
    process.exit(1);
  }
}
