# RentSphere Production Deployment Guide

This document provides complete instructions for deploying the RentSphere Decentralized Rental Agreement platform to production and staging environments.

---

## 1. Production Architecture

```text
┌────────────────────────────────┐
│   Frontend SPA (Vite / React)  │  Hosted on Cloudflare Pages / Vercel
│   https://rentsphere.pages.dev │  Static edge-cached HTML, CSS, JS
└───────────────┬────────────────┘
                │
         HTTPS  │  Web3 JSON-RPC
         REST   │  (Infura / Alchemy)
                ▼
┌────────────────────────────────┐       ┌─────────────────────────────────┐
│     Backend Node.js Service    │       │     Ethereum Sepolia Testnet    │
│  Hosted on Render / Railway    │       │  - RentalAgreementFactory       │
│  https://api.rentsphere.com    │       │  - RentalAgreement contracts    │
└───────────────┬────────────────┘       └─────────────────────────────────┘
                │
         SQLite │ (Single instance persistent volume)
                ▼ or PostgreSQL
┌────────────────────────────────┐
│     Persistent Storage         │
│  Users, Leases, Audit Logs     │
└────────────────────────────────┘
```

---

## 2. Environment Variables Specification

### Backend (`backend/.env`)

| Variable | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `PORT` | HTTP port the Express server binds to | `4000` (or injected by hosting platform) |
| `JWT_SECRET` | Cryptographically random secret for signing tokens | `generate with: openssl rand -base64 32` |
| `CORS_ORIGIN` | Allowed frontend origin(s), comma-separated | `https://rentsphere.pages.dev,https://app.rentsphere.com` |
| `NODE_ENV` | Environment identifier | `production` |
| `DB_PATH` | Optional custom path for the SQLite database | `/var/data/rental_database.sqlite` |

### Frontend (`frontend/.env`)

| Variable | Description | Example / Recommended Value |
| :--- | :--- | :--- |
| `VITE_API_URL` | Public URL of the backend REST API | `https://api.rentsphere.com/api` |
| `VITE_DEFAULT_CHAIN_ID` | Target EVM chain ID | `11155111` (Sepolia Testnet) |

---

## 3. Smart Contract Deployment (Sepolia Testnet)

> [!CAUTION]
> **Safety Rule:** Do NOT deploy contracts directly to Ethereum Mainnet without a formal third-party smart contract audit. Deploy to **Sepolia Testnet** for staging and testing.

### Prerequisites:
1. An Alchemy or Infura Sepolia RPC URL.
2. A deployer wallet private key funded with Sepolia testnet ETH (from a Sepolia faucet).

### Steps:
1. Configure your network in `hardhat.config.js`:
   ```javascript
   networks: {
     sepolia: {
       url: process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY",
       accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
     }
   }
   ```
2. Run the deployment script:
   ```bash
   npx hardhat run scripts/deploy.js --network sepolia
   ```
3. The deployment script will log the deployed `RentalAgreementFactory` address and automatically sync it to `frontend/src/contracts/contractAddress.js`.
4. (Optional) Verify contract source code on Etherscan:
   ```bash
   npx hardhat verify --network sepolia <DEPLOYED_FACTORY_ADDRESS>
   ```

---

## 4. Backend Deployment (Render / Railway / Fly.io)

### Option A: Render
1. Create a new **Web Service** on [Render](https://render.com).
2. Connect your Git repository.
3. Configure settings:
   - **Root Directory:** `RentalAgreement-main/backend` (or root if flattened)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add Persistent Disk (recommended for SQLite):
   - **Mount Path:** `/var/data`
   - Set environment variable: `DB_PATH=/var/data/rental_database.sqlite`
5. Configure Environment Variables:
   - `JWT_SECRET`: *(your secret)*
   - `CORS_ORIGIN`: `https://your-frontend-subdomain.pages.dev`
   - `NODE_ENV`: `production`

### Option B: Railway / Fly.io
Follow similar steps, attaching a persistent volume for the SQLite database file or connecting a managed PostgreSQL database.

---

## 5. Frontend Deployment (Cloudflare Pages / Vercel)

### Option A: Cloudflare Pages
1. Log into the Cloudflare Dashboard -> **Workers & Pages** -> **Create application** -> **Pages**.
2. Connect your Git repository.
3. Configure Build Settings:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `frontend`
4. Set Environment Variables:
   - `VITE_API_URL`: `https://your-backend-api.onrender.com/api`
   - `VITE_DEFAULT_CHAIN_ID`: `11155111`
5. Click **Save and Deploy**.

### Option B: Vercel
1. Import the Git repository in Vercel.
2. Select `frontend` as the root directory.
3. Add the `VITE_API_URL` environment variable.
4. Deploy.

---

## 6. CORS Configuration Verification

Ensure the backend `CORS_ORIGIN` matches the exact URL of your deployed frontend (including `https://` and without a trailing slash).

If accessing the frontend from multiple domains (e.g. preview branch URLs and custom domain), supply them as a comma-separated list:
```env
CORS_ORIGIN=https://rentsphere.pages.dev,https://customdomain.com
```

---

## 7. Troubleshooting & Verification

| Issue | Cause | Resolution |
| :--- | :--- | :--- |
| **MetaMask "Wrong Network"** | Wallet is connected to Ethereum Mainnet or Localhost instead of Sepolia. | Click the network banner in RentSphere to switch to Sepolia (Chain ID: `11155111`). |
| **API returns 401 Unauthorized** | Token expired or `JWT_SECRET` changed. | Log in again via the **Enterprise SaaS** tab with valid credentials. |
| **CORS Policy Error in Console** | Frontend origin does not match backend `CORS_ORIGIN`. | Update `CORS_ORIGIN` in the backend environment variables to include your frontend URL. |
| **Document Verification Mismatch** | Uploaded file differs by even 1 byte from the original document. | Ensure the exact original PDF/DOCX file is uploaded without re-saving or modifying metadata. |
| **Contract Call Fails** | Stale contract address or insufficient Sepolia testnet ETH. | Verify `contractAddress.js` has the deployed Sepolia address and wallet has testnet ETH. |
