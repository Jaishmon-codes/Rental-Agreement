# RentSphere Security Policy & Architecture

## 1. Overview
RentSphere is a decentralized property rental management platform that unites smart-contract financial escrow on EVM-compatible blockchains with an enterprise REST API backend and a responsive Web3 frontend.

Security is foundational to RentSphere's architecture. This document details our security posture, supported versions, threat model, and the procedure for responsibly reporting security vulnerabilities.

---

## 2. Supported Versions

Only the latest major and minor releases receive active security updates and vulnerability patches.

| Version | Status | Security Support |
| :--- | :--- | :--- |
| `1.0.x` | Supported | Active security patches & audit updates |
| `< 1.0.0` | End-of-Life | Unsupported |

---

## 3. Threat Model & Security Boundaries

### 3.1 Trust Assumptions
1. **The Blockchain Network (EVM):** Consensus and ledger integrity are maintained by the blockchain network. However, contract code execution must assume zero trust in callers and defend against reentrancy, front-running, and unauthorized state mutation.
2. **The Client Environment:** The frontend runs in untrusted user browsers. Client-side input validation is solely for user experience; all business logic, document verification, authorization, and financial operations are strictly validated server-side or on-chain.
3. **The Backend Server:** Operates as a trusted coordination, indexing, and enterprise telemetry layer. It does not hold custodial control over user private keys or wallet funds.
4. **The Database (SQLite / RDBMS):** Protected behind parameterized queries via prepared statements. Direct database access is restricted to the backend service.

### 3.2 Security Perimeter & Architecture

```
[ Web3 Client / Browser ]
         │
         ├─── (1) Direct RPC (Ethers.js / Wallet) ───► [ EVM Smart Contracts ]
         │                                               ├── RentalAgreementFactory
         │                                               └── RentalAgreement (Escrow)
         │
         └─── (2) HTTPS / JSON Web Token ────────────► [ Express API Gateway ]
                                                         ├── Helmet Security Headers
                                                         ├── Express Rate Limiting
                                                         ├── JWT RBAC Middleware
                                                         ├── Multer In-Memory Validation
                                                         └── Prepared Statements
                                                                   │
                                                                   ▼
                                                            [ SQLite Engine ]
```

---

## 4. Key Security Controls

### 4.1 Smart Contracts
- **Solidity Version:** Strict `0.8.20` with compiler-enforced arithmetic overflow/underflow protection.
- **Deposit Isolation:** Security deposits are mathematically segregated from claimable rental income. The contract invariant `address(this).balance >= securityDeposit` is enforced across all state transitions.
- **Reentrancy Protection:** All value-transferring routines (`claimRent`, `endAgreementRefundTenant`, `endAgreementLandlordTakesDeposit`, `autoExpireAndRefund`) utilize checks-effects-interactions patterns guarded by custom non-reentrant execution state flags.
- **Role-Based Execution:** Only the designated landlord can claim rent or initiate dispute settlements; only the registered tenant can pay rent; contracts verify caller identity using `msg.sender`.

### 4.2 Backend API & Database
- **Zero SQL Injection:** All database operations utilize SQLite parameterized queries (`db.prepare(...).get(...)`, `db.prepare(...).run(...)`). No dynamic SQL string concatenation exists in the codebase.
- **Credential Storage:** User passwords are never stored in plaintext. They are hashed using `bcryptjs` with 10 salt rounds.
- **Stateless Authentication & RBAC:** Authenticated endpoints require signed `jsonwebtoken` tokens (HS256) with role verification (`Super Admin`, `Property Owner`, `Tenant`, `Legal Officer`, `Auditor`).
- **Broken Object Level Authorization (BOLA/IDOR) Mitigation:** Agreement retrieval (`GET /api/agreements/:id`) and payment recording (`POST /api/payments`) enforce data ownership checks. Non-privileged users cannot access agreements or submit payments for properties to which they are not verified parties.
- **Cryptographic Document Integrity:** Document authenticity is verified using cryptographic SHA-256 digests. The backend exposes `POST /api/verifyDocumentFile` which computes SHA-256 hashes server-side on in-memory buffers without storing files on disk or trusting client-supplied digests.
- **Denial of Service (DoS) Hardening:**
  - `express-rate-limit`: Sensitive authentication routes (`/api/auth/login`) are capped at 25 requests per 15 minutes; general API routes (`/api/`) are limited to 300 requests per 15 minutes.
  - Payload limits: JSON body parsing is restricted to `50kb` and urlencoded data to `10kb`.
- **Security Headers:** `helmet` applies strict HTTP response headers: Content Security Policy (CSP), HTTP Strict Transport Security (HSTS), X-Frame-Options (DENY), X-Content-Type-Options (nosniff), and Referrer-Policy.
- **Production Secret Guard:** The server validates that `JWT_SECRET` is defined, does not use default development values, and meets a minimum entropy threshold of 32 characters in production environments.

### 4.3 Supply Chain & Dependencies
- **Audit Cadence:** All packages are monitored via `npm audit`.
- **Zero Production Vulnerabilities:** `backend/` and `frontend/` dependency trees have **0 known vulnerabilities**.

---

## 5. Deployment Guidelines & Warnings

> [!WARNING]
> **DO NOT DEPLOY TO ETHEREUM MAINNET WITHOUT A FORMAL THIRD-PARTY AUDIT.**
> The current smart contracts and backend infrastructure have passed rigorous automated unit, integration, and security regression testing on local networks (Hardhat) and testnets (Sepolia). Public mainnet deployment involves real economic assets and should be preceded by an external smart contract security firm review.

### 5.1 Environment Configuration Checklist
Before deploying to any staging, testnet, or production environment:
- [ ] Set `NODE_ENV=production`
- [ ] Generate a high-entropy `JWT_SECRET` (minimum 64 random characters)
- [ ] Replace `CORS_ORIGIN=*` with the exact fully-qualified domain name(s) of the frontend
- [ ] Change all seeded user passwords (`Password@123`) immediately
- [ ] Store database files on an encrypted volume with restricted OS file permissions (`chmod 600`)
- [ ] Enforce HTTPS / TLS 1.3 reverse proxy (e.g., Nginx, Caddy, Cloudflare) in front of the Node.js API

---

## 6. Vulnerability Disclosure Policy

We welcome vulnerability reports from security researchers, developers, and users.

### 6.1 Reporting a Vulnerability
If you identify a security vulnerability in RentSphere:
1. **Do NOT open a public GitHub issue or disclose the vulnerability publicly.**
2. Email your report to: `security@rentsphere.io` (or submit via private security advisory).
3. Include:
   - A detailed description of the vulnerability
   - Proof-of-concept steps or code to safely reproduce the issue
   - Affected components, contracts, or endpoints
   - Your proposed remediation (if available)

### 6.2 Response Timeline
- **Initial Acknowledgment:** Within 24 hours of report receipt.
- **Assessment & Triage:** Within 48 hours.
- **Remediation & Patch:** Target fix deployed within 7 business days depending on severity.
- **Public Disclosure:** Coordinated disclosure following successful deployment and verification of the patch.
