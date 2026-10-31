import { ethers, Interface } from "ethers";
import db from "../../db.js";

// Standard RentalAgreement ABI fragments for payment validation
const RENTAL_PAYMENT_ABI = [
  "function joinAsTenant() payable",
  "function joinAsTenantFor(address _tenant) payable",
  "function payNextRent() payable",
  "function payNextRentFor(address _tenant) payable",
  "event RentPaid(address indexed tenant, uint amount, uint nextDue, uint timestamp)",
  "event TenantJoined(address indexed tenant, uint startTime, uint timestamp)"
];

const iface = new Interface(RENTAL_PAYMENT_ABI);

export class Web3PaymentValidator {
  constructor({ provider = null, database = db, minConfirmations = 1 } = {}) {
    this.provider = provider;
    this.db = database;
    this.minConfirmations = parseInt(process.env.MIN_WEB3_CONFIRMATIONS || String(minConfirmations), 10);
  }

  getProvider() {
    if (this.provider) return this.provider;
    const rpcUrl = process.env.WEB3_RPC_URL || "http://127.0.0.1:8545";
    return new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  }

  /**
   * Authoritatively verifies an on-chain Web3 rental payment transaction (Blocker 2)
   */
  async validateWeb3Payment({ agreementId, transactionHash, user }) {
    if (!transactionHash || typeof transactionHash !== "string" || !transactionHash.startsWith("0x") || transactionHash.length !== 66) {
      const err = new Error("Web3 payments require a valid 66-character hexadecimal transaction hash (0x...)");
      err.status = 400;
      throw err;
    }

    const normalizedTxHash = transactionHash.toLowerCase();

    // 10 & 11. Uniqueness check: Transaction hash cannot be reused
    const existing = this.db.prepare(
      "SELECT id FROM payments WHERE LOWER(blockchain_tx_hash) = ? OR LOWER(transaction_id) = ?"
    ).get(normalizedTxHash, normalizedTxHash);

    if (existing) {
      const err = new Error("This transaction hash has already been recorded for a payment.");
      err.status = 409;
      throw err;
    }

    // 9. Agreement check
    const agreement = this.db.prepare(
      "SELECT * FROM agreements WHERE id = ? OR contract_address = ?"
    ).get(agreementId, agreementId);

    if (!agreement) {
      const err = new Error("Agreement not found");
      err.status = 404;
      throw err;
    }

    if (agreement.status !== "Active" && agreement.status !== "Draft") {
      const err = new Error(`Cannot record payment: Agreement is ${agreement.status}`);
      err.status = 400;
      throw err;
    }

    if (!agreement.contract_address || !ethers.isAddress(agreement.contract_address)) {
      const err = new Error("Agreement does not have a valid on-chain contract address deployed");
      err.status = 400;
      throw err;
    }

    const provider = this.getProvider();

    // 1. Transaction exists
    let tx;
    try {
      tx = await provider.getTransaction(transactionHash);
    } catch (e) {
      const err = new Error(`Failed to query blockchain transaction: ${e.message}`);
      err.status = 400;
      throw err;
    }

    if (!tx) {
      const err = new Error("Transaction does not exist on blockchain");
      err.status = 400;
      throw err;
    }

    // 2 & 4. Transaction is mined & receipt exists
    let receipt;
    try {
      receipt = await provider.getTransactionReceipt(transactionHash);
    } catch (e) {
      const err = new Error(`Failed to query transaction receipt: ${e.message}`);
      err.status = 400;
      throw err;
    }

    if (!receipt || receipt.blockNumber === null || receipt.blockNumber === undefined) {
      const err = new Error("Transaction is pending and has not been mined yet");
      err.status = 400;
      throw err;
    }

    // 3. Receipt indicates SUCCESS (status === 1)
    if (receipt.status !== 1) {
      const err = new Error("Transaction execution reverted on-chain (status = 0)");
      err.status = 400;
      throw err;
    }

    // 12. Confirmation depth
    let currentBlock;
    try {
      currentBlock = await provider.getBlockNumber();
    } catch {
      currentBlock = receipt.blockNumber;
    }
    const confirmations = currentBlock - receipt.blockNumber + 1;
    if (confirmations < this.minConfirmations) {
      const err = new Error(`Insufficient confirmation depth: ${confirmations} confirmations, required: ${this.minConfirmations}`);
      err.status = 400;
      throw err;
    }

    // 5. Destination contract address
    if (!tx.to || tx.to.toLowerCase() !== agreement.contract_address.toLowerCase()) {
      const err = new Error(`Transaction destination (${tx.to}) does not match agreement contract address (${agreement.contract_address})`);
      err.status = 400;
      throw err;
    }

    // 6. Sender matches authorized tenant wallet
    const userWallets = this.db.prepare(
      "SELECT wallet_address FROM wallets WHERE user_id = ? AND status = 'VERIFIED'"
    ).all(user.id || 0).map((w) => w.wallet_address.toLowerCase());

    const isPrivileged = ["Super Admin", "Finance Admin"].includes(user.role);
    const txSender = tx.from ? tx.from.toLowerCase() : "";
    const isTenantAddress = agreement.tenant_address && agreement.tenant_address.toLowerCase() === txSender;
    const isUserWallet = userWallets.includes(txSender);

    if (!isPrivileged && !isTenantAddress && !isUserWallet) {
      const err = new Error(`Transaction sender (${tx.from}) is not an authorized wallet for tenant ${user.email}`);
      err.status = 403;
      throw err;
    }

    // 8. Calldata corresponds to expected payment method
    let parsed;
    try {
      parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
    } catch {
      parsed = null;
    }

    const validMethods = ["joinAsTenant", "joinAsTenantFor", "payNextRent", "payNextRentFor"];
    if (!parsed || !validMethods.includes(parsed.name)) {
      const err = new Error("Transaction calldata does not match an authorized rental payment function");
      err.status = 400;
      throw err;
    }

    // 7. Value is positive
    const weiValue = tx.value;
    if (weiValue <= 0n) {
      const err = new Error("Transaction value must be greater than zero");
      err.status = 400;
      throw err;
    }

    return {
      verified: true,
      transactionHash: normalizedTxHash,
      from: tx.from,
      to: tx.to,
      valueWei: weiValue.toString(),
      valueEth: ethers.formatEther(weiValue),
      functionName: parsed.name,
      blockNumber: receipt.blockNumber,
      confirmations,
      agreement
    };
  }
}

export const defaultWeb3Validator = new Web3PaymentValidator();
export default defaultWeb3Validator;
