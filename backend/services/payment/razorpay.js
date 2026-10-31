// Razorpay Integration Service & Cryptographic Verification
import crypto from "node:crypto";

export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_rentsphere_sandbox";
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "rentsphere_test_secret_2026";
export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "rentsphere_webhook_secret_2026";

export class RazorpayClient {
  constructor({ keyId = RAZORPAY_KEY_ID, keySecret = RAZORPAY_KEY_SECRET, webhookSecret = RAZORPAY_WEBHOOK_SECRET } = {}) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = webhookSecret;
    this.isLive = Boolean(process.env.RAZORPAY_LIVE === "true" && keyId.startsWith("rzp_live_"));
  }

  // Create Razorpay Order
  async createOrder({ amount, currency = "INR", receipt, notes = {} }) {
    if (!amount || amount <= 0) {
      throw new Error("Invalid order amount in paise");
    }

    if (this.isLive) {
      const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ amount, currency, receipt, notes })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.description || `Razorpay order creation failed: ${res.status}`);
      }
      return await res.json();
    }

    // Sandbox / Test Mode Order Generation
    const orderId = `order_${crypto.randomBytes(8).toString("hex")}`;
    return {
      id: orderId,
      entity: "order",
      amount,
      amount_paid: 0,
      amount_due: amount,
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      status: "created",
      attempts: 0,
      notes,
      created_at: Math.floor(Date.now() / 1000)
    };
  }

  // Verify Checkout Payment Signature
  verifyPaymentSignature({ orderId, paymentId, signature }) {
    if (!orderId || !paymentId || !signature || typeof signature !== "string") {
      return false;
    }
    const payload = `${orderId}|${paymentId}`;
    const expected = crypto
      .createHmac("sha256", this.keySecret)
      .update(payload)
      .digest("hex");

    if (expected.length !== signature.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(expected, "utf-8"), Buffer.from(signature, "utf-8"));
  }

  // Verify Webhook Signature
  verifyWebhookSignature(rawBody, signature) {
    if (!rawBody || !signature) {
      return false;
    }
    const bodyStr = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
    const expected = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(bodyStr)
      .digest("hex");

    if (expected.length !== signature.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(expected, "utf-8"), Buffer.from(signature, "utf-8"));
  }

  // Initiate Razorpay Route Transfer to Landlord Linked Account
  async createTransfer(paymentId, { account, amount, currency = "INR", notes = {} }) {
    if (this.isLive) {
      const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
      const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/transfers`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          transfers: [
            {
              account,
              amount,
              currency,
              notes
            }
          ]
        })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.description || `Razorpay transfer failed: ${res.status}`);
      }
      return await res.json();
    }

    // Sandbox / Test Mode Transfer
    return {
      id: `trf_${crypto.randomBytes(8).toString("hex")}`,
      entity: "transfer",
      payment_id: paymentId,
      recipient: account,
      amount,
      currency,
      status: "processed",
      created_at: Math.floor(Date.now() / 1000)
    };
  }

  // Initiate Refund via Razorpay
  async createRefund(paymentId, { amount, notes = {} } = {}) {
    if (this.isLive) {
      const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
      const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ amount, notes })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error?.description || `Razorpay refund failed: ${res.status}`);
      }
      return await res.json();
    }

    // Sandbox / Test Mode Refund
    return {
      id: `rfnd_${crypto.randomBytes(8).toString("hex")}`,
      entity: "refund",
      payment_id: paymentId,
      amount,
      currency: "INR",
      status: "processed",
      created_at: Math.floor(Date.now() / 1000)
    };
  }
}

export const defaultRazorpay = new RazorpayClient();
export default defaultRazorpay;

// Testing helper to generate valid HMAC signature
export function generateTestSignature(orderId, paymentId, secret = RAZORPAY_KEY_SECRET) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

export function generateTestWebhookSignature(payload, secret = RAZORPAY_WEBHOOK_SECRET) {
  const bodyStr = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto
    .createHmac("sha256", secret)
    .update(bodyStr)
    .digest("hex");
}
