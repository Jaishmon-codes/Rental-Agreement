import test from "node:test";
import assert from "node:assert/strict";
import { app, db } from "../server.js";

let server;
let port;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(() => {
  server.close();
  try {
    db.close();
  } catch (e) {}
});

const makeRequest = async (path, options = {}) => {
  const { headers = {}, ...rest } = options;
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    ...rest
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};

test("Backend API Test Suite", async (t) => {
  let adminToken = "";
  let tenantToken = "";

  await t.test("GET /api/health returns healthy status", async () => {
    const res = await makeRequest("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "healthy");
  });

  await t.test("POST /api/auth/login rejects incorrect password", async () => {
    const res = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@rentsphere.com", password: "wrong_password" })
    });
    assert.equal(res.status, 401);
    assert.equal(res.data.error, "Invalid credentials");
  });

  await t.test("POST /api/auth/login succeeds with correct password", async () => {
    const res = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@rentsphere.com", password: "Password@123" })
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.token);
    assert.equal(res.data.user.role, "Super Admin");
    adminToken = res.data.token;
  });

  await t.test("POST /api/auth/login as tenant succeeds", async () => {
    const res = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "tenant@gmail.com", password: "Password@123" })
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.token);
    assert.equal(res.data.user.role, "Tenant");
    tenantToken = res.data.token;
  });

  await t.test("GET /api/auth/me returns authenticated profile", async () => {
    const res = await makeRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.email, "admin@rentsphere.com");
  });

  await t.test("GET /api/agreements lists agreements", async () => {
    const res = await makeRequest("/api/agreements", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data));
    assert.ok(res.data.length >= 1);
  });

  await t.test("POST /api/agreements creates new agreement with validation", async () => {
    const res = await makeRequest("/api/agreements", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        companyId: "DLF_Limited",
        landlordAddress: "0x1111111111111111111111111111111111111111",
        tenantAddress: "0x2222222222222222222222222222222222222222",
        rentInINR: 25000,
        securityDepositInINR: 50000,
        durationDays: 60,
        propertyDetails: "100 Cyber City, Tower B, Gurugram",
        pdfHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      })
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.rent_inr, 25000);
    assert.equal(res.data.company_id, "DLF_Limited");
  });

  await t.test("POST /api/verifyAgreement verifies SHA-256 match", async () => {
    const res = await makeRequest("/api/verifyAgreement", {
      method: "POST",
      body: JSON.stringify({
        agreementId: "agreement_001",
        providedPdfHash: "a2b585dd299e03d12FA4293BC5de4111afa1a4b94908f83103eb1f1706367c2e6"
      })
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.isValid, true);
  });

  await t.test("POST /api/verifyAgreement detects invalid SHA-256 mismatch", async () => {
    const res = await makeRequest("/api/verifyAgreement", {
      method: "POST",
      body: JSON.stringify({
        agreementId: "agreement_001",
        providedPdfHash: "tampered_hash_1234567890abcdef"
      })
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.isValid, false);
  });

  await t.test("GET /api/audit-trail enforces RBAC (Super Admin/Auditor only)", async () => {
    // Tenant should be blocked (403)
    const blockedRes = await makeRequest("/api/audit-trail", {
      headers: { Authorization: `Bearer ${tenantToken}` }
    });
    assert.equal(blockedRes.status, 403);

    // Admin should succeed (200)
    const allowedRes = await makeRequest("/api/audit-trail", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(allowedRes.status, 200);
    assert.ok(Array.isArray(allowedRes.data));
    assert.ok(allowedRes.data.length > 0);
  });

  await t.test("GET /api/stats returns analytics", async () => {
    const res = await makeRequest("/api/stats", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(res.status, 200);
    assert.ok(res.data.totalAgreements >= 1);
    assert.ok(res.data.totalLogs >= 1);
  });
});
