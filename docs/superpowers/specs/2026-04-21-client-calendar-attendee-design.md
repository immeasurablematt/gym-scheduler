# Client Calendar Attendee Design

**Date:** April 21, 2026

## Goal

When the app syncs a session to the trainer's Google Calendar, add the client
as a real Google Calendar attendee so the client receives Google invite,
update, and cancellation emails for that session.

## Current Baseline

The current repo already has one shared Google Calendar sync path:

- dashboard/manual session creation calls `syncSessionToCalendar(...)` after
  `createTrainerSession(...)`
- dashboard/manual session updates call `syncSessionToCalendar(...)` after
  `updateTrainerSession(...)`
- SMS booking calls `syncSessionToCalendar(...)` after inserting the session
- SMS reschedule calls `syncSessionToCalendar(...)` after updating the session
- SMS cancel calls `syncSessionToCalendar(...)` after marking the session
  cancelled
- `syncSessionToCalendar(...)` currently delegates to
  `upsertGoogleCalendarEvent(...)` for scheduled sessions and
  `deleteGoogleCalendarEvent(...)` for cancelled sessions
- the Google event payload currently includes summary, description, start, end,
  and time zone, but no attendees

The Google connection model is already trainer-scoped through
`trainer_calendar_connections`, not Gabe-specific.

## Approaches Considered

### 1. Recommended: add attendees in the existing shared calendar sync flow

- keep one Google event per session on the trainer calendar
- add the client attendee in the same Google write path that already handles
  create, update, reschedule, and cancel
- let Google send real invite/update/cancellation emails

Trade-offs:

- best consistency across dashboard and SMS paths
- lowest architectural churn because it reuses the current sync flow
- highest immediate user-visible impact because all connected trainers will send
  real client invites once enabled

### 2. Booking-only attendee sync

- add attendees only for the SMS booking lifecycle
- leave dashboard/manual trainer-created sessions unchanged

Trade-offs:

- smaller functional surface area
- creates inconsistent product behavior for the same session model
- adds special-case rules to a codebase that already funnels all sync through
  one shared path

### 3. Gabe-only or trainer-specific behavior

- make attendee invites conditional on a specific trainer or pilot path

Trade-offs:

- lower short-term rollout exposure
- product behavior becomes trainer-specific without a structural need
- increases long-term cleanup cost and makes the sync layer less coherent

## Recommendation

Use approach 1.

This should be a generalized trainer-calendar feature that applies to all
trainers with a connected Google Calendar, because the existing architecture is
already per-trainer and the current sync pipeline is shared across dashboard and
SMS session mutations.

If rollout caution is needed later, use operational rollout discipline or a
temporary flag, but do not bake trainer-specific business logic into the core
design.

## Approved Product Decisions

- attendee syncing applies to all session lifecycle changes that already sync to
  Google Calendar:
  - dashboard/manual create
  - dashboard/manual update
  - SMS booking
  - SMS reschedule
  - SMS cancel
- the source of truth for the client email is the linked `users.email` record
  for the session's client
- a client email is required for the client to participate in this system
- the feature uses a real invite model, not silent attendee bookkeeping
- Google should send emails for create, update/reschedule, and cancel
- attendee correctness is part of the definition of calendar-sync success
- a trainer-only Google event is not an acceptable fallback for a session that
  should have a client attendee
- this should work for all trainers with a connected Google Calendar, not only
  Gabe

## In Scope

- adding the client as a Google Calendar attendee on session create and update
- preserving attendee behavior across reschedules and other session edits
- deleting the event with guest notifications on cancellation
- validating invite-suitable client email before or during sync
- surfacing attendee-sync failures through the existing sync status and retry
  system
- additive docs and verification updates for the new invite behavior

## Out Of Scope

- reverse sync from Google Calendar back into `sessions`
- multi-attendee product design beyond the session client
- broad calendar-sync refactors unrelated to attendees
- adding new user-facing settings for invite preferences in this slice
- replacing the existing retry/job model

## Lifecycle Behavior

### Create

For any newly scheduled session that reaches Google sync:

- create the trainer calendar event
- include the client email in `attendees`
- request Google guest-update emails
- store the returned Google event id as usual

Expected user-visible result:

- the trainer sees the event on their connected calendar
- the client receives a Google invite email

### Reschedule Or Other Updates

For a scheduled session that already has a Google event:

- patch the existing event instead of creating a new one
- keep the client attendee attached
- request Google update emails

Expected user-visible result:

- the trainer event moves or updates in place
- the client receives the corresponding Google update email

### Cancel

For a cancelled session with an existing Google event:

- delete the event from the trainer calendar
- request Google cancellation emails for attendees

Expected user-visible result:

- the trainer event disappears
- the client receives the Google cancellation

## Source Of Truth For Client Email

The canonical attendee email should come from:

1. `sessions.client_id`
2. `clients.user_id`
3. `users.email`

This design should not add a duplicate session-level email field and should not
snapshot the email onto the session record for this feature.

Why:

- the repo already models identity data in `users`
- duplicating the email would create sync drift without solving a current
  product problem
- the current calendar sync flow already loads the client and linked user data

## Email Suitability Rules

The system contract is that a client must have an invite-suitable email to
participate.

Recommended policy:

- guard earlier where practical so new scheduled-session writes do not proceed
  for clients with a missing or obviously malformed email
- if a legacy or inconsistent row still reaches calendar sync for a non-cancelled
  session, fail the sync job loudly instead of creating or patching a trainer-only
  event

For this slice, "invite-suitable" should remain intentionally narrow:

- non-empty after trim
- passes a reasonable application-level email format check

This slice should not attempt domain-level deliverability checks, MX lookups, or
special-case provider heuristics.

## Google API Behavior

The Google Calendar event write should become attendee-aware:

- create writes should include `attendees`
- update writes should include `attendees`
- cancellation should delete the event with guest updates enabled

This feature should use Google's real guest email behavior:

- create: send guest invite/update emails
- update/reschedule: send guest update emails
- delete: send guest cancellation emails

The current OAuth scopes are already sufficient for this design. The repo
already requests:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/calendar.readonly`

No scope or auth-flow change is required for attendee writes in this slice.

## Attendee Merge Rule

The design must account for Google event patch behavior around array fields.

If the app starts sending `attendees` on patch, a naive implementation could
overwrite any existing non-client attendees on the event.

Recommended rule:

- on event creation, write the canonical client attendee directly
- on event update where `calendar_external_id` already exists, fetch the current
  Google event first
- merge the canonical client attendee into the existing attendee list
- preserve any non-client attendees already on the event
- then patch the full merged attendee array together with the updated event
  fields

This keeps the design additive and avoids silently dropping other guests that
may have been added outside the app.

## Failure Semantics

### Session Mutation vs Calendar Sync

Session creation or update should continue to commit before calendar sync, just
as it does today.

If attendee-aware Google sync fails after the session row already exists:

- do not roll back the session write
- mark the sync job failed
- record the error on the session and trainer connection as the current flow
  already does
- rely on the existing retry path in `calendar_sync_jobs`

### Invalid Client Email

For a non-cancelled session, invalid or missing client email should be treated
as a hard sync failure.

Required behavior:

- do not create a new Google event without the attendee
- do not patch an existing event into a trainer-only state
- set a clear error message indicating the client email must be fixed

### Cancellation

If deleting the Google event fails, keep the sync in failed state and retry
through the existing job queue. Cancellation email delivery is part of the same
success contract.

## Sync Success Definition

After this feature ships, `sessions.calendar_sync_status = 'synced'` should mean:

- the Google event exists and matches the current session state for scheduled
  sessions, or has been deleted for cancelled sessions
- the canonical client attendee state on that Google event is correct for
  scheduled sessions
- the Google write completed with guest updates enabled for the relevant action

## Likely File Touchpoints

Exact likely file touchpoints for implementation:

- [lib/google/calendar-sync.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/google/calendar-sync.ts)
- [lib/google/client.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/google/client.ts)
- [lib/sessions.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sessions.ts)
- [lib/sms/booking-service.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/booking-service.ts)
- [lib/sms/session-lifecycle.ts](/Users/mbaggetta/my-project/gym-scheduler/lib/sms/session-lifecycle.ts)
- [app/api/google/calendar/connect/route.ts](/Users/mbaggetta/my-project/gym-scheduler/app/api/google/calendar/connect/route.ts)
- [app/api/google/calendar/callback/route.ts](/Users/mbaggetta/my-project/gym-scheduler/app/api/google/calendar/callback/route.ts)
- [docs/live-pilot-runbook.md](/Users/mbaggetta/my-project/gym-scheduler/docs/live-pilot-runbook.md)
- [docs/sms-scheduling-mvp.md](/Users/mbaggetta/my-project/gym-scheduler/docs/sms-scheduling-mvp.md)

Expected implementation responsibilities by file:

- `lib/google/calendar-sync.ts`
  - derive the canonical client attendee email from the loaded session view
  - enforce sync-time validation
  - pass attendee-aware input into the Google client layer
- `lib/google/client.ts`
  - extend event create/update/delete helpers for attendees and guest-update
    behavior
  - add a helper to read an existing Google event when merge-safe attendee patch
    behavior is needed
- `lib/sessions.ts`
  - add early validation for trainer-created dashboard session writes where that
    validation can be expressed cleanly
- `lib/sms/booking-service.ts`
  - verify SMS-created sessions still rely on the same shared sync contract
  - add early validation only if needed beyond the shared session/calendar path
- `lib/sms/session-lifecycle.ts`
  - verify reschedule and cancel continue to route through the shared sync path
  - add early validation only where the flow can fail cleanly before mutation
- docs
  - update operational expectations and live verification steps for attendee
    invites

## Data Model And Config Impact

No schema change is required for the core feature.

Why:

- the client email already exists on `users.email`
- sync status and retry state already exist on `sessions` and
  `calendar_sync_jobs`
- trainer Google connection state already exists on
  `trainer_calendar_connections`

No new Google OAuth scope or environment variable is required for this slice.

## Rollout Risks

### User-Visible Invite Traffic

As soon as the feature is live, real Google guest emails will go out for create,
reschedule/update, and cancellation. This is the biggest user-visible rollout
risk.

### Legacy Or Dirty Client Email Data

Bad existing client email data could turn into repeated sync failures for
otherwise valid session writes until the underlying user record is fixed.

### Attendee Overwrite Risk

If update logic sends a fresh one-item `attendees` array without a merge step,
the app could accidentally remove non-client attendees already on the event.

### Existing Partial-Write Risk

The current sync architecture already has a general risk where Google accepts a
write but the app fails before persisting local sync state. This feature does
not create that risk, but it increases the importance of clear retry and manual
inspection during rollout.

## Testing Strategy

### Automated

- focused tests for client-email validation rules
- `lib/google/client.ts` tests with mocked `fetch` verifying:
  - create writes include attendees and guest-update behavior
  - update writes include attendees and guest-update behavior
  - delete calls use guest-update behavior
- `lib/google/calendar-sync.ts` tests covering:
  - scheduled create with valid client email
  - scheduled update/reschedule with valid client email
  - cancellation with existing event id
  - non-cancelled session failure when client email is invalid
  - attendee merge behavior preserving non-client attendees
- regression checks that existing no-attendee calendar sync behavior does not
  regress for non-connected trainers or missing connection cases

### Manual / Live Verification

For a trainer with a connected Google Calendar and a client with a real email:

1. create a session from the dashboard
2. verify the trainer calendar event includes the client as an attendee
3. verify the client receives the Google invite email
4. reschedule the session from the dashboard
5. verify the same Google event updates and the client receives the update email
6. cancel the session
7. verify the Google event is removed and the client receives the cancellation
8. repeat the core flow through SMS booking, SMS reschedule, and SMS cancel
9. verify `sessions.calendar_sync_status = 'synced'` for successful cases
10. verify `sessions.calendar_sync_error` is populated for intentionally invalid
    client-email cases

## Implementation Notes

- keep the design additive
- prefer reusing the current `syncSessionToCalendar(...)` flow instead of adding
  a parallel invite path
- avoid unrelated refactors
- preserve the current behavior for trainers who do not have Google Calendar
  connected

## Success Criteria

This design is successful when:

- every session path that currently syncs to Google Calendar continues to use
  the same shared sync flow
- scheduled sessions synced to Google Calendar include the client as an attendee
- Google sends the expected invite/update/cancellation emails
- invalid client email causes a clear, visible sync failure instead of a silent
  trainer-only event
- cancel, reschedule, and dashboard/manual-created sessions behave consistently
  with SMS-created sessions
