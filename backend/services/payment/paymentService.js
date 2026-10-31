// RentSphere Authoritative Payment Service
import db from "../../db.js";
import defaultRazorpay from "./razorpay.js";
import {
  PAYMENT_STATUS,
  calculatePaymentSplit,
  isValidTransition,
  paiseToRupees
} from "./config.js";

export class PaymentService {
  constructor({ razorpay = defaultRazorpay, database = db } = {}) {
    this.razorpay = razorpay;
    this.db = database;
  }

  // 1. Create Server-Authoritative Payment Order
  async createPaymentOrder({ tenantEmail, agreementId }) {
    if (!tenantEmail || !agreementId) {
      throw new Error("Tenant identification and Agreement ID are required");
    }

    // Retrieve agreement
    const agreement = this.db
      .prepare("SELECT * FROM agreements WHERE id = ? OR contract_address = ?")
      .get(agreementId, agreementId);

    if (!agreement) {
      const err = new Error("Agreement not found");
      err.status = 404;
      throw err;
    }

    // Tenant Authorization Check (BOLA Defense)
    const isTenant =
      agreement.tenant_address?.toLowerCase() === tenantEmail.toLowerCase();
    if (!isTenant) {
      const err = new Error("Access denied: You are not the registered tenant for this agreement");
      err.status = 403;
      throw err;
    }

    // Agreement Status Check
    if (agreement.status !== "Active") {
      const err = new Error(`Cannot initiate payment: Agreement is currently ${agreement.status}`);
      err.status = 400;
      throw err;
    }

    // HIGH-02: Separation of Pure Web3 vs Fiat Payment Rails
    if (agreement.payment_rail === "WEB3") {
      const err = new Error("This agreement is configured for pure Web3 on-chain payments. Fiat payment rail is disabled.");
      err.status = 400;
      throw err;
    }

    // Derive amount strictly server-side from database (Zero-trust client)
    const rentINR = agreement.rent_inr;
    if (!rentINR || rentINR <= 0) {
      const err = new Error("Agreement does not have a valid rent amount configured");
      err.status = 400;
      throw err;
    }

    // Compute fee snapshot
    const split = calculatePaymentSplit(rentINR);

    // Create Razorpay Order
    const paymentId = `pay_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const razorpayOrder = await this.razorpay.createOrder({
      amount: split.grossPaise,
      currency: split.currency,
      receipt: paymentId,
      notes: {
        agreementId: agreement.id,
        tenant: tenantEmail,
        landlord: agreement.landlord_address
      }
    });

    // Persist Payment in Database as PENDING
    const stmt = this.db.prepare(`
      INSERT INTO payments (
        id, agreement_id, tenant_id, landlord_id, payer_address, currency,
        gross_amount, amount_inr, platform_fee_percentage, platform_fee_amount,
        gateway_fee_amount, landlord_amount, razorpay_order_id, payment_gateway,
        transaction_id, status, payment_rail, on_chain_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      paymentId,
      agreement.id,
      tenantEmail,
      agreement.landlord_address,
      tenantEmail,
      split.currency,
      split.grossPaise,
      split.grossRupees,
      split.feePercentage,
      split.platformFeePaise,
      0, // Gateway fee calculated post-capture
      split.landlordPaise,
      razorpayOrder.id,
      "Razorpay",
      razorpayOrder.id,
      PAYMENT_STATUS.PENDING,
      "FIAT",
      0
    );

    return {
      paymentId,
      orderId: razorpayOrder.id,
      keyId: this.razorpay.keyId,
      amount: split.grossPaise,
      amountRupees: split.grossRupees,
      currency: split.currency,
      agreementId: agreement.id,
      propertyDetails: agreement.property_details,
      feeDetails: {
        grossRupees: split.grossRupees,
        platformFeePercentage: split.feePercentage,
        platformFeeRupees: split.platformFeeRupees,
        landlordRupees: split.landlordRupees,
        feeModel: split.feeModel
      }
    };
  }

  // 2. Verify and Capture Payment (Server-Authoritative)
  async verifyAndCapturePayment({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    userEmail
  }) {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      const err = new Error("Missing payment verification parameters");
      err.status = 400;
      throw err;
    }

    // Locate internal payment record
    const payment = this.db
      .prepare("SELECT * FROM payments WHERE razorpay_order_id = ?")
      .get(razorpayOrderId);

    if (!payment) {
      const err = new Error("Payment order reference not found");
      err.status = 404;
      throw err;
    }

    // Ownership check (BOLA / IDOR)
    if (userEmail && payment.tenant_id.toLowerCase() !== userEmail.toLowerCase()) {
      const err = new Error("Access denied: You are not authorized for this payment");
      err.status = 403;
      throw err;
    }

    // Enforce State Machine: If already captured or settled, return current record idempotently
    if (
      payment.status === PAYMENT_STATUS.CAPTURED ||
      payment.status === PAYMENT_STATUS.ALLOCATED ||
      payment.status === PAYMENT_STATUS.SETTLED
    ) {
      return this.getPaymentReceipt(payment.id);
    }

    if (!isValidTransition(payment.status, PAYMENT_STATUS.CAPTURED)) {
      const err = new Error(
        `Invalid state transition: Cannot capture payment in status ${payment.status}`
      );
      err.status = 400;
      throw err;
    }

    // Cryptographic Signature Verification
    const isValid = this.razorpay.verifyPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature
    });

    if (!isValid) {
      // Mark as FAILED if signature is invalid
      this.db
        .prepare("UPDATE payments SET status = ?, failure_reason = ? WHERE id = ?")
        .run(PAYMENT_STATUS.FAILED, "Cryptographic signature mismatch", payment.id);

      const err = new Error("Payment signature verification failed: Potential tampering detected");
      err.status = 400;
      throw err;
    }

    // Transition to CAPTURED
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE payments SET
          status = ?,
          razorpay_payment_id = ?,
          transaction_id = ?,
          captured_at = ?
         WHERE id = ?`
      )
      .run(
        PAYMENT_STATUS.CAPTURED,
        razorpayPaymentId,
        razorpayPaymentId,
        now,
        payment.id
      );

    return this.getPaymentReceipt(payment.id);
  }

  // 3. Process Refund
  async initiateRefund({ paymentId, amountPaise, reason, initiatedBy }) {
    if (!paymentId) {
      const err = new Error("Payment ID is required");
      err.status = 400;
      throw err;
    }

    const payment = this.db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
    if (!payment) {
      const err = new Error("Payment not found");
      err.status = 404;
      throw err;
    }

    const refundableStatuses = [
      PAYMENT_STATUS.CAPTURED,
      PAYMENT_STATUS.ALLOCATED,
      PAYMENT_STATUS.SETTLED,
      PAYMENT_STATUS.PARTIALLY_REFUNDED
    ];

    if (!refundableStatuses.includes(payment.status)) {
      const err = new Error(`Payment with status ${payment.status} cannot be refunded`);
      err.status = 400;
      throw err;
    }

    // Check existing refunds (both PROCESSED and in-flight PENDING) to prevent double-refund TOCTOU races
    const refundSumRow = this.db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total_reserved FROM refunds WHERE payment_id = ? AND status IN ('PROCESSED', 'PENDING')")
      .get(payment.id);

    const alreadyReserved = refundSumRow?.total_reserved || 0;
    const remainingRefundable = payment.gross_amount - alreadyReserved;

    const refundAmount = amountPaise !== undefined ? parseInt(amountPaise, 10) : remainingRefundable;

    if (isNaN(refundAmount) || refundAmount <= 0) {
      const err = new Error("Invalid refund amount");
      err.status = 400;
      throw err;
    }

    if (refundAmount > remainingRefundable) {
      const err = new Error(
        `Refund amount (₹${paiseToRupees(refundAmount)}) exceeds remaining refundable balance (₹${paiseToRupees(remainingRefundable)})`
      );
      err.status = 400;
      throw err;
    }

    // Atomically reserve the refund amount in database BEFORE calling external gateway (CRIT-04 fix)
    const refundId = `rfnd_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.db.prepare(`
      INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, reason, status, initiated_by)
      VALUES (?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(
      refundId,
      payment.id,
      "pending_gateway",
      refundAmount,
      reason || "Standard refund",
      initiatedBy || "admin"
    );

    let rzpRefund;
    try {
      // Call Razorpay Refund API
      rzpRefund = await this.razorpay.createRefund(payment.razorpay_payment_id || payment.id, {
        amount: refundAmount,
        notes: { reason: reason || "Customer requested refund", initiatedBy }
      });
    } catch (gatewayErr) {
      // Release reservation on failure
      this.db.prepare("UPDATE refunds SET status = 'FAILED' WHERE id = ?").run(refundId);
      throw gatewayErr;
    }

    // Update reservation to PROCESSED
    this.db.prepare(`
      UPDATE refunds SET
        status = 'PROCESSED',
        razorpay_refund_id = ?
      WHERE id = ?
    `).run(rzpRefund.id, refundId);

    const processedSumRow = this.db
      .prepare("SELECT COALESCE(SUM(amount), 0) as total_refunded FROM refunds WHERE payment_id = ? AND status = 'PROCESSED'")
      .get(payment.id);
    const totalProcessed = processedSumRow?.total_refunded || 0;

    const isFullRefund = totalProcessed >= payment.gross_amount;
    const nextStatus = isFullRefund ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE payments SET
        status = ?,
        refunded_at = ?
      WHERE id = ?
    `).run(nextStatus, now, payment.id);

    return {
      refundId,
      paymentId: payment.id,
      razorpayRefundId: rzpRefund.id,
      amountPaise: refundAmount,
      amountRupees: paiseToRupees(refundAmount),
      isFullRefund,
      status: "PROCESSED",
      paymentStatus: nextStatus
    };
  }

  // 4. Generate Formal Receipt
  getPaymentReceipt(paymentId) {
    const payment = this.db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
    if (!payment) {
      return null;
    }

    const agreement = this.db.prepare("SELECT * FROM agreements WHERE id = ?").get(payment.agreement_id);
    const refunds = this.db.prepare("SELECT * FROM refunds WHERE payment_id = ?").all(paymentId);

    return {
      receiptNumber: `RCPT-${payment.id.toUpperCase()}`,
      paymentId: payment.id,
      agreementId: payment.agreement_id,
      propertyDetails: agreement?.property_details || "N/A",
      tenantId: payment.tenant_id,
      landlordId: payment.landlord_id,
      currency: payment.currency,
      grossAmountRupees: paiseToRupees(payment.gross_amount || 0),
      grossAmountPaise: payment.gross_amount,
      platformFeePercentage: payment.platform_fee_percentage,
      platformFeeRupees: paiseToRupees(payment.platform_fee_amount || 0),
      landlordAllocationRupees: paiseToRupees(payment.landlord_amount || 0),
      status: payment.status,
      razorpayOrderId: payment.razorpay_order_id,
      razorpayPaymentId: payment.razorpay_payment_id,
      razorpayTransferId: payment.razorpay_transfer_id,
      createdAt: payment.created_at,
      capturedAt: payment.captured_at,
      settledAt: payment.settled_at,
      refundedAt: payment.refunded_at,
      paymentRail: payment.payment_rail || "FIAT",
      onChainSynced: Boolean(payment.on_chain_synced || payment.blockchain_tx_hash),
      blockchainTxHash: payment.blockchain_tx_hash || null,
      refunds: refunds.map((r) => ({
        id: r.id,
        amountRupees: paiseToRupees(r.amount),
        status: r.status,
        reason: r.reason,
        createdAt: r.created_at
      }))
    };
  }

  // 5. Query Payments with Strict Role-Based Access Control
  listPayments({ userRole, userEmail, limit = 50, offset = 0 }) {
    const isPrivileged = [
      "Super Admin",
      "Finance Admin",
      "Auditor",
      "Legal Officer",
      "Security Admin",
      "Support Admin"
    ].includes(userRole);

    let rows;
    if (isPrivileged) {
      rows = this.db
        .prepare("SELECT * FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(limit, offset);
    } else if (userRole === "Property Owner") {
      rows = this.db
        .prepare("SELECT * FROM payments WHERE landlord_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(userEmail, limit, offset);
    } else {
      rows = this.db
        .prepare("SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .all(userEmail, limit, offset);
    }

    return rows.map((p) => ({
      ...p,
      grossRupees: paiseToRupees(p.gross_amount || 0),
      platformFeeRupees: paiseToRupees(p.platform_fee_amount || 0),
      landlordRupees: paiseToRupees(p.landlord_amount || 0)
    }));
  }
}

export const defaultPaymentService = new PaymentService();
export default defaultPaymentService;
