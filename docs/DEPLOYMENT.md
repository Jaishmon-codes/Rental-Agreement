# RentSphere Deployment Checklist & Runbook

**Release Version:** `v1.0.0-beta`  
**Target Environments:** Staging / Production Beta  
**Last Updated:** September 13, 2026  

---

## 1. Pre-Deployment Checklist

Complete every item in this section before triggering build and deployment pipelines:

- [ ] **Environment Variables Configuration:**
  - [ ] `NODE_ENV=production` set on backend service.
  - [ ] `PORT` set (default `4000` or hosting platform assigned).
  - [ ] `VITE_API_URL` configured on frontend to point to the backend public URL (e.g. `https://api.rentsphere.com/api`).
  - [ ] `VITE_DEFAULT_CHAIN_ID=11155111` (Sepolia) or target EVM network ID.
- [ ] **Secret Hygiene & Cryptographic Entropy:**
  - [ ] Generate high-entropy `JWT_SECRET` (at least 32 bytes / 64 hex characters):
    ```bash
    openssl rand -base64 32
    ```
  - [ ] Verify `JWT_SECRET` is NOT set to development default (`enterprise_rent_sphere_production_secret_key_2026`).
  - [ ] Verify zero `.env` or credential files are committed to version control.
- [ ] **Database & Storage Preparation:**
  - [ ] Provision persistent volume for SQLite (e.g. `/var/data` on Render, Fly.io, or Railway).
  - [ ] Set `DB_PATH=/var/data/rental_database.sqlite`.
  - [ ] Verify volume permissions allow read/write by non-root container user (`node`).
- [ ] **Smart Contract & RPC Verification:**
  - [ ] Deploy `RentalAgreementFactory` to Sepolia testnet:
    ```bash
    npx hardhat run scripts/deploy.js --network sepolia
    ```
  - [ ] Set `VITE_FACTORY_ADDRESS` to the deployed factory address.
  - [ ] Fund deployer and operational accounts with Sepolia testnet ETH.
  - [ ] Validate JSON-RPC provider connectivity (`SEPOLIA_RPC_URL`).
- [ ] **Payment Gateway (Razorpay):**
  - [ ] Register live/test webhook endpoint URL: `https://api.yourdomain.com/api/webhooks/razorpay`.
  - [ ] Subscribe to events: `payment.captured`, `payment.failed`, `refund.processed`.
  - [ ] Configure `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
  - [ ] If using live rail, set `RAZORPAY_LIVE=true` with verified live credentials.
- [ ] **Network & Transport Security:**
  - [ ] Set `CORS_ORIGIN` to exact production frontend domains (rejects wildcard `*`).
  - [ ] Terminate TLS/HTTPS at reverse proxy or edge CDN (Cloudflare, Nginx, ALB).
  - [ ] Verify `Strict-Transport-Security` (HSTS) and `X-Frame-Options: DENY` via Helmet.
- [ ] **Backup Scheduling:**
  - [ ] Configure cron or container sidecar to run `node scripts/backup_db.js` daily.
  - [ ] Ensure snapshot target directory (`backups/`) is backed up to off-site storage.

---

## 2. Deployment Execution Steps

Execute the deployment in the following order:

```text
 1. Initialize Database Storage
         │
         ▼
 2. Deploy Backend API Service
         │
         ▼
 3. Verify Background Worker Micro-Engine
         │
         ▼
 4. Deploy Frontend SPA Bundle
         │
         ▼
 5. Configure Edge Reverse Proxy / CDN
         │
         ▼
 6. Execute Deep Health & Readiness Checks
```

### Step 1: Database Initialization
On container launch, the backend automatically initializes all 21 tables, enables WAL mode, and enforces foreign keys.
```bash
# Verify SQLite database connectivity
node -e "import('./db.js').then(m => { console.log('Database connected, tables:', m.default.prepare(\"SELECT count(*) as c FROM sqlite_master WHERE type='table'\").get().c); process.exit(0); })"
```

### Step 2: Backend API Service Deployment
```bash
cd backend
npm install --omit=dev
npm start
```
The server binds to `0.0.0.0:${PORT}` and logs:
```text
[RentSphere SaaS Server] Running on http://localhost:4000
[RentSphere SaaS Server] Security headers, rate limiters, and SQLite connected.
[WORKER] Background event worker started (poll: 5000ms)
```

### Step 3: Frontend Build & CDN Deployment
```bash
cd frontend
npm install
npm run build
```
Deploy the generated `frontend/dist` directory to Cloudflare Pages, Vercel, or AWS S3/CloudFront.

### Step 4: Reverse Proxy & Liveness Probes
Verify reverse proxy forwards traffic to the backend:
- Liveness check: `GET /api/health/live` -> HTTP 200 `{ "status": "alive" }`
- Readiness check: `GET /api/health/ready` -> HTTP 200 `{ "status": "ready" }`
- Comprehensive health: `GET /api/health` -> HTTP 200 `{ "status": "healthy", "checks": { "database": "connected" } }`

---

## 3. Post-Deployment Verification Checklist

Immediately following deployment, run the verification checklist against the live staging/beta environment:

- [ ] **Staging Dry Run Smoke Test:**
  - Run the automated 18-step staging smoke test suite:
    ```bash
    node scripts/staging_smoke_test.mjs
    ```
  - Verify all 18 steps pass: registration, email verification, multi-role login, property creation, agreement creation, PDF upload/verification, wallet link, Web3 validation, Razorpay order/HMAC capture, webhook idempotency, settlement verification, partial refund, RBAC/BOLA 403 enforcement, health probes, and post-restart persistence.
- [ ] **Observability & Log Streaming:**
  - Inspect backend stdout for structured audit log output (`[AUDIT LOG] USER_LOGIN`, `[AUDIT LOG] PAYMENT_CAPTURED`).
  - Verify no unhandled exceptions or internal stack traces are emitted.
- [ ] **Disaster Recovery Backup Verification:**
  - Execute a live backup snapshot:
    ```bash
    node scripts/backup_db.js
    ```
  - Confirm backup archive is created in `backups/` and passes `PRAGMA integrity_check = 'ok'`.
- [ ] **Rollback Readiness:**
  - Ensure previous container image tag is retained in registry for instant 1-click rollback.
  - Ensure previous database snapshot is preserved prior to applying schema migrations.
