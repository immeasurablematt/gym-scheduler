# SMS Free-Text Booking Swarm Handoff

This doc is the exact kickoff package for implementing deterministic free-text
SMS booking in a fresh session with swarm/subagents.

It has three parts:

1. the prework checklist
2. the exact fresh-session prompt
3. the files a new session should inspect first

## Prework Checklist

### 1. Start From A Fresh Worktree

Do not implement this from the current dirty worktree.

Recommended target:

- worktree: `.worktrees/sms-free-text-booking`
- branch: `codex/sms-free-text-booking`

### 2. Use These Docs As Source Of Truth

The fresh session should treat these docs as the approved scope:

- [2026-04-18-sms-free-text-booking-design.md](/Users/mbaggetta/my-project/gym-scheduler/docs/superpowers/specs/2026-04-18-sms-free-text-booking-design.md)
- [2026-04-18-sms-free-text-booking.md](/Users/mbaggetta/my-project/gym-scheduler/docs/superpowers/plans/2026-04-18-sms-free-text-booking.md)
- [sms-free-text-swarm-handoff.md](/Users/mbaggetta/my-project/gym-scheduler/docs/sms-free-text-swarm-handoff.md)

### 3. Keep Scope Locked

The fresh session should not reopen these decisions unless it finds a real
blocker:

- no agent or LLM in the booking path
- exact parsed available slots book immediately
- unavailable exact requests return numbered alternatives
- cancel and reschedule remain on their current deterministic flows
- no schema change unless implementation proves one is necessary
- additive changes only
- no broad audit
- avoid unnecessary edits to `lib/sessions.ts`

### 4. Know The Live Constraints

The live Twilio webhook is already serving from:

- `https://gym-scheduler-umber.vercel.app/api/twilio/inbound`

The fresh session should not print or expose secrets in chat.

### 5. Swarm Safely

Use subagents only where write scopes are disjoint.

Safe parallel slices:

- `lib/sms/requested-time-parser.ts`
- parser test scripts
- docs updates

Keep these serialized:

- `lib/sms/availability-engine.ts`
- `lib/sms/booking-service.ts`
- `lib/sms/orchestrator.ts`

## Fresh Session Prompt

Paste the prompt below into a fresh session:

```text
Continue work in `/Users/mbaggetta/my-project/gym-scheduler`, but do not work from the current dirty tree.

Start by creating or switching into a fresh git worktree at `.worktrees/sms-free-text-booking` on branch `codex/sms-free-text-booking`.

Use these docs as the approved source of truth:
- `docs/superpowers/specs/2026-04-18-sms-free-text-booking-design.md`
- `docs/superpowers/plans/2026-04-18-sms-free-text-booking.md`
- `docs/sms-free-text-swarm-handoff.md`

Use swarm/subagents where write scopes are disjoint, but keep overlapping SMS mutation work serialized.

Goal:
Implement deterministic free-text SMS booking so a known client can text a specific requested time like `Monday at 2`, have the app auto-book it if available, or receive numbered alternatives if it is unavailable.

Hard constraints:
- additive changes only
- no broad audit
- no agent or LLM in the booking path
- do not change the current explicit `Cancel` and `Reschedule` flows
- avoid unnecessary edits to `lib/sessions.ts`
- do not expose secrets in chat
- preserve unrelated local changes

Approved MVP decisions:
- support narrow deterministic parsing only
- support weekday + time, relative day + time, and explicit month/day + time
- support `Monday at 2` shorthand by interpreting bare hours `1` through `7` as PM
- require AM/PM for other bare-hour requests
- if the exact parsed slot is available, book immediately and send confirmation
- if the exact parsed slot is unavailable, send up to 3 alternatives from the requested time forward and reuse the existing numbered booking flow
- if the request is too ambiguous, send a clear format hint or fall back cleanly

Likely files:
- new `lib/sms/requested-time-parser.ts`
- `lib/sms/timezone.ts`
- `lib/sms/availability-engine.ts`
- `lib/sms/booking-service.ts`
- `lib/sms/orchestrator.ts`
- new `scripts/sms-requested-time-parser.test.mjs`
- new `scripts/sms-timezone-anchor.test.mjs`
- `docs/sms-scheduling-mvp.md`
- `docs/live-pilot-runbook.md`

Execution requirements:
1. Inspect the current implementation before changing anything.
2. Follow the plan task-by-task with TDD where practical.
3. Keep the booking authority deterministic.
4. Do not let the new branch break `Availability`, `1/2/3`, `Cancel`, or `Reschedule`.
5. Run focused tests, lint, and the Twilio webhook smoke test before claiming completion.
6. Summarize exact files changed, exact commands run, and whether live rollout requires anything beyond deploy + retest.
```

## Inspect Early

The fresh session should inspect these files early:

- [2026-04-18-sms-free-text-booking-design.md](/Users/mbaggetta/my-project/gym-scheduler/docs/superpowers/specs/2026-04-18-sms-free-text-booking-design.md)
- [2026-04-18-sms-free-text-booking.md](/Users/mbaggetta/my-project/gym-scheduler/docs/superpowers/plans/2026-04-18-sms-free-text-booking.md)
- [lib/sms/orchestrator.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/orchestrator.ts:1)
- [lib/sms/booking-service.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/booking-service.ts:1)
- [lib/sms/availability-engine.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/availability-engine.ts:1)
- [lib/sms/timezone.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/timezone.ts:1)
- [lib/sms/conversation-service.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/conversation-service.ts:1)
- [docs/sms-scheduling-mvp.md](/Users/mbaggetta/my-project/gym-scheduler/docs/sms-scheduling-mvp.md:1)
- [docs/live-pilot-runbook.md](/Users/mbaggetta/my-project/gym-scheduler/docs/live-pilot-runbook.md:1)

## Expected Human Intervention

If the implementation follows the approved scope, the fresh session should not
need human intervention except for:

- confirming any product call only if the session finds a real ambiguity that
  conflicts with the locked MVP decisions
- deploying the finished branch if the session cannot do that automatically
- sending the final live verification SMS from the real client phone
