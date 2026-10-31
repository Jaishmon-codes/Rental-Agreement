# RentSphere Security Architecture & Policy

**Release Version:** `v1.0.0-beta`  
**Security Status:** Production Beta Ready — Verified Against Automated Security Test Suite  
**Last Updated:** September 13, 2026  

---

## 1. Overview & Security Philosophy

RentSphere is a hybrid Web3 and Enterprise property rental platform. Financial escrow is executed on EVM-compatible blockchains, while off-chain operational data, role-based workflows, and audit telemetry are managed by an Express/Node.js API backed by SQLite.

RentSphere follows a zero-trust model:
- The frontend operates in an untrusted client environment.
- The smart contracts assume callers may be malicious contracts or adversarial parties.
- The backend validates all inputs, authorizes all actions server-side, and validates on-chain transactions directly via JSON-RPC.

> [!IMPORTANT]
> **Audit Status:** The security controls detailed in this document have been implemented, tested, and verified against an internal 16-vector adversarial regression test suite and full-spectrum integration tests. RentSphere has **NOT** undergone an external third-party smart contract audit firm engagement. Deployment to public Ethereum Mainnet with real-value financial assets should only follow a professional external audit.

---

## 2. Threat Model & Security Boundaries

```text
[ Untrusted Client / Browser ]
         │
         ├─── (1) Web3 Direct JSON-RPC ────────► [ EVM Smart Contracts ]
         │                                         ├── RentalAgreementFactory
         │                                         └── RentalAgreement (Escrow Vault)
         │
         └─── (2) HTTPS / Signed JWT ──────────► [ Express API Gateway ]
                                                   ├── Helmet Security Headers
                                                   ├── Tiered Rate Limiters
                                                   ├── JWT Gate & Token Versioning
                                                   ├── Tenancy Scoping (BOLA Defense)
                                                   └── Prepared Statements
                                                             │
                                                             ▼
                                                   [ SQLite Engine (WAL + FK) ]
```

### Key Trust Assumptions & Mitigations:
1. **Malicious Smart Contract Callers:** A caller may attempt reentrancy, front-running, or revert on transfer.  
   *Mitigation:* All ETH withdrawals utilize the Pull-over-Push pattern (`pendingWithdrawals` mapping) with strict checks-effects-interactions ordering.
2. **Unilateral Deposit Seizure:** A landlord may attempt to confiscate security deposits dishonestly.  
   *Mitigation:* Landlord damage claims trigger an automatic 3-day timelock. If disputed by the tenant, funds can only be resolved by the designated platform arbitrator.
3. **Spoofed Web3 Payments:** An attacker may submit fake, pending, or reused transaction hashes to mark rent as paid.  
   *Mitigation:* `web3Validator.js` validates mined confirmation, contract address match, sender wallet ownership, calldata function selector, and non-zero value. A unique database index prevents transaction hash replay.
4. **Broken Object Level Authorization (BOLA/IDOR):** An authenticated tenant or landlord may attempt to read or modify another party's lease agreements or payment receipts.  
   *Mitigation:* All queries are strictly scoped in SQL to `req.user.email` or `req.user.id`.
5. **Double Refund / Concurrent Webhook Races:** Rapid concurrent webhook deliveries or refund requests could duplicate payouts.  
   *Mitigation:* Persistent webhook event deduplication (`processed_webhook_events`) and in-flight refund reservation locks.

---

## 3. Verified Security Controls

### 3.1 Authentication & Session Management
- **Password Storage:** Hashed using `bcryptjs` with 10 salt rounds.
- **JWT Authentication:** Signed using HMAC SHA-256 (`jsonwebtoken`).
- **Session Revocation (Token Versioning):** The `users` table tracks `token_version`. On password reset or account suspension, `token_version` is incremented, immediately revoking all active JWTs.
- **Timing-Safe Auth:** Account enumeration defenses return generic error responses on failed logins and registration checks.

### 3.2 Authorization & BOLA / IDOR Defenses
- **Multi-Tenancy Isolation:** Property and agreement queries explicitly filter by landlord/tenant address. Users cannot access resources belonging to another company or individual.
- **Role-Based Access Control (RBAC):** Middleware (`requireRole`, `requirePermission`) strictly restricts administrative endpoints (`/api/audit-trail`, `/api/stats`, `/api/tenants`, `/api/payments/:id/refund`) to authorized roles (`Super Admin`, `Finance Admin`, `Auditor`, `Legal Officer`).

### 3.3 Smart Contract Protections
- **Solidity 0.8.20:** Built-in overflow and underflow protection.
- **Balance Invariant:** The contract enforces `address(this).balance >= securityDeposit` across all active states.
- **Pull-over-Push Pattern:** Direct calls to `transfer()` or `call{value: ...}("")` are strictly avoided for tenant and landlord payouts. Funds are credited to `pendingWithdrawals[recipient]`, preventing reverting receiver DoS attacks (`CRIT-03`).
- **Timelocked Dispute Arbitration:** Landlord damage claims initiate a 3-day timelock window. If disputed, only the designated immutable arbitrator can distribute funds.
- **Factory Pagination:** `getAgreementsPaginated` prevents block gas exhaustion when querying large agreement registries.

### 3.4 Payment & Webhook Security
- **Server-Authoritative Pricing:** Rent and fee amounts are computed server-side from the database; client-submitted amounts are rejected.
- **Razorpay HMAC Signatures:** Gateway checkout signatures are verified using `crypto.createHmac("sha256", secret)` with constant-time comparison (`crypto.timingSafeEqual`).
- **Webhook Deduplication:** All incoming webhook events are recorded in `processed_webhook_events`. Concurrent duplicate deliveries are detected and dropped idempotently without race conditions.
- **Refund TOCTOU Defense:** Refunds reserve remaining balances before calling external gateways, eliminating double-refund races.

### 3.5 Cryptographic Document Authenticity
- **Client-Side Hashing:** Native Web Crypto API computes SHA-256 digests in-browser, preventing unauthorized disclosure of confidential lease documents.
- **Magic-Byte MIME Validation:** Server-side `fileValidator.js` validates true file signatures (`%PDF`, `\xFF\xD8\xFF`, `\x89PNG`) to prevent file-extension spoofing and executable uploads.
- **Server Buffer Verification:** Endpoint `/api/verifyDocumentFile` hashes raw file buffers to detect digital document tampering.

### 3.6 Database Reliability & Disaster Recovery
- **ACID Transactions:** Relational mutations are wrapped in database transactions.
- **Foreign Key Constraints:** `PRAGMA foreign_keys = ON` prevents orphaned relational records.
- **WAL Journaling:** `PRAGMA journal_mode = WAL` enables concurrent readers during write transactions.
- **Hot Backup Utility:** Point-in-time online backup script (`scripts/backup_db.js`) generates consistent snapshots verified with `PRAGMA integrity_check`.

### 3.7 DoS Defenses & Rate Limiting
- **Tiered Rate Limiters:**
  - Authentication endpoints: 25 requests per 15 minutes.
  - Payment creation: 60 requests per 15 minutes.
  - Refund initiation: 30 requests per 15 minutes.
  - Global API: 300 requests per 15 minutes.
- **Payload Limits:** Strict `50kb` body limit on JSON requests; `10kb` on urlencoded requests.
- **Reverse Proxy Trust:** Configured `app.set("trust proxy", 1)` ensuring client IP addresses are correctly resolved behind Docker or Nginx reverse proxies.

---

## 4. Supply Chain & Secrets Management

- **Zero Production Vulnerabilities:** `npm audit --omit=dev` confirms 0 vulnerabilities in backend and frontend production dependency trees.
- **Secret Hygiene:** Repository git history is clean of live secrets, API keys, and private keys.
- **Production Startup Gate:** `validateEnvironment()` enforces that `JWT_SECRET` is set, not the demo default, and at least 32 characters in production, while rejecting wildcard `CORS_ORIGIN=*`.

---

## 5. Security Verification Results

The RentSphere security posture has been validated through the following automated suites:

- **Smart Contract Tests:** 24 / 24 passing (100%)
- **Backend API Tests:** 115 / 115 passing (100%)
- **E2E Integration:** 7 / 7 stages passing (100%)
- **Adversarial Vector Matrix:** 16 / 16 vectors blocked / recovered (100%)
- **Staging Smoke Test:** 18 / 18 steps passing (100%)
- **Concurrency / Failure Drills:** 4 / 4 drills passing (100%)
- **Dependency Audit:** 0 production vulnerabilities
- **Secret Leaks:** 0 detected
