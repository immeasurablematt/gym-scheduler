## SMS Scheduling MVP

This MVP keeps booking inside the current Next.js app and the current Supabase-backed scheduling model.
Google Calendar sync now creates real client attendee invites for connected
trainers. Dashboard and SMS session changes both use the same attendee-aware
calendar sync path.

### In scope

- Known existing clients only
- Sender phone number must map to an existing client profile
- Each client books only with their assigned trainer
- SMS can request availability, or text a specific requested time like `Monday at 2`
- If that exact requested slot is available, the app auto-books it immediately
- If that exact requested slot is unavailable, the app replies with up to 3 numbered alternatives
- Explicit `Cancel` and `Reschedule` flows remain unchanged
- Successful booking writes a real `sessions` row and `session_changes` row
- Booking, reschedule, and cancel syncs include the client as a Google Calendar attendee when the trainer has a connected calendar and the client has a valid email address
- Unknown senders and booking conflicts receive clean SMS responses
- Inbound and outbound SMS are logged in Supabase
- Twilio webhooks are signature-verified, ACKed immediately, and deduplicated by `MessageSid`

### Workflow

1. Twilio posts an inbound SMS webhook to the app.
2. The route verifies the `X-Twilio-Signature`, reserves the `MessageSid`, and returns an empty TwiML response immediately.
3. After the response is flushed, the app logs the inbound message and resolves the sender phone number to a client and trainer.
4. Availability requests and exact free-text time requests generate slots from the trainer's availability templates, minus blocked times, existing session conflicts, and live Google Calendar busy time.
5. If a free-text request matches an exact open slot, the app books it immediately and sends the normal booking confirmation SMS.
6. If a free-text request does not match an exact open slot, the app stores up to three upcoming alternatives as an offer set and sends a numbered SMS reply.
7. A client reply of `1`, `2`, or `3` books only one of the latest active offered slots.
8. Booking conflicts return a clean retry message instead of double-booking.

### Twilio webhook readiness

- The inbound route is `POST /api/twilio/inbound`.
- Clerk does not protect that route. The middleware explicitly treats it as public, so Twilio can reach it without a session.
- The route still rejects requests unless the `X-Twilio-Signature` matches `TWILIO_AUTH_TOKEN` and the webhook URL used for signing matches `TWILIO_WEBHOOK_URL`.
- If `TWILIO_WEBHOOK_URL` is unset, the handler falls back to the request URL, but for live traffic you should set it to the exact public URL Twilio calls.
- For local testing behind a tunnel, keep `TWILIO_WEBHOOK_URL` pointed at the tunnel URL, not `localhost`.

### Manual Twilio setup

These are the remaining steps the user has to do in Twilio by hand. The app does not provision any Twilio resources for you.

1. Get the credentials from the Twilio Console.
   - Open the Twilio Console dashboard at [https://www.twilio.com/console](https://www.twilio.com/console).
   - Copy the `Account SID` and `Auth Token` from the account info section. Twilio documents this on [Profiles](https://www.twilio.com/docs/twilio-cli/general-usage/profiles) and [REST API: Auth Token](https://www.twilio.com/docs/iam/api/authtoken).
   - Put those values into `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
2. Get a Twilio phone number that can receive SMS.
   - Buy or select an SMS-capable number in Twilio’s Phone Numbers area. Twilio’s product page is [Phone Numbers](https://www.twilio.com/docs/phone-numbers).
   - Put that number into `TWILIO_PHONE_NUMBER` in E.164 form, such as `+15551234567`.
3. Configure the inbound message webhook on that number.
   - In Console, go to the Active Numbers page, open the number, scroll to the Messaging section, and set the incoming message handler to a webhook URL. Twilio’s help article is [How to Configure a Twilio Phone Number to Receive and Respond to Messages](https://help.twilio.com/articles/223136047).
   - Twilio’s general webhook behavior for inbound messages is documented in [Messaging Webhooks](https://www.twilio.com/docs/usage/webhooks/messaging-webhooks).
   - Set the webhook URL to the exact public app URL ending in `/api/twilio/inbound`, for example `https://gym-scheduler-umber.vercel.app/api/twilio/inbound`.
   - Put the same exact URL into `TWILIO_WEBHOOK_URL`.
   - For local development, point both Twilio and `TWILIO_WEBHOOK_URL` at your HTTPS tunnel URL, not `localhost`.

### Required env for a live SMS test

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `TWILIO_WEBHOOK_URL`

### Additional env for Google Calendar sync

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `CALENDAR_SYNC_CRON_SECRET`

### Fast smoke test

Use the helper below after `npm run dev` is up and your tunnel is online:

```bash
node scripts/twilio-webhook-smoke.mjs
```

What it checks:

- Required Twilio and Supabase env vars are present.
- `GET /api/twilio/inbound` returns `405`, which means the route is reachable and not being redirected into auth.
- A signed `POST` to `/api/twilio/inbound` returns `400 Missing MessageSid`, which proves the webhook URL and Twilio auth token match the route’s signature verification logic without creating a real session or sending an outbound SMS.

If the signed `POST` returns `403`, the webhook URL or auth token does not match what Twilio is using.

### First live SMS test

1. Start the app locally with `npm run dev`.
2. Expose the app through a public HTTPS tunnel if you are not testing against a deployed environment.
3. Verify `TWILIO_WEBHOOK_URL` matches the exact public webhook URL Twilio will call, ending in `/api/twilio/inbound`.
4. Verify the Twilio phone number webhook points at that same URL.
5. Run the smoke helper until it reports both the `405` GET and the `400 Missing MessageSid` POST.
6. Send one real SMS from a client phone number that already exists in Supabase.
7. Watch the app logs and Supabase tables for one inbound `sms_messages` row and one outbound reply.

### Supabase additions

- `sms_webhook_idempotency`
  - Deduplicates inbound Twilio events by provider and event key
- `sms_messages`
  - Logs inbound and outbound message bodies, phone numbers, Twilio identifiers, status, and linked client/trainer context
- `trainer_calendar_connections`
  - Stores per-trainer Google OAuth tokens and selected calendar metadata
- `calendar_sync_jobs`
  - Queues session sync retries for Google Calendar writes
- `sessions`
  - Tracks Google event linkage and sync state for each session
- `sms_conversations`
  - Holds the lightweight pending SMS intent state for the next reply
- `sms_booking_offers`
  - Stores numbered availability offers and distinguishes booking vs reschedule flows

### Behavior assumptions

- Phone matching uses normalized E.164-style strings, with US/Canada 10-digit numbers normalized to `+1XXXXXXXXXX`
- Booking confirmation is intentionally deterministic for MVP: clients book by replying with the number of a recent offered slot, or by texting a specific exact time that the app can book immediately
- Availability is sourced from `availability_templates`; if no active template exists, the app returns a setup-needed response instead of inventing hours
- SMS-created sessions use the default session type and duration from app config and add `Booked via SMS.` to session notes
