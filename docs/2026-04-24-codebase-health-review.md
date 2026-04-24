# GymScheduler Codebase Health Review

**Date:** April 24, 2026

## Executive Summary

The codebase is stronger than a prototype in the SMS and calendar lane, but it
has repo hygiene debt around verification, database schema history, and product
story drift.

The real product wedge is clear: Twilio SMS intake, booking, reschedule, cancel,
and Google Calendar sync for personal trainers. That area has meaningful
safeguards:

- signed Twilio webhook handling in
  [`app/api/twilio/inbound/route.ts`](../app/api/twilio/inbound/route.ts)
- webhook idempotency in
  [`lib/sms/supabase-idempotency.ts`](../lib/sms/supabase-idempotency.ts)
- SMS intake and scheduling orchestration in
  [`lib/sms/orchestrator.ts`](../lib/sms/orchestrator.ts)
- calendar sync jobs in
  [`lib/google/calendar-sync.ts`](../lib/google/calendar-sync.ts)
- focused regression tests across `scripts/*.test.mjs` and `lib/sms/*.test.ts`

The highest-value next move is not a broad refactor. It is a hardening pass that
makes verification reliable, closes production auth footguns, and reconciles the
database baseline.

## Current Repo State Observed

At review time:

- Branch: `main`
- Remote state: `main` matched `origin/main`
- Dirty state: one untracked doc,
  [`docs/2026-04-21-competitor-analysis.md`](2026-04-21-competitor-analysis.md)
- Existing worktrees:
  - `.worktrees/overnight-bug-sweep-system`
  - `.worktrees/sms-exact-time-reschedule`
  - `.worktrees/sms-free-text-booking`
  - `.worktrees/trainer-sms-mvp`

## Verification Results

Commands run during the review:

```bash
npm run build
npx tsc --noEmit --pretty false
npx eslint app lib components scripts
npm run lint
node --experimental-strip-types --experimental-test-module-mocks --test scripts/*.test.mjs lib/sms/*.test.ts
```

Results:

- `npm run build` passed.
- `npx tsc --noEmit --pretty false` passed.
- `npx eslint app lib components scripts` passed.
- `npm run lint` failed because ESLint scanned generated build output under
  nested `.worktrees/.../.next` folders.
- The broad Node test command reported 96 passing tests and 6 failures. The
  failures were import/alias-resolution problems in the test runner, not
  business-logic assertion failures.

## Strengths

### SMS And Calendar Logic Is Real

The strongest shipped surface is the operational SMS flow:

- known clients can request availability
- clients can book numbered slot offers
- clients can book some exact requested times
- clients can cancel and reschedule by SMS
- unknown senders can enter intake before trainer approval
- calendar sync remains a projection of `sessions`, not the canonical scheduler

This is the right architecture for the product wedge. `sessions` remains the
source of truth, while Google Calendar is a synced output and live busy-time
input.

### Webhook Handling Has The Right Shape

[`app/api/twilio/inbound/route.ts`](../app/api/twilio/inbound/route.ts)
does the important things:

- verifies Twilio signatures
- requires `MessageSid`
- reserves the webhook event before processing
- returns an immediate empty TwiML response
- processes the heavier SMS flow after the response

That is a good reliability pattern for Twilio.

### The Code Has Focused Regression Tests

The repo already has tests around the riskiest areas:

- requested-time parsing
- SMS timezone behavior
- SMS intake state
- receptionist agent guardrails
- OpenAI receptionist runner behavior
- calendar attendee sync contract
- exact-time reschedule paths
- trainer notification hooks

That coverage is valuable. The problem is discoverability and repeatability:
there is no single reliable `npm test` or `npm run verify`.

## Main Risks

### 1. Verification Is Too Easy To Run Incorrectly

[`package.json`](../package.json) only exposes:

```json
"scripts": {
  "dev": "next dev --turbopack",
  "build": "next build --turbopack",
  "start": "next start",
  "lint": "eslint"
}
```

There is no `test`, `typecheck`, or `verify` script. As a result, future changes
depend on people remembering one-off commands from prior sessions.

`npm run lint` also fails in the current repo because
[`eslint.config.mjs`](../eslint.config.mjs) ignores only root generated folders,
not nested worktree generated folders.

Recommended fix:

- add `typecheck`
- add `test`
- add `verify`
- constrain `lint` to real source files or ignore `.worktrees/**`
- document the exact command that gates a release

### 2. Production Auth Can Fail Open If Env Is Misconfigured

[`middleware.ts`](../middleware.ts) skips Clerk entirely when Clerk keys are
missing:

```ts
if (!hasClerkServerKeys) {
  return NextResponse.next()
}
```

That is convenient for local preview, but risky in production. Server code uses
the Supabase service role through
[`lib/supabase/server.ts`](../lib/supabase/server.ts), and several routes depend
on application-level auth checks.

Recommended fix:

- keep preview/open-access mode for local development only
- fail closed in production when Clerk keys are missing
- add a small test or smoke check proving production cannot run unauthenticated
  by accident

### 3. The Database Baseline Is Not Trustworthy For Fresh Setup

[`supabase/schema.sql`](../supabase/schema.sql) appears to contain duplicate SMS
history:

- `sms_offer_status` is declared twice with different values
- `sms_messages` is declared twice with different shapes
- legacy `sms_slot_offers` and current `sms_booking_offers` both appear
- older unrelated Slack/raid migrations remain under `supabase/migrations`

Live production may still be fine because migrations were applied incrementally,
but a fresh database setup from the checked-in baseline is not trustworthy.

Recommended fix:

- decide whether migrations or `schema.sql` is the source for fresh setup
- regenerate or hand-reconcile `schema.sql`
- separate or archive unrelated legacy migrations if they are not part of
  GymScheduler
- add a schema smoke test that can validate a clean database bootstrap

### 4. The Public Story Overclaims Compared With The Shipped Product

[`app/page.tsx`](../app/page.tsx) still markets broad all-in-one gym software:

- AI-powered scheduling
- Stripe payments
- 3D gym visualization
- broad analytics

Several routes are still placeholders:

- [`app/dashboard/analytics/page.tsx`](../app/dashboard/analytics/page.tsx)
- [`app/dashboard/payments/page.tsx`](../app/dashboard/payments/page.tsx)
- [`app/dashboard/gym-view/page.tsx`](../app/dashboard/gym-view/page.tsx)
- [`app/onboarding/page.tsx`](../app/onboarding/page.tsx)

Recommended fix:

- reposition the landing page around the shipped wedge: SMS-first scheduling and
  intake for trainers
- hide or clearly de-emphasize placeholder product areas until they are real
- update README claims so they match the current app

### 5. Some Core Files Are Becoming Too Large

The largest hotspots are:

- [`lib/sms/orchestrator.ts`](../lib/sms/orchestrator.ts), around 1,555 lines
- [`lib/sessions.ts`](../lib/sessions.ts), around 1,093 lines
- [`lib/sms/session-lifecycle.ts`](../lib/sms/session-lifecycle.ts), around 913
  lines

Do not do a giant cleanup refactor for its own sake. Instead, when new work
touches one of these areas, peel out one narrow module at a time with tests.

## Recommended Next Branch

Create one hardening branch with this exact scope:

1. Add reliable repo-level verification scripts.
2. Fix ESLint ignores so generated worktree output cannot break `npm run lint`.
3. Add a production-only auth guard so missing Clerk keys do not fail open.
4. Update README development commands to match reality.

Suggested branch name:

```text
codex/codebase-hardening-verify-auth
```

Suggested verification target after that branch:

```bash
npm run verify
```

Do the database baseline cleanup as a separate branch. It is important, but it
has higher migration risk and should not be mixed with the verification/auth
hardening pass.
