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

test("requireInviteSuitableEmail returns trimmed valid emails", async () => {
  const { requireInviteSuitableEmail } = await import("../lib/google/calendar-attendees.ts");

  assert.equal(requireInviteSuitableEmail(" client@example.com "), "client@example.com");
});

test("requireInviteSuitableEmail throws the default message for invalid input", async () => {
  const { requireInviteSuitableEmail } = await import("../lib/google/calendar-attendees.ts");

  assert.throws(() => requireInviteSuitableEmail("not-an-email"), {
    message: "Client email must be present and valid for Google Calendar invites.",
  });
});

test("requireInviteSuitableEmail honors a custom message", async () => {
  const { requireInviteSuitableEmail } = await import("../lib/google/calendar-attendees.ts");

  assert.throws(() => requireInviteSuitableEmail(null, "Custom invite email error"), {
    message: "Custom invite email error",
  });
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
