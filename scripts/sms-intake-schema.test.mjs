import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(
  "supabase/migrations/20260421120000_sms_receptionist_intake.sql",
);

test("SMS receptionist intake migration defines intake and approval schema", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  const types = fs.readFileSync(path.resolve("types/supabase.ts"), "utf8");
  const leadTable = extractTableBlock(migration, "sms_intake_leads");
  const requestTable = extractTableBlock(migration, "sms_trainer_approval_requests");

  assert.ok(leadTable, "Expected sms_intake_leads table block");
  assert.ok(requestTable, "Expected sms_trainer_approval_requests table block");

  assertTableColumns(leadTable, [
    "id",
    "raw_phone",
    "normalized_phone",
    "requested_trainer_name_raw",
    "requested_trainer_id",
    "client_name",
    "email",
    "scheduling_preferences_text",
    "scheduling_preferences_json",
    "status",
    "conversation_state",
    "summary_for_trainer",
    "last_inbound_message_id",
    "last_outbound_message_id",
    "approved_user_id",
    "approved_client_id",
    "created_at",
    "updated_at",
  ]);

  assertTableColumns(requestTable, [
    "id",
    "lead_id",
    "trainer_id",
    "request_code",
    "status",
    "outbound_message_id",
    "decision_message_id",
    "decided_at",
    "expires_at",
    "created_at",
    "updated_at",
  ]);

  assertIncludesAll(migration, [
    "collecting_info",
    "awaiting_trainer_approval",
    "approved",
    "rejected",
    "expired",
    "needs_manual_review",
    "needs_trainer",
    "needs_name",
    "needs_email",
    "needs_preferences",
    "ready_for_approval",
    "awaiting_trainer_reply",
    "pending",
  ]);

  assertUniqueIndex(migration, "idx_sms_intake_leads_active_normalized_phone", [
    "normalized_phone",
    "WHERE status NOT IN ('approved', 'rejected', 'expired')",
  ]);

  assertUniqueIndex(migration, "idx_sms_trainer_approval_requests_pending_request_code", [
    "request_code",
    "WHERE status = 'pending'",
  ]);

  assertUniqueIndex(migration, "idx_sms_trainer_approval_requests_pending_lead_id", [
    "lead_id",
    "WHERE status = 'pending'",
  ]);

  assert.match(
    migration,
    /CONSTRAINT\s+sms_trainer_approval_requests_state_timestamps_check\s+CHECK\s*\([\s\S]*status\s*=\s*'pending'[\s\S]*expires_at\s+IS\s+NOT\s+NULL[\s\S]*status\s+IN\s*\(\s*'approved'\s*,\s*'rejected'\s*,\s*'expired'\s*\)[\s\S]*decided_at\s+IS\s+NOT\s+NULL[\s\S]*\)/i,
  );

  assert.match(types, /sms_intake_leads:\s*\{/);
  assert.match(types, /sms_trainer_approval_requests:\s*\{/);
  assert.match(
    types,
    /sms_intake_status:\s*\n[\s\S]*'collecting_info'[\s\S]*'awaiting_trainer_approval'[\s\S]*'approved'[\s\S]*'rejected'[\s\S]*'expired'[\s\S]*'needs_manual_review'/,
  );
  assert.match(
    types,
    /sms_intake_conversation_state:\s*\n[\s\S]*'needs_trainer'[\s\S]*'needs_name'[\s\S]*'needs_email'[\s\S]*'needs_preferences'[\s\S]*'ready_for_approval'[\s\S]*'awaiting_trainer_reply'/,
  );
  assert.match(
    types,
    /sms_trainer_approval_status:\s*'pending'\s*\|\s*'approved'\s*\|\s*'rejected'\s*\|\s*'expired'/,
  );
});

function extractTableBlock(text, tableName) {
  const pattern = new RegExp(
    String.raw`CREATE TABLE IF NOT EXISTS ${tableName} \(([\s\S]*?)\n\);`,
    "i",
  );
  const match = text.match(pattern);
  return match?.[1] ?? null;
}

function assertTableColumns(tableBlock, columns) {
  for (const column of columns) {
    assert.match(
      tableBlock,
      new RegExp(String.raw`(?:^|\n)\s*${column}\s`, "i"),
      `Expected table block to include column ${column}`,
    );
  }
}

function assertUniqueIndex(text, indexName, fragments) {
  const indexPattern = new RegExp(
    String.raw`CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+${indexName}[\s\S]*?;`,
    "i",
  );
  const match = text.match(indexPattern);
  assert.ok(match, `Expected unique index ${indexName}`);

  for (const fragment of fragments) {
    assert.ok(match[0].includes(fragment), `Expected ${indexName} to include ${fragment}`);
  }
}

function assertIncludesAll(text, values) {
  for (const value of values) {
    assert.ok(text.includes(value), `Expected migration to include ${value}`);
  }
}
