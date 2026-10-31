# Changelog

All notable changes to the **RentSphere** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.0.0-beta] - 2026-09-13

### Release Overview
Initial frozen production-beta release of RentSphere — a hybrid Web3 and enterprise rental management platform providing cryptographically secured deposit escrow, authoritative payment ledgers, client-side document verification, and role-based portfolio operations.

### Added & Verified Functionality

#### 1. Smart Contract Escrow & Balance Isolation
- **EVM Contracts:** Solidity `^0.8.20` contracts with 200-run optimizer and `viaIR: true`.
- **Deposit Escrow:** Security deposits are mathematically locked in smart contract escrow and strictly isolated from landlord-claimable rent balances.
- **Pull-over-Push Payments:** Replaced push transfers with a `pendingWithdrawals` pattern, completely mitigating reverting receiver Denial-of-Service attacks (`CRIT-03`).
- **Factory Scalability:** Implemented paginated retrieval (`getAgreementsPaginated`) in `RentalAgreementFactory.sol` to prevent block gas limit exhaustion (`MED-04`).

#### 2. Dispute Arbitration & Timelock Enforcement
- **Arbitration Binding:** Immutable arbitrator address binding in `RentalAgreement.sol` (`CRIT-02` defense).
- **Timelock Protection:** Dispute resolution is strictly restricted to the authorized platform arbitrator (`msg.sender == arbitrator`), preventing unilateral landlord deposit seizure.

#### 3. Authoritative Web3 Payment Validation
- **Server-Authoritative Validation:** Implemented `web3Validator.js` to verify on-chain transactions via JSON-RPC.
- **Transaction Invariants:** Enforces that transactions are mined, executed successfully (`status === 1`), target the correct contract address, originate from the tenant's verified linked wallet, and contain correct calldata.
- **Replay Protection:** Unique database index on `payments(blockchain_tx_hash)` prevents transaction hash reuse.
- **Decoupled Wallet Linking:** Cryptographic challenge-response wallet linking via EIP-191 signatures (`POST /api/wallet/nonce` and `POST /api/wallet/verify`).

#### 4. Fiat Payment Integration (Razorpay)
- **Zero Client-Side Trust:** Order generation derives pricing strictly from the server-side database.
- **HMAC Verification:** Server-authoritative checkout capture using cryptographic HMAC SHA-256 signatures with constant-time equality comparisons (`crypto.timingSafeEqual`).
- **Webhook Idempotency:** Persistent deduplication table (`processed_webhook_events`) prevents double-crediting during concurrent webhook delivery.
- **Refund Reservation:** Double-refund TOCTOU race condition defense reserves in-flight refunds before dispatching gateway calls.

#### 5. Cryptographic Document Verification
- **Client-Side Hashing:** Zero-knowledge document verification using the browser's native Web Crypto API (SHA-256) without third-party file uploads.
- **Magic-Byte MIME Validation:** Server-side file signature validation in `fileValidator.js` inspecting true magic bytes for PDF, PNG, and JPEG formats.
- **Server Verification Engine:** Server-side endpoint `/api/verifyDocumentFile` hashes the raw uploaded file buffer to detect document tampering.

#### 6. Role-Based Access Control (RBAC) & BOLA Defense
- **Enterprise Roles:** Granular role definitions for Super Admin, Property Owner, Tenant, Finance Admin, Legal Officer, and Auditor.
- **BOLA / IDOR Defense:** Strict tenancy scoping across properties, agreements, documents, and payments.
- **Session Revocation:** Single-use password reset tokens and database-backed `token_version` tracking immediately revokes JWT sessions upon credential reset or account suspension.

#### 7. Background Event Queue & Worker Micro-Engine
- **Durable Persistence:** SQLite-backed queue adapter (`SQLiteQueueAdapter`) ensuring asynchronous jobs survive server restarts.
- **Crash Recovery:** Automatic reclamation of abandoned in-flight jobs via visibility timeouts (`reclaimStaleJobs`).
- **Poison Pill Resilience:** Error handling and dead-letter queue progression ensure corrupted events do not crash worker instances.

#### 8. Disaster Recovery & Database Resilience
- **ACID Transactions:** Relational mutations executed within transactions with WAL journal mode (`PRAGMA journal_mode = WAL`) and foreign key constraints (`PRAGMA foreign_keys = ON`).
- **Hot Backup Utility:** Point-in-time ACID backup script (`scripts/backup_db.js`) with `PRAGMA integrity_check`.
- **Restoration Drill:** Disaster recovery drill script (`scripts/drill_disaster_recovery.mjs`) verified full data restoration and 100% backend test suite execution against restored databases.

#### 9. Production Hardening & Observability
- **Security Headers & Reverse Proxy:** Configured Helmet, express-rate-limit (tiered limits: Auth 25/15m, Payments 60/15m, Global 300/15m), and `trust proxy` for container deployment.
- **Observability:** Deep health check routes (`/api/health`, `/api/health/live`, `/api/health/ready`).
- **Sanitized Error Responses:** Centralized error handler returning sanitized 500 error messages in production without stack trace or internal SQL leakage.
- **Frontend Cleanliness:** Demo account quick-fill buttons and password hints strictly isolated to development mode (`import.meta.env.DEV`).

### Verified Test Results
- Smart Contracts (Hardhat): **24 / 24 passing (100%)**
- Backend Services (Node Test Runner): **115 / 115 passing (100%)**
- End-to-End Dual-Rail Verification: **7 / 7 stages passing (100%)**
- Adversarial Attack Vector Matrix: **16 / 16 vectors blocked/recovered (100%)**
- Staging Dry Run Smoke Test: **18 / 18 steps passing (100%)**
- Concurrency & Failure Drills: **4 / 4 drills passing (100%)**
- Frontend Linter (Oxlint): **0 errors, 0 warnings**
- Frontend Production Build (Vite): **Passing (2.88s)**
- Production Dependency Vulnerabilities: **0 backend, 0 frontend**
- Secret Leak Scans: **0 leaks**
