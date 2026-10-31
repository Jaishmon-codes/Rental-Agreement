import crypto from "node:crypto";
import db, { logAudit } from "../db.js";
import { eventQueue } from "../services/queue/eventQueue.js";
import reconciliationService from "../services/payment/reconciliationService.js";
import { storageService } from "../services/document/storage.js";

class BackgroundWorker {
  constructor(queue = eventQueue) {
    this.queue = queue;
    this.isRunning = false;
    this.timer = null;
    this.handlers = new Map();

    // Register standard handlers
    this.registerHandler("PAYMENT_RECONCILIATION", this.handleReconciliation.bind(this));
    this.registerHandler("RENT_DUE_NOTIFICATION", this.handleRentDueNotification.bind(this));
    this.registerHandler("DOCUMENT_HASH_VERIFY", this.handleDocumentVerification.bind(this));
  }

  registerHandler(eventType, handler) {
    this.handlers.set(eventType, handler);
  }

  async processNextEvent() {
    const event = await this.queue.dequeue();
    if (!event) return null;

    const handler = this.handlers.get(event.type);
    if (!handler) {
      console.warn(`[WORKER] No handler registered for event type: ${event.type}`);
      await this.queue.ack(event.id);
      return { event, status: "UNHANDLED" };
    }

    try {
      const result = await handler(event.payload);
      await this.queue.ack(event.id);
      return { event, status: "COMPLETED", result };
    } catch (err) {
      console.error(`[WORKER] Error processing event ${event.id} (${event.type}):`, err.message);
      await this.queue.nack(event.id, err);
      return { event, status: "FAILED", error: err.message };
    }
  }

  // 1. Reconciliation Audit Handler
  async handleReconciliation(payload) {
    const report = reconciliationService.runReconciliationAudit();
    logAudit(
      "WORKER_RECONCILIATION_COMPLETED",
      `Automated financial reconciliation completed: ${report.totalPaymentsAudited} audited, ${report.summary.mismatch} mismatches`,
      "system@rentsphere.com"
    );
    return report;
  }

  // 2. Rent Due Notification Handler
  async handleRentDueNotification(payload) {
    const { agreementId } = payload;
    const agreement = db.prepare("SELECT * FROM agreements WHERE id = ?").get(agreementId);
    if (!agreement) {
      throw new Error(`Agreement ${agreementId} not found`);
    }

    // Find tenant user record
    const tenantUser = db.prepare("SELECT id, email FROM users WHERE email = ?").get(agreement.tenant_address);
    if (tenantUser) {
      const notifId = `notif_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
      db.prepare(`
        INSERT INTO notifications (id, user_id, title, message, type)
        VALUES (?, ?, ?, ?, 'INFO')
      `).run(
        notifId,
        tenantUser.id,
        "Rent Payment Reminder",
        `Upcoming rent of ₹${agreement.rent_inr} is due for agreement ${agreement.id} (${agreement.property_details}).`
      );
    }

    return { notified: Boolean(tenantUser), agreementId };
  }

  // 3. Asynchronous Document Integrity Check Handler
  async handleDocumentVerification(payload) {
    const { documentId } = payload;
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    const { buffer } = await storageService.getObject(doc.storage_key);
    const computed = crypto.createHash("sha256").update(buffer).digest("hex");
    const isMatching = computed.toLowerCase() === doc.sha256.toLowerCase();

    if (!isMatching) {
      logAudit(
        "DOCUMENT_INTEGRITY_COMPROMISED",
        `ALERT: Cryptographic SHA-256 hash mismatch for document ${documentId}! Stored: ${doc.sha256}, Actual: ${computed}`,
        "system@rentsphere.com",
        doc.agreement_id
      );
    }

    return { documentId, verified: isMatching, computedHash: computed };
  }

  start(intervalMs = 3000) {
    if (this.isRunning) return;
    this.isRunning = true;

    // Crash Recovery: Reclaim any stale jobs abandoned by a previous crashed worker instance (Finding 5)
    if (typeof this.queue.reclaimStaleJobs === "function") {
      const reclaimed = this.queue.reclaimStaleJobs();
      if (reclaimed > 0) {
        console.log(`[WORKER] Reclaimed ${reclaimed} stale in-flight jobs from prior worker.`);
      }
    }

    const poll = async () => {
      if (!this.isRunning) return;
      try {
        await this.processNextEvent();
      } catch (err) {
        console.error("[WORKER] Uncaught error during polling:", err.message);
      }
      if (this.isRunning) {
        this.timer = setTimeout(poll, intervalMs);
      }
    };

    this.timer = setTimeout(poll, intervalMs);
    console.log(`[WORKER] Background event worker started (poll: ${intervalMs}ms)`);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[WORKER] Background event worker stopped");
  }
}

export const worker = new BackgroundWorker();
export default worker;
