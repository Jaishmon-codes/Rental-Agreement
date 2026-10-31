import test from "node:test";
import assert from "node:assert/strict";
import { ethers, Interface } from "ethers";
import app, { db, web3Validator } from "../server.js";

const RENTAL_PAYMENT_ABI = [
  "function joinAsTenant() payable",
  "function payNextRent() payable"
];
const iface = new Interface(RENTAL_PAYMENT_ABI);

test("Web3 Authoritative Payment Validation Suite (Blocker 2)", async (t) => {
  let server;
  let baseUrl;
  let tenantToken;
  let tenantWallet = "0x8888888888888888888888888888888888888888";
  let contractAddress = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
  let agreementId = `agree_web3_${Date.now()}`;
  let originalProvider = web3Validator.provider;

  // Setup server and test agreement
  t.before(async () => {
    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Login as tenant
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "tenant@gmail.com", password: "Password@123" })
    });
    const loginData = await loginRes.json();
    tenantToken = loginData.token;

    // Link tenant wallet
    db.prepare(`
      INSERT OR REPLACE INTO wallets (id, user_id, wallet_address, wallet_type, network, status)
      VALUES (?, ?, ?, 'EVM', 'Sepolia', 'VERIFIED')
    `).run(`wlt_test_${Date.now()}`, loginData.user.id, tenantWallet);

    // Create test agreement
    db.prepare(`
      INSERT INTO agreements (
        id, company_id, contract_address, landlord_address, tenant_address,
        rent_inr, security_deposit_inr, duration_days, property_details,
        current_document_hash, status, payment_rail
      ) VALUES (?, 'Company_A', ?, 'landlord@gmail.com', 'tenant@gmail.com', 20000, 40000, 30, 'Web3 Test Loft', 'hash_w3', 'Active', 'WEB3')
    `).run(agreementId, contractAddress);
  });

  t.after(() => {
    web3Validator.provider = originalProvider;
    server.close();
    db.prepare("DELETE FROM wallets WHERE wallet_address = ?").run(tenantWallet);
    db.prepare("DELETE FROM payments WHERE agreement_id = ?").run(agreementId);
    db.prepare("DELETE FROM agreements WHERE id = ?").run(agreementId);
  });

  // 1. test_web3_payment_requires_mined_transaction
  await t.test("test_web3_payment_requires_mined_transaction", async () => {
    const pendingTxHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    web3Validator.provider = {
      async getTransaction(hash) {
        return {
          hash,
          to: contractAddress,
          from: tenantWallet,
          value: ethers.parseEther("0.1"),
          data: iface.encodeFunctionData("payNextRent")
        };
      },
      async getTransactionReceipt() {
        return null; // Pending / unmined
      },
      async getBlockNumber() {
        return 100;
      }
    };

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agreementId,
        amountINR: 20000,
        transactionId: pendingTxHash,
        paymentRail: "WEB3"
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Transaction is pending and has not been mined yet/);
  });

  // 2. test_web3_payment_rejects_reverted_transaction
  await t.test("test_web3_payment_rejects_reverted_transaction", async () => {
    const revertedTxHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
    web3Validator.provider = {
      async getTransaction(hash) {
        return {
          hash,
          to: contractAddress,
          from: tenantWallet,
          value: ethers.parseEther("0.1"),
          data: iface.encodeFunctionData("payNextRent")
        };
      },
      async getTransactionReceipt() {
        return {
          blockNumber: 95,
          status: 0 // Reverted
        };
      },
      async getBlockNumber() {
        return 100;
      }
    };

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agreementId,
        amountINR: 20000,
        transactionId: revertedTxHash,
        paymentRail: "WEB3"
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Transaction execution reverted on-chain/);
  });

  // 3. test_web3_payment_rejects_wrong_contract
  await t.test("test_web3_payment_rejects_wrong_contract", async () => {
    const wrongContractHash = "0x3333333333333333333333333333333333333333333333333333333333333333";
    web3Validator.provider = {
      async getTransaction(hash) {
        return {
          hash,
          to: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", // Wrong contract address
          from: tenantWallet,
          value: ethers.parseEther("0.1"),
          data: iface.encodeFunctionData("payNextRent")
        };
      },
      async getTransactionReceipt() {
        return { blockNumber: 95, status: 1 };
      },
      async getBlockNumber() {
        return 100;
      }
    };

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agreementId,
        amountINR: 20000,
        transactionId: wrongContractHash,
        paymentRail: "WEB3"
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /does not match agreement contract address/);
  });

  // 4. test_web3_payment_rejects_wrong_sender
  await t.test("test_web3_payment_rejects_wrong_sender", async () => {
    const wrongSenderHash = "0x4444444444444444444444444444444444444444444444444444444444444444";
    web3Validator.provider = {
      async getTransaction(hash) {
        return {
          hash,
          to: contractAddress,
          from: "0x9999999999999999999999999999999999999999", // Attacker's unlinked wallet
          value: ethers.parseEther("0.1"),
          data: iface.encodeFunctionData("payNextRent")
        };
      },
      async getTransactionReceipt() {
        return { blockNumber: 95, status: 1 };
      },
      async getBlockNumber() {
        return 100;
      }
    };

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agreementId,
        amountINR: 20000,
        transactionId: wrongSenderHash,
        paymentRail: "WEB3"
      })
    });

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /not an authorized wallet for tenant/);
  });

  // 5. test_web3_payment_rejects_wrong_value
  await t.test("test_web3_payment_rejects_wrong_value", async () => {
    const zeroValueHash = "0x5555555555555555555555555555555555555555555555555555555555555555";
    web3Validator.provider = {
      async getTransaction(hash) {
        return {
          hash,
          to: contractAddress,
          from: tenantWallet,
          value: 0n, // Zero value transfer
          data: iface.encodeFunctionData("payNextRent")
        };
      },
      async getTransactionReceipt() {
        return { blockNumber: 95, status: 1 };
      },
      async getBlockNumber() {
        return 100;
      }
    };

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agreementId,
        amountINR: 20000,
        transactionId: zeroValueHash,
        paymentRail: "WEB3"
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Transaction value must be greater than zero/);
  });

  // 6. test_web3_payment_rejects_wrong_calldata
  await t.test("test_web3_payment_rejects_wrong_calldata", async () => {
    const wrongCalldataHash = "0x6666666666666666666666666666666666666666666666666666666666666666";
    web3Validator.provider = {
      async getTransaction(hash) {
        return {
          hash,
          to: contractAddress,
          from: tenantWallet,
          value: ethers.parseEther("0.1"),
          data: "0xdeadbeef" // Arbitrary non-contract call
        };
      },
      async getTransactionReceipt() {
        return { blockNumber: 95, status: 1 };
      },
      async getBlockNumber() {
        return 100;
      }
    };

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agreementId,
        amountINR: 20000,
        transactionId: wrongCalldataHash,
        paymentRail: "WEB3"
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Transaction calldata does not match an authorized rental payment function/);
  });

  // 7. test_web3_payment_accepts_valid_transaction
  const validHash = "0x7777777777777777777777777777777777777777777777777777777777777777";
  await t.test("test_web3_payment_accepts_valid_transaction", async () => {
    web3Validator.provider = {
      async getTransaction(hash) {
        return {
          hash,
          to: contractAddress,
          from: tenantWallet,
          value: ethers.parseEther("0.1"),
          data: iface.encodeFunctionData("payNextRent")
        };
      },
      async getTransactionReceipt() {
        return { blockNumber: 95, status: 1 };
      },
      async getBlockNumber() {
        return 100; // 6 confirmations
      }
    };

    const res = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agreementId,
        amountINR: 20000,
        transactionId: validHash,
        paymentRail: "WEB3"
      })
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.status, "Success");
    assert.strictEqual(data.payment_rail, "WEB3");
    assert.strictEqual(data.blockchain_tx_hash, validHash);
  });

  // 8. test_web3_payment_rejects_duplicate_transaction
  await t.test("test_web3_payment_rejects_duplicate_transaction", async () => {
    // Attempt to record the exact same validHash again
    const res = await fetch(`${baseUrl}/api/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tenantToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agreementId,
        amountINR: 20000,
        transactionId: validHash,
        paymentRail: "WEB3"
      })
    });

    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.match(data.error, /already been recorded/);
  });
});
