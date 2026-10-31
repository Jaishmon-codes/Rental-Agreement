import test from "node:test";
import assert from "node:assert/strict";
import { app, db } from "../server.js";
import emailService from "../services/email/emailService.js";

let server;
let baseUrl;

test.before(() => {
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
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

test("Phase 2: Authentication, Registration & Granular RBAC Suite", async (t) => {
  const uniqueId = Date.now();
  const testEmail = `newtenant_${uniqueId}@example.com`;
  const testPassword = "SecurePassword@123";
  let verificationToken;
  let authToken;

  await t.test("POST /api/auth/register validates email format and password policy", async () => {
    // Bad email
    const badEmailRes = await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: "invalid-email", password: testPassword, name: "Test User" })
    });
    assert.strictEqual(badEmailRes.status, 400);

    // Weak password (too short)
    const weakPassRes = await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: "weak", name: "Test User" })
    });
    assert.strictEqual(weakPassRes.status, 400);
    assert.ok(weakPassRes.data.error.includes("8 characters"));

    // Weak password (no uppercase)
    const noUpperRes = await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: "password123", name: "Test User" })
    });
    assert.strictEqual(noUpperRes.status, 400);
    assert.ok(noUpperRes.data.error.includes("uppercase"));
  });

  await t.test("POST /api/auth/register successfully registers new user and dispatches out-of-band email (HIGH-05)", async () => {
    const res = await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Alice Tenant",
        role: "Tenant"
      })
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.user);
    assert.strictEqual(res.data.user.email, testEmail);
    assert.strictEqual(res.data.user.role, "Tenant");
    assert.strictEqual(res.data.user.verified, false);
    
    // SECURITY REGRESSION CHECK: Token must NEVER be leaked in the API response
    assert.strictEqual(res.data.verificationToken, undefined, "Verification token must not leak in HTTP response");

    // Retrieve token safely from out-of-band transactional email sink
    const sentEmail = emailService.getLastEmail(testEmail);
    assert.ok(sentEmail, "Verification email should have been sent");
    assert.ok(sentEmail.token, "Email must contain raw verification token");
    verificationToken = sentEmail.token;

    // Verify user exists in database and mapped in user_roles
    const dbUser = db.prepare("SELECT * FROM users WHERE email = ?").get(testEmail);
    assert.ok(dbUser);
    // In database, the token must be hashed, not stored in plaintext
    assert.notStrictEqual(dbUser.verification_token, verificationToken, "Token must be stored hashed in DB");

    const userRole = db.prepare("SELECT role_id FROM user_roles WHERE user_id = ?").get(dbUser.id);
    assert.strictEqual(userRole?.role_id, "TENANT");
  });

  await t.test("POST /api/auth/register rejects duplicate registration with 409", async () => {
    const res = await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Duplicate User",
        role: "Tenant"
      })
    });
    assert.strictEqual(res.status, 409);
  });

  await t.test("POST /api/auth/verify-email validates token and updates verification status", async () => {
    // Bad token
    const badTokenRes = await makeRequest("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, token: "wrong_token_123" })
    });
    assert.strictEqual(badTokenRes.status, 400);

    // Valid token from out-of-band email
    const validRes = await makeRequest("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, token: verificationToken })
    });
    assert.strictEqual(validRes.status, 200);
    assert.strictEqual(validRes.data.verified, true);

    const updatedUser = db.prepare("SELECT verified, verification_token FROM users WHERE email = ?").get(testEmail);
    assert.strictEqual(Boolean(updatedUser.verified), true);
    assert.strictEqual(updatedUser.verification_token, null, "Verification token must be cleared after verification");
  });

  await t.test("POST /api/auth/login succeeds and returns JWT with resolved permissions", async () => {
    const res = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: testPassword })
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.data.token);
    assert.ok(Array.isArray(res.data.user.permissions));
    authToken = res.data.token;
  });

  await t.test("GET /api/auth/me returns authenticated profile with permissions", async () => {
    const res = await makeRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.email, testEmail);
    assert.strictEqual(res.data.role, "Tenant");
    assert.ok(res.data.permissions.includes("RENT_PAY"));
  });

  await t.test("POST /api/auth/forgot-password and /api/auth/reset-password lifecycle (CRIT-01)", async () => {
    const forgotRes = await makeRequest("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: testEmail })
    });

    assert.strictEqual(forgotRes.status, 200);
    // SECURITY REGRESSION CHECK: Token must NEVER be returned in response!
    assert.strictEqual(forgotRes.data.resetToken, undefined, "Reset token must NOT be leaked in HTTP response body");
    assert.ok(forgotRes.data.message.includes("password reset instructions have been sent"));

    // Retrieve raw token out-of-band from transactional email sink
    const resetMail = emailService.getLastEmail(testEmail);
    assert.ok(resetMail && resetMail.token);
    const resetToken = resetMail.token;

    // Bad reset token
    const badReset = await makeRequest("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, token: "invalid_reset_token", newPassword: "NewPassword@456" })
    });
    assert.strictEqual(badReset.status, 400);

    // Valid reset
    const newPassword = "NewPassword@456";
    const goodReset = await makeRequest("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, token: resetToken, newPassword })
    });
    assert.strictEqual(goodReset.status, 200);

    // Old password fails
    const oldLogin = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: testPassword })
    });
    assert.strictEqual(oldLogin.status, 401);

    // New password succeeds
    const newLogin = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: newPassword })
    });
    assert.strictEqual(newLogin.status, 200);
    assert.ok(newLogin.data.token);
  });

  // --- NEW SECURITY REGRESSION TESTS ---

  await t.test("test_forgot_password_no_token_leak", async () => {
    const res = await makeRequest("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "admin@rentsphere.com" })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.resetToken, undefined);
    assert.strictEqual(JSON.stringify(res.data).includes("resetToken"), false);
  });

  await t.test("test_reset_token_single_use", async () => {
    const email = `single_use_${Date.now()}@test.com`;
    // Register and verify user
    await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: testPassword, name: "Single Use User", role: "Tenant" })
    });
    const verifyToken = emailService.getLastEmail(email).token;
    await makeRequest("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, token: verifyToken })
    });

    // Request reset
    await makeRequest("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    const token = emailService.getLastEmail(email).token;

    // First reset succeeds
    const firstReset = await makeRequest("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, token, newPassword: "UpdatedPassword@123" })
    });
    assert.strictEqual(firstReset.status, 200);

    // Replay attempt with same token fails
    const replayReset = await makeRequest("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, token, newPassword: "ReplayedPassword@123" })
    });
    assert.strictEqual(replayReset.status, 400);
    assert.ok(replayReset.data.error.includes("Invalid or expired"));
  });

  await t.test("test_reset_token_expiry", async () => {
    const email = `expiry_test_${Date.now()}@test.com`;
    await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password: testPassword, name: "Expiry User", role: "Tenant" })
    });
    const verifyToken = emailService.getLastEmail(email).token;
    await makeRequest("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, token: verifyToken })
    });

    // Request reset
    await makeRequest("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    const token = emailService.getLastEmail(email).token;

    // Artificially expire the token in database
    const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    db.prepare("UPDATE users SET reset_token_expires_at = ? WHERE email = ?").run(pastDate, email);

    // Attempt reset with expired token
    const res = await makeRequest("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, token, newPassword: "ExpiredPassword@123" })
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.data.error.includes("expired"));
  });

  await t.test("test_verification_token_no_leak", async () => {
    const regRes = await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: `noleak_${Date.now()}@test.com`,
        password: testPassword,
        name: "No Leak User",
        role: "Tenant"
      })
    });
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regRes.data.verificationToken, undefined);
    assert.strictEqual(JSON.stringify(regRes.data).includes("verificationToken"), false);
  });

  await t.test("test_nonexistent_account_generic_response (enumeration hardening)", async () => {
    const res = await makeRequest("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: `nonexistent_user_${Date.now()}@notfound.org` })
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.message.includes("password reset instructions have been sent"));
    assert.strictEqual(res.data.resetToken, undefined);
  });

  await t.test("Suspended / deactivated accounts are blocked from login", async () => {
    // Suspend test user
    db.prepare("UPDATE users SET status = 'SUSPENDED' WHERE email = ?").run(testEmail);

    const res = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: testEmail, password: "NewPassword@456" })
    });
    assert.strictEqual(res.status, 403);
    assert.ok(res.data.error.includes("suspended"));

    // Restore
    db.prepare("UPDATE users SET status = 'ACTIVE' WHERE email = ?").run(testEmail);
  });

  await t.test("test_jwt_invalidated_after_password_reset", async () => {
    const email = `jwt_reset_${Date.now()}@test.com`;
    const password = "InitialPassword@123";
    const newPassword = "UpdatedPassword@456";

    // Register & verify
    await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name: "JWT Reset User", role: "Tenant" })
    });
    const verifyToken = emailService.getLastEmail(email).token;
    await makeRequest("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, token: verifyToken })
    });

    // Login to obtain active JWT
    const loginRes = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    assert.strictEqual(loginRes.status, 200);
    const activeJwt = loginRes.data.token;

    // Verify token works
    const meBefore = await makeRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${activeJwt}` }
    });
    assert.strictEqual(meBefore.status, 200);
    assert.strictEqual(meBefore.data.email, email);

    // Request password reset & execute reset
    await makeRequest("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email })
    });
    const resetToken = emailService.getLastEmail(email).token;
    const resetRes = await makeRequest("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, token: resetToken, newPassword })
    });
    assert.strictEqual(resetRes.status, 200);

    // SECURITY CHECK: The old JWT MUST now be rejected with 401
    const meAfter = await makeRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${activeJwt}` }
    });
    assert.strictEqual(meAfter.status, 401, "Old JWT must be rejected after password reset");
    assert.ok(meAfter.data.error.includes("Session has been revoked"));

    // Login with new password produces a valid JWT with incremented token_version
    const newLogin = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: newPassword })
    });
    assert.strictEqual(newLogin.status, 200);
    const newJwt = newLogin.data.token;

    const meWithNew = await makeRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${newJwt}` }
    });
    assert.strictEqual(meWithNew.status, 200);
  });

  await t.test("test_jwt_invalidated_after_account_suspension", async () => {
    const email = `jwt_suspend_${Date.now()}@test.com`;
    const password = "ValidPassword@123";

    // Register & verify
    await makeRequest("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name: "Suspension User", role: "Tenant" })
    });
    const verifyToken = emailService.getLastEmail(email).token;
    await makeRequest("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, token: verifyToken })
    });

    // Login
    const loginRes = await makeRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    assert.strictEqual(loginRes.status, 200);
    const jwt = loginRes.data.token;

    // Pre-check: access is granted
    const meRes1 = await makeRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${jwt}` }
    });
    assert.strictEqual(meRes1.status, 200);

    // Suspend user in DB
    db.prepare("UPDATE users SET status = 'SUSPENDED' WHERE email = ?").run(email);

    // SECURITY CHECK: In-flight token is immediately rejected with 403
    const meRes2 = await makeRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${jwt}` }
    });
    assert.strictEqual(meRes2.status, 403, "Suspended user token must be rejected with 403");
    assert.ok(meRes2.data.error.includes("suspended"));

    // Unsuspend user
    db.prepare("UPDATE users SET status = 'ACTIVE' WHERE email = ?").run(email);

    // After reactivation, the token works again
    const meRes3 = await makeRequest("/api/auth/me", {
      headers: { Authorization: `Bearer ${jwt}` }
    });
    assert.strictEqual(meRes3.status, 200);
  });
});
