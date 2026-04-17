# Vercel Pilot Hosting

This is the recommended hosted path if you want the live-facing runtime off the
MacBook Pro and do not want to operate the Mac mini as the public app host.

## Recommended architecture

- GitHub private repo on `main` is the source of truth.
- Vercel hosts the Next.js app and provides the stable public HTTPS origin.
- Supabase remains the hosted database and backend service.
- Twilio inbound SMS and Google Calendar OAuth both point at the Vercel
  production hostname.

Recommended runtime flow:

```text
GitHub main -> Vercel production deployment -> stable HTTPS hostname
                                             |
                                             v
                               Twilio webhook + Google OAuth callback
```

## Why this is the best hosted path

- Stable public hostname without tunnel management.
- GitHub push remains the deployment source of truth.
- Managed TLS and uptime for the public app runtime.
- Cleaner path to a private beta than running the app on home hardware.

## User-visible behavior changes

- The public app URL changes from a temporary ngrok host to a stable Vercel URL
  or custom domain.
- Public traffic no longer depends on the MacBook Pro staying awake.
- Twilio and Google callback targets move to the new production hostname.
- Until Clerk server keys are configured, dashboard routes remain publicly
  reachable on the live host, so the supervised-pilot restriction still applies.

## Required env alignment

Set these in Vercel for the final production hostname:

```bash
NEXT_PUBLIC_APP_URL=https://your-production-host.example.com
TWILIO_WEBHOOK_URL=https://your-production-host.example.com/api/twilio/inbound
GOOGLE_CALENDAR_REDIRECT_URI=https://your-production-host.example.com/api/google/calendar/callback
CALENDAR_SYNC_CRON_SECRET=choose_a_long_random_secret
```

If you use Vercel Cron, also set:

```bash
CRON_SECRET=choose_the_same_value_as_calendar_sync_cron_secret
```

The app accepts either `CALENDAR_SYNC_CRON_SECRET` or `CRON_SECRET` for the
calendar sync endpoint.

## Scheduler choice

### If you are on Vercel Pro

Use Vercel Cron.

- Vercel Cron sends a `GET` request to the configured path.
- Vercel automatically includes `Authorization: Bearer <CRON_SECRET>` when
  `CRON_SECRET` is set.
- The route at `/api/internal/calendar-sync` now accepts both `GET` and `POST`
  with bearer auth, so it is compatible with either Vercel Cron or an external
  caller.

### If you are on Vercel Hobby

Do not rely on Vercel Cron for this route.

Vercel's official cron docs say Hobby cron jobs can only run once per day, while
this app wants a cadence closer to every 1 to 5 minutes for calendar sync.

Recommended fallback:

- GitHub Actions scheduled workflow, or
- another external scheduler that can make authenticated HTTPS requests

The request shape stays:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_CALENDAR_SYNC_CRON_SECRET" \
  "https://your-production-host.example.com/api/internal/calendar-sync"
```

## Exact manual setup steps

1. Import `immeasurablematt/gym-scheduler` into Vercel as a new project.
2. Add the production environment variables.
3. Trigger the first production deployment.
4. Decide whether production uses:
   - the default `*.vercel.app` hostname, or
   - a custom pilot hostname such as `pilot.yourdomain.com`
5. Update Twilio to use the production `/api/twilio/inbound` URL.
6. Update the Google OAuth client redirect URI to the production callback URL.
7. Re-run the trainer Google Calendar connect flow on the production host.
8. Run `node scripts/twilio-webhook-smoke.mjs --base-url=https://your-production-host.example.com`.
9. Run the supervised pilot flow from the live runbook.

## Recommended immediate path

For the supervised pilot, the best hosted path is:

- Vercel for app hosting
- GitHub `main` as the deployment source
- a custom subdomain if you already have a domain ready
- external cron caller unless you are on Vercel Pro

## Recommended near-term path

For the private beta, keep:

- Vercel for the public app runtime
- GitHub-driven deploys on push

Before sharing trainer-facing URLs broadly, add:

- Clerk server keys
- real trainer and client identity mapping instead of the preview records
