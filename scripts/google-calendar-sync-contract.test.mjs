import assert from "node:assert/strict";
import test from "node:test";

test("scheduled sessions require a valid client email and merge attendees", async () => {
  const { buildCalendarSyncMutation } = await import("../lib/google/calendar-sync-contract.ts");

  const result = buildCalendarSyncMutation({
    clientEmail: "client@example.com",
    existingAttendees: [{ email: "other@example.com" }],
    sessionStatus: "scheduled",
  });

  assert.deepEqual(result, {
    attendees: [
      { email: "other@example.com" },
      { email: "client@example.com" },
    ],
    kind: "upsert",
    sendUpdates: "all",
  });
});

test("scheduled sessions throw when the client email is invalid", async () => {
  const { buildCalendarSyncMutation } = await import("../lib/google/calendar-sync-contract.ts");

  assert.throws(
    () =>
      buildCalendarSyncMutation({
        clientEmail: "not-an-email",
        existingAttendees: [],
        sessionStatus: "scheduled",
      }),
    /Client email must be present and valid for Google Calendar invites/,
  );
});

test("cancelled sessions delete with guest updates and skip email validation", async () => {
  const { buildCalendarSyncMutation } = await import("../lib/google/calendar-sync-contract.ts");

  assert.deepEqual(
    buildCalendarSyncMutation({
      clientEmail: null,
      existingAttendees: [],
      sessionStatus: "cancelled",
    }),
    {
      kind: "delete",
      sendUpdates: "all",
    },
  );
});
