/**
 * RentSphere Performance & Failure Smoke Test Suite (Phase 18)
 *
 * Verifies system resilience under adverse operating conditions:
 * 1. Concurrent webhook delivery idempotency under heavy parallel dispatch
 * 2. Concurrent refund / payment isolation (no double refund / double allocation)
 * 3. Graceful rejection of malformed JSON, oversized payloads, and missing fields
 * 4. Background worker resilience against poisoned queue items
 */

import http from "node:http";
import assert from "node:assert";
import crypto from "node:crypto";
import jwt from "../backend/node_modules/jsonwebtoken/index.js";
import { app, db, worker } from "../backend/server.js";
import { eventQueue } from "../backend/services/queue/eventQueue.js";
import paymentService from "../backend/services/payment/paymentService.js";
import { generateTestWebhookSignature, RAZORPAY_WEBHOOK_SECRET } from "../backend/services/payment/razorpay.js";

const JWT_SECRET = process.env.JWT_SECRET || "enterprise_rent_sphere_production_secret_key_2026";

let serverInstance;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    serverInstance = http.createServer(app);
    serverInstance.listen(0, "127.0.0.1", () => {
      const addr = serverInstance.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(resolve);
    } else {
      resolve();
    }
  });
}

async function makeRequest(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const fetchOptions = {
    method: options.method || "GET",
    headers: { ...options.headers }
  };

  if (options.body) {
    if (typeof options.body === "string" || Buffer.isBuffer(options.body)) {
      fetchOptions.body = options.body;
    } else {
      fetchOptions.headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(url, fetchOptions);
  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    data = await res.text();
  }

  return { status: res.status, headers: res.headers, data };
}

async function runPerformanceFailureDrill() {
  console.log("=================================================");
  console.log("   RENTSPHERE PERFORMANCE & FAILURE DRILL        ");
  console.log("=================================================\n");

  await startServer();

  const finUser = db.prepare("SELECT id, email, role, token_version FROM users WHERE email = ?").get("finance@rentsphere.com");
  const tenUser = db.prepare("SELECT id, email, role, token_version FROM users WHERE email = ?").get("tenant@gmail.com");

  const financeToken = jwt.sign(
    { id: finUser.id, email: finUser.email, role: finUser.role, tokenVersion: finUser.token_version || 1 },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const tenantToken = jwt.sign(
    { id: tenUser.id, email: tenUser.email, role: tenUser.role, tokenVersion: tenUser.token_version || 1 },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  let agreementId = null;
  let paymentId = null;

  try {
    // -------------------------------------------------------------
    // TEST 1: CONCURRENT IDENTICAL WEBHOOKS
    // -------------------------------------------------------------
    console.log("[TEST 1] Dispatching 10 concurrent identical webhook deliveries...");
    const eventId = `evt_race_${Date.now()}`;
    const fakeOrder = `order_race_${Date.now()}`;
    const fakePay = `pay_race_${Date.now()}`;

    const webhookBody = JSON.stringify({
      entity: "event",
      id: eventId,
      event: "payment.captured",
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: {
          entity: {
            id: fakePay,
            order_id: fakeOrder,
            amount: 2500000,
            currency: "INR",
            status: "captured"
          }
        }
      }
    });

    const sig = generateTestWebhookSignature(webhookBody, RAZORPAY_WEBHOOK_SECRET);

    const concurrentHooks = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        fetch(`${baseUrl}/api/webhooks/razorpay`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-razorpay-signature": sig
          },
          body: webhookBody
        }).then(async (r) => ({ status: r.status, data: await r.json() }))
      )
    );

    const successfulHooks = concurrentHooks.filter((r) => r.status === 200);
    assert.strictEqual(successfulHooks.length, 10, "All 10 webhook requests must return 200");

    const processedHook = concurrentHooks.find((r) => !r.data.idempotent);
    const idempotentHooks = concurrentHooks.filter((r) => r.data.idempotent === true);

    assert.ok(processedHook, "Exactly one delivery should be processed as the primary event");
    assert.strictEqual(idempotentHooks.length, 9, "9 duplicate concurrent deliveries must be deduplicated idempotently");
    console.log(" -> Result: 1 primary delivery processed, 9 duplicate deliveries dropped idempotently without race conditions: PASS.");

    // -------------------------------------------------------------
    // TEST 2: CONCURRENT REFUND PROTECTION
    // -------------------------------------------------------------
    console.log("\n[TEST 2] Verifying concurrent refund execution & double-refund protection...");
    agreementId = `agree_race_${Date.now()}`;
    db.prepare(`
      INSERT INTO agreements (
        id, company_id, property_details, landlord_address, tenant_address,
        rent_inr, security_deposit_inr, duration_days, current_document_hash,
        status, payment_rail
      ) VALUES (?, 'comp_perf', 'Concurrency Test Suite', 'landlord@rentsphere.com', 'tenant@gmail.com', 20000, 40000, 365, 'hash_perf_01', 'Active', 'FIAT')
    `).run(agreementId);

    const createdOrder = await paymentService.createPaymentOrder({
      agreementId,
      tenantEmail: "tenant@gmail.com"
    });

    const rzpPayId = `pay_rzp_race_${Date.now()}`;
    const hmac = crypto.createHmac("sha256", "rentsphere_test_secret_2026");
    hmac.update(`${createdOrder.orderId}|${rzpPayId}`);
    const rzpSig = hmac.digest("hex");

    const captured = await paymentService.verifyAndCapturePayment({
      razorpayOrderId: createdOrder.orderId,
      razorpayPaymentId: rzpPayId,
      razorpaySignature: rzpSig,
      userEmail: "tenant@gmail.com"
    });
    paymentId = captured.paymentId;

    // Concurrently trigger 5 full refunds of 2,000,000 paise (₹20,000) on the same payment
    const concurrentRefunds = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        makeRequest(`/api/payments/${paymentId}/refund`, {
          method: "POST",
          headers: { Authorization: `Bearer ${financeToken}` },
          body: { amountPaise: 2000000, reason: "Concurrent test refund" }
        })
      )
    );

    const refundSuccess = concurrentRefunds.filter((r) => r.status === 200);
    const refundBlocked = concurrentRefunds.filter((r) => r.status === 400);

    assert.strictEqual(refundSuccess.length, 1, "Exactly one full refund should succeed");
    assert.strictEqual(refundBlocked.length, 4, "Remaining 4 concurrent attempts must be rejected with 400");
    console.log(" -> Result: Exactly 1 full refund succeeded, 4 concurrent attempts rejected: PASS.");

    // Check payment status and total refunded in DB
    const finalPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
    assert.strictEqual(finalPayment.status, "REFUNDED");
    const totalRefunded = db.prepare("SELECT SUM(amount) as s FROM refunds WHERE payment_id = ? AND status = 'PROCESSED'").get(paymentId).s;
    assert.strictEqual(totalRefunded, 2000000, "Ledger must strictly record exactly ₹20,000 refunded, zero over-refund");
    console.log(" -> Total ledger refund amount verified: ₹20,000 (paise: 2000000): PASS.");

    // -------------------------------------------------------------
    // TEST 3: MALFORMED PAYLOAD RESILIENCE
    // -------------------------------------------------------------
    console.log("\n[TEST 3] Testing malformed & oversized payload protections...");

    // 3a. Malformed JSON syntax
    const malformedJsonRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"email": "bad@test.com", "password": '
    });
    assert.strictEqual(malformedJsonRes.status, 400, "Malformed JSON syntax must return HTTP 400");
    const malformedJsonData = await malformedJsonRes.json();
    assert.ok(malformedJsonData.error, "Error message must be present");
    assert.ok(!JSON.stringify(malformedJsonData).includes("node_modules"), "No stack traces or path disclosures");
    console.log(" -> Malformed JSON rejected with HTTP 400 (sanitized message): PASS.");

    // 3b. Oversized body (> 50kb limit)
    const giantPayload = JSON.stringify({
      email: "bloat@test.com",
      password: "password123",
      bloat: "A".repeat(60 * 1024)
    });
    const oversizedRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: giantPayload
    });
    assert.strictEqual(oversizedRes.status, 413, "Oversized payload exceeding 50kb limit must return HTTP 413");
    console.log(" -> Oversized payload (60 KB) rejected with HTTP 413: PASS.");

    // 3c. Missing required fields in payment verify
    const missingParamRes = await makeRequest("/api/payments/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: { razorpayOrderId: "order_xyz" }
    });
    assert.strictEqual(missingParamRes.status, 400, "Missing parameters must return HTTP 400");
    console.log(" -> Missing required parameters rejected with HTTP 400: PASS.");

    // -------------------------------------------------------------
    // TEST 4: WORKER POISON PILL SURVIVABILITY
    // -------------------------------------------------------------
    console.log("\n[TEST 4] Testing background worker poison pill survivability...");

    // 4a. Enqueue an unknown/unrecognized event type
    await eventQueue.enqueue("UNKNOWN_CORRUPTED_EVENT_TYPE", { junk: true });
    const unknownResult = await worker.processNextEvent();
    assert.strictEqual(unknownResult.status, "UNHANDLED", "Unknown event type should be marked UNHANDLED");
    console.log(" -> Unhandled event type acknowledged and logged cleanly without crash: PASS.");

    // 4b. Enqueue an event whose handler throws (missing document in DOCUMENT_HASH_VERIFY)
    await eventQueue.enqueue("DOCUMENT_HASH_VERIFY", {
      documentId: "non_existent_doc_id_9999"
    });
    const corruptResult = await worker.processNextEvent();
    assert.strictEqual(corruptResult.status, "FAILED", "Handler error must be caught and marked FAILED");
    assert.ok(corruptResult.error.includes("not found"), "Error details captured in result");
    console.log(" -> Errored handler caught cleanly, event nacked, worker remains healthy: PASS.");

    console.log("\n=================================================");
    console.log("   ALL PERFORMANCE & FAILURE DRILLS PASSED!      ");
    console.log("=================================================");
  } finally {
    await stopServer();
    db.prepare("DELETE FROM queued_jobs WHERE event_type IN ('UNKNOWN_CORRUPTED_EVENT_TYPE', 'DOCUMENT_HASH_VERIFY')").run();
    if (agreementId) {
      db.prepare("DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE agreement_id = ?)").run(agreementId);
      db.prepare("DELETE FROM payments WHERE agreement_id = ?").run(agreementId);
      db.prepare("DELETE FROM agreements WHERE id = ?").run(agreementId);
    }
  }
}

runPerformanceFailureDrill().catch((err) => {
  console.error("DRILL FAILURE:", err);
  process.exit(1);
});
