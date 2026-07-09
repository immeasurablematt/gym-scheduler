import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const schemaPath = path.resolve("supabase/schema.sql");

test("supabase/schema.sql is a single trustworthy GymScheduler baseline", () => {
  const schema = fs.readFileSync(schemaPath, "utf8");

  assertUniqueCreateNames(schema, "TYPE");
  assertUniqueCreateNames(schema, "TABLE");
  assertUniqueCreateNames(schema, "INDEX");

  assertNoLegacySmsBaselineObjects(schema);

  assertTableColumns(schema, "sms_messages", [
    "id",
    "provider",
    "audience",
    "message_kind",
    "direction",
    "status",
    "message_sid",
    "account_sid",
    "from_phone",
    "to_phone",
    "normalized_from_phone",
    "normalized_to_phone",
    "body",
    "error_message",
    "offer_set_id",
    "client_id",
    "trainer_id",
    "source_change_id",
    "sent_at",
    "created_at",
  ]);

  assertTableColumns(schema, "sms_booking_offers", [
    "id",
    "offer_set_id",
    "client_id",
    "trainer_id",
    "offered_by_message_id",
    "selected_by_message_id",
    "booked_session_id",
    "flow_type",
    "target_session_id",
    "slot_position",
    "slot_starts_at",
    "slot_ends_at",
    "time_zone",
    "status",
    "expires_at",
    "created_at",
    "updated_at",
  ]);

  assertTableColumns(schema, "sms_intake_leads", [
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

  assertTableColumns(schema, "sms_trainer_approval_requests", [
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

  assertIncludesAll(schema, [
    "CREATE TYPE sms_message_audience AS ENUM ('client', 'trainer');",
    "CREATE TYPE sms_message_kind AS ENUM ('conversation', 'book', 'reschedule', 'cancel');",
    "CREATE TYPE sms_intake_status AS ENUM",
    "CREATE TYPE sms_intake_conversation_state AS ENUM",
    "CREATE TYPE sms_trainer_approval_status AS ENUM",
  ]);
});

function assertUniqueCreateNames(schema, objectKind) {
  const names = [...schema.matchAll(createNamePattern(objectKind))]
    .map((match) => match[1])
    .sort();
  const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);

  assert.deepEqual(
    [...new Set(duplicateNames)],
    [],
    `Expected CREATE ${objectKind} statements to be unique`,
  );
}

function createNamePattern(objectKind) {
  if (objectKind === "INDEX") {
    return /CREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-zA-Z0-9_]+)/gi;
  }

  return new RegExp(String.raw`CREATE\s+${objectKind}\s+([a-zA-Z0-9_]+)`, "gi");
}

function assertNoLegacySmsBaselineObjects(schema) {
  assert.doesNotMatch(schema, /\bsms_message_direction\b/);
  assert.doesNotMatch(schema, /\bsms_slot_offers\b/);
  assert.doesNotMatch(schema, /\bsms_webhook_events\b/);
  assert.doesNotMatch(schema, /\braw_from_phone_number\b/);
  assert.doesNotMatch(schema, /\btwilio_message_sid\b/);
}

function assertTableColumns(schema, tableName, columns) {
  const tableBlock = extractTableBlock(schema, tableName);
  assert.ok(tableBlock, `Expected ${tableName} table block`);

  for (const column of columns) {
    assert.match(
      tableBlock,
      new RegExp(String.raw`(?:^|\n)\s+${column}\s`, "i"),
      `Expected ${tableName} to include column ${column}`,
    );
  }
}

function extractTableBlock(schema, tableName) {
  const match = schema.match(
    new RegExp(String.raw`CREATE TABLE ${tableName} \(([\s\S]*?)\n\);`, "i"),
  );

  return match?.[1] ?? null;
}

function assertIncludesAll(text, values) {
  for (const value of values) {
    assert.ok(text.includes(value), `Expected schema to include ${value}`);
  }
}
