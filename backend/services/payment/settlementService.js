// Razorpay Route & Landlord Linked Account Settlement Service
import db from "../../db.js";
import defaultRazorpay from "./razorpay.js";
import { PAYMENT_STATUS } from "./config.js";

export class SettlementService {
  constructor({ razorpay = defaultRazorpay, database = db } = {}) {
    this.razorpay = razorpay;
    this.db = database;
  }

  // Register or link landlord bank account for Razorpay Route
  registerLandlordAccount({ landlordId, accountNumber, ifsc, razorpayAccountId }) {
    if (!landlordId) {
      throw new Error("Landlord identification is required");
    }

    // Mask sensitive bank account (PCI/RBI compliance best-practice: zero plain bank credential storage)
    const masked = accountNumber ? `******${String(accountNumber).slice(-4)}` : "******0000";
    const existing = this.db.prepare("SELECT * FROM landlord_accounts WHERE landlord_id = ?").get(landlordId);

    const accountId = existing ? existing.id : `acct_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const status = razorpayAccountId ? "ACTIVE" : "VERIFIED";

    if (existing) {
      this.db.prepare(`
        UPDATE landlord_accounts SET
          account_number_masked = ?,
          ifsc = ?,
          razorpay_account_id = ?,
          status = ?
        WHERE id = ?
      `).run(masked, ifsc || existing.ifsc, razorpayAccountId || existing.razorpay_account_id, status, existing.id);
    } else {
      this.db.prepare(`
        INSERT INTO landlord_accounts (id, landlord_id, account_number_masked, ifsc, razorpay_account_id, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(accountId, landlordId, masked, ifsc || null, razorpayAccountId || null, status);
    }

    return this.db.prepare("SELECT * FROM landlord_accounts WHERE id = ?").get(accountId);
  }

  // Get Landlord Account Status
  getLandlordAccount(landlordId) {
    return this.db.prepare("SELECT * FROM landlord_accounts WHERE landlord_id = ?").get(landlordId);
  }

  // Execute Route Transfer to Landlord
  async settlePaymentToLandlord(paymentId) {
    const payment = this.db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
    if (!payment) {
      throw new Error("Payment not found");
    }

    if (payment.status !== PAYMENT_STATUS.CAPTURED && payment.status !== PAYMENT_STATUS.ALLOCATED) {
      return {
        settled: false,
        reason: `Payment is in status ${payment.status}; settlement requires CAPTURED or ALLOCATED`
      };
    }

    // Find linked account
    const linkedAccount = this.db
      .prepare("SELECT * FROM landlord_accounts WHERE landlord_id = ? AND status = 'ACTIVE'")
      .get(payment.landlord_id);

    if (!linkedAccount || !linkedAccount.razorpay_account_id) {
      return {
        settled: false,
        reason: "Landlord has not linked an active Razorpay Route account yet. Funds remain in platform escrow balance."
      };
    }

    // Atomic reservation: change status from CAPTURED to ALLOCATED before external API call
    const reservation = this.db.prepare(`
      UPDATE payments SET status = ?
      WHERE id = ? AND status = ?
    `).run(PAYMENT_STATUS.ALLOCATED, payment.id, PAYMENT_STATUS.CAPTURED);

    if (reservation.changes === 0 && payment.status !== PAYMENT_STATUS.ALLOCATED) {
      return {
        settled: false,
        reason: "Payment is already in-flight for settlement or already settled"
      };
    }

    try {
      // Execute Razorpay Route transfer
      const transfer = await this.razorpay.createTransfer(payment.razorpay_payment_id || payment.id, {
        account: linkedAccount.razorpay_account_id,
        amount: payment.landlord_amount,
        currency: payment.currency,
        notes: {
          agreementId: payment.agreement_id,
          paymentId: payment.id
        }
      });

      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE payments SET
          status = ?,
          razorpay_transfer_id = ?,
          settled_at = ?
        WHERE id = ?
      `).run(PAYMENT_STATUS.SETTLED, transfer.id, now, payment.id);

      return {
        settled: true,
        transferId: transfer.id,
        amount: payment.landlord_amount,
        status: PAYMENT_STATUS.SETTLED
      };
    } catch (err) {
      console.error(`[SETTLEMENT] Route transfer failed for payment ${payment.id}:`, err.message);
      return {
        settled: false,
        error: err.message
      };
    }
  }
}

export const defaultSettlementService = new SettlementService();
export default defaultSettlementService;
