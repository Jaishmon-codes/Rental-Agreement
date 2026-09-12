# RentSphere — Decentralized & Enterprise Smart Rental Agreement System

RentSphere is a hybrid Web3 and Enterprise SaaS platform for drafting, deploying, managing, and settling residential and commercial lease agreements.

It combines **cryptographically enforced Ethereum smart contracts** for security deposit escrow and automated rent ledgers with a **lightweight persistent backend** providing role-based access control (RBAC), physical document authenticity verification (SHA-256), and auditable event tracking.

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)              │
│  - Landlord Panel (Deploy & Manage Leases)              │
│  - Tenant Panel (Inspect, Sign Lease, Pay Rent)         │
│  - Document Integrity Hub (Drag & Drop PDF -> SHA256)   │
│  - Explorer (Public Contract & Vault Lookup)            │
│  - Enterprise / Audit Panel (RBAC, Audit Logs)          │
└──────────────┬───────────────────────────┬──────────────┘
               │ (Ethers.js Web3)          │ (REST HTTP / JWT)
               ▼                           ▼
┌───────────────────────────────┐ ┌───────────────────────────────────┐
│       Smart Contracts         │ │           Backend API             │
│      (Hardhat / Node)         │ │         (Node.js/Express)         │
│  - RentalAgreementFactory     │ │  - Auth & RBAC (Bcrypt + JWT)     │
│  - RentalAgreement (Isolated) │ │  - Agreement Metadata Service     │
│    - Deposit Escrow           │ │  - Document Verification Engine   │
│    - Rent Accounting          │ │  - Audit Trail Logging            │
│    - Auto-Expiry & Refund     │ │  - Persistent SQLite Database     │
└───────────────────────────────┘ └───────────────────────────────────┘
```

---

## Key Features

1. **Decentralized Escrow & Balance Isolation:**
   - Security deposits are strictly locked in escrow and mathematically isolated from claimable rent.
   - Landlords can claim monthly rent immediately upon tenant payment without touching the security deposit.
   - Transparent auto-expiry: tenant can trigger contract expiration and claim their security deposit refund once the lease term concludes.
2. **Cryptographic Document Authenticity Engine:**
   - Real-time client-side hashing: drag-and-drop any lease PDF/DOCX to compute its SHA-256 hash using the browser's native Web Crypto API.
   - Verify that an off-chain digital or printed document precisely matches the on-chain registered terms without uploading file contents to third-party servers.
3. **Role-Based Access Control (RBAC):**
   - Granular roles: **Super Admin**, **Legal Officer**, **Auditor**, **Property Owner**, and **Tenant**.
   - Secure authentication with password hashing (`bcryptjs`) and signed JWT access tokens.
4. **Auditable Event Trail:**
   - Immutable security and financial event log tracking logins, agreement creations, payment receipts, and document verification requests.

---

## Technology Stack

- **Smart Contracts:** Solidity `^0.8.20`, Hardhat `2.22.5`, Ethers.js `v6`
- **Backend Service:** Node.js, Express `4.21`, SQLite (`node:sqlite`), `bcryptjs`, `jsonwebtoken`, `dotenv`, `cors`
- **Frontend App:** React `19`, Vite `8`, Lucide React, Space Grotesk / Inter typography
- **Testing:** Hardhat Mocha/Chai for EVM contracts, Node built-in test runner for REST API

---

## Quick Start & Local Development

### 1. Prerequisites
- **Node.js**: v18+ (tested on Node v24)
- **MetaMask** or compatible Web3 browser extension

### 2. Installation
Install dependencies in all layers:
```bash
# Root (Hardhat & Smart Contracts)
npm install

# Backend
npm --prefix backend install

# Frontend
npm --prefix frontend install
```

### 3. Start Local Hardhat Blockchain
Open a terminal and start the local EVM node:
```bash
npm run node
```
*Chain ID:* `1337` (or `31337`)  
*RPC URL:* `http://127.0.0.1:8545`

### 4. Deploy Smart Contracts
In a second terminal, deploy the factory and sample agreement:
```bash
npm run deploy:local
```
> *Note:* The deployment script automatically updates `frontend/src/contracts/contractAddress.js` with the fresh contract addresses.

### 5. Start Backend Server
```bash
npm run backend:start
```
The REST API server will run at `http://localhost:4000`.

### 6. Start Frontend Application
```bash
npm run frontend:dev
```
Open `http://localhost:5173` in your browser.

---

## Pre-Seeded Demonstration Accounts

For testing the Enterprise SaaS portal (`http://localhost:5173` -> **Enterprise SaaS** tab):

| Role | Email | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@rentsphere.com` | `Password@123` | Full dashboard, analytics, audit trail |
| **Legal Officer** | `legal@rentsphere.com` | `Password@123` | Document hash verification engine |
| **Auditor** | `auditor@rentsphere.com` | `Password@123` | Read-only security audit trail |
| **Property Owner** | `landlord@gmail.com` | `Password@123` | Landlord portfolio operations |
| **Tenant** | `tenant@gmail.com` | `Password@123` | Tenant operations |

---

## Running the Automated Test Suites

### Smart Contract Tests (Hardhat)
```bash
npm test
```
Verifies:
- Factory deployment & agreement tracking
- Tenant lease joining & deposit locking
- Initial rent claim & multi-month rent advances
- Deposit balance isolation & protection
- Auto-expiry after duration

### Backend API Tests (Node Test Runner)
```bash
npm --prefix backend test
```
Verifies:
- Health check & database connection
- Bcrypt credential verification & JWT issuance
- Agreement creation & input validation
- Cryptographic SHA-256 verification
- RBAC route protection

---

## Production Deployment Guide

### Deployment Architecture Recommendation:
```text
Static Frontend (Vite Build)       Backend REST API (Node/Express)       Database
       │                                     │                              │
       ▼                                     ▼                              ▼
Cloudflare Pages / Vercel / Netlify    Render / Railway / Fly.io       Persistent SQLite / Postgres
```

### Environment Variables

#### Backend (`backend/.env`):
```env
PORT=4000
JWT_SECRET=your_long_random_production_secret_key
CORS_ORIGIN=https://your-frontend-domain.com
NODE_ENV=production
```

#### Frontend (`frontend/.env`):
```env
VITE_API_URL=https://your-backend-api.com/api
VITE_DEFAULT_CHAIN_ID=11155111  # Sepolia (or your target EVM chain ID)
```

### Production Build
```bash
# Compile contracts
npm run compile

# Build frontend production bundle
npm run frontend:build
```
The production bundle will be generated in `frontend/dist`.
