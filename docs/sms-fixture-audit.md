# SMS Fixture Audit

Audit date: 2026-04-16

This checks the linked Supabase project behind `NEXT_PUBLIC_SUPABASE_URL` for the SMS MVP data that the app actually reads.

## Verdict

There is **not yet a viable SMS happy path** in the linked project as-is, but part of the earlier drift has now been repaired.

The project currently has a usable base trainer/client pair and some session history.

What is already fixed on the linked project:

- `users.phone_number` is now present and queryable through the Supabase API.
- `trainers.available_hours` is now present and queryable through the Supabase API.

What is still blocking the SMS flow:

- `public.availability_templates` is not queryable through the Supabase REST schema cache that the app uses.
- `public.blocked_time_slots` is not queryable through the Supabase REST schema cache that the app uses.

The SMS log/idempotency tables do exist and are empty:

- `sms_webhook_idempotency`
- `sms_messages`
- `sms_booking_offers`

## Exact Live Records Found

### Base pair

- Trainer user: `trainer-preview-1`
  - Name: `Preview Trainer`
  - Email: `trainer@example.com`
  - Trainer row id: `11111111-1111-1111-1111-111111111111`
  - Trainer row `user_id`: `trainer-preview-1`
  - Hourly rate: `85.00`

- Client user: `client-preview-1`
  - Name: `Preview Client`
  - Email: `client@example.com`
  - Client row id: `22222222-2222-2222-2222-222222222222`
  - Client row `user_id`: `client-preview-1`
  - Client row `trainer_id`: `11111111-1111-1111-1111-111111111111`

### Existing session context

- `44444444-4444-4444-4444-444444444444`
  - `scheduled_at`: `2026-04-18T15:00:00+00:00`
  - `status`: `scheduled`
  - `session_type`: `Strength + Conditioning`

- `7d4700b9-fd78-43d7-896d-4a1380e7e2c2`
  - `scheduled_at`: `2026-04-19T14:30:00+00:00`
  - `status`: `scheduled`
  - `session_type`: `Create Slice Test`

- `55555555-5555-5555-5555-555555555555`
  - `scheduled_at`: `2026-04-15T20:36:12.799834+00:00`
  - `status`: `completed`

## Why Happy Path Is Blocked

The SMS lookup code resolves a sender by matching normalized phone number against `users.phone_number`, then requires:

1. a matching `users` row with `role = client`
2. a `clients` row for that user
3. a non-null `clients.trainer_id`
4. an availability source for the trainer
   - first choice: active `availability_templates`
   - fallback: `trainers.available_hours`

In the linked project:

- the client row exists
- the trainer link exists
- the phone lookup column now exists
- the trainer JSON fallback column now exists
- the trainer availability tables are still not queryable by the current SMS runtime
- even the `available_hours` fallback will not help until `availability_templates` and `blocked_time_slots` are queryable, because the runtime reads those tables before it falls back to trainer JSON

## Exact Fixture Checklist

To make the SMS MVP testable, seed or migrate these items:

1. Apply the remaining table repair so `availability_templates` and `blocked_time_slots` become queryable through the Supabase API.
   - The repo-side SQL is [`supabase/migrations/20260416190000_sms_availability_tables_repair.sql`](../supabase/migrations/20260416190000_sms_availability_tables_repair.sql).
2. Set the client phone to a real E.164-style value, or at least a 10-digit US/Canada number that normalizes to `+1XXXXXXXXXX`.
3. Add one trainer availability source:
   - preferred: create at least one active `availability_templates` row for trainer `11111111-1111-1111-1111-111111111111`
   - fallback: `trainers.available_hours` is now available, but the runtime still needs the missing tables fixed first
4. Make sure the availability window overlaps a real conflict candidate.
   - Current sessions already give you filtering material on `2026-04-18T15:00:00+00:00` and `2026-04-19T14:30:00+00:00`
   - If you seed Saturday or Sunday availability that covers one of those times, the SMS engine can prove it skips busy slots before offering them
   - For the actual `selected slot conflicts before booking` path, you need a race after an offer is sent: offer a free slot first, then create a conflicting session on that exact `scheduled_at` before the client replies with `1`, `2`, or `3`
5. If you want blocked-slot coverage specifically, add `blocked_time_slots` and block a slot that overlaps an available window.
6. Keep at least one of `sms_webhook_idempotency`, `sms_messages`, and `sms_booking_offers` populated only if you want dashboard activity; they are not required for first-booking success.

## Practical Minimum For Tests

If the goal is just one happy-path and one conflict-path SMS test, the smallest useful fixture set is:

- one client phone number on `Preview Client`
- one active availability source for `Preview Trainer`
- one availability window that yields at least one slot in the next 7 days
- one overlapping session or blocked slot inside that window

That is enough for:

- happy path: request availability, receive numbered options, reply `1`
- pre-offer filtering path: existing sessions or blocked slots are skipped before the offer is sent
- post-offer conflict path: another booking takes an offered slot before the client replies, so the app returns the retry response

## Ready-To-Apply Patch

For the current preview records, the narrowest helper is [`scripts/sms-preview-fixture.sql`](../scripts/sms-preview-fixture.sql).

It keeps the known trainer/client fixture and only patches:

- `Preview Client` phone lookup via `users.phone_number`
- `Preview Trainer` availability via both `trainers.available_hours` and `availability_templates`

The only inputs you still need to choose are:

- the final client phone number to receive SMS
- whether the default Mon-Fri `09:00-17:00` availability window is good enough for the test
- the app `SMS_TIME_ZONE` if you want something other than `America/Toronto`
