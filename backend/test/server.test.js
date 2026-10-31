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
  const { headers = {}, body, ...rest } = options;
  const url = `${baseUrl}${path}`;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const requestHeaders = isFormData
    ? { ...headers }
    : { "Content-Type": "application/json", ...headers };
  const response = await fetch(url, {
    headers: requestHeaders,
    body,
    ...rest
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};

test("Backend API Test Suite", async (t) => {
  let adminToken = "";
  let tenantToken = "";

  await t.test("GET /api/health returns healthy status and deep observability checks", async () => {
    const res = await makeRequest("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "healthy");
    assert.equal(res.data.checks.database, "connected");
    assert.ok(typeof res.data.checks.queue.pending === "number");
    assert.ok(res.data.uptimeSeconds >= 0);
  });

  await t.test("GET /api/health/live and /api/health/ready respond successfully", async () => {
    const live = await makeRequest("/api/health/live");
    assert.equal(live.status, 200);
    assert.equal(live.data.status, "alive");

    const ready = await makeRequest("/api/health/ready");
    assert.equal(ready.status, 200);
    assert.equal(ready.data.status, "ready");
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

  await t.test("HIGH-01 Defense: Tenant agreement query isolates active leases and blocks companyId bypass", async () => {
    // Tenant lists agreements
    const listRes = await makeRequest("/api/agreements", {
      headers: { Authorization: `Bearer ${tenantToken}` }
    });
    assert.equal(listRes.status, 200);
    // Tenant does not own agreement_001
    const hasAgreement001 = listRes.data.some((a) => a.id === "agreement_001");
    assert.strictEqual(hasAgreement001, false, "Tenant must not see unowned agreements even if active");

    // Tenant attempts companyId query bypass
    const companyRes = await makeRequest("/api/agreements?companyId=Company_A", {
      headers: { Authorization: `Bearer ${tenantToken}` }
    });
    assert.equal(companyRes.status, 200);
    const hasCompanyA = companyRes.data.some((a) => a.id === "agreement_001");
    assert.strictEqual(hasCompanyA, false, "Company ID query param must not bypass tenant data isolation");
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
        providedPdfHash: "a2b585dd299e03d12fa4293bc5de4111afa1a4b94908f83103eb1f1706367c2e"
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

  await t.test("GET /api/agreements/:id prevents unauthorized IDOR/BOLA access", async () => {
    // Tenant attempts to read agreement_001 where tenant_address is 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (not tenant@gmail.com)
    const unauthorizedRes = await makeRequest("/api/agreements/agreement_001", {
      headers: { Authorization: `Bearer ${tenantToken}` }
    });
    assert.equal(unauthorizedRes.status, 403);
    assert.match(unauthorizedRes.data.error, /Access denied/);

    // Admin should have access
    const adminRes = await makeRequest("/api/agreements/agreement_001", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.data.id, "agreement_001");
  });

  await t.test("POST /api/verifyDocumentFile hashes file server-side without trusting client hash", async () => {
    const formData = new FormData();
    formData.append("agreementId", "agreement_001");
    const fileBlob = new Blob(["sample agreement contract text content"], { type: "text/plain" });
    formData.append("file", fileBlob, "sample_contract.txt");

    const res = await makeRequest("/api/verifyDocumentFile", {
      method: "POST",
      body: formData
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.agreementId, "agreement_001");
    assert.equal(res.data.fileName, "sample_contract.txt");
    assert.ok(typeof res.data.serverComputedHash === "string");
    assert.equal(res.data.isValid, false); // Mismatches seeded hash
  });

  await t.test("POST /api/verifyDocumentFile rejects forbidden MIME types", async () => {
    const formData = new FormData();
    formData.append("agreementId", "agreement_001");
    const maliciousBlob = new Blob(["#!/bin/bash\necho bad"], { type: "application/x-sh" });
    formData.append("file", maliciousBlob, "exploit.sh");

    const res = await makeRequest("/api/verifyDocumentFile", {
      method: "POST",
      body: formData
    });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /Invalid document format/);
  });

  await t.test("Payload size limit rejects payloads exceeding 50kb", async () => {
    const hugeData = "x".repeat(60 * 1024);
    const res = await makeRequest("/api/agreements", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ propertyDetails: hugeData })
    });
    assert.equal(res.status, 413); // Payload Too Large
  });
});

