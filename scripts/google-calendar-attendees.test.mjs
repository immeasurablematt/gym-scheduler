import assert from "node:assert/strict";
import test from "node:test";

test("hasInviteSuitableEmail accepts trimmed normal emails", async () => {
  const { hasInviteSuitableEmail } = await import("../lib/google/calendar-attendees.ts");

  assert.equal(hasInviteSuitableEmail(" client@example.com "), true);
});

test("hasInviteSuitableEmail rejects malformed emails", async () => {
  const { hasInviteSuitableEmail } = await import("../lib/google/calendar-attendees.ts");

  assert.equal(hasInviteSuitableEmail("not-an-email"), false);
  assert.equal(hasInviteSuitableEmail(""), false);
  assert.equal(hasInviteSuitableEmail(null), false);
});

test("mergeClientAttendee adds the client once and preserves other guests", async () => {
  const { mergeClientAttendee } = await import("../lib/google/calendar-attendees.ts");

  const merged = mergeClientAttendee(
    [{ email: "other@example.com" }, { email: "client@example.com" }],
    "client@example.com",
  );

  assert.deepEqual(merged, [
    { email: "other@example.com" },
    { email: "client@example.com" },
  ]);
});

test("mergeClientAttendee appends the client when absent", async () => {
  const { mergeClientAttendee } = await import("../lib/google/calendar-attendees.ts");

  const merged = mergeClientAttendee([{ email: "other@example.com" }], "client@example.com");

  assert.deepEqual(merged, [
    { email: "other@example.com" },
    { email: "client@example.com" },
  ]);
});
