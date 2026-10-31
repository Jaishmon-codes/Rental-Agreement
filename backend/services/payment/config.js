// RentSphere Payment Architecture Configuration & Helpers

export const DEFAULT_PLATFORM_FEE_PERCENTAGE = 0.03; // 3% initial platform fee
export const DEFAULT_CURRENCY = "INR";
export const FEE_MODEL = "LANDLORD_BEARING_PLATFORM_FEE";

export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  AUTHORIZED: "AUTHORIZED",
  CAPTURED: "CAPTURED",
  ALLOCATED: "ALLOCATED",
  SETTLED: "SETTLED",
  FAILED: "FAILED",
  REFUND_REQUESTED: "REFUND_REQUESTED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  CANCELLED: "CANCELLED"
};

// Strict state machine transitions
export const ALLOWED_TRANSITIONS = {
  [PAYMENT_STATUS.PENDING]: [
    PAYMENT_STATUS.AUTHORIZED,
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED
  ],
  [PAYMENT_STATUS.AUTHORIZED]: [
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.FAILED,
    PAYMENT_STATUS.CANCELLED
  ],
  [PAYMENT_STATUS.CAPTURED]: [
    PAYMENT_STATUS.ALLOCATED,
    PAYMENT_STATUS.REFUND_REQUESTED,
    PAYMENT_STATUS.REFUNDED,
    PAYMENT_STATUS.PARTIALLY_REFUNDED
  ],
  [PAYMENT_STATUS.ALLOCATED]: [
    PAYMENT_STATUS.SETTLED,
    PAYMENT_STATUS.REFUND_REQUESTED,
    PAYMENT_STATUS.REFUNDED,
    PAYMENT_STATUS.PARTIALLY_REFUNDED
  ],
  [PAYMENT_STATUS.SETTLED]: [
    PAYMENT_STATUS.REFUND_REQUESTED,
    PAYMENT_STATUS.REFUNDED,
    PAYMENT_STATUS.PARTIALLY_REFUNDED
  ],
  [PAYMENT_STATUS.REFUND_REQUESTED]: [
    PAYMENT_STATUS.REFUNDED,
    PAYMENT_STATUS.PARTIALLY_REFUNDED,
    PAYMENT_STATUS.CAPTURED,
    PAYMENT_STATUS.SETTLED
  ],
  [PAYMENT_STATUS.PARTIALLY_REFUNDED]: [
    PAYMENT_STATUS.REFUND_REQUESTED,
    PAYMENT_STATUS.REFUNDED
  ],
  [PAYMENT_STATUS.REFUNDED]: [],
  [PAYMENT_STATUS.FAILED]: [],
  [PAYMENT_STATUS.CANCELLED]: []
};

export function isValidTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;
  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  return allowed.includes(nextStatus);
}

export function rupeesToPaise(rupees) {
  const num = Number(rupees);
  if (isNaN(num) || num < 0) {
    throw new Error("Invalid rupee amount");
  }
  return Math.round(num * 100);
}

export function paiseToRupees(paise) {
  const num = Number(paise);
  if (isNaN(num) || num < 0) {
    throw new Error("Invalid paise amount");
  }
  return Number((num / 100).toFixed(2));
}

export function getActivePlatformFeePercentage() {
  const envFee = process.env.PLATFORM_FEE_PERCENTAGE;
  if (envFee !== undefined && envFee !== "") {
    const parsed = parseFloat(envFee);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return DEFAULT_PLATFORM_FEE_PERCENTAGE;
}

export function calculatePaymentSplit(grossRupees, feePercentage = getActivePlatformFeePercentage()) {
  const grossPaise = rupeesToPaise(grossRupees);
  const platformFeePaise = Math.round(grossPaise * feePercentage);
  const landlordPaise = grossPaise - platformFeePaise;

  return {
    currency: DEFAULT_CURRENCY,
    grossPaise,
    grossRupees: paiseToRupees(grossPaise),
    feePercentage,
    platformFeePaise,
    platformFeeRupees: paiseToRupees(platformFeePaise),
    landlordPaise,
    landlordRupees: paiseToRupees(landlordPaise),
    feeModel: FEE_MODEL
  };
}
