import test from "node:test";
import assert from "node:assert/strict";
import db, { runTransaction } from "../db.js";

test("Database Schema & Normalization Suite (Phase 1)", async (t) => {
  await t.test("All normalized tables exist in SQLite", () => {
    const requiredTables = [
      "users",
      "roles",
      "permissions",
      "role_permissions",
      "user_roles",
      "wallets",
      "properties",
      "units",
      "agreements",
      "documents",
      "payments",
      "refunds",
      "landlord_accounts",
      "platform_fees",
      "webhook_events",
      "reconciliation_records",
      "notifications",
      "audit_logs",
      "security_events"
    ];

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);

    for (const table of requiredTables) {
      assert.ok(
        tables.includes(table),
        `Table '${table}' must exist in database schema`
      );
    }
  });

  await t.test("Migrated columns exist on agreements and users tables", () => {
    const agreementCols = db
      .prepare("PRAGMA table_info(agreements)")
      .all()
      .map((c) => c.name);
    assert.ok(agreementCols.includes("property_id"), "agreements should have property_id");
    assert.ok(agreementCols.includes("unit_id"), "agreements should have unit_id");

    const userCols = db
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((c) => c.name);
    assert.ok(userCols.includes("status"), "users should have status column");
    assert.ok(userCols.includes("verification_token"), "users should have verification_token column");
    assert.ok(userCols.includes("reset_token"), "users should have reset_token column");
  });

  await t.test("Roles, permissions, and user_roles are properly seeded", () => {
    const roles = db.prepare("SELECT * FROM roles").all();
    assert.ok(roles.length >= 9, "At least 9 standard roles must be seeded");

    const permissions = db.prepare("SELECT * FROM permissions").all();
    assert.ok(permissions.length >= 25, "At least 25 standard permissions must be seeded");

    const userRoles = db.prepare("SELECT * FROM user_roles").all();
    assert.ok(userRoles.length >= 8, "Seeded users must have mapped user_roles");

    // Test permission resolution for Super Admin
    const superAdmin = db.prepare("SELECT id FROM users WHERE email = 'admin@rentsphere.com'").get();
    assert.ok(superAdmin, "Super Admin user exists");

    const superAdminPerms = db
      .prepare(`
        SELECT p.code
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN user_roles ur ON rp.role_id = ur.role_id
        WHERE ur.user_id = ?
      `)
      .all(superAdmin.id)
      .map((p) => p.code);

    assert.ok(superAdminPerms.includes("USER_MANAGE"), "Super Admin has USER_MANAGE permission");
    assert.ok(superAdminPerms.includes("REFUND_APPROVE"), "Super Admin has REFUND_APPROVE permission");
    assert.ok(superAdminPerms.includes("FEE_CONFIG_EDIT"), "Super Admin has FEE_CONFIG_EDIT permission");
  });

  await t.test("Platform fee configuration is seeded and active", () => {
    const activeFee = db.prepare("SELECT * FROM platform_fees WHERE active = 1").get();
    assert.ok(activeFee, "Active platform fee must exist");
    assert.strictEqual(Number(activeFee.fee_percentage), 0.03, "Default fee percentage is 3%");
  });

  await t.test("Sample properties and units are seeded and associated", () => {
    const properties = db.prepare("SELECT * FROM properties").all();
    assert.ok(properties.length >= 1, "At least one sample property must be seeded");

    const units = db.prepare("SELECT * FROM units").all();
    assert.ok(units.length >= 1, "At least one sample unit must be seeded");

    const agreement = db.prepare("SELECT * FROM agreements WHERE id = 'agreement_001'").get();
    assert.ok(agreement.property_id, "agreement_001 must have property_id linked");
    assert.ok(agreement.unit_id, "agreement_001 must have unit_id linked");
  });

  await t.test("MED-01: runTransaction commits atomic multi-step mutations", () => {
    const testEmail = `tx_success_${Date.now()}@test.com`;
    runTransaction(() => {
      db.prepare("INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)")
        .run(testEmail, "hash", "Tenant", "TX Tester");
      const user = db.prepare("SELECT id FROM users WHERE email = ?").get(testEmail);
      db.prepare("INSERT INTO notifications (id, user_id, title, message) VALUES (?, ?, ?, ?)")
        .run(`notif_tx_${Date.now()}`, user.id, "Welcome", "Hello");
    });

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(testEmail);
    assert.ok(user, "User should be committed");

    // Cleanup
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  });

  await t.test("MED-01: runTransaction rolls back all operations if an error occurs", () => {
    const testEmail = `tx_fail_${Date.now()}@test.com`;
    assert.throws(() => {
      runTransaction(() => {
        db.prepare("INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)")
          .run(testEmail, "hash", "Tenant", "Fail Tester");
        // Simulate unexpected failure
        throw new Error("Simulated mutation failure mid-transaction");
      });
    }, /Simulated mutation failure mid-transaction/);

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(testEmail);
    assert.strictEqual(user, undefined, "User must NOT exist because transaction was rolled back");
  });

  await t.test("Blocker 3: PRAGMA foreign_keys is strictly enabled on database connection", () => {
    const fkStatus = db.prepare("PRAGMA foreign_keys").get();
    assert.strictEqual(Number(fkStatus.foreign_keys), 1, "foreign_keys pragma must be active (1)");
  });

  await t.test("Blocker 3: Rejects orphaned payment insertion referencing non-existent agreement", () => {
    assert.throws(() => {
      db.prepare(`
        INSERT INTO payments (id, agreement_id, amount_inr, payment_gateway, transaction_id)
        VALUES ('pay_orphan_test', 'non_existent_agreement_9999', 15000, 'Direct', 'tx_orphan')
      `).run();
    }, /FOREIGN KEY constraint failed/);
  });

  await t.test("Blocker 3: Rejects orphaned document insertion referencing non-existent agreement", () => {
    assert.throws(() => {
      db.prepare(`
        INSERT INTO documents (id, agreement_id, storage_key, original_filename, sha256, mime_type, size_bytes, uploaded_by)
        VALUES ('doc_orphan_test', 'non_existent_agreement_9999', 'key', 'file.pdf', 'hash', 'application/pdf', 100, 'test@test.com')
      `).run();
    }, /FOREIGN KEY constraint failed/);
  });

  await t.test("Blocker 3: Cascades unit deletion when parent property is deleted", () => {
    const propId = `prop_fk_test_${Date.now()}`;
    const unitId = `unit_fk_test_${Date.now()}`;
    const landlord = db.prepare("SELECT id FROM users WHERE role = 'Property Owner'").get();
    assert.ok(landlord, "Landlord must exist");

    db.prepare(`
      INSERT INTO properties (id, landlord_id, title, address, city)
      VALUES (?, ?, 'Cascade Test Building', '123 Cascade St', 'Metropolis')
    `).run(propId, landlord.id);

    db.prepare(`
      INSERT INTO units (id, property_id, unit_number, rent_inr, security_deposit_inr)
      VALUES (?, ?, 'Suite C-1', 12000, 24000)
    `).run(unitId, propId);

    // Verify unit exists
    assert.ok(db.prepare("SELECT * FROM units WHERE id = ?").get(unitId));

    // Delete property
    db.prepare("DELETE FROM properties WHERE id = ?").run(propId);

    // Verify unit was cascaded and deleted
    const unitAfter = db.prepare("SELECT * FROM units WHERE id = ?").get(unitId);
    assert.strictEqual(unitAfter, undefined, "Child unit must be automatically deleted when parent property is deleted");
  });
});
