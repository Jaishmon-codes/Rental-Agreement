# RentSphere Interactive Demo & Technical Portfolio Script

**Demo Duration:** 8–10 minutes  
**Target Audience:** Technical Recruiters, Security Engineers, Web3 Architects, and Enterprise Stakeholders  
**Focus:** Engineering decisions, cryptographic guarantees, security boundaries, and real-world resilience (not just UI clicks).

---

## Prerequisites & Setup

1. Open 3 terminal tabs:
   ```bash
   # Tab 1: Local Hardhat Node
   npm run node

   # Tab 2: Backend REST Server
   npm run backend:start

   # Tab 3: Frontend Vite App
   npm run frontend:dev
   ```
2. Deploy smart contracts:
   ```bash
   npm run deploy:local
   ```
3. Open `http://localhost:5173` in your browser. Ensure MetaMask is configured with Localhost network (`RPC: http://127.0.0.1:8545`, `Chain ID: 1337` or `31337`).

---

## Demonstration Script (10 Steps)

### Step 1: Multi-Role Authentication & Session Architecture (1 min)
- **Action:** Open the **Login** modal. In development mode, explain the pre-configured role selector (Super Admin, Property Owner, Tenant, Finance Admin, Legal Officer, Auditor).
- **Engineering Highlight:** Explain that demo quick-fill buttons are wrapped in `import.meta.env.DEV` guards and disappear in production builds. Explain `token_version` database tracking: resetting a password or suspending a user immediately revokes all active JWT sessions across devices.
- **Perform:** Log in as **Property Owner** (`landlord@gmail.com` / `Password@123`).

### Step 2: Landlord Portfolio & Unit Management (1 min)
- **Action:** Navigate to the **Properties** panel. Click **Add Property**.
- **Input:** Name: `"Prestige Horizon Tower"`, Address: `"Sector 48, Gurugram"`, Units: 4.
- **Engineering Highlight:** Show that property and unit creation is wrapped in an ACID SQLite transaction. Relational foreign key constraints prevent orphaned units or dangling lease records (`PRAGMA foreign_keys = ON`).

### Step 3: Drafting & Registering the Rental Agreement (1 min)
- **Action:** Click **Create Agreement** for a unit.
- **Input:** Tenant: `tenant@gmail.com`, Rent: `₹35,000` (or `0.05 ETH`), Security Deposit: `₹70,000` (or `0.1 ETH`), Duration: 365 days, Payment Rail: `HYBRID`.
- **Engineering Highlight:** Point out that the agreement records both off-chain metadata (property details, duration) and on-chain contract configurations. Explain that `RentalAgreementFactory.sol` maintains a paginated registry (`getAgreementsPaginated`) to eliminate gas-limit exhaustion vulnerabilities.

### Step 4: Tenant Onboarding & Cryptographic Wallet Linking (1 min)
- **Action:** Open an Incognito window (or log out and log in as Tenant `tenant@gmail.com`).
- **Action:** Click **Connect Web3 Wallet**. A cryptographic signature challenge appears.
- **Engineering Highlight:** Demonstrate the EIP-191 challenge-response flow (`/api/wallet/nonce` and `/api/wallet/verify`). The backend never trusts a client-reported wallet address; it validates that the user possesses the private key via `ethers.verifyMessage`.
- **Action:** Tenant reviews the drafted agreement and signs the lease terms.

### Step 5: Dual-Rail Payment Execution (1.5 mins)
- **Scenario A (Web3 Escrow):**
  - Tenant clicks **Pay Rent via Web3**. MetaMask prompts for `0.05 ETH`.
  - Transaction mines.
  - **Engineering Highlight:** Show `web3Validator.js` in action: the backend does not simply accept the transaction hash. It queries the local node via JSON-RPC, verifying that the transaction is mined (`status === 1`), targets the exact contract address, originates from the tenant's verified wallet, and calls `payNextRent()`. Replay attacks are blocked by a unique DB index.
- **Scenario B (Fiat Rail):**
  - Alternatively, demonstrate Razorpay fiat order creation. The order amount is derived strictly server-side from the database (zero-trust client pricing). Checkout signatures are verified using HMAC SHA-256 with constant-time byte comparisons (`crypto.timingSafeEqual`).

### Step 6: Zero-Knowledge Document Integrity Verification (1 min)
- **Action:** In the **Document Verification** tab, drag and drop `sample_contract.pdf`.
- **Engineering Highlight:** Watch the browser instantly compute the document's SHA-256 hash using the native browser Web Crypto API (`crypto.subtle.digest`). Explain that the client compares the hash against the on-chain registered document hash without transmitting confidential contract contents over the internet.
- **Tamper Test:** Open the file, modify one character, re-hash: the system immediately flags a **Cryptographic Hash Mismatch / Tamper Detected**.

### Step 7: Landlord Claim & Escrow Balance Isolation (1 min)
- **Action:** Switch back to Landlord view.
- **Action:** Landlord clicks **Claim Rent**. The landlord receives the rent payment.
- **Engineering Highlight:** Show the smart contract balance inspector: the tenant's security deposit remains 100% locked in escrow (`address(this).balance >= securityDeposit`). Landlords cannot withdraw security deposit funds during an active lease term.
- **Engineering Highlight:** Explain the Pull-over-Push payment architecture (`pendingWithdrawals` mapping): if a recipient address reverts, it cannot freeze contract state or DoS the escrow vault.

### Step 8: Damage Claim, Timelock Window & Dispute Arbitration (1.5 mins)
- **Action:** Landlord triggers lease termination with a damage claim of `0.04 ETH`.
- **Engineering Highlight:** The contract transitions to `PENDING_DAMAGE` and starts an immutable 3-day timelock countdown.
- **Action:** Tenant disputes the claim. Contract transitions to `DISPUTED`.
- **Engineering Highlight:** Show the critical security remediation: landlords can no longer unilaterally seize deposits. Only the designated platform arbitrator can call `resolveDispute()`.
- **Action:** Log in as **Legal Officer / Arbitrator** and approve a 50/50 fair settlement split.

### Step 9: Enterprise Audit Trail & Compliance (1 min)
- **Action:** Log in as **Auditor** (`auditor@rentsphere.com`).
- **Action:** Open the **Audit Trail** panel.
- **Engineering Highlight:** Review the structured audit log. Every critical security event (user registrations, logins, wallet links, contract deployments, payment captures, document verifications, security alerts) is recorded with timestamp, actor email, IP address, and agreement ID.
- **BOLA Defense Check:** Attempt to fetch the audit log as a Tenant: backend responds with strict `HTTP 403 Forbidden`.

### Step 10: Disaster Recovery & Automated Resilience (1 min)
- **Action:** Switch to terminal and run the disaster recovery drill:
  ```bash
  node scripts/drill_disaster_recovery.mjs
  ```
- **Engineering Highlight:** Point out that this script takes an online hot ACID snapshot of SQLite with `PRAGMA integrity_check`, deletes the live database and WAL files, restores from backup, and immediately passes all 115 backend unit tests.
- **Action:** Run the concurrency and failure resilience drill:
  ```bash
  node scripts/drill_performance_failure.mjs
  ```
- **Engineering Highlight:** Highlights: 10 concurrent identical webhooks deduplicated with 0 double allocations; 5 concurrent refunds on the same payment handled with 0 over-refunds; worker recovers cleanly from poisoned queue events.

---

## Summary Wrap-Up Talking Points

1. **Dual-Rail Harmony:** Not just another crypto project; connects real-world enterprise fiat payments and compliance with trustless on-chain deposit escrow.
2. **Defensive Architecture:** Pull-over-Push payments, dispute timelocks, server-authoritative Web3 validation, and magic-byte file inspection solve real vulnerabilities.
3. **Reproducibility:** 100% automated test coverage across contracts, backend, E2E, disaster recovery, and concurrency drills.
