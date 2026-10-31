import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { app, db } from "../server.js";
import emailService from "../services/email/emailService.js";

let server;
let baseUrl;

let user1Token;
let user1Id;
let user2Token;
let user2Id;

const walletA = Wallet.createRandom();
const walletB = Wallet.createRandom();

test.before(async () => {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const loginUser = async (email, password = "Password@123") => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    return (await res.json()).token;
  };

  // Register User 1
  const email1 = `wallet_user1_${Date.now()}@test.com`;
  const reg1 = await (await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email1, password: "Password@123", name: "Wallet User One", role: "Tenant" })
  })).json();
  assert.strictEqual(reg1.verificationToken, undefined);
  const sentMail1 = emailService.getLastEmail(email1);
  assert.ok(sentMail1 && sentMail1.token);

  await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email1, token: sentMail1.token })
  });
  user1Token = await loginUser(email1);
  user1Id = reg1.user.id;

  // Register User 2
  const email2 = `wallet_user2_${Date.now()}@test.com`;
  const reg2 = await (await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email2, password: "Password@123", name: "Wallet User Two", role: "Tenant" })
  })).json();
  assert.strictEqual(reg2.verificationToken, undefined);
  const sentMail2 = emailService.getLastEmail(email2);
  assert.ok(sentMail2 && sentMail2.token);

  await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email2, token: sentMail2.token })
  });
  user2Token = await loginUser(email2);
  user2Id = reg2.user.id;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Phase 5: Decoupled Wallet Onboarding & Signature Verification Suite", async (t) => {
  let challengeNonce;
  let challengeMessage;

  await t.test("POST /api/wallet/nonce validates address format", async () => {
    const res = await fetch(`${baseUrl}/api/wallet/nonce`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`
      },
      body: JSON.stringify({ walletAddress: "invalid-eth-address" })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Invalid Ethereum wallet address format"));
  });

  await t.test("POST /api/wallet/nonce generates cryptographic nonce and challenge message", async () => {
    const res = await fetch(`${baseUrl}/api/wallet/nonce`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`
      },
      body: JSON.stringify({ walletAddress: walletA.address })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.nonce && data.nonce.length === 64, "Nonce should be 64-char hex string");
    assert.ok(data.message.includes(data.nonce));
    assert.strictEqual(data.walletAddress, walletA.address);

    challengeNonce = data.nonce;
    challengeMessage = data.message;
  });

  await t.test("POST /api/wallet/verify rejects spoofed signature (Wallet B signs for Wallet A)", async () => {
    // Wallet B signs the challenge intended for Wallet A
    const spoofedSignature = await walletB.signMessage(challengeMessage);

    const res = await fetch(`${baseUrl}/api/wallet/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        walletAddress: walletA.address,
        signature: spoofedSignature
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Signature does not match"));
  });

  await t.test("POST /api/wallet/verify successfully verifies authentic signature and links wallet", async () => {
    const genuineSignature = await walletA.signMessage(challengeMessage);

    const res = await fetch(`${baseUrl}/api/wallet/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        walletAddress: walletA.address,
        signature: genuineSignature
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.verified, true);
    assert.strictEqual(data.status, "VERIFIED");

    // Check DB state: status must be VERIFIED and nonce must be NULL
    const dbWallet = db.prepare("SELECT * FROM wallets WHERE LOWER(wallet_address) = ?").get(walletA.address.toLowerCase());
    assert.ok(dbWallet);
    assert.strictEqual(dbWallet.status, "VERIFIED");
    assert.strictEqual(dbWallet.nonce, null, "Nonce must be nullified to prevent replay");
    assert.strictEqual(dbWallet.user_id, user1Id);
  });

  await t.test("POST /api/wallet/verify prevents replay attacks", async () => {
    const genuineSignature = await walletA.signMessage(challengeMessage);

    // Replay the exact same verification
    const res = await fetch(`${baseUrl}/api/wallet/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        walletAddress: walletA.address,
        signature: genuineSignature
      })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("No active challenge nonce found"));
  });

  await t.test("POST /api/wallet/nonce prevents wallet takeover by another user (409 Conflict)", async () => {
    // User 2 attempts to claim walletA which is already VERIFIED to User 1
    const res = await fetch(`${baseUrl}/api/wallet/nonce`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user2Token}`
      },
      body: JSON.stringify({ walletAddress: walletA.address })
    });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.ok(data.error.includes("already verified and linked to another account"));
  });

  await t.test("GET /api/wallet/me returns verified wallets for user", async () => {
    const res = await fetch(`${baseUrl}/api/wallet/me`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    assert.strictEqual(res.status, 200);
    const wallets = await res.json();
    assert.ok(Array.isArray(wallets));
    assert.strictEqual(wallets.length, 1);
    assert.strictEqual(wallets[0].wallet_address, walletA.address);
    assert.strictEqual(wallets[0].status, "VERIFIED");
  });

  await t.test("DELETE /api/wallet/:address unlinks wallet from user account", async () => {
    // User 2 cannot unlink User 1's wallet
    const unauthDel = await fetch(`${baseUrl}/api/wallet/${walletA.address}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    assert.strictEqual(unauthDel.status, 404);

    // User 1 unlinks own wallet
    const delRes = await fetch(`${baseUrl}/api/wallet/${walletA.address}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    assert.strictEqual(delRes.status, 200);
    const data = await delRes.json();
    assert.strictEqual(data.success, true);

    // Verify removed from DB
    const dbWallet = db.prepare("SELECT * FROM wallets WHERE LOWER(wallet_address) = ?").get(walletA.address.toLowerCase());
    assert.strictEqual(dbWallet, undefined);
  });
});
