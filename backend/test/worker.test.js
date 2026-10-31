import test from "node:test";
import assert from "node:assert/strict";
import { eventQueue, InMemoryQueueAdapter, SQLiteQueueAdapter } from "../services/queue/eventQueue.js";
import worker from "../jobs/worker.js";
import db from "../db.js";

test("Phase 7: Background Worker & Event Queue Architecture Suite", async (t) => {
  // Ensure clean queue state before running worker tests
  db.prepare("DELETE FROM queued_jobs WHERE status IN ('QUEUED', 'PROCESSING')").run();

  await t.test("InMemoryQueueAdapter enqueue, dequeue, ack lifecycle", async () => {
    const queue = new InMemoryQueueAdapter();
    const evt = await queue.enqueue("TEST_EVENT", { foo: "bar" });

    assert.ok(evt.id.startsWith("evt_"));
    assert.strictEqual(evt.status, "QUEUED");
    assert.strictEqual(queue.size(), 1);

    const dequeued = await queue.dequeue();
    assert.strictEqual(dequeued.id, evt.id);
    assert.strictEqual(dequeued.status, "PROCESSING");
    assert.strictEqual(queue.size(), 0);

    await queue.ack(dequeued.id);
  });

  await t.test("Queue retry backoff and dead-letter queue progression", async () => {
    const queue = new InMemoryQueueAdapter();
    const evt = await queue.enqueue("FAILING_EVENT", {}, { maxRetries: 2 });

    const d1 = await queue.dequeue();
    const willRetry1 = await queue.nack(d1.id, new Error("Temporary network glitch"));
    assert.strictEqual(willRetry1, true);

    // Wait for backoff
    await new Promise((r) => setTimeout(r, 1100));

    const d2 = await queue.dequeue();
    assert.strictEqual(d2.id, evt.id);

    const willRetry2 = await queue.nack(d2.id, new Error("Permanent service failure"));
    assert.strictEqual(willRetry2, false, "Should not retry beyond maxRetries");
    assert.strictEqual(queue.deadLetterQueue.length, 1);
    assert.strictEqual(queue.deadLetterQueue[0].status, "FAILED");
  });

  await t.test("Worker processes PAYMENT_RECONCILIATION asynchronously", async () => {
    await eventQueue.enqueue("PAYMENT_RECONCILIATION", {});
    const outcome = await worker.processNextEvent();

    assert.ok(outcome);
    assert.strictEqual(outcome.status, "COMPLETED");
    assert.ok(outcome.result.summary);
    assert.ok(outcome.result.totalPaymentsAudited >= 0);
  });

  await t.test("Worker processes RENT_DUE_NOTIFICATION and generates database notification", async () => {
    // Create isolated agreement for worker test
    db.prepare(`
      INSERT OR REPLACE INTO agreements (
        id, company_id, landlord_address, tenant_address, rent_inr,
        security_deposit_inr, duration_days, property_details, current_document_hash, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "agree_worker_test_01",
      "Company_Worker",
      "landlord@gmail.com",
      "tenant@gmail.com",
      15000,
      30000,
      30,
      "Worker Test Unit",
      "hash_worker_01",
      "Active"
    );

    await eventQueue.enqueue("RENT_DUE_NOTIFICATION", { agreementId: "agree_worker_test_01" });
    const outcome = await worker.processNextEvent();

    assert.ok(outcome);
    assert.strictEqual(outcome.status, "COMPLETED");
    assert.strictEqual(outcome.result.notified, true);

    // Verify written to notifications table
    const tenantUser = db.prepare("SELECT id FROM users WHERE email = 'tenant@gmail.com'").get();
    const notif = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(tenantUser.id);
    assert.ok(notif);
    assert.strictEqual(notif.title, "Rent Payment Reminder");
  });

  await t.test("MED-03: SQLiteQueueAdapter durable persistence across adapter instances", async () => {
    const q1 = new SQLiteQueueAdapter(db);
    const evt = await q1.enqueue("TEST_PERSISTENT_JOB", { accountId: "acc_123" });
    assert.ok(evt.id.startsWith("evt_"));

    // Simulate process restart by creating a brand-new adapter instance
    const q2 = new SQLiteQueueAdapter(db);
    const dequeued = await q2.dequeue();
    assert.ok(dequeued);
    assert.strictEqual(dequeued.id, evt.id);
    assert.strictEqual(dequeued.type, "TEST_PERSISTENT_JOB");
    assert.strictEqual(dequeued.payload.accountId, "acc_123");

    await q2.ack(dequeued.id);
    const jobRow = db.prepare("SELECT * FROM queued_jobs WHERE id = ?").get(evt.id);
    assert.strictEqual(jobRow.status, "COMPLETED");

    // Cleanup
    db.prepare("DELETE FROM queued_jobs WHERE id = ?").run(evt.id);
  });

  await t.test("MED-03: Worker start and stop lifecycle control", async () => {
    assert.strictEqual(worker.isRunning, false);
    worker.start(500);
    assert.strictEqual(worker.isRunning, true);
    worker.stop();
    assert.strictEqual(worker.isRunning, false);
  });

  await t.test("test_worker_reclaims_stale_processing_jobs_after_crash", async () => {
    const queue = new SQLiteQueueAdapter(db);
    const evt = await queue.enqueue("CRASH_TEST_JOB", { testId: "crash_123" });
    assert.ok(evt.id);

    // Dequeue transition to PROCESSING
    const inFlight = await queue.dequeue();
    assert.strictEqual(inFlight.id, evt.id);
    assert.strictEqual(inFlight.status, "PROCESSING");

    // Verify in DB that it is PROCESSING
    const preRow = db.prepare("SELECT status, processing_started_at FROM queued_jobs WHERE id = ?").get(evt.id);
    assert.strictEqual(preRow.status, "PROCESSING");
    assert.ok(preRow.processing_started_at);

    // Simulate worker crashing while job was processing 2 minutes ago
    const staleTime = Date.now() - 120000;
    db.prepare("UPDATE queued_jobs SET processing_started_at = ? WHERE id = ?").run(staleTime, evt.id);

    // Reclaim stale jobs with 60s visibility timeout
    const reclaimedCount = queue.reclaimStaleJobs(60000);
    assert.ok(reclaimedCount >= 1, "Should have reclaimed at least 1 stale job");

    // Verify in DB that it reverted to QUEUED with reset processing_started_at
    const postRow = db.prepare("SELECT status, processing_started_at FROM queued_jobs WHERE id = ?").get(evt.id);
    assert.strictEqual(postRow.status, "QUEUED");
    assert.strictEqual(postRow.processing_started_at, null);

    // New worker instance dequeues and processes the job successfully
    const reclaimedJob = await queue.dequeue();
    assert.strictEqual(reclaimedJob.id, evt.id);
    assert.strictEqual(reclaimedJob.status, "PROCESSING");
    await queue.ack(reclaimedJob.id);

    // Verify COMPLETED
    const finalRow = db.prepare("SELECT status FROM queued_jobs WHERE id = ?").get(evt.id);
    assert.strictEqual(finalRow.status, "COMPLETED");

    // Cleanup
    db.prepare("DELETE FROM queued_jobs WHERE id = ?").run(evt.id);
  });
});
