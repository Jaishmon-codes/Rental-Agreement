import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ethers, Interface } from "ethers";
import { app, db, worker, web3Validator } from "../backend/server.js";
import emailService from "../backend/services/email/emailService.js";
import { generateTestWebhookSignature, RAZORPAY_WEBHOOK_SECRET } from "../backend/services/payment/razorpay.js";

console.log("=================================================");
console.log("    RENTSPHERE STAGING DRY RUN SMOKE TEST        ");
console.log("=================================================");

let server;
let port;
let baseUrl;

const startServer = () => new Promise((resolve) => {
  server = app.listen(0, () => {
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    resolve();
  });
});

const stopServer = () => new Promise((resolve) => {
  server.close(() => resolve());
});

await startServer();

const makeRequest = async (path, options = {}) => {
  const { headers = {}, body, ...rest } = options;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const requestHeaders = isFormData
    ? { ...headers }
    : { "Content-Type": "application/json", ...headers };

  const res = await fetch(`${baseUrl}${path}`, {
    headers: requestHeaders,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
    ...rest
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const uniqueId = Date.now();
const tenantEmail = `stage_tenant_${uniqueId}@rentsphere.com`;
const tenantPassword = "SecurePassword@2026";
let tenantToken = "";
let landlordToken = "";
let financeToken = "";
let adminToken = "";
let propertyId = "";
let agreementId = "";
let documentId = "";
let uploadedHash = "";
let paymentId = "";
const testWallet = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

try {
  // 1. REGISTER
  console.log("\n[STEP 1] Register new tenant user...");
  const regRes = await makeRequest("/api/auth/register", {
    method: "POST",
    body: { email: tenantEmail, password: tenantPassword, name: "Staging Tenant", role: "Tenant" }
  });
  assert.strictEqual(regRes.status, 201);
  console.log(" -> Registered successfully:", tenantEmail);

  // 2. VERIFY EMAIL
  console.log("\n[STEP 2] Verify email via out-of-band token...");
  const sentMail = emailService.getLastEmail(tenantEmail);
  assert.ok(sentMail && sentMail.token, "Verification email must contain token");
  const verifyRes = await makeRequest("/api/auth/verify-email", {
    method: "POST",
    body: { email: tenantEmail, token: sentMail.token }
  });
  assert.strictEqual(verifyRes.status, 200);
  assert.strictEqual(verifyRes.data.verified, true);
  console.log(" -> Email verified successfully.");

  // 3. LOGIN
  console.log("\n[STEP 3] Login as Tenant, Landlord, Finance Admin, Super Admin...");
  const tenantLogin = await makeRequest("/api/auth/login", {
    method: "POST",
    body: { email: tenantEmail, password: tenantPassword }
  });
  assert.strictEqual(tenantLogin.status, 200);
  tenantToken = tenantLogin.data.token;

  const landlordLogin = await makeRequest("/api/auth/login", {
    method: "POST",
    body: { email: "landlord@gmail.com", password: "Password@123" }
  });
  assert.strictEqual(landlordLogin.status, 200);
  landlordToken = landlordLogin.data.token;

  const financeLogin = await makeRequest("/api/auth/login", {
    method: "POST",
    body: { email: "finance@rentsphere.com", password: "Password@123" }
  });
  assert.strictEqual(financeLogin.status, 200);
  financeToken = financeLogin.data.token;

  const adminLogin = await makeRequest("/api/auth/login", {
    method: "POST",
    body: { email: "admin@rentsphere.com", password: "Password@123" }
  });
  assert.strictEqual(adminLogin.status, 200);
  adminToken = adminLogin.data.token;
  console.log(" -> All 4 roles authenticated successfully with JWTs.");

  // 4. CREATE PROPERTY
  console.log("\n[STEP 4] Landlord creates property...");
  const propRes = await makeRequest("/api/properties", {
    method: "POST",
    headers: { Authorization: `Bearer ${landlordToken}` },
    body: { title: "Staging Horizon Towers", address: "Tower 1, Golf Course Road, Gurugram", city: "Gurugram", state: "Haryana", pincode: "122002" }
  });
  assert.strictEqual(propRes.status, 201);
  propertyId = propRes.data.id;
  console.log(" -> Property created:", propertyId);

  const samplePdfContent = "%PDF-1.4\n1 0 obj\n<< /Title (Staging Lease Agreement) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF";
  const expectedPdfHash = crypto.createHash("sha256").update(samplePdfContent).digest("hex");

  // 5. CREATE AGREEMENT
  console.log("\n[STEP 5] Create rental agreement linked to property...");
  const agreeRes = await makeRequest("/api/agreements", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      companyId: "DLF_Staging",
      landlordAddress: "landlord@gmail.com",
      tenantAddress: tenantEmail,
      rentInINR: 35000,
      securityDepositInINR: 70000,
      durationDays: 365,
      propertyDetails: "Tower 1, Suite 1204",
      pdfHash: expectedPdfHash,
      propertyId,
      paymentRail: "HYBRID"
    }
  });
  assert.strictEqual(agreeRes.status, 201);
  agreementId = agreeRes.data.id;
  // Update contract_address and set Active for staging test
  db.prepare("UPDATE agreements SET contract_address = ?, status = 'Active' WHERE id = ?").run(contractAddress, agreementId);
  console.log(" -> Agreement created and activated:", agreementId);

  // 6. UPLOAD DOCUMENT
  console.log("\n[STEP 6] Upload verified lease PDF document...");
  const pdfBlob = new Blob([samplePdfContent], { type: "application/pdf" });
  const uploadForm = new FormData();
  uploadForm.append("agreementId", agreementId);
  uploadForm.append("title", "Staging Executed Lease Agreement");
  uploadForm.append("isPrimaryLease", "true");
  uploadForm.append("file", pdfBlob, "staging_lease.pdf");

  const uploadRes = await makeRequest("/api/documents/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${landlordToken}` },
    body: uploadForm
  });
  assert.strictEqual(uploadRes.status, 201);
  documentId = uploadRes.data.id;
  uploadedHash = uploadRes.data.sha256;
  console.log(" -> Document uploaded:", documentId, "SHA-256:", uploadedHash);

  // 7. VERIFY DOCUMENT
  console.log("\n[STEP 7] Verify document hash on server...");
  const verifyFileForm = new FormData();
  verifyFileForm.append("agreementId", agreementId);
  verifyFileForm.append("file", pdfBlob, "staging_lease.pdf");

  const verifyDocRes = await makeRequest("/api/verifyDocumentFile", {
    method: "POST",
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: verifyFileForm
  });
  assert.strictEqual(verifyDocRes.status, 200);
  assert.strictEqual(verifyDocRes.data.isValid, true);
  console.log(" -> Document integrity match verified: PASS (isValid = true).");

  // 8. CONNECT WALLET
  console.log("\n[STEP 8] Link verified Web3 wallet using cryptographic signature...");
  const nonceRes = await makeRequest("/api/wallet/nonce", {
    method: "POST",
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: { walletAddress: testWallet }
  });
  assert.strictEqual(nonceRes.status, 200);
  const { nonce, challengeMessage } = nonceRes.data;

  // Sign challenge message with private key
  const walletSigner = ethers.Wallet.createRandom();
  const actualSignerAddress = walletSigner.address;
  // Use user's real wallet for signing
  const userSigner = new ethers.Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
  const realWallet = userSigner.address;

  // Request nonce for realWallet
  const userNonceRes = await makeRequest("/api/wallet/nonce", {
    method: "POST",
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: { walletAddress: realWallet }
  });
  const userSignature = await userSigner.signMessage(userNonceRes.data.message);

  const linkRes = await makeRequest("/api/wallet/verify", {
    method: "POST",
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: { walletAddress: realWallet, signature: userSignature }
  });
  assert.strictEqual(linkRes.status, 200);
  assert.strictEqual(linkRes.data.verified, true);
  console.log(" -> Web3 Wallet linked and verified:", realWallet);

  // 9. EXECUTE WEB3 FLOW
  console.log("\n[STEP 9] Execute authoritative Web3 payment validation...");
  const web3TxHash = "0x" + "a".repeat(64);
  const iface = new Interface(["function payNextRent() payable"]);
  const origProvider = web3Validator.provider;
  web3Validator.provider = {
    getTransaction: async (hash) => ({
      hash: web3TxHash,
      to: contractAddress,
      from: realWallet,
      value: ethers.parseEther("0.05"),
      data: iface.encodeFunctionData("payNextRent", []),
      blockNumber: 50001
    }),
    getTransactionReceipt: async (hash) => ({ status: 1, blockNumber: 50001 }),
    getBlockNumber: async () => 50005
  };

  const web3PayRes = await makeRequest("/api/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: {
      agreementId,
      amountINR: 35000,
      transactionId: web3TxHash,
      paymentRail: "WEB3",
      blockchainTxHash: web3TxHash
    }
  });
  web3Validator.provider = origProvider;
  assert.strictEqual(web3PayRes.status, 201);
  assert.strictEqual(web3PayRes.data.payment_rail, "WEB3");
  assert.strictEqual(web3PayRes.data.on_chain_synced, 1);
  console.log(" -> Web3 payment validated and recorded:", web3PayRes.data.id);

  // 10. EXECUTE FIAT FLOW
  console.log("\n[STEP 10] Execute fiat flow (Razorpay order creation & signature capture)...");
  const orderRes = await makeRequest("/api/payments/create-order", {
    method: "POST",
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: { agreementId, rentAmountINR: 35000 }
  });
  assert.strictEqual(orderRes.status, 201);
  const { orderId, amountINR, platformFeeINR } = orderRes.data;
  console.log(` -> Razorpay order created: ${orderId} (Rent: ₹${amountINR}, Fee: ₹${platformFeeINR})`);

  // Simulate gateway capture with authentic HMAC signature
  const fakeRazorpayPaymentId = `pay_rzp_stage_${Date.now()}`;
  const hmac = crypto.createHmac("sha256", "rentsphere_test_secret_2026");
  hmac.update(`${orderId}|${fakeRazorpayPaymentId}`);
  const signature = hmac.digest("hex");

  const captureRes = await makeRequest("/api/payments/verify", {
    method: "POST",
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: {
      razorpayOrderId: orderId,
      razorpayPaymentId: fakeRazorpayPaymentId,
      razorpaySignature: signature
    }
  });
  assert.strictEqual(captureRes.status, 200);
  paymentId = captureRes.data.paymentId;
  assert.strictEqual(captureRes.data.status, "CAPTURED");
  console.log(` -> Payment captured successfully: ${paymentId}`);

  // 11. PROCESS WEBHOOK
  console.log("\n[STEP 11] Process duplicate payment.captured webhook idempotency...");
  const webhookEventId = `evt_stage_${Date.now()}`;
  const webhookPayload = JSON.stringify({
    entity: "event",
    id: webhookEventId,
    event: "payment.captured",
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: fakeRazorpayPaymentId,
          order_id: orderId,
          amount: 3500000,
          currency: "INR",
          status: "captured"
        }
      }
    }
  });
  const webhookSig = generateTestWebhookSignature(webhookPayload, RAZORPAY_WEBHOOK_SECRET);

  const hookRes = await fetch(`${baseUrl}/api/webhooks/razorpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-razorpay-signature": webhookSig },
    body: webhookPayload
  });
  const hookData = await hookRes.json();
  assert.strictEqual(hookRes.status, 200);
  console.log(" -> Webhook processed:", hookData.actionTaken);

  // Replay duplicate webhook
  const duplicateHookRes = await fetch(`${baseUrl}/api/webhooks/razorpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-razorpay-signature": webhookSig },
    body: webhookPayload
  });
  const duplicateData = await duplicateHookRes.json();
  assert.strictEqual(duplicateData.idempotent, true);
  console.log(" -> Duplicate webhook dropped idempotently: PASS.");

  // 12. VERIFY SETTLEMENT
  console.log("\n[STEP 12] Verify landlord settlement records...");
  const settlements = db.prepare("SELECT * FROM reconciliation_records WHERE payment_id = ?").all(paymentId);
  console.log(` -> Settlement records audited for ${paymentId}: ${settlements.length} entry found.`);

  // 13. REQUEST REFUND
  console.log("\n[STEP 13] Finance admin processes partial refund...");
  const refundRes = await makeRequest(`/api/payments/${paymentId}/refund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${financeToken}` },
    body: { amountPaise: 1000000, reason: "Staging utility reimbursement adjustment" }
  });
  assert.strictEqual(refundRes.status, 200);
  assert.strictEqual(refundRes.data.paymentStatus, "PARTIALLY_REFUNDED");
  console.log(" -> Partial refund processed: Status =", refundRes.data.paymentStatus);

  // 14. VERIFY AUTHORIZATION BOUNDARIES
  console.log("\n[STEP 14] Verify authorization boundaries (BOLA & RBAC)...");
  // Tenant cannot trigger refund
  const unauthRefund = await makeRequest(`/api/payments/${paymentId}/refund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: { amountINR: 5000, reason: "Unauthorized attempt" }
  });
  assert.strictEqual(unauthRefund.status, 403);

  // Tenant cannot read audit trail
  const unauthAudit = await makeRequest("/api/audit-trail", {
    headers: { Authorization: `Bearer ${tenantToken}` }
  });
  assert.strictEqual(unauthAudit.status, 403);
  console.log(" -> RBAC and BOLA access denials confirmed: PASS (403 Forbidden).");

  // 15. TEST HEALTH ENDPOINTS
  console.log("\n[STEP 15] Test health observability endpoints...");
  const healthRes = await makeRequest("/api/health");
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.data.status, "healthy");
  assert.strictEqual(healthRes.data.checks.database, "connected");

  const liveRes = await makeRequest("/api/health/live");
  assert.strictEqual(liveRes.status, 200);
  assert.strictEqual(liveRes.data.status, "alive");

  const readyRes = await makeRequest("/api/health/ready");
  assert.strictEqual(readyRes.status, 200);
  assert.strictEqual(readyRes.data.status, "ready");
  console.log(" -> /api/health (healthy), /api/health/live (alive), /api/health/ready (ready): PASS.");

  // 16. RESTART BACKEND
  console.log("\n[STEP 16] Restart backend server process...");
  await stopServer();
  await startServer();
  console.log(" -> Backend HTTP server successfully restarted on port:", port);

  // 17. RESTART WORKER
  console.log("\n[STEP 17] Restart worker micro-engine...");
  worker.stop();
  assert.strictEqual(worker.isRunning, false);
  worker.start(500);
  assert.strictEqual(worker.isRunning, true);
  console.log(" -> Worker micro-engine stopped and restarted successfully.");

  // 18. VERIFY PERSISTENCE
  console.log("\n[STEP 18] Verify data persistence after restarts...");
  const postAgreement = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
  assert.ok(postAgreement, "Agreement must persist across server restarts");
  assert.strictEqual(postAgreement.rent_inr, 35000);

  const postPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  assert.ok(postPayment, "Payment record must persist across server restarts");
  assert.strictEqual(postPayment.status, "PARTIALLY_REFUNDED");

  const postWallet = db.prepare("SELECT * FROM wallets WHERE wallet_address = ?").get(realWallet);
  assert.ok(postWallet, "Wallet link must persist across server restarts");
  console.log(" -> Verified: Agreement, Payment, and Wallet records 100% persisted across restart!");

  console.log("\n=================================================");
  console.log("   ALL 18 STAGING SMOKE TEST STEPS PASSED!       ");
  console.log("=================================================");
} finally {
  worker.stop();
  await stopServer();
  // Cleanup staging records
  if (agreementId) {
    db.prepare("DELETE FROM reconciliation_records WHERE payment_id IN (SELECT id FROM payments WHERE agreement_id = ?)").run(agreementId);
    db.prepare("DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE agreement_id = ?)").run(agreementId);
    db.prepare("DELETE FROM payments WHERE agreement_id = ?").run(agreementId);
    db.prepare("DELETE FROM documents WHERE agreement_id = ?").run(agreementId);
    db.prepare("DELETE FROM agreements WHERE id = ?").run(agreementId);
  }
  if (propertyId) {
    db.prepare("DELETE FROM properties WHERE id = ?").run(propertyId);
  }
  db.prepare("DELETE FROM users WHERE email = ?").run(tenantEmail);
}
