import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  "supabase/migrations/20260421120000_sms_receptionist_intake.sql",
);

test("SMS receptionist intake migration defines intake and approval schema", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS sms_intake_leads/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sms_trainer_approval_requests/i);

  assertIncludesAll(migration, [
    "collecting_info",
    "awaiting_trainer_approval",
    "approved",
    "rejected",
    "expired",
    "needs_manual_review",
  ]);

  assertIncludesAll(migration, [
    "needs_trainer",
    "needs_name",
    "needs_email",
    "needs_preferences",
    "ready_for_approval",
    "awaiting_trainer_reply",
  ]);

  assertIncludesAll(migration, ["pending", "approved", "rejected", "expired"]);

  assert.match(
    migration,
    /CREATE\s+UNIQUE\s+INDEX[\s\S]*normalized_phone[\s\S]*WHERE[\s\S]*status\s+NOT\s+IN\s*\(\s*'approved'\s*,\s*'rejected'\s*,\s*'expired'\s*\)/i,
  );

  assert.match(
    migration,
    /CREATE\s+UNIQUE\s+INDEX[\s\S]*request_code[\s\S]*WHERE[\s\S]*status\s*=\s*'pending'/i,
  );
});

function assertIncludesAll(text, values) {
  for (const value of values) {
    assert.ok(text.includes(value), `Expected migration to include ${value}`);
  }
}
