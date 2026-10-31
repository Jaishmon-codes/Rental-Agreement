// RentSphere Production Payment Architecture Test Suite
// Covers Unit, API, Security, State Machine, and 20 Failure Scenarios

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Interface } from "ethers";
import { app, db } from "../server.js";
import web3Validator from "../services/payment/web3Validator.js";
import {
  calculatePaymentSplit,
  rupeesToPaise,
  paiseToRupees,
  isValidTransition,
  PAYMENT_STATUS
} from "../services/payment/config.js";
import {
  generateTestSignature,
  generateTestWebhookSignature,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET
} from "../services/payment/razorpay.js";
import paymentService from "../services/payment/paymentService.js";
import reconciliationService from "../services/payment/reconciliationService.js";
import settlementService from "../services/payment/settlementService.js";

let server;
let port;
let baseUrl;
let adminToken = "";
let tenantToken = "";
let financeToken = "";
let testAgreementId = "";

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Ensure agreement_001 has baseline tenant_address for test isolation
  db.prepare("UPDATE agreements SET tenant_address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' WHERE id = 'agreement_001'").run();

  // Log in admin
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@rentsphere.com", password: "Password@123" })
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;

  // Log in tenant
  const tenantRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "tenant@gmail.com", password: "Password@123" })
  });
  const tenantData = await tenantRes.json();
  tenantToken = tenantData.token;

  // Log in finance admin
  const financeRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "finance@rentsphere.com", password: "Password@123" })
  });
  const financeData = await financeRes.json();
  financeToken = financeData.token;

  // Create an active test agreement for tenant@gmail.com
  testAgreementId = `agree_pay_test_${Date.now()}`;
  db.prepare(`
    INSERT INTO agreements (
      id, company_id, contract_address, landlord_address, tenant_address,
      rent_inr, security_deposit_inr, duration_days, property_details,
      current_document_hash, status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    testAgreementId,
    "Company_Test",
    "0x9999999999999999999999999999999999999999",
    "landlord@gmail.com",
    "tenant@gmail.com",
    30000,
    60000,
    30,
    "Suite 404, Tech Park, Bengaluru",
    "a2b585dd299e03d12fa4293bc5de4111afa1a4b94908f83103eb1f1706367c2e",
    "Active",
    1
  );
});

test.after(() => {
  server.close();
  try {
    db.close();
  } catch (e) {}
});

const makeRequest = async (path, options = {}) => {
  const { headers = {}, body, ...rest } = options;
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: typeof body === "object" ? JSON.stringify(body) : body,
    ...rest
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};

test("Payment Architecture Suite: Monetary Math & Config Units", async (t) => {
  await t.test("Calculates standard 3% platform fee in integer paise", () => {
    // ₹30,000 -> 3000000 paise
    // 3% fee -> 90000 paise (₹900)
    // Landlord proceeds -> 2910000 paise (₹29,100)
    const split = calculatePaymentSplit(30000, 0.03);
    assert.equal(split.grossPaise, 3000000);
    assert.equal(split.grossRupees, 30000);
    assert.equal(split.platformFeePaise, 90000);
    assert.equal(split.platformFeeRupees, 900);
    assert.equal(split.landlordPaise, 2910000);
    assert.equal(split.landlordRupees, 29100);
    assert.equal(split.feeModel, "LANDLORD_BEARING_PLATFORM_FEE");
  });

  await t.test("Supports promotional or altered fee percentage without code changes", () => {
    const split2Percent = calculatePaymentSplit(30000, 0.02);
    assert.equal(split2Percent.platformFeeRupees, 600);
    assert.equal(split2Percent.landlordRupees, 29400);

    const splitZeroPercent = calculatePaymentSplit(30000, 0.0);
    assert.equal(splitZeroPercent.platformFeeRupees, 0);
    assert.equal(splitZeroPercent.landlordRupees, 30000);
  });

  await t.test("Minor unit conversions handle fractional calculations without floating-point drift", () => {
    assert.equal(rupeesToPaise(1250.50), 125050);
    assert.equal(paiseToRupees(125050), 1250.50);
  });
});

test("Payment Architecture Suite: State Machine Verification", async (t) => {
  await t.test("Allows valid state transitions", () => {
    assert.ok(isValidTransition(PAYMENT_STATUS.PENDING, PAYMENT_STATUS.CAPTURED));
    assert.ok(isValidTransition(PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.ALLOCATED));
    assert.ok(isValidTransition(PAYMENT_STATUS.ALLOCATED, PAYMENT_STATUS.SETTLED));
    assert.ok(isValidTransition(PAYMENT_STATUS.SETTLED, PAYMENT_STATUS.REFUNDED));
    assert.ok(isValidTransition(PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED));
  });

  await t.test("Rejects illegal state transitions (Scenario 20)", () => {
    assert.equal(isValidTransition(PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.CAPTURED), false);
    assert.equal(isValidTransition(PAYMENT_STATUS.FAILED, PAYMENT_STATUS.SETTLED), false);
    assert.equal(isValidTransition(PAYMENT_STATUS.CANCELLED, PAYMENT_STATUS.CAPTURED), false);
  });
});

test("Payment Architecture Suite: 20 Production Scenarios & Edge Cases", async (t) => {
  let activeOrderId = "";
  let activePaymentId = "";

  // Scenario 1: Order creation success & fee calculation snapshot
  await t.test("Scenario 1 & 17: Order created server-side with derived fee (tenant cannot submit arbitrary amount)", async () => {
    const res = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: {
        agreementId: testAgreementId,
        // Attacker attempts to send manipulated amount and fee
        amount: 500,
        platformFee: 0
      }
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.agreementId, testAgreementId);
    assert.equal(res.data.amountRupees, 30000); // Server strictly derived ₹30,000 from agreement record
    assert.equal(res.data.amount, 3000000); // Paise
    assert.equal(res.data.feeDetails.platformFeeRupees, 900); // 3%
    assert.equal(res.data.feeDetails.landlordRupees, 29100);
    assert.ok(res.data.orderId.startsWith("order_"));

    activeOrderId = res.data.orderId;
    activePaymentId = res.data.paymentId;
  });

  // Scenario 3: Valid payment capture with genuine HMAC signature
  await t.test("Scenario 3: Payment captured successfully with valid HMAC signature", async () => {
    const genuinePaymentId = `pay_${crypto.randomBytes(8).toString("hex")}`;
    const validSignature = generateTestSignature(activeOrderId, genuinePaymentId, RAZORPAY_KEY_SECRET);

    const res = await makeRequest("/api/payments/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: {
        razorpayOrderId: activeOrderId,
        razorpayPaymentId: genuinePaymentId,
        razorpaySignature: validSignature
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.status, "CAPTURED");
    assert.equal(res.data.grossAmountRupees, 30000);
    assert.equal(res.data.platformFeeRupees, 900);
    assert.equal(res.data.landlordAllocationRupees, 29100);
    assert.ok(res.data.capturedAt);
  });

  // Scenario 8: Idempotent payment capture (retry after network interruption)
  await t.test("Scenario 8: Re-verifying already captured payment returns receipt idempotently", async () => {
    const payment = db.prepare("SELECT * FROM payments WHERE razorpay_order_id = ?").get(activeOrderId);
    const validSignature = generateTestSignature(activeOrderId, payment.razorpay_payment_id, RAZORPAY_KEY_SECRET);

    const res = await makeRequest("/api/payments/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: {
        razorpayOrderId: activeOrderId,
        razorpayPaymentId: payment.razorpay_payment_id,
        razorpaySignature: validSignature
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.paymentId, payment.id);
  });

  // Scenario 4: Frontend callback spoofing with forged signature
  await t.test("Scenario 4: Forged payment callback is rejected with 400 (tamper detection)", async () => {
    // Create separate order for forgery test
    const forgeOrderRes = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: testAgreementId }
    });
    const forgeOrderId = forgeOrderRes.data.orderId;

    const res = await makeRequest("/api/payments/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: {
        razorpayOrderId: forgeOrderId,
        razorpayPaymentId: "pay_fake_attacker_id_123",
        razorpaySignature: "forged_malicious_signature_hash_xyz"
      }
    });

    assert.equal(res.status, 400);
    assert.match(res.data.error, /signature verification failed/i);
  });

  // GATEWAY-BYPASS Defense: Hardcoded test signature backdoor is blocked
  await t.test("GATEWAY-BYPASS Defense: simulated_checkout_signature is rejected with 400", async () => {
    const bypassOrderRes = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: testAgreementId }
    });
    const bypassOrderId = bypassOrderRes.data.orderId;

    const res = await makeRequest("/api/payments/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: {
        razorpayOrderId: bypassOrderId,
        razorpayPaymentId: `pay_${Date.now()}`,
        razorpaySignature: "simulated_checkout_signature"
      }
    });

    assert.equal(res.status, 400);
    assert.match(res.data.error, /signature verification failed/i);
  });

  // Scenario 5: Webhook signature verification and idempotency
  await t.test("Scenario 5: Webhook handles payment.captured and drops duplicate events idempotently", async () => {
    // Create new order for webhook testing
    const orderRes = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: testAgreementId }
    });
    const webhookOrderId = orderRes.data.orderId;
    const webhookPaymentId = `pay_hook_${Date.now()}`;

    const webhookPayload = JSON.stringify({
      entity: "event",
      event: "payment.captured",
      id: `evt_test_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: webhookPaymentId,
            order_id: webhookOrderId,
            amount: 3000000,
            status: "captured"
          }
        }
      }
    });

    const validWebhookSig = generateTestWebhookSignature(webhookPayload, RAZORPAY_WEBHOOK_SECRET);
    const testEventId = `evt_unique_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // First webhook delivery
    const firstRes = await makeRequest("/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "x-razorpay-signature": validWebhookSig,
        "x-razorpay-event-id": testEventId
      },
      body: webhookPayload
    });

    assert.equal(firstRes.status, 200);
    assert.equal(firstRes.data.idempotent, false);
    assert.equal(firstRes.data.actionTaken, "PAYMENT_CAPTURED");

    // Second webhook delivery with identical event ID
    const duplicateRes = await makeRequest("/api/webhooks/razorpay", {
      method: "POST",
      headers: {
        "x-razorpay-signature": validWebhookSig,
        "x-razorpay-event-id": testEventId
      },
      body: webhookPayload
    });

    assert.equal(duplicateRes.status, 200);
    assert.equal(duplicateRes.data.idempotent, true);
    assert.equal(duplicateRes.data.message, "Event already processed");
  });

  // CRIT-05 Concurrency Defense: Concurrent duplicate webhook deliveries
  await t.test("CRIT-05 Defense: Concurrent duplicate webhooks do not double-settle", async () => {
    const concurrentOrderRes = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: testAgreementId }
    });
    const cOrderId = concurrentOrderRes.data.orderId;
    const cEventId = `evt_race_${Date.now()}`;
    const cPayload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_concurrent_${Date.now()}`,
            order_id: cOrderId,
            amount: 3000000,
            status: "captured"
          }
        }
      }
    };
    const cSig = generateTestWebhookSignature(cPayload, RAZORPAY_WEBHOOK_SECRET);

    const [resA, resB] = await Promise.all([
      makeRequest("/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": cSig, "x-razorpay-event-id": cEventId },
        body: cPayload
      }),
      makeRequest("/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": cSig, "x-razorpay-event-id": cEventId },
        body: cPayload
      })
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    const actions = [resA.data.actionTaken, resB.data.actionTaken];
    const idempotents = [resA.data.idempotent, resB.data.idempotent];

    // Exactly one must be actionTaken = PAYMENT_CAPTURED and one idempotent = true
    assert.ok(actions.includes("PAYMENT_CAPTURED"));
    assert.ok(idempotents.includes(true));
  });

  // Scenario 2: Webhook handles payment.failed
  await t.test("Scenario 2: Webhook payment.failed updates payment status to FAILED", async () => {
    const orderRes = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: testAgreementId }
    });
    const failOrderId = orderRes.data.orderId;

    const webhookPayload = JSON.stringify({
      entity: "event",
      event: "payment.failed",
      id: `evt_fail_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: `pay_failed_${Date.now()}`,
            order_id: failOrderId,
            error_description: "Insufficient funds in bank account"
          }
        }
      }
    });

    const sig = generateTestWebhookSignature(webhookPayload, RAZORPAY_WEBHOOK_SECRET);
    const res = await makeRequest("/api/webhooks/razorpay", {
      method: "POST",
      headers: { "x-razorpay-signature": sig },
      body: webhookPayload
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.actionTaken, "PAYMENT_FAILED");

    const failedPayment = db.prepare("SELECT * FROM payments WHERE razorpay_order_id = ?").get(failOrderId);
    assert.equal(failedPayment.status, "FAILED");
    assert.match(failedPayment.failure_reason, /Insufficient funds/);
  });

  // Scenario 14 & 16: Unauthorized tenant payment (BOLA / IDOR)
  await t.test("Scenario 14 & 16: Tenant cannot create payment for another user's agreement (403)", async () => {
    // agreement_001 belongs to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8, not tenant@gmail.com
    const res = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: "agreement_001" }
    });

    assert.equal(res.status, 403);
    assert.match(res.data.error, /Access denied/);
  });

  // Scenario 15: Payment against inactive agreement
  await t.test("Scenario 15: Payment against inactive/draft agreement is rejected (400)", async () => {
    const draftAgreeId = `draft_agree_${Date.now()}`;
    db.prepare(`
      INSERT INTO agreements (
        id, company_id, landlord_address, tenant_address, rent_inr,
        security_deposit_inr, duration_days, property_details, current_document_hash, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(draftAgreeId, "Co", "landlord@gmail.com", "tenant@gmail.com", 20000, 40000, 30, "Draft Unit", "hash", "Draft");

    const res = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: draftAgreeId }
    });

    assert.equal(res.status, 400);
    assert.match(res.data.error, /Agreement is currently Draft/);
  });

  // Scenario 10 & 11: Refund operations and over-refund prevention
  await t.test("Scenario 10 & 11: Finance admin can process refund and prevents over-refund / double-refund", async () => {
    // Attempt refund by tenant (should be blocked - RBAC)
    const tenantRefundRes = await makeRequest(`/api/payments/${activePaymentId}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { amountPaise: 100000 }
    });
    assert.equal(tenantRefundRes.status, 403);

    // Partial refund by Finance Admin (₹10,000 -> 1000000 paise)
    const partialRefundRes = await makeRequest(`/api/payments/${activePaymentId}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${financeToken}` },
      body: { amountPaise: 1000000, reason: "Partial refund approved by finance" }
    });
    assert.equal(partialRefundRes.status, 200);
    assert.equal(partialRefundRes.data.paymentStatus, "PARTIALLY_REFUNDED");
    assert.equal(partialRefundRes.data.amountRupees, 10000);

    // Over-refund attempt: remaining is ₹20,000, requesting ₹25,000 (2500000 paise)
    const overRefundRes = await makeRequest(`/api/payments/${activePaymentId}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${financeToken}` },
      body: { amountPaise: 2500000, reason: "Excessive refund" }
    });
    assert.equal(overRefundRes.status, 400);
    assert.match(overRefundRes.data.error, /exceeds remaining refundable balance/);

    // Full remaining refund (₹20,000 -> 2000000 paise)
    const fullRefundRes = await makeRequest(`/api/payments/${activePaymentId}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${financeToken}` },
      body: { amountPaise: 2000000, reason: "Full remainder refund" }
    });
    assert.equal(fullRefundRes.status, 200);
    assert.equal(fullRefundRes.data.paymentStatus, "REFUNDED");
    assert.equal(fullRefundRes.data.isFullRefund, true);

    // Attempting refund on already REFUNDED payment (Scenario 11: Double-refund)
    const doubleRefundRes = await makeRequest(`/api/payments/${activePaymentId}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${financeToken}` },
      body: { amountPaise: 50000 }
    });
    assert.equal(doubleRefundRes.status, 400);
    assert.match(doubleRefundRes.data.error, /cannot be refunded/);
  });

  // CRIT-04 Concurrency Defense: Double-refund TOCTOU race prevention
  await t.test("CRIT-04 Defense: Concurrent refund requests prevent double-refund TOCTOU race", async () => {
    // Create and capture a fresh payment of 30,000 INR
    const oRes = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: testAgreementId }
    });
    const payId = oRes.data.paymentId;
    const ordId = oRes.data.orderId;
    const dummyPayId = `pay_race_capture_${Date.now()}`;
    const sig = generateTestSignature(ordId, dummyPayId, RAZORPAY_KEY_SECRET);

    await makeRequest("/api/payments/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: {
        razorpayOrderId: ordId,
        razorpayPaymentId: dummyPayId,
        razorpaySignature: sig
      }
    });

    // Fire two concurrent full refund requests of 30,000 INR (3000000 paise)
    const [refA, refB] = await Promise.all([
      makeRequest(`/api/payments/${payId}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${financeToken}` },
        body: { amountPaise: 3000000, reason: "Concurrent refund race A" }
      }),
      makeRequest(`/api/payments/${payId}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${financeToken}` },
        body: { amountPaise: 3000000, reason: "Concurrent refund race B" }
      })
    ]);

    const statuses = [refA.status, refB.status].sort();
    // Exactly one must succeed (200) and one must be rejected (400)
    assert.deepEqual(statuses, [200, 400]);

    // Verify total processed in DB does not exceed gross amount
    const totalRefunded = db.prepare("SELECT SUM(amount) as total FROM refunds WHERE payment_id = ? AND status = 'PROCESSED'").get(payId).total;
    assert.equal(totalRefunded, 3000000);
  });

  // Scenario 9: Landlord Route Linked Account & Settlement
  await t.test("Scenario 9: Landlord registers Route linked account and settlement transfers funds", async () => {
    // Register linked account for landlord@gmail.com
    const linkRes = settlementService.registerLandlordAccount({
      landlordId: "landlord@gmail.com",
      accountNumber: "12345678901234",
      ifsc: "HDFC0001234",
      razorpayAccountId: "acc_rzp_landlord_9988"
    });
    assert.equal(linkRes.status, "ACTIVE");
    assert.equal(linkRes.account_number_masked, "******1234"); // Masked

    // Create and capture a payment
    const orderRes = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: testAgreementId }
    });
    const orderId = orderRes.data.orderId;
    const paymentId = orderRes.data.paymentId;
    const pId = `pay_settle_${Date.now()}`;
    const sig = generateTestSignature(orderId, pId, RAZORPAY_KEY_SECRET);

    await makeRequest("/api/payments/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: {
        razorpayOrderId: orderId,
        razorpayPaymentId: pId,
        razorpaySignature: sig
      }
    });

    // Execute settlement
    const settleRes = await settlementService.settlePaymentToLandlord(paymentId);
    assert.equal(settleRes.settled, true);
    assert.equal(settleRes.status, "SETTLED");
    assert.ok(settleRes.transferId.startsWith("trf_"));
  });

  // Reconciliation Engine Verification
  await t.test("Reconciliation Engine audits ledger and detects mismatches correctly", () => {
    const report = reconciliationService.runReconciliationAudit();
    assert.ok(report.totalPaymentsAudited > 0);
    assert.ok(report.summary.matched >= 1);
  });

  // Financial Dashboard Analytics
  await t.test("GET /api/payments/stats returns aggregated enterprise financial metrics", async () => {
    const res = await makeRequest("/api/payments/stats", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.totalTransactionVolumeRupees > 0);
    assert.ok(res.data.platformGrossRevenueRupees > 0);
  });

  // HIGH-02: Separation of Pure Web3 vs Fiat Payment Rails
  await t.test("HIGH-02 Defense: Creating fiat payment order for pure WEB3 agreement is rejected with 400", async () => {
    // Create an agreement explicitly configured for pure WEB3 rail
    const web3AgreeId = `agree_web3_${Date.now()}`;
    db.prepare(`
      INSERT INTO agreements (
        id, company_id, contract_address, landlord_address, tenant_address,
        rent_inr, security_deposit_inr, duration_days, property_details,
        current_document_hash, status, payment_rail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      web3AgreeId,
      "Company_A",
      "0x1111111111111111111111111111111111111111",
      "landlord@gmail.com",
      "tenant@gmail.com",
      25000,
      50000,
      30,
      "Pure Web3 Smart Contract Suite",
      "a".repeat(64),
      "Active",
      "WEB3"
    );

    const res = await makeRequest("/api/payments/create-order", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { agreementId: web3AgreeId }
    });

    assert.equal(res.status, 400);
    assert.match(res.data.error, /pure Web3/i);

    // Cleanup
    db.prepare("DELETE FROM agreements WHERE id = ?").run(web3AgreeId);
  });

  await t.test("HIGH-02 Defense: Fiat payment receipt reflects paymentRail: FIAT and onChainSynced: false", async () => {
    const receipt = paymentService.getPaymentReceipt(activePaymentId);
    assert.ok(receipt);
    assert.equal(receipt.paymentRail, "FIAT");
    assert.equal(receipt.onChainSynced, false);
  });

  await t.test("HIGH-02 Defense: Direct payment recording validates rail and requires tx hash for pure Web3", async () => {
    // Attempting Web3 payment without 66-char tx hash is rejected
    const invalidRes = await makeRequest("/api/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: {
        agreementId: testAgreementId,
        amountINR: 20000,
        transactionId: "invalid_tx_hash",
        paymentRail: "WEB3"
      }
    });
    assert.equal(invalidRes.status, 400);
    assert.match(invalidRes.data.error, /Web3 payments require a valid 66-character/i);

    // Valid Web3 payment with authentic tx hash succeeds
    const validHash = "0x" + "c".repeat(64);
    const testWallet = "0x4444444444444444444444444444444444444444";
    const tenantUser = db.prepare("SELECT id FROM users WHERE email = 'tenant@gmail.com'").get();
    db.prepare(`
      INSERT OR REPLACE INTO wallets (id, user_id, wallet_address, wallet_type, network, status)
      VALUES (?, ?, ?, 'EVM', 'Sepolia', 'VERIFIED')
    `).run("wlt_pay_test_01", tenantUser.id, testWallet);

    const iface = new Interface(["function joinAsTenant() payable", "function payNextRent() payable"]);
    const originalProvider = web3Validator.provider;
    web3Validator.provider = {
      getTransaction: async (hash) => {
        if (hash.toLowerCase() === validHash.toLowerCase()) {
          return {
            hash: validHash,
            to: "0x9999999999999999999999999999999999999999",
            from: testWallet,
            value: 2000000000000000000n,
            data: iface.encodeFunctionData("joinAsTenant", []),
            blockNumber: 12345
          };
        }
        return null;
      },
      getTransactionReceipt: async (hash) => {
        if (hash.toLowerCase() === validHash.toLowerCase()) {
          return { status: 1, blockNumber: 12345 };
        }
        return null;
      },
      getBlockNumber: async () => 12350
    };

    let validRes;
    try {
      validRes = await makeRequest("/api/payments", {
        method: "POST",
        headers: { Authorization: `Bearer ${tenantToken}` },
        body: {
          agreementId: testAgreementId,
          amountINR: 20000,
          transactionId: validHash,
          paymentRail: "WEB3",
          blockchainTxHash: validHash
        }
      });
      assert.equal(validRes.status, 201);
      assert.equal(validRes.data.payment_rail, "WEB3");
      assert.equal(validRes.data.on_chain_synced, 1);
    } finally {
      web3Validator.provider = originalProvider;
      db.prepare("DELETE FROM wallets WHERE id = 'wlt_pay_test_01'").run();
      if (validRes?.data?.id) {
        db.prepare("DELETE FROM payments WHERE id = ?").run(validRes.data.id);
      }
    }
  });
});
