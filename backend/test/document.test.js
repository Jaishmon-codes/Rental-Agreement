import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { app, db } from "../server.js";
import { resolveSafePath, sanitizeFilename } from "../services/document/storage.js";
import emailService from "../services/email/emailService.js";

let server;
let baseUrl;

let landlordToken;
let landlord2Token;
let tenantToken;
let adminToken;
let uploadedDocId;
let loginUser;
const sampleContractContent = "STANDARD LEASE AGREEMENT: 742 Evergreen Terrace. Monthly rent: INR 15,000.";
const expectedSha256 = crypto.createHash("sha256").update(sampleContractContent).digest("hex");

test.before(async () => {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  loginUser = async (email, password = "Password@123") => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    return (await res.json()).token;
  };

  landlordToken = await loginUser("landlord@gmail.com");
  tenantToken = await loginUser("tenant@gmail.com");
  adminToken = await loginUser("admin@rentsphere.com");

  // Register second landlord for BOLA / IDOR isolation tests
  const email2 = `landlord2_doc_${Date.now()}@test.com`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email2,
      password: "Password@123",
      name: "Landlord Document Tester",
      role: "Property Owner"
    })
  });
  const regData = await regRes.json();
  assert.strictEqual(regData.verificationToken, undefined);
  const sentMail = emailService.getLastEmail(email2);
  assert.ok(sentMail && sentMail.token);

  await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email2, token: sentMail.token })
  });
  landlord2Token = await loginUser(email2);

  // Restore baseline agreement hash in case of concurrent test pollution
  db.prepare("UPDATE agreements SET current_document_hash = 'a2b585dd299e03d12fa4293bc5de4111afa1a4b94908f83103eb1f1706367c2e' WHERE id = 'agreement_001'").run();

  // Create isolated agreement for document suite testing
  db.prepare(`
    INSERT OR REPLACE INTO agreements (
      id, company_id, landlord_address, tenant_address, rent_inr, security_deposit_inr, duration_days,
      property_details, current_document_hash, status, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "agree_doc_test_101",
    "Company_DocTest",
    "landlord@gmail.com",
    "tenant@gmail.com",
    18000,
    36000,
    365,
    "Document Test Suite Apartment 401",
    "initial_dummy_hash_for_document_test",
    "Active",
    1
  );
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Phase 4: Document Storage & Cryptographic Verification Suite", async (t) => {
  await t.test("Unit: sanitizeFilename and resolveSafePath prevent path traversal", () => {
    assert.strictEqual(sanitizeFilename("../../../etc/passwd"), "passwd");
    assert.strictEqual(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe");
    assert.strictEqual(sanitizeFilename("safe_lease.pdf"), "safe_lease.pdf");

    // Path traversal defense check
    assert.throws(
      () => resolveSafePath("D:/RentalAgreement-main/uploads", "../../windows/system32"),
      /Path traversal attempt detected/
    );
  });

  await t.test("POST /api/documents/upload uploads file, computes SHA-256 and records metadata", async () => {
    const formData = new FormData();
    const fileBlob = new Blob([sampleContractContent], { type: "text/plain" });
    formData.append("file", fileBlob, "sample_lease.txt");
    formData.append("agreementId", "agree_doc_test_101");
    formData.append("isPrimaryLease", "true");

    const res = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${landlordToken}`
      },
      body: formData
    });

    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.ok(data.id.startsWith("doc_"));
    assert.strictEqual(data.sha256, expectedSha256);
    assert.strictEqual(data.filename, "sample_lease.txt");
    assert.strictEqual(data.mimeType, "text/plain");
    assert.strictEqual(data.sizeBytes, Buffer.byteLength(sampleContractContent));

    uploadedDocId = data.id;

    // Verify DB record persisted
    const dbDoc = db.prepare("SELECT * FROM documents WHERE id = ?").get(uploadedDocId);
    assert.ok(dbDoc);
    assert.strictEqual(dbDoc.sha256, expectedSha256);

    // Verify agreement current_document_hash updated because isPrimaryLease was true
    const updatedAgreement = db.prepare("SELECT current_document_hash, version FROM agreements WHERE id = ?").get("agree_doc_test_101");
    assert.strictEqual(updatedAgreement.current_document_hash, expectedSha256);
    assert.ok(updatedAgreement.version >= 2);
  });

  await t.test("POST /api/documents/upload rejects unauthorized landlord (BOLA / IDOR Protection)", async () => {
    const formData = new FormData();
    const fileBlob = new Blob(["UNAUTHORIZED OVERWRITE LEASE"], { type: "text/plain" });
    formData.append("file", fileBlob, "malicious.txt");
    formData.append("agreementId", "agree_doc_test_101");

    const res = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${landlord2Token}`
      },
      body: formData
    });

    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes("Access denied"));
  });

  await t.test("POST /api/documents/upload rejects forbidden MIME types (e.g. executable/html)", async () => {
    const formData = new FormData();
    const fileBlob = new Blob(["<script>alert(1)</script>"], { type: "text/html" });
    formData.append("file", fileBlob, "exploit.html");
    formData.append("agreementId", "agree_doc_test_101");

    const res = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${landlordToken}`
      },
      body: formData
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes("Invalid document MIME type"));
  });

  await t.test("MED-05 Defense: rejects spoofed MIME types and executables via magic-byte inspection", async () => {
    // 1. Spoofed PDF with Windows PE executable header (MZ)
    const mzExeBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const exeForm = new FormData();
    exeForm.append("file", new Blob([mzExeBuffer], { type: "application/pdf" }), "fake.pdf");
    exeForm.append("agreementId", "agree_doc_test_101");

    const exeRes = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${landlordToken}` },
      body: exeForm
    });
    assert.strictEqual(exeRes.status, 400);
    const exeData = await exeRes.json();
    assert.match(exeData.error, /Dangerous executable format/);

    // 2. Shell script with shebang #! pretending to be text/plain
    const shForm = new FormData();
    shForm.append("file", new Blob(["#!/bin/bash\nrm -rf /"], { type: "text/plain" }), "script.txt");
    shForm.append("agreementId", "agree_doc_test_101");

    const shRes = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${landlordToken}` },
      body: shForm
    });
    assert.strictEqual(shRes.status, 400);
    const shData = await shRes.json();
    assert.match(shData.error, /Executable scripts/);

    // 3. Genuine PDF with %PDF- header is accepted
    const genuinePdf = Buffer.from("%PDF-1.4 genuine lease agreement content");
    const pdfForm = new FormData();
    pdfForm.append("file", new Blob([genuinePdf], { type: "application/pdf" }), "lease.pdf");
    pdfForm.append("agreementId", "agree_doc_test_101");

    const pdfRes = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${landlordToken}` },
      body: pdfForm
    });
    assert.strictEqual(pdfRes.status, 201);
  });

  await t.test("GET /api/documents/:id/download allows authorized landlord and tenant to download authentic file", async () => {
    assert.ok(uploadedDocId, "Uploaded doc ID must exist from previous test");

    // Landlord download
    const landlordRes = await fetch(`${baseUrl}/api/documents/${uploadedDocId}/download`, {
      headers: { Authorization: `Bearer ${landlordToken}` }
    });
    assert.strictEqual(landlordRes.status, 200);
    assert.strictEqual(landlordRes.headers.get("x-document-sha256"), expectedSha256);
    const landlordText = await landlordRes.text();
    assert.strictEqual(landlordText, sampleContractContent);

    // Tenant download
    const tenantRes = await fetch(`${baseUrl}/api/documents/${uploadedDocId}/download`, {
      headers: { Authorization: `Bearer ${tenantToken}` }
    });
    assert.strictEqual(tenantRes.status, 200);
    assert.strictEqual(tenantRes.headers.get("x-document-sha256"), expectedSha256);
    const tenantText = await tenantRes.text();
    assert.strictEqual(tenantText, sampleContractContent);
  });

  await t.test("GET /api/documents/:id/download rejects unauthorized party (BOLA Protection)", async () => {
    const res = await fetch(`${baseUrl}/api/documents/${uploadedDocId}/download`, {
      headers: { Authorization: `Bearer ${landlord2Token}` }
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes("Access denied"));
  });

  await t.test("GET /api/agreements/:id/documents lists documents for authorized parties", async () => {
    // Authorized landlord listing
    const res = await fetch(`${baseUrl}/api/agreements/agree_doc_test_101/documents`, {
      headers: { Authorization: `Bearer ${landlordToken}` }
    });
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1);
    const targetDoc = list.find(d => d.id === uploadedDocId);
    assert.ok(targetDoc, `Expected document ${uploadedDocId} to be in agreement documents`);

    // Unauthorized landlord listing
    const unauthRes = await fetch(`${baseUrl}/api/agreements/agree_doc_test_101/documents`, {
      headers: { Authorization: `Bearer ${landlord2Token}` }
    });
    assert.strictEqual(unauthRes.status, 403);
  });

  await t.test("DEMO-BYPASS Defense: Arbitrary user cannot access documents of unowned agreement", async () => {
    // Register third party user with no wallet and no association
    const thirdEmail = `attacker_doc_${Date.now()}@test.com`;
    await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: thirdEmail, password: "Password@123", name: "Attacker", role: "Property Owner" })
    });
    const token = emailService.getLastEmail(thirdEmail).token;
    await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: thirdEmail, token })
    });
    const thirdToken = await loginUser(thirdEmail);

    // Attempt to download document
    const res = await fetch(`${baseUrl}/api/documents/${uploadedDocId}/download`, {
      headers: { Authorization: `Bearer ${thirdToken}` }
    });
    assert.strictEqual(res.status, 403);

    // Attempt to upload document to agree_doc_test_101
    const form = new FormData();
    form.append("file", new Blob(["attacker content"], { type: "text/plain" }), "hack.txt");
    form.append("agreementId", "agree_doc_test_101");
    const upRes = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${thirdToken}` },
      body: form
    });
    assert.strictEqual(upRes.status, 403);
  });
});
