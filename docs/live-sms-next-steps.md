# Live SMS Next Steps

This is the shortest path from the current repo state to a real live end-to-end SMS booking test.

## Current state

- The linked Supabase project is `oqzouzwbbkunirxptlnn`.
- I already applied the additive column repair from [`supabase/migrations/20260416_sms_scheduling_reconciliation.sql`](../supabase/migrations/20260416_sms_scheduling_reconciliation.sql) to the linked project.
- `users.phone_number` is now queryable through Supabase REST.
- `trainers.available_hours` is now queryable through Supabase REST.
- The live project is still missing `availability_templates` and `blocked_time_slots` from the API surface the app uses.
- Twilio runtime secrets are still missing from `.env.local`.

## What I can do after you give me access or inputs

- Apply the remaining Supabase SQL from this machine.
- Seed the Preview Trainer / Preview Client SMS fixture.
- Run the webhook smoke test.
- Run the app-side verification steps and tell you exactly what still fails, if anything.

## What you do not need to send in chat

Because we share the same workspace, you can put secrets into `.env.local` on this machine and then tell me they are there.

That is the safest way to give me what I need without pasting secrets into the conversation.

## Manual step 1: Supabase database access

I can finish the remaining Supabase work if this machine has the project database password.

You have two options:

### Option A

Put the password into `.env.local` as:

```bash
SUPABASE_DB_PASSWORD=your_database_password
```

Then tell me:

`SUPABASE_DB_PASSWORD is set in .env.local`

After that, I can retry the linked CLI path from here.

### Option B

If you do not want to expose the DB password to this machine, run the SQL yourself in the Supabase SQL Editor.

How to get the password if you do not already have it:

- Supabase says you can reset the database password from the Database Settings page: [How do I reset my Supabase database password?](https://supabase.com/docs/guides/troubleshooting/how-do-i-reset-my-supabase-database-password-oTs5sB)
- Supabase CLI docs note that `SUPABASE_DB_PASSWORD` is the variable used for linked DB commands: [CLI reference: supabase link / db push](https://supabase.com/docs/reference/cli/supabase-encryption)

If you choose SQL Editor instead of giving me the password, run these files in this order:

1. [`supabase/migrations/20260416190000_sms_availability_tables_repair.sql`](../supabase/migrations/20260416190000_sms_availability_tables_repair.sql)
2. [`scripts/sms-preview-fixture.sql`](../scripts/sms-preview-fixture.sql)

Before running the fixture SQL, replace the hard-coded client phone with the real phone number you will text from.

After you finish, tell me:

`I ran the Supabase SQL files in SQL Editor`

## Manual step 2: Choose the real test phone number

The SMS lookup matches on `users.phone_number` for the client user `client-preview-1`.

You need to choose the real phone that will send the test SMS.

What I need from you:

- Either edit [`scripts/sms-preview-fixture.sql`](../scripts/sms-preview-fixture.sql) and replace `+16475550101`
- Or tell me the phone number you want to use and I will patch the file for you

The number should be:

- E.164 if possible, like `+15551234567`
- or a 10-digit US/Canada number that normalizes to `+1XXXXXXXXXX`

## Manual step 3: Twilio credentials

The app still needs these values in `.env.local`:

```bash
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
TWILIO_WEBHOOK_URL=https://your-public-host.example.com/api/twilio/inbound
```

The easiest handoff is: add them to `.env.local`, then tell me they are set.

How to get them:

- Twilio documents that the Account SID and Auth Token are on the Twilio Console dashboard under Account Info: [Profiles](https://www.twilio.com/docs/twilio-cli/general-usage/profiles)
- Twilio’s auth docs also point to the Console for the Auth Token: [REST API: Auth Token](https://www.twilio.com/docs/iam/api/authtoken)
- For local testing, Twilio also documents using the Account SID and Auth Token from the Console dashboard: [Twilio API requests](https://www.twilio.com/docs/usage/requests-to-twilio)

After you add them locally, tell me:

`Twilio env is set in .env.local`

## Manual step 4: Twilio phone number and inbound webhook

You need an SMS-capable Twilio number and that number must send inbound messages to this app.

Twilio’s current docs for the console flow:

- [Messaging Webhooks](https://www.twilio.com/docs/usage/webhooks/messaging-webhooks)
- [SMS developer quickstart](https://www.twilio.com/docs/messaging/quickstart)

What to do in Twilio Console:

1. Open the Active Numbers page.
2. Click the Twilio phone number you want to use.
3. In Messaging Configuration, set the incoming message webhook for `A message comes in`.
4. Use the exact public URL ending in `/api/twilio/inbound`.
5. Save the configuration.

`TWILIO_WEBHOOK_URL` in `.env.local` must match that same exact URL.

For local development:

- use your HTTPS tunnel URL
- do not use `localhost`

After you finish, tell me:

`Twilio webhook is pointed at /api/twilio/inbound`

## Manual step 5: Optional availability choices

The preview fixture currently assumes:

- Mon-Fri
- `09:00` to `17:00`
- app timezone `America/Toronto`

If that is fine, you do not need to change anything.

If you want different hours, update [`scripts/sms-preview-fixture.sql`](../scripts/sms-preview-fixture.sql) or tell me the exact window you want.

If you want a different timezone, add this to `.env.local`:

```bash
SMS_TIME_ZONE=America/Your_City
```

## Optional local-only step: Docker

Docker is not required for the live linked-project SMS test.

You only need Docker if you want me to use local Supabase stack commands like:

- `npx supabase status`
- `npx supabase db reset --local`

## After you finish the manual parts

Send me one short message with whichever of these are true:

- `SUPABASE_DB_PASSWORD is set in .env.local`
- `I ran the Supabase SQL files in SQL Editor`
- `My SMS test phone is +1...`
- `Twilio env is set in .env.local`
- `Twilio webhook is pointed at /api/twilio/inbound`
- `Keep the default Mon-Fri 09:00-17:00 window`

Once I have that, I can take over the next steps:

1. verify the linked Supabase runtime again
2. apply or confirm the fixture
3. run [`scripts/twilio-webhook-smoke.mjs`](../scripts/twilio-webhook-smoke.mjs)
4. walk the happy path, unknown sender path, and booking conflict path as far as the available access allows
