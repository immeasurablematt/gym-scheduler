# Trainer SMS Swarm Handoff

This doc is the exact prework and kickoff package for executing the trainer SMS MVP in a fresh session with minimal human intervention.

It has three parts:

1. the prework checklist
2. the exact fresh-session prompt
3. the files a new session should inspect first

## Prework Checklist

Complete these items before kicking off the fresh session:

### 1. Start From A Fresh Worktree

Do not run the implementation from the current dirty worktree.

The current repo has unrelated local changes in `scripts/`, so the fresh session should start in a new worktree and branch.

Recommended target:

- worktree: `.worktrees/trainer-sms-mvp`
- branch: `codex/trainer-sms-mvp`

### 2. Use These Docs As Source Of Truth

The fresh session should treat these docs as the approved scope:

- [trainer-sms-mvp-spec.md](/Users/mbaggetta/my-project/gym-scheduler/docs/trainer-sms-mvp-spec.md)
- [trainer-sms-mvp-plan.md](/Users/mbaggetta/my-project/gym-scheduler/docs/trainer-sms-mvp-plan.md)
- [trainer-sms-swarm-handoff.md](/Users/mbaggetta/my-project/gym-scheduler/docs/trainer-sms-swarm-handoff.md)

### 3. Confirm Existing Runtime Secrets Exist

No new secret is required for MVP.

The fresh session can rely on the existing SMS runtime setup:

- Supabase env
- Twilio env

The session should not print or expose secret values in chat.

### 4. Know The Live Rollout Dependency

The trainer phone number may still be missing in the live database.

That is not a blocker to implementation, because the MVP should skip and log when the trainer phone is missing.

It is a blocker to proving a real live trainer SMS send end to end.

### 5. Keep Scope Locked

The fresh session should not ask to reopen these decisions unless it finds a real blocker:

- only client SMS `book`, `reschedule`, and `cancel`
- no dashboard/manual trainer SMS
- no Google reverse-sync notifications
- no broad audit
- additive changes only
- avoid unnecessary edits to `lib/sessions.ts`

## Fresh Session Prompt

Paste the prompt below into a fresh session:

```text
Continue work in `/Users/mbaggetta/my-project/gym-scheduler`, but do not work from the current dirty tree.

Start by creating or switching into a fresh git worktree at `.worktrees/trainer-sms-mvp` on branch `codex/trainer-sms-mvp`.

Use these docs as the approved source of truth:
- `docs/trainer-sms-mvp-spec.md`
- `docs/trainer-sms-mvp-plan.md`
- `docs/trainer-sms-swarm-handoff.md`

Work autonomously with minimal questions.

Use subagents where write scopes are disjoint, but keep overlapping SMS mutation work serialized.

Goal:
Implement the narrow MVP for trainer-notification SMS.

Hard constraints:
- additive changes only
- no broad audit
- do not implement trainer-notification SMS for dashboard or manual schedule changes
- do not implement Google-driven reverse-sync notifications
- avoid unnecessary edits to `lib/sessions.ts`
- do not expose secrets in chat
- preserve unrelated local changes

Approved MVP decisions:
- send trainer SMS only for successful client SMS `book`, `reschedule`, and `cancel`
- resolve trainer destination from `trainers.user_id -> users.phone_number`
- if trainer phone is missing or invalid, skip send and log setup issue
- trainer SMS is best-effort and non-blocking
- no retry queue in MVP
- distinguish trainer vs client SMS in `sms_messages`, using fields such as `audience`, `message_kind`, and `source_change_id`
- keep the current dashboard and reporting filtered to client-facing SMS rows

Exact hook points:
- `lib/sms/booking-service.ts`
  - `createSmsBookedSession`
- `lib/sms/session-lifecycle.ts`
  - `rescheduleSessionFromOffer`
  - `cancelSessionBySms`

Likely files:
- new `lib/sms/trainer-notifications.ts`
- `lib/sms/booking-service.ts`
- `lib/sms/session-lifecycle.ts`
- `lib/sms/twilio-sender.ts`
- `lib/sms/dashboard.ts`
- `types/supabase.ts`
- new Supabase migration

Message shapes:
- book: `Gym Scheduler: {clientName} booked {newSlotLabel} via SMS. No reply needed.`
- reschedule: `Gym Scheduler: {clientName} moved from {oldSlotLabel} to {newSlotLabel} via SMS. No reply needed.`
- cancel: `Gym Scheduler: {clientName} cancelled {slotLabel} via SMS. No reply needed.`

Execution requirements:
1. Inspect the current implementation before changing anything.
2. Implement the MVP only.
3. Keep trainer SMS best-effort and non-blocking.
4. Do not let trainer-notification failures break the existing client SMS success path.
5. Run `npm run lint` and any focused verification needed for the new behavior.
6. Summarize exact files changed, final behavior, and any rollout dependency still remaining.

Known rollout dependency:
- the live trainer `users.phone_number` may still be missing, so production end-to-end proof may require that row to be populated after implementation
```

## Inspect Early

The fresh session should inspect these files early:

- [docs/trainer-sms-mvp-spec.md](/Users/mbaggetta/my-project/gym-scheduler/docs/trainer-sms-mvp-spec.md)
- [docs/trainer-sms-mvp-plan.md](/Users/mbaggetta/my-project/gym-scheduler/docs/trainer-sms-mvp-plan.md)
- [lib/sms/booking-service.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/booking-service.ts:1)
- [lib/sms/session-lifecycle.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/session-lifecycle.ts:1)
- [lib/sms/twilio-sender.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/twilio-sender.ts:1)
- [lib/sms/dashboard.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/dashboard.ts:1)
- [lib/sms/message-log.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/message-log.ts:1)
- [types/supabase.ts](/Users/mbaggetta/my-project/gym-scheduler/types/supabase.ts:1)
- [supabase/schema.sql](/Users/mbaggetta/my-project/gym-scheduler/supabase/schema.sql:156)

## Expected Human Intervention

If the implementation follows the approved scope, the fresh session should not need human intervention except for:

- deciding whether to populate the trainer phone number in the live database before rollout verification
- applying the new migration in whichever environment you want to test
- approving any change only if the session finds a real blocker that conflicts with the locked MVP decisions
