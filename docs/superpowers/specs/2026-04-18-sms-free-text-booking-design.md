# SMS Free-Text Booking Design

**Date:** April 18, 2026

## Goal

Extend the existing deterministic SMS booking flow so a known client can text a
specific requested time such as `can you do monday at 2?`, have the app parse
that request without an agent, and immediately book it if the exact slot is
available.

## Current Baseline

The live SMS flow is already deterministic:

- Twilio posts to `POST /api/twilio/inbound`
- the route signature-verifies and ACKs immediately
- the app maps `From` to a known client and trainer
- `Availability` generates a numbered offer set
- replies of `1`, `2`, or `3` book from the latest offer set
- `Cancel` and `Reschedule` are handled with fixed rule-based flows

There is no model or agent in the current booking path.

## Approved Product Decisions

- Keep the booking path deterministic and rule-based.
- Do not introduce an agent or LLM layer for the MVP.
- If a parsed exact requested slot is available, book it immediately.
- After an immediate book, send the normal booking confirmation SMS.
- If the exact requested slot is unavailable, reply with up to 3 alternative
  options from the requested time forward and reuse the existing numbered
  booking path.
- Keep the existing `Availability`, `1/2/3`, `Cancel`, and `Reschedule` flows.
- Avoid schema changes unless implementation proves one is truly necessary.

## In Scope

- Known existing clients only
- Free-text booking requests in the normal booking flow
- Deterministic parsing for a small, explicit set of time-request patterns
- Exact-slot validation against:
  - trainer availability templates
  - blocked time slots
  - existing sessions
  - live Google Calendar busy time
- Immediate booking for an exact available slot
- Alternative numbered options when the exact slot is unavailable
- Clear fallback copy when the message is too ambiguous to parse

## Out Of Scope

- Agent-based or model-based parsing
- Free-text reschedule requests in MVP
- Free-text cancel requests in MVP
- Multi-turn clarification conversations in MVP
- Vague phrases like `after work`, `sometime next week`, or `not too early`
- Silent rounding of off-interval requests
- Broad SMS refactors

## Supported Input Patterns

The MVP parser should recognize only these narrow patterns:

- weekday + time
  - `monday at 2`
  - `tuesday 11am`
  - `friday at 1:30 pm`
- relative day + time
  - `today at 4`
  - `tomorrow 11am`
- explicit month/day + time
  - `apr 22 1:30 pm`
  - `april 22 at 2`
  - `4/22 2pm`

The parser should tolerate polite wrappers around those patterns:

- `can you do monday at 2?`
- `could i do tomorrow at 11?`
- `is april 22 at 1:30 open?`

## Interpretation Rules

- Interpret parsed times in the SMS runtime time zone.
- Use the same time zone for reply labels and for booking.
- Support the client shorthand `monday at 2` by interpreting bare hours `1`
  through `7` as PM.
- Require explicit `am` or `pm` for other bare-hour requests to avoid hidden
  assumptions.
- Accept `:00` and `:30` only when the current slot interval is 30 minutes.
- If a parsed time does not land on the configured slot interval, reply with a
  clear format message instead of rounding silently.
- When a weekday is specified, interpret it as the next occurrence of that day
  within the existing SMS search horizon.

## Routing Order

The inbound SMS path should remain mostly unchanged, but the decision order must
be adjusted so specific requested times are not swallowed by the broad
availability regex.

Recommended order inside `buildReply(...)`:

1. unknown sender / missing client / missing trainer guards
2. active conversation numeric reply handling
3. normal `1` / `2` / `3` booking selection
4. explicit `Cancel`
5. explicit `Reschedule`
6. new free-text exact-time booking request handling
7. existing generic availability matcher
8. existing generic help message

This preserves the current explicit flows and only inserts the new deterministic
exact-time branch before generic availability fallback.

## Exact-Time Booking Behavior

### If the text parses and the exact slot is available

- book the session immediately using the existing booking write path
- create the same `sessions` and `session_changes` records as the numbered
  booking flow
- sync the booked session to Google Calendar through the current calendar sync
  logic
- send the existing confirmation shape:

```text
You're booked for Mon, Apr 20, 2:00 PM. See you then.
```

### If the text parses but the exact slot is unavailable

- do not book anything
- generate up to 3 alternatives from the requested time forward
- persist those alternatives as a normal SMS offer set
- send a numbered reply that reuses the current `1` / `2` / `3` booking path

Example:

```text
2:00 PM is not open, but I have:
1) Mon, Apr 20, 2:30 PM
2) Mon, Apr 20, 3:00 PM
3) Mon, Apr 20, 3:30 PM
Reply with 1, 2, or 3 and I'll lock it in.
```

### If the text is too ambiguous to parse

- do not book anything
- fall through to the existing availability-style behavior or send a narrower
  format hint if the implementation can reliably distinguish a failed
  time-request parse from a generic chatty message

Recommended format-hint copy:

```text
I couldn't tell which time you meant. Text something like 'Monday 2 PM',
'tomorrow at 11 AM', or 'Apr 22 at 1:30 PM'.
```

## Architecture

### New File

- `lib/sms/requested-time-parser.ts`
  - pure parsing helper
  - no `server-only`
  - takes `(body, now, timeZone, slotIntervalMinutes)`
  - returns either:
    - `kind: "requested_time"` with a normalized UTC ISO slot start
    - `kind: "not_requested_time"`
    - `kind: "invalid_requested_time"` with a user-safe reason

### Existing Files To Modify

- `lib/sms/orchestrator.ts`
  - insert the requested-time branch in the decision order
  - keep explicit cancel/reschedule behavior ahead of it
- `lib/sms/booking-service.ts`
  - add a new function for exact-time SMS booking requests
  - reuse the existing booking write path and offer-set path
- `lib/sms/availability-engine.ts`
  - add a way to search from a requested anchor time instead of always from
    `now`
- `lib/sms/timezone.ts`
  - add a reusable helper for getting a plain date from an arbitrary anchor
    date in a target time zone, if needed by the parser or search anchor logic
- `docs/sms-scheduling-mvp.md`
  - document the new supported free-text behavior
- `docs/live-pilot-runbook.md`
  - add a concrete live verification step for free-text booking

## Data Model Impact

The MVP should not require any new tables or columns.

Why:

- an exact available slot books immediately
- an exact unavailable slot can reuse the existing `sms_booking_offers` table
- there is no new confirmation conversation state because the approved decision
  is to auto-book exact available slots

## Error Handling

- If Google busy-time lookup is unavailable, reuse the current
  `calendar_unavailable` behavior and do not offer or book a potentially wrong
  slot.
- If the exact slot becomes unavailable between evaluation and insert, reuse the
  current booking conflict behavior and send alternatives if possible.
- If outbound SMS send fails after generating an offer set, expire that offer
  set using the current failure pattern.
- Do not let parser failures throw raw exceptions back into the webhook path.

## Testing Strategy

### Automated

- parser tests for supported and unsupported formats
- parser tests for the `monday at 2` shorthand
- tests for invalid off-interval inputs
- focused tests for the requested-time search anchor behavior if the
  availability engine is adjusted to search from a requested start time

### Manual / Live Verification

From the mapped client phone:

1. text `Availability`
2. text a specific time that is actually available, for example `Monday at 2`
3. verify immediate booking confirmation
4. verify a new `sessions` row is created
5. verify Google Calendar sync still succeeds
6. text a specific time that is unavailable
7. verify the app replies with numbered alternatives instead of silence

## Swarm Suitability

This is a good fit for a fresh swarm session, but the write scopes are only
partially parallelizable.

Safe parallel slices:

- parser helper + parser tests
- docs updates

Core serialized slice:

- availability-engine search-anchor change
- booking-service exact-slot flow
- orchestrator routing order

The fresh session should use subagents only for disjoint write scopes and keep
the core SMS mutation path serialized.
