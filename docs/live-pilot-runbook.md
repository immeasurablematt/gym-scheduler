# Live Pilot Runbook

This runbook is for one supervised end-to-end SMS scheduling test against the
current live environment.

## Current live assumptions

- `TWILIO_WEBHOOK_URL` points at the public host currently receiving inbound SMS.
- `GOOGLE_CALENDAR_REDIRECT_URI` points at that same public host.
- Google Calendar is already connected in `/dashboard/settings`.
- The live trainer calendar connection is tied to trainer
  `11111111-1111-1111-1111-111111111111`.
- The live client SMS sender is the phone number currently stored on
  `users.id = 'client-preview-1'`.
- The client profile for `client-preview-1` has a valid email address so
  Google Calendar invites can be sent.
- SMS availability is currently configured for `America/Toronto`.
- Active availability templates are currently:
  - Monday to Friday
  - `09:00` to `17:00`
- `blocked_time_slots` is currently empty, so busy-time exclusion comes from:
  - existing non-cancelled `sessions`
  - the connected Google Calendar busy feed

## Before the supervised test

1. Keep the current public host alive for the full test window.
2. Run:

```bash
node scripts/twilio-webhook-smoke.mjs
```

Expected result:

- `GET .../api/twilio/inbound -> 405`
- `POST .../api/twilio/inbound -> 400 Missing MessageSid`
- `Twilio webhook smoke test passed.`

3. Open `/dashboard/settings` and confirm the Google Calendar card still shows
   `Connected`.
4. Confirm the test phone in `users.phone_number` for `client-preview-1` is the
   exact phone that will send the SMS.
5. Keep the test inside the current live window:
   - weekday
   - `09:00` to `17:00`
   - `America/Toronto`

## Important pilot caveat

The current environment is still running in preview mode without Clerk server
keys. That means dashboard routes are publicly reachable on the current host.

Use this setup only for a supervised pilot that you control directly.

Do not treat the current host as safe to share as a reusable trainer-facing app
URL until auth is enabled.

## Supervised flow

### 1. Send availability text

From the mapped client phone, send:

```text
Availability
```

Expected result:

- the client receives a numbered reply with up to 3 slots
- the reply should not include a slot that overlaps a live Google busy period
  or an existing scheduled session

Current real-world example of busy periods inside the configured weekday window:

- Friday, April 17, 2026 at `10:30 AM` to `11:30 AM` Toronto
- Friday, April 17, 2026 at `1:00 PM` to `2:00 PM` Toronto
- Friday, April 17, 2026 at `2:30 PM` to `4:00 PM` Toronto
- Tuesday, April 21, 2026 at `9:00 AM` to `10:30 AM` Toronto
- Tuesday, April 21, 2026 at `2:00 PM` to `3:30 PM` Toronto

If you run the test while those remain busy, those times should not be offered.

### 2. Book a slot

Reply with one of the offered numbers:

```text
1
```

Expected result:

- the client receives `You're booked for ...`
- a new `sessions` row is created with:
  - `status = 'scheduled'`
  - `calendar_sync_status = 'synced'`
- a new `session_changes` row is created with:
  - `change_type = 'created'`
  - `reason = 'Booked via SMS'`
- the session appears on the trainer Google Calendar
- the trainer Google Calendar event includes the client as an attendee
- the client receives the Google invite email

### 3. Verify busy-time exclusion

After the first booking lands, send:

```text
Availability
```

Expected result:

- the just-booked time is not offered again
- any overlapping Google Calendar busy interval is still excluded

If you want a stronger proof, create or keep one obvious Google Calendar event
inside the weekday `09:00` to `17:00` window, then confirm that exact interval
is omitted from the SMS options.

### 4. Verify free-text exact-time booking

From the mapped client phone, send:

```text
Monday at 2
```

Expected result:

- if the exact slot is open, the client receives `You're booked for ...`
- a new `sessions` row is created for that exact requested time
- `session_changes.reason = 'Booked via SMS'`
- the session syncs to Google Calendar
- the trainer Google Calendar event includes the client as an attendee
- the client receives the Google invite email

If that exact slot is not open in the current live window, the app should reply
with up to 3 numbered alternatives instead of silently failing.

### 5. Reschedule

Send:

```text
Reschedule
```

If there is more than one upcoming scheduled session, the app will first reply
with session choices. Reply with the number of the session to move, then reply
with the number of the new offered time.

Expected result:

- the client receives `Your session is moved to ...`
- the target `sessions` row keeps the same `id` and gets a new `scheduled_at`
- `sms_booking_offers.flow_type = 'reschedule'`
- `sms_booking_offers.target_session_id` points at the moved session
- a `session_changes` row is created with:
  - `change_type = 'rescheduled'`
  - `reason = 'Rescheduled via SMS'`
- the existing Google event is updated in place
- the client receives the Google update email

### 6. Cancel

Send:

```text
Cancel
```

If there is more than one upcoming scheduled session, the app will first reply
with session choices. Reply with the number of the session to cancel.

Expected result:

- the client receives `Your session for ... is cancelled.`
- the target `sessions` row is updated to:
  - `status = 'cancelled'`
  - `calendar_sync_status = 'synced'`
- the Google event is removed
- the client receives the Google cancellation email
- a `session_changes` row is created with:
  - `change_type = 'cancelled'`
  - `reason = 'Cancelled via SMS'`

## What to inspect if something fails

### If the client gets no reply

Check:

- Twilio Console message logs for the inbound webhook attempt
- app logs for `/api/twilio/inbound`
- `sms_webhook_idempotency`
- `sms_messages`

Likely causes:

- `TWILIO_WEBHOOK_URL` does not exactly match the public webhook URL
- Twilio is pointing at an old host
- the public host is down

### If the webhook reaches the app but the sender is treated as unknown

Check:

- `users.id = 'client-preview-1'`
- `users.phone_number`
- `clients.user_id = 'client-preview-1'`
- `clients.trainer_id`

Likely cause:

- the real test phone does not match the phone stored on the client user

### If availability returns no times

Check:

- `availability_templates`
- `blocked_time_slots`
- `sessions`
- `trainer_calendar_connections`
- `trainer_calendar_connections.last_sync_error`

Likely causes:

- no active availability templates
- the requested window is fully blocked by sessions or Google busy time
- Google token refresh failed

### If booking, reschedule, or cancel does not sync to Google

Check:

- `sessions.calendar_sync_status`
- `sessions.calendar_sync_error`
- `calendar_sync_jobs`
- `trainer_calendar_connections.last_sync_error`
- app logs for `[google-calendar]`

Likely causes:

- expired or revoked Google refresh token
- public host/env mismatch after an ngrok URL change
- transient Google API failure

### If reschedule or cancel prompts the wrong session choice flow

Check:

- `sms_conversations`
- `sms_booking_offers`
- upcoming `sessions` for the client

The app intentionally switches into a choose-one-first flow when the client has
multiple upcoming sessions.
