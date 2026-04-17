# Hands-Off Scheduling Handoff

This doc is the exact handoff for finishing the remaining rollout work from the current repo state.

It has two parts:

1. a fresh-session prompt you can paste into a new Codex session
2. a manual setup guide for the external steps only you can do

## Fresh Session Prompt

Paste the prompt below into a fresh session:

```text
Continue work in `/Users/mbaggetta/my-project/gym-scheduler`.

Start by inspecting the current repo state and the latest implementation before changing anything.

Context you should verify from the repo:
- Next.js App Router + Supabase
- Twilio inbound webhook exists at `/api/twilio/inbound`
- SMS booking MVP already worked for known clients
- additive Google Calendar + SMS cancel/reschedule groundwork has now been implemented in the repo
- new Google-related routes exist at:
  - `/api/google/calendar/connect`
  - `/api/google/calendar/callback`
  - `/api/internal/calendar-sync`
- new schema work should exist for:
  - `trainer_calendar_connections`
  - `calendar_sync_jobs`
  - `sms_conversations`
  - session calendar sync fields
  - `sms_booking_offers.flow_type`
  - `sms_booking_offers.target_session_id`

Your job in this fresh session:
1. Inspect the repo and confirm the current implementation state from code, not assumptions.
2. Verify what has already been completed for:
   - Google Calendar OAuth
   - calendar sync jobs
   - live trainer busy-time overlay
   - SMS reschedule
   - SMS cancellation
3. Verify whether the external/manual setup has been completed in this environment:
   - Supabase migration applied
   - env vars present
   - Google OAuth redirect configured
   - trainer Google Calendar connected
   - cron caller for `/api/internal/calendar-sync` set up
   - Twilio webhook still pointed correctly
4. If anything external is still missing, stop and give one short exact checklist with no ambiguity.
5. If the external setup is complete, run the highest-value verification path end to end:
   - confirm Google connection status in the settings flow
   - confirm calendar sync job execution works
   - verify session create/update/cancel sync behavior
   - verify SMS availability respects live busy time
   - verify SMS reschedule flow
   - verify SMS cancellation flow
6. Fix any code issues you find during verification, staying additive and avoiding unnecessary edits to `lib/sessions.ts`.

Constraints:
- keep logic inside the current app and Supabase model unless there is a strong reason not to
- prefer additive changes
- do not revert unrelated work
- audit first, then act
- be explicit about any user-visible behavior changes

Success criteria:
- either the hands-off scheduling flow is verified through the current implementation
- or the remaining blocker list is reduced to exact external setup tasks only

Important files to inspect early:
- `docs/hands-off-scheduling-handoff.md`
- `docs/live-sms-next-steps.md`
- `docs/sms-scheduling-mvp.md`
- `supabase/migrations/20260416210000_google_calendar_and_sms_conversation_state.sql`
- `app/api/twilio/inbound/route.ts`
- `app/api/google/calendar/connect/route.ts`
- `app/api/google/calendar/callback/route.ts`
- `app/api/internal/calendar-sync/route.ts`
- `lib/google/calendar-sync.ts`
- `lib/sms/orchestrator.ts`
- `lib/sms/session-lifecycle.ts`
- `lib/sms/availability-engine.ts`
- `app/dashboard/settings/page.tsx`
```

## Manual Setup Guide

These are the exact things only you can do manually so a fresh session can take over the rest.

### 1. Apply the new Supabase migration

The app now depends on:

- `trainer_calendar_connections`
- `calendar_sync_jobs`
- `sms_conversations`
- new `sessions` calendar sync columns
- new `sms_booking_offers` reschedule columns

Apply this file to the live project:

- [supabase/migrations/20260416210000_google_calendar_and_sms_conversation_state.sql](/Users/mbaggetta/my-project/gym-scheduler/supabase/migrations/20260416210000_google_calendar_and_sms_conversation_state.sql:1)

If you are doing it in the Supabase SQL Editor:

1. Open your Supabase project.
2. Open SQL Editor.
3. Paste the full contents of that migration file.
4. Run it successfully.

When done, you can tell me:

`I applied 20260416210000_google_calendar_and_sms_conversation_state.sql`

### 2. Put the required env vars in `.env.local` or your deployment env

These values are now required for Google Calendar sync:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALENDAR_REDIRECT_URI=https://gym-scheduler-umber.vercel.app/api/google/calendar/callback
CALENDAR_SYNC_CRON_SECRET=choose_a_long_random_secret
```

Twilio and Supabase still need to be present too:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
TWILIO_WEBHOOK_URL=https://gym-scheduler-umber.vercel.app/api/twilio/inbound
```

Use a real long random string for `CALENDAR_SYNC_CRON_SECRET`.

When done, you can tell me:

`Google, Twilio, and Supabase env vars are set`

### 3. Create or confirm the Google OAuth credentials

You need a Google Cloud OAuth client for the trainer calendar connection.

What to create:

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Choose the correct project.
3. Go to `APIs & Services` -> `Enabled APIs & services`.
4. Enable `Google Calendar API` if it is not already enabled.
5. Go to `APIs & Services` -> `Credentials`.
6. Create or open an `OAuth 2.0 Client ID`.
7. Add this exact authorized redirect URI:

`https://gym-scheduler-umber.vercel.app/api/google/calendar/callback`

That exact value must match `GOOGLE_CALENDAR_REDIRECT_URI`.

When done, you can tell me:

`Google OAuth redirect URI is configured`

### 4. Make sure the app is reachable on the public host you will actually use

The current implementation expects the real public app URL for both integrations.

You need:

- Twilio inbound webhook:
  `https://gym-scheduler-umber.vercel.app/api/twilio/inbound`
- Google OAuth callback:
  `https://gym-scheduler-umber.vercel.app/api/google/calendar/callback`

If you are testing locally through a tunnel, use the tunnel URL consistently.

When done, you can tell me:

`The public host is ready`

### 5. Connect the trainer Google Calendar in the app

Once the env vars and OAuth redirect are correct:

1. Start the app on the same host that matches `GOOGLE_CALENDAR_REDIRECT_URI`.
2. Sign in as the trainer account.
3. Open `/dashboard/settings`.
4. Click `Connect Google Calendar`.
5. Finish the Google consent flow.
6. Return to the settings page and confirm it shows connected state.

This step stores the trainer-specific OAuth tokens in Supabase.

When done, you can tell me:

`The trainer Google Calendar is connected`

### 6. Set up a caller for the calendar sync job route

The app now exposes:

`POST /api/internal/calendar-sync`

It requires:

`Authorization: Bearer <CALENDAR_SYNC_CRON_SECRET>`

You need some scheduler to call it regularly in production.

Any scheduler is fine if it can make authenticated HTTPS POST requests. Examples:

- Vercel Cron calling a server route
- GitHub Actions on a schedule
- UptimeRobot or another webhook scheduler
- your hosting provider’s cron facility

Recommended cadence:

- every 1 to 5 minutes

Minimal request shape:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_CALENDAR_SYNC_CRON_SECRET" \
  "https://gym-scheduler-umber.vercel.app/api/internal/calendar-sync"
```

When done, you can tell me:

`The calendar sync cron caller is set up`

### 7. Confirm Twilio is still pointed at the correct inbound route

The Twilio number should still use:

`https://gym-scheduler-umber.vercel.app/api/twilio/inbound`

And `TWILIO_WEBHOOK_URL` must match that same exact value.

When done, you can tell me:

`Twilio is pointed at the live inbound webhook`

## The Short Message To Send After Manual Setup

Once you finish the manual work, send exactly this in the next session if it is true:

```text
I applied 20260416210000_google_calendar_and_sms_conversation_state.sql.
Google, Twilio, and Supabase env vars are set.
Google OAuth redirect URI is configured.
The public host is ready.
The trainer Google Calendar is connected.
The calendar sync cron caller is set up.
Twilio is pointed at the live inbound webhook.
```

At that point, a fresh session should be able to verify the remaining flow and finish the rollout work without ambiguity.
