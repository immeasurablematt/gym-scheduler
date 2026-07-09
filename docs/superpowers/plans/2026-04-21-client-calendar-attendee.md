# Client Calendar Attendee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real Google Calendar client attendees to the existing trainer calendar sync flow so dashboard and SMS session changes create, update, and cancel Google invites consistently for all connected trainers.

**Architecture:** Keep the existing `syncSessionToCalendar(...)` pipeline as the single integration point. Add small, testable helper modules for attendee validation, attendee merge behavior, and sync-action selection, then extend the Google client layer to support attendee reads and guest-update writes before wiring those helpers into dashboard and SMS session flows.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Google Calendar REST API, existing calendar sync job flow, Node test runner, ESLint.

---

## File Map

- Create: `lib/google/calendar-attendees.ts`
  - Pure helper for email suitability checks and attendee merge behavior.
- Create: `scripts/google-calendar-attendees.test.mjs`
  - Focused Node tests for attendee validation and merge rules.
- Modify: `lib/google/client.ts`
  - Add attendee-aware event create/update/delete behavior and a helper to fetch an existing event.
- Create: `scripts/google-calendar-client-attendees.test.mjs`
  - Mocked-fetch tests for Google client request shape and query params.
- Create: `lib/google/calendar-sync-contract.ts`
  - Pure helper that converts session state + client email + existing attendees into a concrete Google mutation contract.
- Create: `scripts/google-calendar-sync-contract.test.mjs`
  - Focused tests for scheduled, rescheduled, invalid-email, and cancelled session sync behavior.
- Create: `lib/google/client-invite-eligibility.ts`
  - Pure helper that centralizes early-validation decisions and user-safe error messages for dashboard and SMS flows.
- Create: `scripts/client-invite-eligibility.test.mjs`
  - Tests for early-validation messages and eligibility outcomes.
- Modify: `lib/google/calendar-sync.ts`
  - Wire the pure sync contract into the live Supabase + Google sync flow.
- Modify: `lib/sessions.ts`
  - Add early client-email validation for dashboard/manual scheduled-session create and update.
- Modify: `lib/sms/booking-service.ts`
  - Add early validation before SMS booking inserts a new scheduled session.
- Modify: `lib/sms/session-lifecycle.ts`
  - Add early validation before SMS reschedule mutates a scheduled session.
- Modify: `docs/live-pilot-runbook.md`
  - Document invite/update/cancellation verification.
- Modify: `docs/sms-scheduling-mvp.md`
  - Document the new attendee-invite behavior in the MVP docs.

### Task 1: Add The Attendee Validation And Merge Helper

**Files:**
- Create: `lib/google/calendar-attendees.ts`
- Create: `scripts/google-calendar-attendees.test.mjs`

- [ ] **Step 1: Write the failing attendee-helper test**

```js
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
```

- [ ] **Step 2: Run the attendee-helper test to verify it fails**

Run:

```bash
node --experimental-strip-types --test scripts/google-calendar-attendees.test.mjs
```

Expected:

- FAIL with `Cannot find module .../lib/google/calendar-attendees.ts`

- [ ] **Step 3: Write the minimal attendee-helper implementation**

```ts
export type GoogleCalendarAttendee = {
  email: string;
};

const INVITE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hasInviteSuitableEmail(email: string | null | undefined) {
  if (typeof email !== "string") {
    return false;
  }

  return INVITE_EMAIL_PATTERN.test(email.trim());
}

export function requireInviteSuitableEmail(
  email: string | null | undefined,
  message = "Client email must be present and valid for Google Calendar invites.",
) {
  if (!hasInviteSuitableEmail(email)) {
    throw new Error(message);
  }

  return email.trim();
}

export function mergeClientAttendee(
  existing: GoogleCalendarAttendee[] | null | undefined,
  clientEmail: string,
) {
  const trimmedClientEmail = clientEmail.trim().toLowerCase();
  const normalized = (existing ?? []).filter(
    (attendee) => attendee && typeof attendee.email === "string" && attendee.email.trim(),
  );

  const hasClient = normalized.some(
    (attendee) => attendee.email.trim().toLowerCase() === trimmedClientEmail,
  );

  return hasClient
    ? normalized
    : [...normalized, { email: clientEmail.trim() }];
}
```

- [ ] **Step 4: Run the attendee-helper test to verify it passes**

Run:

```bash
node --experimental-strip-types --test scripts/google-calendar-attendees.test.mjs
```

Expected:

- PASS with `4 pass`

- [ ] **Step 5: Commit the attendee-helper slice**

```bash
git add lib/google/calendar-attendees.ts scripts/google-calendar-attendees.test.mjs
git commit -m "feat: add google calendar attendee helpers"
```

### Task 2: Extend The Google Client For Attendee Reads And Guest Updates

**Files:**
- Modify: `lib/google/client.ts`
- Create: `scripts/google-calendar-client-attendees.test.mjs`

- [ ] **Step 1: Write the failing Google-client request-shape test**

```js
import assert from "node:assert/strict";
import test from "node:test";

test("upsertGoogleCalendarEvent sends attendees and sendUpdates=all on create", async () => {
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ init, url: String(url) });

    if (String(url).includes("/token")) {
      return Response.json({ access_token: "token", expires_in: 3600 });
    }

    return Response.json({ id: "event-123" });
  };

  const { upsertGoogleCalendarEvent } = await import("../lib/google/client.ts");

  await upsertGoogleCalendarEvent(
    {
      access_token: "token",
      calendar_time_zone: "America/Toronto",
      google_calendar_id: "primary",
      provider: "google",
      refresh_token: "refresh",
      sync_enabled: true,
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
      trainer_id: "trainer-1",
    },
    {
      attendees: [{ email: "client@example.com" }],
      description: "Desc",
      endTime: "2026-04-21T16:00:00.000Z",
      startTime: "2026-04-21T15:00:00.000Z",
      timeZone: "America/Toronto",
      title: "Client · Strength",
    },
  );

  const request = requests.at(-1);
  assert.match(request.url, /sendUpdates=all/);
  assert.equal(request.init.method, "POST");

  const payload = JSON.parse(request.init.body);
  assert.deepEqual(payload.attendees, [{ email: "client@example.com" }]);
});

test("deleteGoogleCalendarEvent sends guest updates on delete", async () => {
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ init, url: String(url) });
    return new Response(null, { status: 204 });
  };

  const { deleteGoogleCalendarEvent } = await import("../lib/google/client.ts");

  await deleteGoogleCalendarEvent(
    {
      access_token: "token",
      calendar_time_zone: "America/Toronto",
      google_calendar_id: "primary",
      provider: "google",
      refresh_token: "refresh",
      sync_enabled: true,
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
      trainer_id: "trainer-1",
    },
    "event-123",
  );

  const request = requests.at(-1);
  assert.match(request.url, /sendUpdates=all/);
  assert.equal(request.init.method, "DELETE");
});
```

- [ ] **Step 2: Run the Google-client test to verify it fails**

Run:

```bash
node --experimental-strip-types --test scripts/google-calendar-client-attendees.test.mjs
```

Expected:

- FAIL because `attendees` are not included and `sendUpdates=all` is missing from the request URLs

- [ ] **Step 3: Implement attendee-aware Google client behavior**

```ts
import type { GoogleCalendarAttendee } from "@/lib/google/calendar-attendees";

type GoogleCalendarEventResponse = {
  attendees?: GoogleCalendarAttendee[];
  id?: string;
};

export async function getGoogleCalendarEvent(
  connection: TrainerCalendarConnection,
  eventId: string,
) {
  const accessToken = await ensureFreshGoogleAccessToken(connection);
  const calendarId = connection.google_calendar_id || "primary";

  return authorizedGoogleRequest<GoogleCalendarEventResponse>(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
}

export async function upsertGoogleCalendarEvent(
  connection: TrainerCalendarConnection,
  input: {
    attendees?: GoogleCalendarAttendee[];
    description: string;
    endTime: string;
    eventId?: string | null;
    startTime: string;
    timeZone: string;
    title: string;
  },
) {
  const accessToken = await ensureFreshGoogleAccessToken(connection);
  const calendarId = connection.google_calendar_id || "primary";
  const baseUrl = input.eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const url = new URL(baseUrl);
  url.searchParams.set("sendUpdates", "all");

  const body = await authorizedGoogleRequest<GoogleCalendarEventResponse>(
    accessToken,
    url.toString(),
    {
      body: JSON.stringify({
        attendees: input.attendees ?? [],
        description: input.description,
        end: {
          dateTime: input.endTime,
          timeZone: input.timeZone,
        },
        start: {
          dateTime: input.startTime,
          timeZone: input.timeZone,
        },
        summary: input.title,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: input.eventId ? "PATCH" : "POST",
    },
  );

  return {
    calendarId,
    eventId: body.id ?? null,
  };
}

export async function deleteGoogleCalendarEvent(
  connection: TrainerCalendarConnection,
  eventId: string,
) {
  const accessToken = await ensureFreshGoogleAccessToken(connection);
  const calendarId = connection.google_calendar_id || "primary";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  url.searchParams.set("sendUpdates", "all");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    method: "DELETE",
  });
}
```

- [ ] **Step 4: Run the Google-client test to verify it passes**

Run:

```bash
node --experimental-strip-types --test scripts/google-calendar-client-attendees.test.mjs
```

Expected:

- PASS with `2 pass`

- [ ] **Step 5: Commit the Google-client slice**

```bash
git add lib/google/client.ts scripts/google-calendar-client-attendees.test.mjs
git commit -m "feat: support google calendar attendees"
```

### Task 3: Add A Pure Calendar-Sync Contract Helper

**Files:**
- Create: `lib/google/calendar-sync-contract.ts`
- Create: `scripts/google-calendar-sync-contract.test.mjs`

- [ ] **Step 1: Write the failing sync-contract test**

```js
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
```

- [ ] **Step 2: Run the sync-contract test to verify it fails**

Run:

```bash
node --experimental-strip-types --test scripts/google-calendar-sync-contract.test.mjs
```

Expected:

- FAIL with `Cannot find module .../lib/google/calendar-sync-contract.ts`

- [ ] **Step 3: Implement the pure sync contract**

```ts
import {
  mergeClientAttendee,
  requireInviteSuitableEmail,
  type GoogleCalendarAttendee,
} from "@/lib/google/calendar-attendees";

export type CalendarSyncMutation =
  | {
      kind: "delete";
      sendUpdates: "all";
    }
  | {
      attendees: GoogleCalendarAttendee[];
      kind: "upsert";
      sendUpdates: "all";
    };

export function buildCalendarSyncMutation(input: {
  clientEmail: string | null | undefined;
  existingAttendees?: GoogleCalendarAttendee[] | null;
  sessionStatus: "scheduled" | "completed" | "cancelled" | "no_show";
}): CalendarSyncMutation {
  if (input.sessionStatus === "cancelled") {
    return {
      kind: "delete",
      sendUpdates: "all",
    };
  }

  const clientEmail = requireInviteSuitableEmail(input.clientEmail);

  return {
    attendees: mergeClientAttendee(input.existingAttendees, clientEmail),
    kind: "upsert",
    sendUpdates: "all",
  };
}
```

- [ ] **Step 4: Run the sync-contract test to verify it passes**

Run:

```bash
node --experimental-strip-types --test scripts/google-calendar-sync-contract.test.mjs
```

Expected:

- PASS with `3 pass`

- [ ] **Step 5: Commit the sync-contract slice**

```bash
git add lib/google/calendar-sync-contract.ts scripts/google-calendar-sync-contract.test.mjs
git commit -m "feat: add calendar sync attendee contract"
```

### Task 4: Add Early Invite Eligibility Checks For Dashboard And SMS Flows

**Files:**
- Create: `lib/google/client-invite-eligibility.ts`
- Create: `scripts/client-invite-eligibility.test.mjs`
- Modify: `lib/sessions.ts`
- Modify: `lib/sms/booking-service.ts`
- Modify: `lib/sms/session-lifecycle.ts`

- [ ] **Step 1: Write the failing invite-eligibility test**

```js
import assert from "node:assert/strict";
import test from "node:test";

test("assessClientInviteEligibility returns dashboard and SMS messages for invalid email", async () => {
  const { assessClientInviteEligibility } = await import("../lib/google/client-invite-eligibility.ts");

  const result = assessClientInviteEligibility("not-an-email");

  assert.deepEqual(result, {
    dashboardMessage:
      "This client needs a valid email before the session can sync Google Calendar invites.",
    kind: "ineligible",
    smsBookReply:
      "I can't book that yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
    smsRescheduleReply:
      "I can't move that session yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
    syncError:
      "Client email must be present and valid for Google Calendar invites.",
  });
});

test("assessClientInviteEligibility returns eligible for valid email", async () => {
  const { assessClientInviteEligibility } = await import("../lib/google/client-invite-eligibility.ts");

  assert.deepEqual(assessClientInviteEligibility("client@example.com"), {
    email: "client@example.com",
    kind: "eligible",
  });
});
```

- [ ] **Step 2: Run the invite-eligibility test to verify it fails**

Run:

```bash
node --experimental-strip-types --test scripts/client-invite-eligibility.test.mjs
```

Expected:

- FAIL with `Cannot find module .../lib/google/client-invite-eligibility.ts`

- [ ] **Step 3: Implement the invite-eligibility helper and wire it into dashboard and SMS flows**

```ts
import { hasInviteSuitableEmail } from "@/lib/google/calendar-attendees";

export type ClientInviteEligibility =
  | {
      email: string;
      kind: "eligible";
    }
  | {
      dashboardMessage: string;
      kind: "ineligible";
      smsBookReply: string;
      smsRescheduleReply: string;
      syncError: string;
    };

export function assessClientInviteEligibility(
  email: string | null | undefined,
): ClientInviteEligibility {
  if (!hasInviteSuitableEmail(email)) {
    return {
      dashboardMessage:
        "This client needs a valid email before the session can sync Google Calendar invites.",
      kind: "ineligible",
      smsBookReply:
        "I can't book that yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
      smsRescheduleReply:
        "I can't move that session yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
      syncError:
        "Client email must be present and valid for Google Calendar invites.",
    };
  }

  return {
    email: email.trim(),
    kind: "eligible",
  };
}
```

```ts
const clientUser = await getUserById(supabase, client.user_id);
const inviteEligibility = assessClientInviteEligibility(clientUser?.email ?? null);

if (inviteEligibility.kind === "ineligible") {
  throw new SessionCreateError(inviteEligibility.dashboardMessage, 400);
}
```

```ts
const client = await getTrainerClientById(
  supabase,
  context.trainer.id,
  existingSession.client_id,
);
const clientUser = client ? await getUserById(supabase, client.user_id) : null;
const inviteEligibility = assessClientInviteEligibility(clientUser?.email ?? null);

if (inviteEligibility.kind === "ineligible" && input.status === "scheduled") {
  throw new SessionUpdateError(inviteEligibility.dashboardMessage, 400);
}
```

```ts
export type SmsBookingOutcome =
  | {
      kind: "invite_email_required";
      replyBody: string;
    }
  | {
      kind: "booked";
      replyBody: string;
      sessionId: string;
    };
```

```ts
const inviteEligibility = assessClientInviteEligibility(context.clientUser.email);

if (inviteEligibility.kind === "ineligible") {
  return {
    kind: "invite_email_required",
    replyBody: inviteEligibility.smsBookReply,
  };
}
```

```ts
const inviteEligibility = assessClientInviteEligibility(context.clientUser.email);

if (inviteEligibility.kind === "ineligible") {
  return {
    kind: "invite_email_required" as const,
    offerSetId: null,
    replyBody: inviteEligibility.smsRescheduleReply,
  };
}
```

- [ ] **Step 4: Run the invite-eligibility test and lint the touched flow files**

Run:

```bash
node --experimental-strip-types --test scripts/client-invite-eligibility.test.mjs
npx eslint \
  lib/google/client-invite-eligibility.ts \
  lib/sessions.ts \
  lib/sms/booking-service.ts \
  lib/sms/session-lifecycle.ts
```

Expected:

- `2 pass` from the Node test
- ESLint exits with code 0

- [ ] **Step 5: Commit the invite-eligibility slice**

```bash
git add \
  lib/google/client-invite-eligibility.ts \
  scripts/client-invite-eligibility.test.mjs \
  lib/sessions.ts \
  lib/sms/booking-service.ts \
  lib/sms/session-lifecycle.ts
git commit -m "feat: guard scheduling flows on client invite eligibility"
```

### Task 5: Wire The Shared Calendar Sync Flow To The Attendee Contract

**Files:**
- Modify: `lib/google/calendar-sync.ts`

- [ ] **Step 1: Write the failing flow regression by extending the sync-contract test with update-path merge expectations**

```js
test("scheduled sessions with existing event guests keep those guests during attendee sync", async () => {
  const { buildCalendarSyncMutation } = await import("../lib/google/calendar-sync-contract.ts");

  const result = buildCalendarSyncMutation({
    clientEmail: "client@example.com",
    existingAttendees: [
      { email: "owner@example.com" },
      { email: "assistant@example.com" },
    ],
    sessionStatus: "scheduled",
  });

  assert.deepEqual(result.attendees, [
    { email: "owner@example.com" },
    { email: "assistant@example.com" },
    { email: "client@example.com" },
  ]);
});
```

- [ ] **Step 2: Run the sync-contract test to verify the merge rule is covered**

Run:

```bash
node --experimental-strip-types --test scripts/google-calendar-sync-contract.test.mjs
```

Expected:

- PASS after adding the new test coverage, proving the merge rule is locked before the live wiring changes

- [ ] **Step 3: Implement the live calendar-sync wiring**

```ts
import { buildCalendarSyncMutation } from "@/lib/google/calendar-sync-contract";
import { assessClientInviteEligibility } from "@/lib/google/client-invite-eligibility";
import {
  deleteGoogleCalendarEvent,
  getGoogleCalendarEvent,
  upsertGoogleCalendarEvent,
} from "@/lib/google/client";

const inviteEligibility = assessClientInviteEligibility(view.clientUser?.email ?? null);
if (inviteEligibility.kind === "ineligible" && session.status !== "cancelled") {
  throw new Error(inviteEligibility.syncError);
}

const syncMutation = buildCalendarSyncMutation({
  clientEmail:
    inviteEligibility.kind === "eligible"
      ? inviteEligibility.email
      : null,
  existingAttendees:
    session.calendar_external_id && session.status !== "cancelled"
      ? (await getGoogleCalendarEvent(connection, session.calendar_external_id)).attendees ?? []
      : [],
  sessionStatus: session.status,
});

if (syncMutation.kind === "delete") {
  if (session.calendar_external_id) {
    await deleteGoogleCalendarEvent(connection, session.calendar_external_id);
  }
} else {
  const event = await upsertGoogleCalendarEvent(connection, {
    attendees: syncMutation.attendees,
    description: buildCalendarEventDescription(view),
    endTime: new Date(
      new Date(session.scheduled_at).getTime() +
        session.duration_minutes * 60 * 1000,
    ).toISOString(),
    eventId: session.calendar_external_id ?? null,
    startTime: session.scheduled_at,
    timeZone,
    title: buildCalendarEventTitle(view),
  });
}
```

- [ ] **Step 4: Run the focused attendee test suite and lint the live sync file**

Run:

```bash
node --experimental-strip-types --test \
  scripts/google-calendar-attendees.test.mjs \
  scripts/google-calendar-client-attendees.test.mjs \
  scripts/google-calendar-sync-contract.test.mjs \
  scripts/client-invite-eligibility.test.mjs
npx eslint lib/google/calendar-sync.ts lib/google/client.ts
```

Expected:

- all focused Node tests pass
- ESLint exits with code 0

- [ ] **Step 5: Commit the live sync wiring**

```bash
git add lib/google/calendar-sync.ts
git commit -m "feat: sync client attendees to google calendar"
```

### Task 6: Update Docs And Run The Verification Checklist

**Files:**
- Modify: `docs/live-pilot-runbook.md`
- Modify: `docs/sms-scheduling-mvp.md`

- [ ] **Step 1: Confirm the docs do not yet mention attendee invites**

Run:

```bash
rg -n "attendee|invite email|cancellation email|google update email" \
  docs/live-pilot-runbook.md \
  docs/sms-scheduling-mvp.md
```

Expected:

- no relevant matches for the new attendee-invite behavior

- [ ] **Step 2: Add the new docs text**

```md
Expected result after booking:

- the trainer Google Calendar event includes the client as an attendee
- the client receives the Google invite email
```

```md
Expected result after reschedule:

- the existing Google event is updated in place
- the client receives the Google update email
```

```md
Expected result after cancel:

- the Google event is removed
- the client receives the Google cancellation email
```

```md
Google Calendar sync now creates real client attendee invites for connected
trainers. Dashboard and SMS session changes both use the same attendee-aware
calendar sync path.
```

- [ ] **Step 3: Re-run the docs grep and the focused attendee test suite**

Run:

```bash
rg -n "attendee|invite email|cancellation email|google update email" \
  docs/live-pilot-runbook.md \
  docs/sms-scheduling-mvp.md
node --experimental-strip-types --test \
  scripts/google-calendar-attendees.test.mjs \
  scripts/google-calendar-client-attendees.test.mjs \
  scripts/google-calendar-sync-contract.test.mjs \
  scripts/client-invite-eligibility.test.mjs
```

Expected:

- the grep now shows the new runbook and MVP references
- the focused attendee test suite still passes

- [ ] **Step 4: Run the manual verification checklist**

Run:

```bash
printf '%s\n' \
  "1. Create a dashboard session for a client with a real email." \
  "2. Confirm the trainer calendar event includes the client attendee." \
  "3. Confirm the client receives the Google invite email." \
  "4. Reschedule the session from the dashboard." \
  "5. Confirm the same event updates and the client receives the Google update email." \
  "6. Cancel the session." \
  "7. Confirm the event disappears and the client receives the cancellation email." \
  "8. Repeat the create/reschedule/cancel flow through SMS booking." \
  "9. Check sessions.calendar_sync_status and sessions.calendar_sync_error for the exercised rows."
```

Expected:

- the checklist prints cleanly and is ready to follow during live verification

- [ ] **Step 5: Commit the docs and verification slice**

```bash
git add docs/live-pilot-runbook.md docs/sms-scheduling-mvp.md
git commit -m "docs: add client calendar attendee verification"
```
