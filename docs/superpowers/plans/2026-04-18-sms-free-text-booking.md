# SMS Free-Text Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic free-text SMS booking path so a known client can text a specific time like `Monday at 2`, have the app auto-book that exact slot if available, or receive numbered alternatives if it is unavailable.

**Architecture:** Add a pure requested-time parser, extend the availability search path so it can start from a requested anchor time, and route parsed free-text requests through a new booking-service branch that reuses the existing booking write path and offer-set path. Keep cancel, reschedule, and numbered booking behavior unchanged, and do not introduce an agent or schema change.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Twilio, Google Calendar sync, existing SMS availability engine, Node test runner, ESLint.

---

### Task 1: Add The Deterministic Requested-Time Parser

**Files:**
- Create: `lib/sms/requested-time-parser.ts`
- Create: `scripts/sms-requested-time-parser.test.mjs`

- [ ] **Step 1: Write the failing parser test**

```js
import assert from "node:assert/strict";
import test from "node:test";

test("parses weekday shorthand like monday at 2 as a requested time", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "can you do monday at 2?",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.equal(result.kind, "requested_time");
  assert.equal(result.startsAt, "2026-04-20T18:00:00.000Z");
});

test("parses tomorrow with explicit am/pm", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "tomorrow 11am",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.equal(result.kind, "requested_time");
});

test("rejects vague phrases that are out of scope", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "after work next week",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.equal(result.kind, "not_requested_time");
});

test("flags off-interval minute values instead of rounding", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "monday 2:15 pm",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.equal(result.kind, "invalid_requested_time");
});
```

- [ ] **Step 2: Run the parser test to verify it fails**

Run:

```bash
node --experimental-strip-types --test scripts/sms-requested-time-parser.test.mjs
```

Expected:

- FAIL with `Cannot find module .../lib/sms/requested-time-parser.ts`

- [ ] **Step 3: Write the minimal parser implementation**

```ts
import { getPlainDateInTimeZone, zonedLocalDateTimeToUtc } from "@/lib/sms/timezone";

export type RequestedSmsTimeParseResult =
  | { kind: "not_requested_time" }
  | { kind: "invalid_requested_time"; reason: "off_interval" | "ambiguous_hour" }
  | { kind: "requested_time"; startsAt: string };

export function parseRequestedSmsTime(input: {
  body: string;
  now: Date;
  slotIntervalMinutes: number;
  timeZone: string;
}): RequestedSmsTimeParseResult {
  const normalized = input.body.trim().toLowerCase();
  const parsed = tryParseSupportedPattern(normalized, input);

  if (!parsed) {
    return { kind: "not_requested_time" };
  }

  if (parsed.minute % input.slotIntervalMinutes !== 0) {
    return { kind: "invalid_requested_time", reason: "off_interval" };
  }

  if (parsed.isAmbiguousHour) {
    return { kind: "invalid_requested_time", reason: "ambiguous_hour" };
  }

  return {
    kind: "requested_time",
    startsAt: zonedLocalDateTimeToUtc(
      parsed.date,
      parsed.hour,
      parsed.minute,
      input.timeZone,
    ).toISOString(),
  };
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

Run:

```bash
node --experimental-strip-types --test scripts/sms-requested-time-parser.test.mjs
```

Expected:

- PASS with `4 pass`

- [ ] **Step 5: Commit the parser slice**

```bash
git add lib/sms/requested-time-parser.ts scripts/sms-requested-time-parser.test.mjs
git commit -m "feat: add sms requested-time parser"
```

### Task 2: Add Time-Zone Anchor Support For Requested-Time Searches

**Files:**
- Modify: `lib/sms/timezone.ts`
- Modify: `lib/sms/availability-engine.ts`
- Create: `scripts/sms-timezone-anchor.test.mjs`

- [ ] **Step 1: Write the failing anchor-date test**

```js
import assert from "node:assert/strict";
import test from "node:test";

test("getPlainDateInTimeZone returns the date for an arbitrary anchor", async () => {
  const { getPlainDateInTimeZone } = await import("../lib/sms/timezone.ts");

  const result = getPlainDateInTimeZone(
    new Date("2026-04-20T02:30:00.000Z"),
    "America/Toronto",
  );

  assert.deepEqual(result, {
    day: 19,
    month: 4,
    year: 2026,
  });
});
```

- [ ] **Step 2: Run the anchor-date test to verify it fails**

Run:

```bash
node --experimental-strip-types --test scripts/sms-timezone-anchor.test.mjs
```

Expected:

- FAIL because `getPlainDateInTimeZone` does not exist yet

- [ ] **Step 3: Implement the time-zone anchor helper and requested search start**

```ts
export function getPlainDateInTimeZone(date: Date, timeZone: string): PlainDate {
  const parts = getPartsInTimeZone(date, timeZone);
  return {
    day: parts.day,
    month: parts.month,
    year: parts.year,
  };
}

export function getCurrentPlainDateInTimeZone(timeZone: string): PlainDate {
  return getPlainDateInTimeZone(new Date(), timeZone);
}
```

```ts
type FindAvailableSmsSlotsOptions = {
  clientId: string;
  durationMinutes: number;
  ignoredSessionIds?: string[];
  maxSlots: number;
  searchDays: number;
  searchStartAt?: string;
  slotIntervalMinutes: number;
  timeZone: string;
  trainerAvailableHours: Json | null;
  trainerId: string;
};

const baseline = options.searchStartAt
  ? new Date(Math.max(Date.now(), new Date(options.searchStartAt).getTime()))
  : new Date();
const searchEnd = new Date(
  baseline.getTime() + searchDays * 24 * 60 * 60 * 1000,
).toISOString();
const today = getPlainDateInTimeZone(baseline, timeZone);
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
node --experimental-strip-types --test scripts/sms-timezone-anchor.test.mjs
```

Expected:

- PASS with `1 pass`

- [ ] **Step 5: Commit the anchor-search slice**

```bash
git add lib/sms/timezone.ts lib/sms/availability-engine.ts scripts/sms-timezone-anchor.test.mjs
git commit -m "feat: add requested-time search anchors"
```

### Task 3: Add Exact Requested-Time Booking To The Booking Service

**Files:**
- Modify: `lib/sms/booking-service.ts`
- Test: `scripts/sms-requested-time-parser.test.mjs`

- [ ] **Step 1: Extend the parser test with a real booking-path expectation stub**

```js
test("parses can you do monday at 2 so the booking flow can consume it", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const parsed = parseRequestedSmsTime({
    body: "can you do monday at 2?",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.equal(parsed.kind, "requested_time");
  assert.equal(parsed.startsAt, "2026-04-20T18:00:00.000Z");
});
```

- [ ] **Step 2: Run the focused tests before changing booking logic**

Run:

```bash
node --experimental-strip-types --test \
  scripts/sms-requested-time-parser.test.mjs \
  scripts/sms-timezone-anchor.test.mjs
```

Expected:

- PASS before the service change, confirming the parser contract is stable

- [ ] **Step 3: Add `bookRequestedSmsTime` to `lib/sms/booking-service.ts`**

```ts
export type RequestedSmsTimeOutcome =
  | { kind: "not_requested_time" }
  | { kind: "invalid_requested_time"; replyBody: string }
  | { kind: "booked"; replyBody: string; sessionId: string }
  | { kind: "offered_alternatives"; offerSetId: string; replyBody: string }
  | { kind: "calendar_unavailable"; replyBody: string };

export async function bookRequestedSmsTime(
  context: SmsKnownClientContext,
  body: string,
  inboundMessageId: string | null,
): Promise<RequestedSmsTimeOutcome> {
  const config = getSmsRuntimeConfig();
  const parsed = parseRequestedSmsTime({
    body,
    now: new Date(),
    slotIntervalMinutes: config.slotIntervalMinutes,
    timeZone: config.timeZone,
  });

  if (parsed.kind === "not_requested_time") {
    return parsed;
  }

  if (parsed.kind === "invalid_requested_time") {
    return {
      kind: "invalid_requested_time",
      replyBody:
        "I couldn't use that exact time. Text something like 'Monday 2 PM', 'tomorrow at 11 AM', or 'Apr 22 at 1:30 PM'.",
    };
  }

  const candidateSlots = await findAvailableSmsSlots({
    clientId: context.client.id,
    durationMinutes: config.sessionDurationMinutes,
    maxSlots: config.maxSlotsOffered,
    searchDays: config.searchDays,
    searchStartAt: parsed.startsAt,
    slotIntervalMinutes: config.slotIntervalMinutes,
    timeZone: config.timeZone,
    trainerAvailableHours: context.trainer.available_hours,
    trainerId: context.trainer.id,
  });

  if (candidateSlots[0]?.startsAt === parsed.startsAt) {
    const session = await createSmsBookedSession(context, parsed.startsAt);
    return {
      kind: "booked",
      replyBody: `You're booked for ${formatSlotLabel(parsed.startsAt, config.timeZone)}. See you then.`,
      sessionId: session.id,
    };
  }

  if (candidateSlots.length === 0) {
    return {
      kind: "invalid_requested_time",
      replyBody:
        "I couldn't find an opening around that time. Text availability and I'll send a fresh set of options.",
    };
  }

  await expirePendingOfferSets(context.client.id, context.trainer.id);
  const offerSet = await createSmsOfferSet({
    clientId: context.client.id,
    expiresAt: new Date(Date.now() + config.offerExpiryHours * 60 * 60 * 1000).toISOString(),
    offeredByMessageId: inboundMessageId,
    slots: candidateSlots,
    timeZone: config.timeZone,
    trainerId: context.trainer.id,
  });

  return {
    kind: "offered_alternatives",
    offerSetId: offerSet.offerSetId,
    replyBody: buildRequestedTimeUnavailableReply(parsed.startsAt, candidateSlots),
  };
}
```

- [ ] **Step 4: Run the focused tests and lint after the booking-service change**

Run:

```bash
node --experimental-strip-types --test \
  scripts/sms-requested-time-parser.test.mjs \
  scripts/sms-timezone-anchor.test.mjs
npx eslint lib/sms/booking-service.ts lib/sms/requested-time-parser.ts lib/sms/availability-engine.ts lib/sms/timezone.ts
```

Expected:

- tests PASS
- eslint exits `0`

- [ ] **Step 5: Commit the booking-service slice**

```bash
git add lib/sms/booking-service.ts lib/sms/requested-time-parser.ts lib/sms/availability-engine.ts lib/sms/timezone.ts scripts/sms-requested-time-parser.test.mjs scripts/sms-timezone-anchor.test.mjs
git commit -m "feat: support exact free-text sms bookings"
```

### Task 4: Route Free-Text Requests Before Generic Availability Matching

**Files:**
- Modify: `lib/sms/orchestrator.ts`

- [ ] **Step 1: Read the current decision order and write the branch insertion**

```ts
import {
  bookRequestedSmsTime,
  bookSmsOfferSelection,
  extractOfferSelection,
  offerAvailabilityBySms,
} from "@/lib/sms/booking-service";
```

```ts
  if (looksLikeCancellation(body)) {
    const outcome = await handleSmsCancelIntent(context.value, inboundMessageId);
    return { body: outcome.replyBody, offerSetId: null };
  }

  if (looksLikeReschedule(body)) {
    const outcome = await handleSmsRescheduleIntent(context.value, inboundMessageId);
    return {
      body: outcome.replyBody,
      offerSetId: "offerSetId" in outcome ? outcome.offerSetId : null,
    };
  }

  const requestedTimeOutcome = await bookRequestedSmsTime(
    context.value,
    body,
    inboundMessageId,
  );

  if (requestedTimeOutcome.kind === "booked") {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: null,
    };
  }

  if (requestedTimeOutcome.kind === "offered_alternatives") {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: requestedTimeOutcome.offerSetId,
    };
  }

  if (
    requestedTimeOutcome.kind === "invalid_requested_time" ||
    requestedTimeOutcome.kind === "calendar_unavailable"
  ) {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: null,
    };
  }
```

- [ ] **Step 2: Run lint after updating the orchestrator**

Run:

```bash
npx eslint lib/sms/orchestrator.ts lib/sms/booking-service.ts
```

Expected:

- eslint exits `0`

- [ ] **Step 3: Commit the routing-order slice**

```bash
git add lib/sms/orchestrator.ts lib/sms/booking-service.ts
git commit -m "feat: route sms requested times before availability fallback"
```

### Task 5: Update Docs And Verify The Full Flow

**Files:**
- Modify: `docs/sms-scheduling-mvp.md`
- Modify: `docs/live-pilot-runbook.md`

- [ ] **Step 1: Update the docs with the new free-text behavior**

```md
- Clients can also request a specific time by text, for example `Monday 2 PM`
- If that exact slot is available, the app books it immediately
- If it is unavailable, the app replies with up to 3 numbered alternatives
```

```md
### 1A. Free-text requested time

From the mapped client phone, send:

    Monday at 2

Expected result:

- if the exact slot is available, the client receives `You're booked for ...`
- if the exact slot is unavailable, the client receives numbered alternatives
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
node --experimental-strip-types --test \
  scripts/sms-requested-time-parser.test.mjs \
  scripts/sms-timezone-anchor.test.mjs \
  scripts/twilio-webhook-smoke.test.mjs
npx eslint \
  lib/sms/requested-time-parser.ts \
  lib/sms/timezone.ts \
  lib/sms/availability-engine.ts \
  lib/sms/booking-service.ts \
  lib/sms/orchestrator.ts
node scripts/twilio-webhook-smoke.mjs --base-url=https://gym-scheduler-umber.vercel.app
```

Expected:

- all focused tests PASS
- eslint exits `0`
- smoke test prints:
  - `GET .../api/twilio/inbound -> 405`
  - `POST .../api/twilio/inbound -> 400 Missing MessageSid`

- [ ] **Step 3: Run the live manual verification from the real client phone**

Manual checks:

1. Text `Availability` and confirm the normal numbered flow still works.
2. Text an actually open time such as `Monday at 2` and confirm immediate booking.
3. Verify the new `sessions` row in Supabase.
4. Verify `session_changes.reason = 'Booked via SMS'`.
5. Verify the session syncs to Google Calendar.
6. Text an unavailable exact time and confirm the app replies with numbered alternatives instead of silence.

- [ ] **Step 4: Commit the docs and verification slice**

```bash
git add docs/sms-scheduling-mvp.md docs/live-pilot-runbook.md
git commit -m "docs: add sms free-text booking verification"
```

## Self-Review Notes

- Spec coverage:
  - deterministic parser: Task 1
  - requested-time search anchor: Task 2
  - immediate exact booking: Task 3
  - unavailable-time alternatives: Task 3
  - orchestrator routing order: Task 4
  - docs and live verification: Task 5
- Placeholder scan:
  - no unresolved placeholders remain
- Type consistency:
  - `bookRequestedSmsTime` is introduced once and reused consistently
  - `parseRequestedSmsTime` contract is defined once and reused consistently

## Fresh-Session Execution Notes

- Run this plan from a new worktree, not the current dirty tree.
- Safe parallelism:
  - parser helper + parser tests
  - docs updates
- Serialized implementation:
  - availability-engine search anchor
  - booking-service exact requested-time flow
  - orchestrator routing order
