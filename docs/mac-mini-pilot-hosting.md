# Mac Mini Pilot Hosting

This is the recommended path to move the live-facing runtime off the MacBook Pro
and onto the Mac mini without introducing a larger hosting migration first.

## Recommended immediate architecture

- GitHub private repo on `main` is the source of truth.
- The Mac mini runs the Next.js app from a local checkout of this repo.
- The app listens only on `127.0.0.1:3000`.
- A Cloudflare Tunnel running on the Mac mini publishes a stable custom hostname
  such as `pilot.yourdomain.com` to that local app.
- Supabase remains the hosted database and backend service.
- Twilio inbound SMS and Google Calendar OAuth both point at the same stable
  public hostname.

Recommended runtime flow:

```text
GitHub main -> Mac mini checkout -> Next.js app on 127.0.0.1:3000
                                      |
                                      v
                             Cloudflare Tunnel
                                      |
                                      v
                          https://pilot.yourdomain.com
                                      |
                        Twilio webhook + Google OAuth callback
```

## Why this is the best practical pilot path

- It removes the MacBook Pro and rotating ngrok host from the live path.
- It gives Twilio and Google a stable HTTPS hostname.
- It keeps the deployment model simple: pull from GitHub, build, restart.
- It avoids opening inbound ports on the home network.
- It does not force a hosting-platform migration before the supervised pilot.

## User-visible behavior changes

- The public app URL changes from a temporary tunnel URL to a stable hostname.
- The live runtime is available when the Mac mini app process and tunnel are
  running, not when the MacBook Pro and ngrok session are running.
- Twilio and Google callback targets move to the stable hostname.
- Until Clerk server keys are configured, dashboard routes remain publicly
  reachable on the live host, so the supervised-pilot restriction still applies.

## Required env alignment for cutover

Set these on the Mac mini to the stable public hostname:

```bash
NEXT_PUBLIC_APP_URL=https://pilot.yourdomain.com
TWILIO_WEBHOOK_URL=https://pilot.yourdomain.com/api/twilio/inbound
GOOGLE_CALENDAR_REDIRECT_URI=https://pilot.yourdomain.com/api/google/calendar/callback
```

Also carry over the existing live secrets for:

- Supabase
- Twilio
- Google OAuth
- `CALENDAR_SYNC_CRON_SECRET`

## Mac mini cutover checklist

1. Clone the repo on the Mac mini and stay on `main`.
2. Install the project Node.js version and run `npm ci`.
3. Create the Mac mini env file with the production values.
4. Build the app with `npm run build`.
5. Run the app locally on the Mac mini at `127.0.0.1:3000`.
6. Install and configure `cloudflared` on the Mac mini.
7. Attach a stable hostname in Cloudflare DNS to the tunnel.
8. Update Twilio to use the new `/api/twilio/inbound` URL.
9. Update the Google OAuth client redirect URI to the new callback URL.
10. Re-run the trainer Google Calendar connect flow on the stable host.
11. Run `node scripts/twilio-webhook-smoke.mjs` against the stable hostname.
12. Re-run the supervised pilot flow from the live runbook.

## Recommended process model on the Mac mini

For the immediate supervised pilot:

- Use a manual pull-based deploy from GitHub.
- Run the app under a simple process manager on the Mac mini.
- Keep the tunnel running as a service.

The lightest practical option is:

- `cloudflared` as a service for the public hostname
- `pm2` for the Node app process

If you want an all-native macOS service setup later, replace `pm2` with
`launchd`. That is a good cleanup step, but it is not required to get the pilot
stable.

## Hosting tradeoff summary

### Cloudflare Tunnel

- Best fit for the immediate Mac mini pilot.
- Stable custom hostname for Twilio and Google.
- No inbound port forwarding required.
- Keeps the live runtime on hardware you control.

### Tailscale Funnel

- Fast if you already live inside Tailscale.
- Less ideal as the main public webhook and OAuth host for third-party services.
- Not my recommendation for this pilot unless you already depend on Tailscale
  and want the shortest possible setup regardless of hostname polish.

### Vercel

- Best fit for the near-term private beta.
- Strong GitHub-based deployment flow and stable managed hosting.
- Removes the need to keep a Mac mini app runtime healthy for external traffic.
- Not the preferred immediate path only because you asked to move the live
  runtime to the Mac mini first.

## Recommendation by phase

### Immediate supervised pilot

Use:

- Mac mini runtime
- Cloudflare Tunnel
- stable custom hostname
- GitHub `main` as deployment source

### Near-term private beta

Move to:

- Vercel for the public app runtime
- GitHub-driven deploys on push
- Clerk server keys enabled before sharing trainer-facing URLs

Keep Supabase, Twilio, and Google Calendar integration the same, just with the
managed host as the public origin.
