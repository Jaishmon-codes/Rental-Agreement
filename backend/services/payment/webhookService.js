// Razorpay Idempotent Webhook Processing Service
import db from "../../db.js";
import defaultRazorpay from "./razorpay.js";
import defaultSettlementService from "./settlementService.js";
import { PAYMENT_STATUS } from "./config.js";

export class WebhookService {
  constructor({
    razorpay = defaultRazorpay,
    settlementService = defaultSettlementService,
    database = db
  } = {}) {
    this.razorpay = razorpay;
    this.settlementService = settlementService;
    this.db = database;
  }

  // Handle incoming Razorpay Webhook Event
  async handleWebhook({ rawBody, signature, eventIdHeader }) {
    if (!rawBody || !signature) {
      const err = new Error("Missing webhook body or signature");
      err.status = 400;
      throw err;
    }

    // 1. Cryptographic Signature Verification
    const isValid = this.razorpay.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      const err = new Error("Invalid webhook signature");
      err.status = 400;
      throw err;
    }

    // 2. Parse Payload
    const event = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    const eventId =
      eventIdHeader ||
      event.id ||
      event.event_id ||
      `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 3. Strict Idempotency Check (Atomic reservation to prevent concurrent settlement races)
    const eventType = event.event;
    try {
      this.db.prepare(`
        INSERT INTO webhook_events (id, event_type, payload)
        VALUES (?, ?, ?)
      `).run(eventId, eventType, typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody));
    } catch (err) {
      if (err.message && err.message.includes("UNIQUE constraint failed")) {
        console.log(`[WEBHOOK] Dropping duplicate event ${eventId} (Already processed)`);
        return {
          idempotent: true,
          processed: false,
          eventId,
          message: "Event already processed"
        };
      }
      throw err;
    }

    // 4. Dispatch Event
    console.log(`[WEBHOOK] Processing event ${eventId} of type ${eventType}`);

    let actionTaken = "UNHANDLED_EVENT";

    switch (eventType) {
      case "payment.captured": {
        const paymentEntity = event.payload?.payment?.entity;
        if (paymentEntity?.order_id) {
          const payment = this.db
            .prepare("SELECT * FROM payments WHERE razorpay_order_id = ?")
            .get(paymentEntity.order_id);

          if (payment && payment.status === PAYMENT_STATUS.PENDING) {
            const now = new Date().toISOString();
            const updateRes = this.db.prepare(`
              UPDATE payments SET
                status = ?,
                razorpay_payment_id = ?,
                transaction_id = ?,
                captured_at = ?
              WHERE id = ? AND status = ?
            `).run(
              PAYMENT_STATUS.CAPTURED,
              paymentEntity.id,
              paymentEntity.id,
              now,
              payment.id,
              PAYMENT_STATUS.PENDING
            );

            if (updateRes.changes > 0) {
              // Attempt settlement to linked account only once
              await this.settlementService.settlePaymentToLandlord(payment.id);
              actionTaken = "PAYMENT_CAPTURED";
            }
          }
        }
        break;
      }

      case "payment.failed": {
        const paymentEntity = event.payload?.payment?.entity;
        if (paymentEntity?.order_id) {
          const payment = this.db
            .prepare("SELECT * FROM payments WHERE razorpay_order_id = ?")
            .get(paymentEntity.order_id);

          if (payment && payment.status === PAYMENT_STATUS.PENDING) {
            this.db.prepare(`
              UPDATE payments SET
                status = ?,
                failure_reason = ?
              WHERE id = ?
            `).run(
              PAYMENT_STATUS.FAILED,
              paymentEntity.error_description || "Payment failed via gateway",
              payment.id
            );
            actionTaken = "PAYMENT_FAILED";
          }
        }
        break;
      }

      case "refund.processed": {
        const refundEntity = event.payload?.refund?.entity;
        if (refundEntity?.payment_id) {
          const payment = this.db
            .prepare("SELECT * FROM payments WHERE razorpay_payment_id = ? OR id = ?")
            .get(refundEntity.payment_id, refundEntity.payment_id);

          if (payment) {
            const refundRecord = this.db
              .prepare("SELECT * FROM refunds WHERE razorpay_refund_id = ?")
              .get(refundEntity.id);

            if (refundRecord) {
              this.db.prepare("UPDATE refunds SET status = 'PROCESSED' WHERE id = ?").run(refundRecord.id);
            }
            actionTaken = "REFUND_PROCESSED";
          }
        }
        break;
      }

      case "transfer.processed": {
        const transferEntity = event.payload?.transfer?.entity;
        if (transferEntity?.source) {
          this.db.prepare(`
            UPDATE payments SET
              status = ?,
              settled_at = ?
            WHERE razorpay_payment_id = ?
          `).run(
            PAYMENT_STATUS.SETTLED,
            new Date().toISOString(),
            transferEntity.source
          );
          actionTaken = "TRANSFER_SETTLED";
        }
        break;
      }

      default:
        console.log(`[WEBHOOK] Received informational event ${eventType}`);
    }

    return {
      idempotent: false,
      processed: true,
      eventId,
      eventType,
      actionTaken
    };
  }
}

export const defaultWebhookService = new WebhookService();
export default defaultWebhookService;
