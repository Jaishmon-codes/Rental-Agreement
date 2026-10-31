// RentSphere Financial Reconciliation Engine
import db from "../../db.js";
import { PAYMENT_STATUS, paiseToRupees } from "./config.js";

export const RECON_STATUS = {
  MATCHED: "MATCHED",
  MISMATCH: "MISMATCH",
  MISSING: "MISSING",
  PENDING: "PENDING",
  MANUAL_REVIEW: "MANUAL_REVIEW"
};

export class ReconciliationService {
  constructor({ database = db } = {}) {
    this.db = database;
  }

  // Audit a single payment record for internal mathematical & ledger consistency
  reconcilePayment(payment) {
    const issues = [];

    // 1. Check Gross = Platform Fee + Landlord Allocation
    const sumSplit = (payment.platform_fee_amount || 0) + (payment.landlord_amount || 0);
    if (payment.gross_amount && sumSplit !== payment.gross_amount) {
      issues.push(
        `Amount split mismatch: gross (${payment.gross_amount} paise) != fee (${payment.platform_fee_amount}) + landlord (${payment.landlord_amount})`
      );
    }

    // 2. Check Platform Fee Percentage calculation
    if (payment.gross_amount && payment.platform_fee_percentage) {
      const expectedFee = Math.round(payment.gross_amount * payment.platform_fee_percentage);
      if (Math.abs(expectedFee - payment.platform_fee_amount) > 1) { // 1 paisa rounding tolerance
        issues.push(
          `Platform fee calculation discrepancy: recorded ${payment.platform_fee_amount} paise vs expected ${expectedFee} paise`
        );
      }
    }

    // 3. Status vs Reference Consistency
    if (payment.status === PAYMENT_STATUS.CAPTURED && !payment.razorpay_payment_id) {
      issues.push("Payment marked CAPTURED without gateway payment reference");
    }

    if (payment.status === PAYMENT_STATUS.SETTLED && !payment.razorpay_transfer_id) {
      issues.push("Payment marked SETTLED without gateway transfer reference");
    }

    // 4. Refund Ledger Consistency
    const refundRows = this.db.prepare("SELECT * FROM refunds WHERE payment_id = ?").all(payment.id);
    const totalRefunded = refundRows.reduce((sum, r) => sum + (r.amount || 0), 0);

    if (totalRefunded > payment.gross_amount) {
      issues.push(
        `Critical: Total refunded amount (${totalRefunded} paise) exceeds original gross payment (${payment.gross_amount} paise)`
      );
    }

    if (payment.status === PAYMENT_STATUS.REFUNDED && totalRefunded < payment.gross_amount) {
      issues.push(
        `Payment marked fully REFUNDED but recorded refund total (${totalRefunded}) is less than gross (${payment.gross_amount})`
      );
    }

    // Determine status
    let status = RECON_STATUS.MATCHED;
    if (issues.length > 0) {
      status = issues.some((i) => i.startsWith("Critical"))
        ? RECON_STATUS.MANUAL_REVIEW
        : RECON_STATUS.MISMATCH;
    } else if (payment.status === PAYMENT_STATUS.PENDING) {
      status = RECON_STATUS.PENDING;
    }

    return {
      paymentId: payment.id,
      status,
      issues,
      checkedAt: new Date().toISOString()
    };
  }

  // Run full ledger reconciliation audit across all recorded payments
  runReconciliationAudit() {
    const payments = this.db.prepare("SELECT * FROM payments ORDER BY created_at DESC").all();
    const results = [];
    let matchedCount = 0;
    let mismatchCount = 0;
    let pendingCount = 0;
    let manualReviewCount = 0;

    for (const payment of payments) {
      const recon = this.reconcilePayment(payment);
      results.push(recon);

      if (recon.status === RECON_STATUS.MATCHED) matchedCount++;
      else if (recon.status === RECON_STATUS.MISMATCH) mismatchCount++;
      else if (recon.status === RECON_STATUS.PENDING) pendingCount++;
      else if (recon.status === RECON_STATUS.MANUAL_REVIEW) manualReviewCount++;

      // Upsert into reconciliation_records
      const recId = `rec_${payment.id}`;
      this.db.prepare(`
        INSERT INTO reconciliation_records (id, payment_id, status, details, checked_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          details = excluded.details,
          checked_at = excluded.checked_at
      `).run(
        recId,
        payment.id,
        recon.status,
        JSON.stringify(recon.issues),
        recon.checkedAt
      );
    }

    return {
      auditedAt: new Date().toISOString(),
      totalPaymentsAudited: payments.length,
      summary: {
        matched: matchedCount,
        mismatch: mismatchCount,
        pending: pendingCount,
        manualReview: manualReviewCount
      },
      discrepancies: results.filter((r) => r.status !== RECON_STATUS.MATCHED)
    };
  }

  // Aggregate Financial Statistics for Admin Dashboard
  getFinancialDashboardStats() {
    const payments = this.db.prepare("SELECT * FROM payments").all();
    const refunds = this.db.prepare("SELECT * FROM refunds WHERE status = 'PROCESSED'").all();

    let totalGrossPaise = 0;
    let totalPlatformFeePaise = 0;
    let totalLandlordPayoutsPaise = 0;
    let pendingSettlementPaise = 0;
    let failedCount = 0;

    for (const p of payments) {
      if ([PAYMENT_STATUS.CAPTURED, PAYMENT_STATUS.ALLOCATED, PAYMENT_STATUS.SETTLED].includes(p.status)) {
        totalGrossPaise += (p.gross_amount || 0);
        totalPlatformFeePaise += (p.platform_fee_amount || 0);

        if (p.status === PAYMENT_STATUS.SETTLED) {
          totalLandlordPayoutsPaise += (p.landlord_amount || 0);
        } else {
          pendingSettlementPaise += (p.landlord_amount || 0);
        }
      } else if (p.status === PAYMENT_STATUS.FAILED) {
        failedCount++;
      }
    }

    const totalRefundedPaise = refunds.reduce((sum, r) => sum + (r.amount || 0), 0);
    const recon = this.runReconciliationAudit();

    return {
      totalTransactionVolumeRupees: paiseToRupees(totalGrossPaise),
      platformGrossRevenueRupees: paiseToRupees(totalPlatformFeePaise),
      landlordPayoutsRupees: paiseToRupees(totalLandlordPayoutsPaise),
      pendingSettlementRupees: paiseToRupees(pendingSettlementPaise),
      totalRefundedRupees: paiseToRupees(totalRefundedPaise),
      failedPaymentsCount: failedCount,
      reconciliationIssuesCount: recon.summary.mismatch + recon.summary.manualReview,
      reconciliationSummary: recon.summary
    };
  }
}

export const defaultReconciliationService = new ReconciliationService();
export default defaultReconciliationService;
