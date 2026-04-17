# Trainer SMS MVP Spec

This doc defines the narrow first version of trainer-notification SMS.

The goal is to notify a trainer by SMS when a client successfully changes a real session by SMS, without broadening scope into dashboard notifications, reverse calendar sync, or unrelated scheduling refactors.

## MVP Goal

Send a trainer-facing SMS when a client successfully:

- books a session by SMS
- reschedules a session by SMS
- cancels a session by SMS

The implementation should stay additive, reuse the current Twilio sender and SMS logging flow, and avoid unnecessary edits to `lib/sessions.ts`.

## Out Of Scope

- trainer SMS for dashboard or manual schedule changes
- trainer SMS for Google Calendar-only or reverse-sync-driven changes
- new retry queues or a full notification jobs system
- notification preference UI or opt-in logic
- changes to the existing client-facing SMS conversational flow beyond what is required to trigger trainer notifications

## Current Codebase Hook Points

These are the exact places where the MVP should trigger trainer SMS, because they represent committed session mutations rather than conversational prompts:

- `lib/sms/booking-service.ts`
  - `createSmsBookedSession`
- `lib/sms/session-lifecycle.ts`
  - `rescheduleSessionFromOffer`
  - `cancelSessionBySms`

These are intentionally better hook points than `lib/sms/orchestrator.ts`, which handles intent parsing and reply generation but does not guarantee a real session change occurred.

## Trigger Decisions

Trainer SMS should send only for:

- client SMS booking
- client SMS reschedule
- client SMS cancel

Trainer SMS should not send for:

- dashboard or manual schedule edits
- Google Calendar sync job processing
- SMS prompts that do not end in a successful session mutation
- failed or conflicted offer selections

## Recipient And Destination Source

The recipient is the trainer assigned to the client in the existing scheduling model.

The destination phone number should come from:

- `clients.trainer_id`
- `trainers.user_id`
- `users.phone_number`

This keeps destination lookup inside the existing data model and avoids introducing a new secret or a trainer-specific env var.

## Rollout Dependency

The trainer user must have a real `users.phone_number` value in the backing database.

If the trainer phone number is missing or invalid:

- do not fail the session mutation
- skip the outbound trainer SMS
- log the setup issue clearly in the outbound message record or server log

## Message Shapes

All labels should use the existing slot formatting helper and SMS time zone configuration.

### Book

`Gym Scheduler: {clientName} booked {newSlotLabel} via SMS. No reply needed.`

### Reschedule

`Gym Scheduler: {clientName} moved from {oldSlotLabel} to {newSlotLabel} via SMS. No reply needed.`

### Cancel

`Gym Scheduler: {clientName} cancelled {slotLabel} via SMS. No reply needed.`

## Google Calendar Decision

Google Calendar alone is enough for trainer-initiated dashboard changes, because the trainer already made the change and the calendar event is updated by the existing sync flow.

Trainer SMS is still required for client-initiated SMS changes, because those are remote actions the trainer did not directly perform.

The current codebase does not implement reverse Google Calendar sync into `sessions`, so Google-driven changes are not part of the MVP.

## Failure Handling

Trainer SMS is best-effort and non-blocking.

Required behavior:

- Only attempt the trainer SMS after the session write succeeds.
- Do not roll back the session change if the trainer SMS send fails.
- Do not break the client-facing SMS flow because a secondary trainer notification fails.
- Log the failure so it is visible for debugging.

## Retries And Idempotency

No automatic retry queue in MVP.

Idempotency should be lightweight and additive:

- send from the committed mutation hook points only once per successful mutation
- attach the originating `session_changes` row to the trainer SMS log record when possible
- if needed, use that linkage to guard against accidental duplicate sends in the same code path

The MVP should not introduce a new queue modeled after `calendar_sync_jobs` unless the implementation discovers a concrete need.

## Logging And Reporting

Trainer notifications should not be mixed blindly into the existing client SMS dashboard feed.

The recommended logging additions on `sms_messages` are:

- `audience`
  - `client`
  - `trainer`
- `message_kind`
  - `conversation`
  - `book`
  - `reschedule`
  - `cancel`
- `source_change_id`
  - nullable foreign key to `session_changes.id`

The current dashboard at `lib/sms/dashboard.ts` should continue to report client-SMS activity by filtering to client-facing rows.

## Schema And Config Impact

### Schema

Recommended additive schema changes:

- add `audience` to `sms_messages`
- add `message_kind` to `sms_messages`
- add `source_change_id` to `sms_messages`

### Env

No new secret is required for MVP.

The implementation should reuse the existing Twilio sender configuration:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

### Dashboard

Minimum dashboard impact:

- filter existing client SMS views and counts so trainer alerts do not inflate client-facing reporting
- no new dashboard screen is required for MVP

## Likely Files

Expected implementation files:

- new `lib/sms/trainer-notifications.ts`
- `lib/sms/booking-service.ts`
- `lib/sms/session-lifecycle.ts`
- `lib/sms/twilio-sender.ts`
- `lib/sms/dashboard.ts`
- `types/supabase.ts`
- new Supabase migration under `supabase/migrations/`

Avoid changing:

- `lib/sessions.ts`, unless a blocker is discovered that truly requires it

## MVP Success Criteria

The MVP is complete when:

- a successful client SMS book sends one trainer SMS
- a successful client SMS reschedule sends one trainer SMS
- a successful client SMS cancel sends one trainer SMS
- missing trainer phone numbers do not break the underlying session change
- trainer SMS rows are distinguishable from client SMS rows in logging and dashboard queries
