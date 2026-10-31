# RentSphere Disaster Recovery & Business Continuity Runbook

**Version:** 1.0 (Production Beta Verified)  
**Last Updated:** September 13, 2026  
**Target Architecture:** Hybrid Enterprise SQLite (WAL) + Ethereum/Sepolia EVM Escrow Contracts  

---

## 1. System Architecture Overview

RentSphere is a hybrid Web3 and Enterprise SaaS rental management platform:
1. **Financial Ledger & State Machine (Off-Chain):** High-throughput transactional data, user credentials, document verification hashes, audit logs, and fiat payment splits (Razorpay ledger) reside in an ACID SQLite database operating in Write-Ahead Logging (`WAL`) mode with enforced foreign keys (`PRAGMA foreign_keys = ON`).
2. **Escrow & Trustless Dispute State (On-Chain):** Cryptographic security deposit holding, timelocked dispute resolution with designated neutral arbitrator, and monthly rent escrow reside in immutable Solidity smart contracts (`RentalAgreement.sol`, `RentalAgreementFactory.sol`).

---

## 2. Recovery Objectives & Policies

| Metric | Target | Operational Procedure |
| :--- | :---: | :--- |
| **Recovery Point Objective (RPO)** | `< 1 hour` | Scheduled hourly hot snapshots via `VACUUM INTO` minimize data loss. |
| **Recovery Time Objective (RTO)** | `< 15 minutes` | Single-command database restoration (`node scripts/restore_db.js <snapshot>`). |
| **Backup Frequency** | Hourly | Automated cron job triggering `scripts/backup_db.js`. |
| **Retention Policy** | 7 days local, 30 days off-site | Daily pruning of local snapshots older than 7 days; replication to encrypted S3 cold storage. |

---

## 3. Automated Online Backup Procedure

Online backups are performed without stopping the application or locking transactions using SQLite's atomic `VACUUM INTO` engine:

```bash
# Execute point-in-time hot backup
node scripts/backup_db.js
```

### Technical Safeguards
- **Zero Reader/Writer Interruption:** SQLite WAL mode continues processing concurrent queries and transactions during snapshot creation.
- **Automated Integrity Verification:** The backup utility invokes `PRAGMA integrity_check;` on the generated snapshot before marking the backup successful.
- **Snapshot Location:** Output snapshots are saved to `backups/rentsphere_backup_<TIMESTAMP>.sqlite`.

---

## 4. Automated Database Restoration Runbook

In the event of database corruption, disk failure, or container volume destruction:

### Step 1: Halt Application Services
```bash
# Docker Compose
docker compose down

# Or stop backend process
pm2 stop rentsphere-backend
```

### Step 2: Execute Automated Restore Utility
The restore script `scripts/restore_db.js` automates pre-restore integrity verification, removes stale WAL/SHM journal files, atomically restores the SQLite snapshot, and performs post-restore integrity check:

```bash
# Run automated restore
node scripts/restore_db.js backups/rentsphere_backup_2026-09-13T13-48-50-783Z.sqlite
```

### Step 3: Restart Services & Verify Health
```bash
# Start backend service
npm --prefix backend start

# Check deep health observability endpoint
curl -s http://localhost:4000/api/health | jq .
```
Expected output:
```json
{
  "status": "healthy",
  "checks": {
    "database": "connected",
    "queue": { "pending": 0 },
    "worker": "running"
  }
}
```

---

## 5. Verified Disaster Recovery Drill (Phase 7 Evidence)

An actual end-to-end disaster recovery drill was executed on September 13, 2026 via `scripts/drill_disaster_recovery.mjs`:

1. **Test Record Injected:** Injected lease record `agree_drill_1789307330765` into live database.
2. **Snapshot Executed:** Created ACID snapshot `backups/rentsphere_backup_2026-09-13T13-48-50-783Z.sqlite` (1,024 KB).
3. **Pre-Restore Verification:** Verified `PRAGMA integrity_check = ok`.
4. **Simulated Catastrophic Loss:** Hard-deleted `rental_database.sqlite`, `rental_database.sqlite-wal`, and `rental_database.sqlite-shm`.
5. **Restoration:** Successfully restored database via `scripts/restore_db.js`.
6. **Data Verification:** Query confirmed test lease `agree_drill_1789307330765` was 100% intact with rent ₹45,000.
7. **Regression Suite:** Executed full backend test suite (`115 / 115 passing tests`) against the restored database.

**Result: PASS (100% Data Preservation & Zero Relational Drift)**.

---

## 6. Smart Contract Escrow State Synchronization

Because smart contracts reside immutably on the blockchain, their state cannot be deleted by off-chain database loss. If a database restore resets off-chain agreement records:

1. **Verify Contract On-Chain Balances:**
   ```bash
   npx hardhat run scripts/verify_contracts.js --network sepolia
   ```
2. **Reconcile Off-Chain Database against Factory Registry:**
   - Query `RentalAgreementFactory.getAgreementsPaginated(0, 50)` on-chain.
   - For each registered contract address, call `getAgreementDetails()`.
   - Update `agreements.status` in SQLite to match on-chain status:
     - `0` -> `Created`
     - `1` -> `Active`
     - `2` -> `TerminationRequested`
     - `3` -> `Disputed`
     - `4` -> `Settled`
     - `5` -> `Expired`

---

## 7. Emergency Contacts & Escalation Matrix

| Role | Responsibility | Escalation Target |
| :--- | :--- | :--- |
| **DevSecOps Incident Commander** | Infrastructure & container orchestration | `ops@rentsphere.com` |
| **Lead Security Engineer** | Forensic analysis & cryptographic hash audits | `security@rentsphere.com` |
| **Finance Administrator** | Razorpay Route settlement & gateway hold verification | `finance@rentsphere.com` |
