import crypto from "node:crypto";
import { verifyMessage } from "ethers";
import db, { logAudit } from "../../db.js";

const ETH_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Builds the standard EIP-191 signing challenge message
 */
export function buildChallengeMessage(nonce) {
  return `Sign this one-time challenge to verify ownership of your wallet on RentSphere:\n\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
}

/**
 * Generates a one-time cryptographic challenge nonce for a wallet address
 */
export async function generateWalletNonce({ userId, walletAddress, req = null }) {
  if (!walletAddress || !ETH_ADDR_REGEX.test(walletAddress)) {
    const err = new Error("Invalid Ethereum wallet address format");
    err.status = 400;
    throw err;
  }

  const normalizedAddress = walletAddress.toLowerCase();

  // Check if wallet is already verified to a different user
  const existingOther = db.prepare(`
    SELECT * FROM wallets 
    WHERE LOWER(wallet_address) = ? AND user_id != ? AND status = 'VERIFIED'
  `).get(normalizedAddress, userId);

  if (existingOther) {
    const err = new Error("This wallet address is already verified and linked to another account");
    err.status = 409;
    throw err;
  }

  // Generate cryptographically secure nonce
  const nonce = crypto.randomBytes(32).toString("hex");
  const challengeMessage = `Sign this one-time challenge to verify ownership of your wallet on RentSphere:\n\nNonce: ${nonce}`;

  const existingWallet = db.prepare(`
    SELECT * FROM wallets WHERE LOWER(wallet_address) = ? AND user_id = ?
  `).get(normalizedAddress, userId);

  if (existingWallet) {
    db.prepare(`
      UPDATE wallets 
      SET nonce = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(nonce, existingWallet.id);
  } else {
    const walletId = `wlt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    db.prepare(`
      INSERT INTO wallets (id, user_id, wallet_address, wallet_type, network, status, nonce)
      VALUES (?, ?, ?, 'EVM', 'Sepolia', 'PENDING', ?)
    `).run(walletId, userId, walletAddress, nonce);
  }

  return {
    walletAddress,
    nonce,
    message: challengeMessage
  };
}

/**
 * Verifies EIP-191 personal signature and marks wallet as verified
 */
export async function verifyWalletSignature({ userId, userEmail, walletAddress, signature, req = null }) {
  if (!walletAddress || !ETH_ADDR_REGEX.test(walletAddress)) {
    const err = new Error("Invalid Ethereum wallet address format");
    err.status = 400;
    throw err;
  }

  if (!signature || typeof signature !== "string" || !signature.startsWith("0x")) {
    const err = new Error("Invalid cryptographic signature format");
    err.status = 400;
    throw err;
  }

  const normalizedAddress = walletAddress.toLowerCase();

  const walletRecord = db.prepare(`
    SELECT * FROM wallets 
    WHERE LOWER(wallet_address) = ? AND user_id = ?
  `).get(normalizedAddress, userId);

  if (!walletRecord || !walletRecord.nonce) {
    const err = new Error("No active challenge nonce found for this wallet. Request a new nonce first.");
    err.status = 400;
    throw err;
  }

  const challengeMessage = `Sign this one-time challenge to verify ownership of your wallet on RentSphere:\n\nNonce: ${walletRecord.nonce}`;

  let recoveredAddress;
  try {
    recoveredAddress = verifyMessage(challengeMessage, signature);
  } catch (err) {
    logAudit(
      "SECURITY_ALERT",
      `Malformed signature verification attempt for ${walletAddress} by ${userEmail}: ${err.message}`,
      userEmail,
      null,
      req
    );
    const verifyErr = new Error("Cryptographic signature verification failed");
    verifyErr.status = 400;
    throw verifyErr;
  }

  if (recoveredAddress.toLowerCase() !== normalizedAddress) {
    logAudit(
      "SECURITY_ALERT",
      `Wallet signature spoofing attempt detected. Claimed: ${walletAddress}, Recovered: ${recoveredAddress}`,
      userEmail,
      null,
      req
    );
    const mismatchErr = new Error("Signature does not match the claimed wallet address");
    mismatchErr.status = 400;
    throw mismatchErr;
  }

  // Atomically mark as VERIFIED and clear nonce to prevent replay attacks
  db.prepare(`
    UPDATE wallets 
    SET status = 'VERIFIED', nonce = NULL, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(walletRecord.id);

  logAudit(
    "WALLET_LINKED",
    `Wallet ${walletAddress} verified and linked to user ${userEmail}`,
    userEmail,
    null,
    req
  );

  return {
    verified: true,
    walletAddress,
    status: "VERIFIED",
    linkedAt: new Date().toISOString()
  };
}

/**
 * Lists all verified wallets for a user
 */
export function getUserWallets(userId) {
  return db.prepare(`
    SELECT id, wallet_address, wallet_type, network, status, created_at, updated_at 
    FROM wallets 
    WHERE user_id = ? AND status = 'VERIFIED'
    ORDER BY created_at DESC
  `).all(userId);
}

/**
 * Unlinks a wallet from user account
 */
export function unlinkWallet({ userId, userEmail, walletAddress, req = null }) {
  const normalized = (walletAddress || "").toLowerCase();
  const wallet = db.prepare(`
    SELECT * FROM wallets WHERE LOWER(wallet_address) = ? AND user_id = ?
  `).get(normalized, userId);

  if (!wallet) {
    const err = new Error("Wallet not found on your account");
    err.status = 404;
    throw err;
  }

  db.prepare("DELETE FROM wallets WHERE id = ?").run(wallet.id);

  logAudit(
    "WALLET_UNLINKED",
    `Wallet ${walletAddress} unlinked from user ${userEmail}`,
    userEmail,
    null,
    req
  );

  return { success: true, message: `Wallet ${walletAddress} successfully unlinked` };
}
