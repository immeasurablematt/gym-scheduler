# Trainer SMS MVP Plan

This plan is intentionally narrow so a fresh session can execute it with very little human input.

## Phase 1: Lock The Logging Contract

Add the minimum schema needed to distinguish trainer notifications from client-facing SMS.

Expected changes:

- new migration under `supabase/migrations/`
- `types/supabase.ts`

Recommended schema additions on `sms_messages`:

- `audience`
- `message_kind`
- `source_change_id`

Decisions:

- keep the current table rather than creating a separate trainer notifications table
- do not add a queue or retry table in MVP
- keep changes additive so existing SMS logs continue to work

## Phase 2: Add A Focused Trainer Notification Helper

Create a dedicated helper that owns:

- trainer destination lookup
- body formatting
- best-effort sending
- lightweight dedupe based on the originating change when possible

Expected changes:

- new `lib/sms/trainer-notifications.ts`
- small extension in `lib/sms/twilio-sender.ts`

The helper should:

- resolve trainer user phone through `trainers.user_id -> users.phone_number`
- validate and normalize the destination
- no-op cleanly when the trainer phone is missing
- write outbound logs with `audience='trainer'`

## Phase 3: Wire The Real Mutation Hook Points

Hook the helper only into committed SMS-driven session mutations.

Expected changes:

- `lib/sms/booking-service.ts`
- `lib/sms/session-lifecycle.ts`

Exact hook points:

- `createSmsBookedSession`
- `rescheduleSessionFromOffer`
- `cancelSessionBySms`

Behavior:

- send only after the session change and `session_changes` insert succeed
- keep trainer SMS best-effort and non-blocking
- do not touch `lib/sms/orchestrator.ts` unless a small shared utility becomes necessary

## Phase 4: Keep Reporting Clean

Prevent trainer alerts from polluting the current client-SMS dashboard.

Expected changes:

- `lib/sms/dashboard.ts`

Behavior:

- client-facing counts and recent-message queries should filter to client audience rows
- no new dashboard UI is required for MVP

## Phase 5: Verify Narrowly

Run the smallest high-value verification set:

- lint
- one successful book path
- one successful reschedule path
- one successful cancel path
- one missing-trainer-phone path that skips send without breaking the session mutation

Suggested verification approach:

- use the current code paths and existing SMS fixture strategy
- do not broaden into a full scheduling audit
- confirm trainer rows are logged distinctly from client rows

## Likely Implementation Order For A Swarm

These tasks can be split with minimal conflict:

1. schema and generated type updates
2. trainer notification helper and sender extension
3. mutation hook wiring in SMS booking and lifecycle files
4. dashboard filtering cleanup
5. verification and final integration review

The mutation-hook task should remain serialized because it touches overlapping flow logic.

## Human Decisions Already Locked

To minimize questions from a fresh session, these decisions are already made:

- scope is client SMS `book`, `reschedule`, and `cancel` only
- no dashboard/manual trainer SMS in MVP
- no Google reverse-sync notifications
- no new secrets
- trainer phone source is `users.phone_number`
- skip and log if trainer phone is missing
- keep `lib/sessions.ts` out of scope unless a true blocker appears
