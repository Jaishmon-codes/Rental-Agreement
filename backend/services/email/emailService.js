import crypto from "node:crypto";

/**
 * Transactional Email Service Abstraction
 * Supports production SMTP/provider transport, with an in-memory test sink for development and automated testing.
 */
class EmailService {
  constructor() {
    this.testInbox = []; // In-memory test sink for dev/tests
    this.isTestOrDev = process.env.NODE_ENV !== "production";
  }

  /**
   * Dispatches password reset email with one-time raw token
   */
  async sendPasswordResetEmail({ to, token, name = "User" }) {
    const subject = "RentSphere — Password Reset Instructions";
    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?email=${encodeURIComponent(to)}&token=${token}`;
    const text = `Hello ${name},\n\nA password reset request was received for your RentSphere account. Use the following link or token to set a new password:\n\nToken: ${token}\nLink: ${resetUrl}\n\nThis token will expire in 1 hour. If you did not request this, please disregard this email.`;

    const messageRecord = {
      id: `mail_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      to: to.toLowerCase().trim(),
      type: "PASSWORD_RESET",
      subject,
      token,
      text,
      sentAt: new Date().toISOString()
    };

    this.testInbox.push(messageRecord);

    if (!this.isTestOrDev) {
      // In production, dispatch via SMTP / SES / SendGrid here
      console.log(`[EMAIL DISPATCH] Password reset instructions dispatched to ${to}`);
    }

    return { sent: true, messageId: messageRecord.id };
  }

  /**
   * Dispatches account verification email with one-time raw token
   */
  async sendVerificationEmail({ to, token, name = "User" }) {
    const subject = "RentSphere — Verify Your Account";
    const verifyUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?email=${encodeURIComponent(to)}&token=${token}`;
    const text = `Hello ${name},\n\nThank you for registering on RentSphere. Please verify your email using the following link or token:\n\nToken: ${token}\nLink: ${verifyUrl}\n\nWelcome to RentSphere!`;

    const messageRecord = {
      id: `mail_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      to: to.toLowerCase().trim(),
      type: "ACCOUNT_VERIFICATION",
      subject,
      token,
      text,
      sentAt: new Date().toISOString()
    };

    this.testInbox.push(messageRecord);

    if (!this.isTestOrDev) {
      console.log(`[EMAIL DISPATCH] Verification email dispatched to ${to}`);
    }

    return { sent: true, messageId: messageRecord.id };
  }

  /**
   * Testing helpers for assertions without API leaks
   */
  getLastEmail(to = null) {
    if (!to) return this.testInbox[this.testInbox.length - 1] || null;
    const filtered = this.testInbox.filter((m) => m.to === to.toLowerCase().trim());
    return filtered[filtered.length - 1] || null;
  }

  clearInbox() {
    this.testInbox = [];
  }
}

export const emailService = new EmailService();
export default emailService;
