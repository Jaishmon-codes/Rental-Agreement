import test from "node:test";
import assert from "node:assert/strict";
import { app, db } from "../server.js";
import emailService from "../services/email/emailService.js";

let server;
let baseUrl;

let landlordToken;
let landlord2Token;
let tenantToken;
let adminToken;

test.before(async () => {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Log in standard roles
  const loginUser = async (email, password = "Password@123") => {
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

  // Register second landlord for BOLA testing
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `landlord2_${Date.now()}@test.com`,
      password: "Password@123",
      name: "Landlord Two",
      role: "Property Owner"
    })
  });
  const regData = await regRes.json();
  // Verify token never leaked in API response
  assert.strictEqual(regData.verificationToken, undefined);
  const sentMail = emailService.getLastEmail(regData.user.email);
  assert.ok(sentMail && sentMail.token);

  // Verify second landlord using out-of-band token
  await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: regData.user.email, token: sentMail.token })
  });
  landlord2Token = await loginUser(regData.user.email);
});

test.after(() => {
  server.close();
});

const makeRequest = async (path, options = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, data };
};

test("Phase 3: Properties & Units Domain Suite", async (t) => {
  let createdPropertyId;
  let createdUnitId;

  await t.test("POST /api/properties validates input and creates property for landlord", async () => {
    // Missing required field
    const badRes = await makeRequest("/api/properties", {
      method: "POST",
      headers: { Authorization: `Bearer ${landlordToken}` },
      body: JSON.stringify({ title: "Incomplete" })
    });
    assert.strictEqual(badRes.status, 400);

    // Tenant cannot create property
    const tenantRes = await makeRequest("/api/properties", {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantToken}` },
      body: JSON.stringify({ title: "Tenant Apt", address: "123 Main St", city: "Delhi" })
    });
    assert.strictEqual(tenantRes.status, 403);

    // Landlord creates property
    const res = await makeRequest("/api/properties", {
      method: "POST",
      headers: { Authorization: `Bearer ${landlordToken}` },
      body: JSON.stringify({
        title: "Cyber Greens Tower C",
        address: "DLF Phase 3",
        city: "Gurugram",
        state: "Haryana",
        postalCode: "122002",
        propertyType: "COMMERCIAL"
      })
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.id);
    assert.strictEqual(res.data.title, "Cyber Greens Tower C");
    assert.strictEqual(res.data.status, "ACTIVE");
    createdPropertyId = res.data.id;
  });

  await t.test("GET /api/properties enforces role-based isolation", async () => {
    // Landlord sees own properties
    const landlordRes = await makeRequest("/api/properties", {
      headers: { Authorization: `Bearer ${landlordToken}` }
    });
    assert.strictEqual(landlordRes.status, 200);
    assert.ok(Array.isArray(landlordRes.data));
    assert.ok(landlordRes.data.some((p) => p.id === createdPropertyId));

    // Landlord 2 does not see Landlord 1's created property
    const landlord2Res = await makeRequest("/api/properties", {
      headers: { Authorization: `Bearer ${landlord2Token}` }
    });
    assert.strictEqual(landlord2Res.status, 200);
    assert.strictEqual(landlord2Res.data.some((p) => p.id === createdPropertyId), false);

    // Admin sees all properties
    const adminRes = await makeRequest("/api/properties", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminRes.status, 200);
    assert.ok(adminRes.data.some((p) => p.id === createdPropertyId));
  });

  await t.test("GET /api/properties/:id prevents unauthorized BOLA/IDOR access", async () => {
    // Owner can access
    const ownerRes = await makeRequest(`/api/properties/${createdPropertyId}`, {
      headers: { Authorization: `Bearer ${landlordToken}` }
    });
    assert.strictEqual(ownerRes.status, 200);
    assert.strictEqual(ownerRes.data.id, createdPropertyId);
    assert.ok(Array.isArray(ownerRes.data.units));

    // Non-owner landlord cannot access
    const foreignRes = await makeRequest(`/api/properties/${createdPropertyId}`, {
      headers: { Authorization: `Bearer ${landlord2Token}` }
    });
    assert.strictEqual(foreignRes.status, 403);
  });

  await t.test("POST /api/properties/:id/units adds unit to property", async () => {
    // Unauthorized landlord cannot add unit
    const badRes = await makeRequest(`/api/properties/${createdPropertyId}/units`, {
      method: "POST",
      headers: { Authorization: `Bearer ${landlord2Token}` },
      body: JSON.stringify({ unitNumber: "Suite 404", rentInr: 50000 })
    });
    assert.strictEqual(badRes.status, 403);

    // Owner adds unit
    const res = await makeRequest(`/api/properties/${createdPropertyId}/units`, {
      method: "POST",
      headers: { Authorization: `Bearer ${landlordToken}` },
      body: JSON.stringify({
        unitNumber: "Floor 4 - Suite A",
        rentInr: 45000,
        securityDepositInr: 90000
      })
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.unit_number, "Floor 4 - Suite A");
    assert.strictEqual(res.data.rent_inr, 45000);
    createdUnitId = res.data.id;
  });

  await t.test("PUT /api/properties/:id/units/:unitId updates unit status", async () => {
    const res = await makeRequest(`/api/properties/${createdPropertyId}/units/${createdUnitId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${landlordToken}` },
      body: JSON.stringify({ status: "OCCUPIED" })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, "OCCUPIED");
  });

  await t.test("DELETE /api/properties/:id protects against active lease deletion", async () => {
    // agreement_001 is Active and linked to prop_springfield_001
    const delActiveRes = await makeRequest("/api/properties/prop_springfield_001", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.strictEqual(delActiveRes.status, 400);
    assert.ok(delActiveRes.data.error.includes("active leases"));

    // Deleting created property without active lease succeeds
    const delRes = await makeRequest(`/api/properties/${createdPropertyId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${landlordToken}` }
    });
    assert.strictEqual(delRes.status, 200);
    assert.ok(delRes.data.message.includes("successfully deleted"));
  });
});
