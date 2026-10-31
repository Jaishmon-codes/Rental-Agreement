import crypto from "node:crypto";
import db, { logAudit } from "../../db.js";

/**
 * In-Memory Event Queue Adapter for zero-cost local development and testing
 */
export class InMemoryQueueAdapter {
  constructor() {
    this.queue = [];
    this.deadLetterQueue = [];
    this.processingMap = new Map();
  }

  async enqueue(eventType, payload, options = {}) {
    const event = {
      id: `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      type: eventType,
      payload,
      maxRetries: options.maxRetries ?? 3,
      retryCount: 0,
      status: "QUEUED",
      createdAt: new Date().toISOString(),
      availableAt: Date.now() + (options.delayMs || 0)
    };

    this.queue.push(event);
    return event;
  }

  async dequeue() {
    const now = Date.now();
    const index = this.queue.findIndex((e) => e.availableAt <= now);
    if (index === -1) return null;

    const [event] = this.queue.splice(index, 1);
    event.status = "PROCESSING";
    this.processingMap.set(event.id, event);
    return event;
  }

  async ack(eventId) {
    this.processingMap.delete(eventId);
    return true;
  }

  async nack(eventId, error) {
    const event = this.processingMap.get(eventId);
    this.processingMap.delete(eventId);
    if (!event) return false;

    event.retryCount += 1;
    if (event.retryCount >= event.maxRetries) {
      event.status = "FAILED";
      event.failureReason = error?.message || "Max retries exceeded";
      this.deadLetterQueue.push(event);
      return false;
    }

    event.status = "QUEUED";
    // Exponential backoff
    event.availableAt = Date.now() + Math.pow(2, event.retryCount) * 500;
    this.queue.push(event);
    return true;
  }

  size() {
    return this.queue.length;
  }

  clear() {
    this.queue = [];
    this.deadLetterQueue = [];
    this.processingMap.clear();
  }
}

/**
 * SQLite Persistent Queue Adapter for zero-loss local and production deployments (MED-03)
 */
export class SQLiteQueueAdapter {
  constructor(database = db) {
    this.db = database;
  }

  async enqueue(eventType, payload, options = {}) {
    const id = `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const maxRetries = options.maxRetries ?? 3;
    const availableAt = Date.now() + (options.delayMs || 0);

    const stmt = this.db.prepare(`
      INSERT INTO queued_jobs (id, event_type, payload, max_retries, retry_count, status, available_at)
      VALUES (?, ?, ?, ?, 0, 'QUEUED', ?)
    `);
    stmt.run(id, eventType, JSON.stringify(payload), maxRetries, availableAt);

    return {
      id,
      type: eventType,
      payload,
      maxRetries,
      retryCount: 0,
      status: "QUEUED",
      createdAt: new Date().toISOString(),
      availableAt
    };
  }

  reclaimStaleJobs(visibilityTimeoutMs = 60000) {
    const cutoff = Date.now() - visibilityTimeoutMs;
    const result = this.db.prepare(`
      UPDATE queued_jobs
      SET status = 'QUEUED', processing_started_at = NULL, retry_count = retry_count + 1
      WHERE status = 'PROCESSING' AND processing_started_at IS NOT NULL AND processing_started_at < ?
    `).run(cutoff);
    return result.changes;
  }

  async dequeue(visibilityTimeoutMs = 60000) {
    const now = Date.now();
    // 1. Reclaim abandoned jobs from crashed workers (Finding 5)
    this.reclaimStaleJobs(visibilityTimeoutMs);

    // 2. Select next available queued job
    const row = this.db.prepare(`
      SELECT * FROM queued_jobs
      WHERE status = 'QUEUED' AND available_at <= ?
      ORDER BY available_at ASC
      LIMIT 1
    `).get(now);

    if (!row) return null;

    // 3. Atomically claim with processing timestamp
    const updateRes = this.db.prepare(`
      UPDATE queued_jobs
      SET status = 'PROCESSING', processing_started_at = ?
      WHERE id = ? AND status = 'QUEUED'
    `).run(now, row.id);

    if (updateRes.changes === 0) {
      // Race: another concurrent worker claimed this job
      return null;
    }

    return {
      id: row.id,
      type: row.event_type,
      payload: JSON.parse(row.payload),
      maxRetries: row.max_retries,
      retryCount: row.retry_count,
      status: "PROCESSING",
      availableAt: row.available_at,
      processingStartedAt: now
    };
  }

  async ack(eventId) {
    this.db.prepare("UPDATE queued_jobs SET status = 'COMPLETED', processing_started_at = NULL WHERE id = ?").run(eventId);
    return true;
  }

  async nack(eventId, error) {
    const row = this.db.prepare("SELECT * FROM queued_jobs WHERE id = ?").get(eventId);
    if (!row) return false;

    const nextRetry = row.retry_count + 1;
    if (nextRetry >= row.max_retries) {
      this.db.prepare(`
        UPDATE queued_jobs
        SET status = 'FAILED', failure_reason = ?, retry_count = ?, processing_started_at = NULL
        WHERE id = ?
      `).run(error?.message || "Max retries exceeded", nextRetry, eventId);
      return false;
    }

    const nextAvailableAt = Date.now() + Math.pow(2, nextRetry) * 500;
    this.db.prepare(`
      UPDATE queued_jobs
      SET status = 'QUEUED', retry_count = ?, available_at = ?, failure_reason = ?, processing_started_at = NULL
      WHERE id = ?
    `).run(nextRetry, nextAvailableAt, error?.message || null, eventId);
    return true;
  }

  size() {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM queued_jobs WHERE status = 'QUEUED'").get();
    return row?.count || 0;
  }

  clear() {
    this.db.prepare("DELETE FROM queued_jobs").run();
  }
}

/**
 * SQS Queue Adapter for Production Amazon Web Services Deployments
 */
export class SQSQueueAdapter {
  constructor(options = {}) {
    this.queueUrl = options.queueUrl || process.env.AWS_SQS_QUEUE_URL;
    this.fallbackAdapter = new SQLiteQueueAdapter();
    this.isConfigured = Boolean(this.queueUrl && process.env.AWS_ACCESS_KEY_ID);
  }

  async enqueue(eventType, payload, options = {}) {
    if (!this.isConfigured) {
      return this.fallbackAdapter.enqueue(eventType, payload, options);
    }

    try {
      const { SQSClient, SendMessageCommand } = await import("@aws-sdk/client-sqs");
      const client = new SQSClient({ region: process.env.AWS_REGION || "us-east-1" });
      const eventId = `sqs_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

      await client.send(new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({
          id: eventId,
          type: eventType,
          payload,
          maxRetries: options.maxRetries || 3,
          retryCount: 0
        }),
        DelaySeconds: Math.floor((options.delayMs || 0) / 1000)
      }));

      return { id: eventId, type: eventType, payload, status: "QUEUED" };
    } catch (err) {
      console.warn(`[SQS] enqueue failed (${err.message}). Using SQLite fallback.`);
      return this.fallbackAdapter.enqueue(eventType, payload, options);
    }
  }

  async dequeue() {
    if (!this.isConfigured) {
      return this.fallbackAdapter.dequeue();
    }
    // SQS consumer uses ReceiveMessageCommand in worker
    return this.fallbackAdapter.dequeue();
  }

  async ack(eventId) {
    return this.fallbackAdapter.ack(eventId);
  }

  async nack(eventId, error) {
    return this.fallbackAdapter.nack(eventId, error);
  }
}

export function getEventQueue() {
  if (process.env.QUEUE_ADAPTER === "memory") {
    return new InMemoryQueueAdapter();
  }
  if (process.env.AWS_SQS_QUEUE_URL && process.env.AWS_ACCESS_KEY_ID) {
    return new SQSQueueAdapter();
  }
  return new SQLiteQueueAdapter();
}

export const eventQueue = getEventQueue();
