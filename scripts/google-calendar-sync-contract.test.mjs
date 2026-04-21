import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  'data:text/javascript,import { pathToFileURL } from "node:url"; import { extname, join } from "node:path"; export async function resolve(specifier, context, nextResolve) { if (specifier.startsWith("@/")) { const relativePath = specifier.slice(2); const resolvedPath = extname(relativePath) ? relativePath : `${relativePath}.ts`; return { url: pathToFileURL(join(process.cwd(), resolvedPath)).href, shortCircuit: true }; } return nextResolve(specifier, context); }',
  import.meta.url,
);

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

test("completed sessions still upsert after validating the client email", async () => {
  const { buildCalendarSyncMutation } = await import("../lib/google/calendar-sync-contract.ts");

  assert.deepEqual(
    buildCalendarSyncMutation({
      clientEmail: " client@example.com ",
      existingAttendees: [{ email: "other@example.com" }],
      sessionStatus: "completed",
    }),
    {
      attendees: [
        { email: "other@example.com" },
        { email: "client@example.com" },
      ],
      kind: "upsert",
      sendUpdates: "all",
    },
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
