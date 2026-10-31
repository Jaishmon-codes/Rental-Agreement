# RentSphere System Architecture Specification

**Release Version:** `v1.0.0-beta`  
**Document Status:** Complete & Verified Against Codebase  
**Last Updated:** September 13, 2026  

---

## 1. High-Level Architecture

RentSphere employs a hybrid Web3 and Enterprise SaaS architecture designed to separate concerns across user presentation, relational state management, asynchronous job execution, and decentralized financial escrow.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                    Presentation Layer (React 19 / Vite)                │
│   - Landlord & Tenant Dashboards      - Web Crypto Client SHA-256      │
│   - Enterprise Admin & Audit UI       - Web3 Ethers.js v6 RPC Provider │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │ (JSON-RPC)                     │ (REST HTTP / JWT)
                    ▼                                ▼
┌──────────────────────────────────────┐ ┌───────────────────────────────┐
│     Decentralized Escrow Layer       │ │    Application Backend Layer  │
│        (Solidity 0.8.20 / EVM)       │ │       (Express 4.21 / Node)   │
│  - RentalAgreementFactory            │ │  - Authentication & JWT Gate │
│  - RentalAgreement (Isolated Escrow) │ │  - Tenancy Scoping (BOLA/IDOR)│
│    - Timelocked Dispute Engine       │ │  - Web3 JSON-RPC Validator    │
│    - Pull-over-Push Balance Vault    │ │  - Razorpay Gateway Service   │
└──────────────────────────────────────┘ └───────┬───────────────┬───────┘
                                                 │               │
                                                 ▼               ▼
                                       ┌──────────────────┐ ┌────────────┐
                                       │ Relational Store │ │ Asynchronous│
                                       │   (SQLite WAL)   │ │ Background │
                                       │ - Users, Roles   │ │   Worker   │
                                       │ - Agreements     │ │ - Durable  │
                                       │ - Ledgers & Audit│ │   Queue    │
                                       │ - Webhook Events │ │ - Retries  │
                                       └──────────────────┘ └────────────┘
```

---

## 2. Component Responsibilities

| Component | Technology | Primary Responsibilities |
| :--- | :--- | :--- |
| **Frontend Application** | React 19, Vite, Ethers.js v6 | Interactive dashboards, MetaMask/wallet integration, client-side SHA-256 file hashing via Web Crypto API, responsive UI. Zero production credential leakage (`import.meta.env.DEV` guards). |
| **Backend API Gateway** | Express 4.21, Node.js | REST endpoints, authentication (`bcryptjs`), JWT verification, rate limiting, request size limits, CORS policy enforcement, centralized error handling. |
| **Relational Database** | SQLite (`node:sqlite`) | Persistent relational storage with Write-Ahead Logging (`WAL`), strict foreign keys (`PRAGMA foreign_keys = ON`), ACID transactions for multi-record operations. |
| **Smart Contract Factory** | Solidity `^0.8.20` | Deploys isolated `RentalAgreement` contracts, records agreement registries, supports paginated queries (`getAgreementsPaginated`) to eliminate gas exhaustion. |
| **Rental Agreement Escrow** | Solidity `^0.8.20` | Holds security deposits in escrow, isolates deposit from claimable rent, enforces Pull-over-Push payments (`pendingWithdrawals`), enforces 3-day dispute timelocks. |
| **Web3 Validator** | Ethers.js JSON-RPC | Authoritative backend validation of on-chain transactions (mined status, recipient contract, sender wallet, calldata, replay prevention). |
| **Payment Service** | Razorpay SDK, HMAC SHA-256 | Server-authoritative order creation, checkout signature verification, idempotent webhook processing, concurrent refund reservation locks. |
| **Background Worker** | Node.js, SQLite Queue | Asynchronous event processing (`PAYMENT_RECONCILIATION`, `RENT_DUE_NOTIFICATION`, `DOCUMENT_HASH_VERIFY`), visibility timeouts, crash recovery. |
| **Storage Service** | Local Filesystem / S3 Interface | Abstracted document persistence, magic-byte file signature validation (`fileValidator.js`). |

---

## 3. Communication & Flow Specifications

### 3.1 Authentication & Session Management Flow
```text
Client                          Backend API                     Database
  │                                  │                             │
  │── POST /api/auth/login ─────────►│                             │
  │   { email, password }            │── SELECT * FROM users ─────►│
  │                                  │◄── User record + hash ──────│
  │                                  │ [bcrypt.compare]            │
  │◄── 200 OK + Signed JWT ──────────│ (Includes token_version)    │
  │                                  │                             │
  │── GET /api/agreements ──────────►│                             │
  │   Authorization: Bearer <JWT>    │ [jwt.verify]                │
  │                                  │── SELECT token_version ────►│
  │                                  │◄── Valid version (active) ──│
  │◄── 200 OK (Scoped agreements) ───│                             │
```
- **Session Revocation:** On password reset, `token_version` is incremented in `users`. Subsequent requests with old JWTs fail with HTTP 401. Suspended users are rejected with HTTP 403.

### 3.2 Authorization & Tenancy Scoping (BOLA / IDOR Defense)
- Every protected route enforces tenancy boundaries:
  - **Tenants:** Can only query agreements where `tenant_address == req.user.email`.
  - **Landlords:** Can only access properties and agreements where `landlord_address == req.user.email`.
  - **Admin / Auditors:** Governed by explicit RBAC middleware (`requireRole`, `requirePermission`).

### 3.3 Smart Contract Escrow & Settlement Lifecycle
```text
Landlord                        Tenant                       RentalAgreement.sol
   │                               │                                 │
   │── deploy via Factory ─────────┼────────────────────────────────►│ (Status: Created)
   │                               │                                 │
   │                               │── joinAsTenant() {value} ──────►│ (Deposit + Rent locked)
   │                               │                                 │ (Status: Active)
   │◄── claimRent() (Initial Month)┼─────────────────────────────────│ (Rent claimed via pull)
   │                               │                                 │
   │                               │── payNextRent() {value} ───────►│ (Available rent increases)
   │◄── claimRent() ───────────────┼─────────────────────────────────│ (Rent claimed via pull)
   │                               │                                 │
   │── endAgreement(damageClaim)───┼────────────────────────────────►│ (Status: PENDING_DAMAGE)
   │                               │                                 │ (3-day timelock begins)
   │                               │── disputeDamageClaim() ────────►│ (Status: DISPUTED)
   │                               │                                 │
   │                               │   [Arbitrator Only]             │
   │                               │   resolveDispute(split) ───────►│ (Funds credited to pull balances)
   │◄── withdrawFunds() ───────────┼─────────────────────────────────│ (Pull-over-push withdrawal)
   │                               │◄── withdrawFunds() ─────────────│ (Pull-over-push withdrawal)
```

### 3.4 Authoritative Web3 Payment Flow
1. Tenant executes on-chain payment (`joinAsTenant` or `payNextRent`) via MetaMask.
2. Tenant submits `transactionHash` to `POST /api/payments` with `paymentRail = "WEB3"`.
3. Backend `web3Validator.js` queries JSON-RPC:
   - Verifies transaction exists, is mined (`blockNumber > 0`), and succeeded (`status === 1`).
   - Verifies `tx.to.toLowerCase() === agreement.contract_address.toLowerCase()`.
   - Verifies `tx.from.toLowerCase() === tenantLinkedWallet.toLowerCase()`.
   - Verifies calldata selector matches `payNextRent()` or `joinAsTenant()`.
   - Verifies `tx.value > 0`.
4. Backend checks unique index on `payments(blockchain_tx_hash)`. If unique, records payment with `on_chain_synced = 1`.

### 3.5 Fiat Payment & Webhook Idempotency Flow
```text
Tenant User                     Backend Server                Razorpay Gateway
    │                                  │                              │
    │── POST /api/payments/create-order│                              │
    │◄── 201 Created (orderId, INR) ───│── createOrder({ amount }) ──►│
    │                                  │◄── order_id ─────────────────│
    │── Complete Checkout ─────────────┼─────────────────────────────►│
    │◄── paymentId, signature ─────────┼──────────────────────────────│
    │                                  │                              │
    │── POST /api/payments/verify ────►│                              │
    │   { orderId, paymentId, sig }    │ [verifyPaymentSignature]     │
    │◄── 200 OK (Payment CAPTURED) ────│ [DB: status = 'CAPTURED']    │
    │                                  │                              │
    │                                  │◄── Webhook (payment.captured)│
    │                                  │    [HMAC SHA-256 Verify]     │
    │                                  │    [Check processed_events]  │
    │                                  │── If new: Update ledger ────►│
    │                                  │── If duplicate: Drop (200) ──►│
```

### 3.6 Document Verification Flow
1. **Client-Side:** User drags lease document into the frontend. The Web Crypto API computes `crypto.subtle.digest("SHA-256", fileBuffer)`. The resulting hash is compared with `agreement.current_document_hash` without sending file bytes across the network.
2. **Server-Side Upload & Storage:**
   - Document buffer is inspected by `fileValidator.js` checking magic numbers (`%PDF`, `\xFF\xD8\xFF`, `\x89PNG`).
   - Raw buffer SHA-256 is computed and persisted in `documents` table.
   - Endpoint `POST /api/verifyDocumentFile` provides server-side authenticity verification.

### 3.7 Asynchronous Queue & Background Worker Flow
- `SQLiteQueueAdapter` persists jobs to `queued_jobs` table.
- Worker polls periodically, transitioning jobs from `QUEUED` to `PROCESSING` with timestamp `processing_started_at`.
- If worker crashes, subsequent worker startup runs `reclaimStaleJobs()`: any job in `PROCESSING` longer than 60 seconds is returned to `QUEUED`.
- Errored handlers invoke `nack(eventId, error)`: increments `retry_count`, applies exponential backoff, or moves to dead-letter queue when `max_retries` is exceeded.
