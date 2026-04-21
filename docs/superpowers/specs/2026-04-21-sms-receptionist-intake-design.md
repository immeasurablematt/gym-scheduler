# SMS Receptionist Intake And Trainer Approval Design

**Date:** April 21, 2026

## Goal

Add a lightweight SMS receptionist layer that can safely handle unknown inbound
numbers by collecting onboarding details in natural language, then route those
leads to the named trainer for SMS approval before the person becomes a real
client.

The feature should solve the current operational gap on the booking line:

- unknown senders should not be hard-rejected
- messy, non-technical client texts should still be handled gracefully
- booking authority should remain deterministic
- trainer approval should happen entirely by SMS
- client dashboard access should remain out of scope for this slice

## Current Baseline

The repo already has a deterministic SMS scheduling path:

- Twilio posts inbound SMS to `POST /api/twilio/inbound`
- the route verifies signatures, ACKs immediately, and processes in the
  background
- known clients can request availability, book numbered offers, cancel, and
  reschedule through rule-based flows
- unknown senders are currently treated as unsupported and receive a rejection
  reply
- `/onboarding` is currently a placeholder page
- the current `users` table is practically treated as Clerk-backed, even though
  the schema itself only requires a text id

The app also already has one shared calendar sync path and a separate attendee
design in:

- [2026-04-21-client-calendar-attendee-design.md](/Users/mbaggetta/my-project/gym-scheduler/docs/superpowers/specs/2026-04-21-client-calendar-attendee-design.md)

That attendee work is related, but it is a separate slice. This receptionist
design should come first because it collects the valid client email data that
attendee invites depend on.

## Approaches Considered

### 1. Mostly Deterministic Intake With Tiny Agent Fallback

- ask the same fixed questions in a rigid order
- use the model only when an answer is messy or ambiguous

Trade-offs:

- easiest to build and test
- lowest operational risk
- weakest receptionist experience
- more robotic for the client

### 2. Recommended: Agent-Led Intake With Deterministic State Changes

- use a receptionist agent to understand natural-language replies
- let the agent extract trainer name, client name, email, and timing
  preferences
- keep every real state transition deterministic:
  - intake lead creation
  - readiness for approval
  - trainer approval request
  - trainer approval or rejection
  - real client creation

Trade-offs:

- best balance of usefulness and safety
- strong client experience without turning booking into a black box
- moderate implementation complexity
- requires clear confidence thresholds and validation rules

### 3. Full Conversational Receptionist

- let the agent manage intake, approval, and booking with broad autonomy

Trade-offs:

- most flexible on paper
- highest long-term maintenance burden
- hardest to debug and trust
- too much risk for the current app state

## Recommendation

Use approach 2.

The receptionist should act as a liaison, not as the source of truth. It may:

- classify
- extract
- summarize
- ask clarifying follow-ups

It may not:

- approve a lead
- reject a lead
- create a real client
- unlock booking
- create, cancel, or reschedule sessions directly

All durable state transitions should remain deterministic code paths.

## Approved Product Decisions

- unknown senders should enter an intake flow, not receive a dead-end rejection
- the receptionist agent should help with onboarding
- the lead must name the trainer during intake
- only the named trainer needs to approve the lead
- trainer approval should happen by SMS reply, not in the dashboard
- booking, reschedule, and cancel remain blocked until approval
- after approval, the person becomes a real client in the scheduling model
- client dashboard access is explicitly deferred
- Clerk build-out is not a prerequisite for this feature
- the system should preserve the original SMS language and also store a cleaned
  summary plus lightweight structured timing preferences

## In Scope

- unknown-number SMS intake
- intake lead persistence and resume-by-phone behavior
- agent-led collection of:
  - trainer name
  - client name
  - email
  - scheduling preferences
- follow-up questions when a response is too vague to be useful
- trainer lookup from named trainer text
- trainer SMS approval request
- trainer SMS approve or reject decision
- deterministic promotion from approved lead to real `users` and `clients` rows
- clear client-facing blocked messages before approval
- additive logging, auditability, and verification docs

## Out Of Scope

- client dashboard or client sign-in UX
- Clerk account creation for new SMS leads
- intake-to-booking automation before approval
- admin review queues or back-office intake UIs
- calendar attendee invite implementation
- broad known-client conversational booking beyond current deterministic flows
- payment collection or package sales

## Architecture

### High-Level Shape

This slice should add a separate intake lane in front of the current known-client
SMS booking logic.

Recommended inbound decision order:

1. verify and log inbound Twilio message
2. resolve phone actor by normalized phone
3. if known approved client:
   - continue through the existing deterministic booking/cancel/reschedule flow
4. if active intake lead exists for the phone:
   - continue the intake conversation
5. if trainer approval reply from a trainer phone:
   - handle approval deterministically
6. otherwise:
   - create a new intake lead and begin onboarding

This keeps the existing booking authority intact while adding a receptionist lane
only where it is truly needed.

### Agent Boundary

The receptionist layer should be provider-agnostic. The implementation should
define one small adapter interface that can later be backed by Hermes, OpenClaw,
OpenAI, Anthropic, or another model without changing business logic.

The agent should receive:

- the current intake lead snapshot
- the recent SMS transcript for that lead
- the list of trainers and trainer aliases it is allowed to recognize
- the fields already collected
- the next missing field

The agent should return structured output only, such as:

- `resolved_fields`
- `follow_up_question`
- `summary_text`
- `preference_summary`
- `preference_json`
- `needs_follow_up`
- `confidence_flags`

Deterministic code should validate and persist any suggested field updates before
they affect state.

### Identity Boundary

Full Clerk rollout does not block this feature.

This design should intentionally separate:

- `approved client in the scheduling system`
- `authenticated portal user`

For v1, approved leads should become SMS-capable clients without requiring a
portal account. The system should create:

- a `users` row with an application-generated id such as
  `sms-client-<uuid>`
- a linked `clients` row assigned to the approving trainer

No sign-in credentials need to be provisioned in this slice.

Later, a separate account-linking or account-claiming slice can connect an
approved client email to a portal identity.

## Data Model

### New Table: `sms_intake_leads`

This table should represent an unknown sender from first contact through final
approval outcome.

Recommended columns:

- `id`
- `raw_phone`
- `normalized_phone`
- `requested_trainer_name_raw`
- `requested_trainer_id`
- `client_name`
- `email`
- `scheduling_preferences_text`
- `scheduling_preferences_json`
- `status`
  - `collecting_info`
  - `awaiting_trainer_approval`
  - `approved`
  - `rejected`
  - `expired`
  - `needs_manual_review`
- `conversation_state`
  - `needs_trainer`
  - `needs_name`
  - `needs_email`
  - `needs_preferences`
  - `ready_for_approval`
  - `awaiting_trainer_reply`
- `summary_for_trainer`
- `last_inbound_message_id`
- `last_outbound_message_id`
- `approved_user_id`
- `approved_client_id`
- `created_at`
- `updated_at`

Recommended uniqueness rule:

- at most one active lead per normalized phone number

### New Table: `sms_trainer_approval_requests`

This table should isolate the trainer-facing decision from the lead itself.

Recommended columns:

- `id`
- `lead_id`
- `trainer_id`
- `request_code`
- `status`
  - `pending`
  - `approved`
  - `rejected`
  - `expired`
- `outbound_message_id`
- `decision_message_id`
- `decided_at`
- `expires_at`
- `created_at`
- `updated_at`

The `request_code` is important. Trainer replies should use a short unique code
so the approval path stays deterministic even if a trainer has multiple pending
leads.

Example:

```text
New client lead A7K3:
Jane Smith
jane@email.com
Prefers Tue/Thu evenings, flexible Saturday mornings.
Reply APPROVE A7K3 or REJECT A7K3.
```

### Existing Tables

- keep `sms_messages` as the universal inbound/outbound SMS log
- keep `sms_conversations` focused on known-client booking/cancel/reschedule
  flows
- do not overload `sms_conversations` with unknown-lead onboarding state

## Preference Capture

The system should preserve three layers of preference data:

1. the raw SMS transcript in `sms_messages`
2. a cleaned human-readable summary in `scheduling_preferences_text`
3. a lightweight structured representation in `scheduling_preferences_json`

Example source text:

```text
probably tuesdays or thursdays after work, but i can sometimes do saturday mornings
```

Possible normalized summary:

```text
Prefers Tuesday/Thursday evenings after work; can sometimes do Saturday mornings.
```

Possible structured JSON:

```json
{
  "preferred_days": ["tuesday", "thursday", "saturday"],
  "preferred_windows": ["evening", "morning"],
  "hard_constraints": [],
  "desired_start_timing": null,
  "flexibility": "medium",
  "confidence": "high"
}
```

The agent should ask follow-ups until the preferences are useful enough for a
trainer to judge fit, not until the system has an exact appointment.

Useful follow-up questions include:

- what days usually work best for you?
- do you usually prefer mornings, afternoons, or evenings?
- are there any times that never work for you?
- are you hoping to start on a particular day, or are you just sharing general
  availability for now?

The intake flow should capture broad preference patterns and constraints. It
should not treat those preferences as booking instructions.

## Conversation Flow

### 1. Unknown Number Starts Intake

When an unknown number texts the booking line:

- create or resume an active intake lead by normalized phone number
- use the receptionist agent to determine what information is already present
- persist any validated structured fields
- ask the next missing question

### 2. Trainer Identification

The lead must name a trainer.

If the trainer name is:

- clearly resolved to one trainer: store `requested_trainer_id`
- ambiguous across multiple trainers: ask a clarifying follow-up
- unknown: ask the client to try the trainer name again

The system must not silently guess the trainer.

### 3. Blocked Scheduling Before Approval

If an unapproved lead asks to book, reschedule, or cancel, the system should
reply with a polite block, for example:

```text
I can help get you set up first. Once your trainer approves, I can help with scheduling by text.
```

### 4. Completion Gate

A lead is ready for trainer approval only when all of the following are present:

- resolved trainer
- client name
- valid email
- useful scheduling preferences

Once those are present:

- generate a concise trainer-facing summary
- send the client a short acknowledgment that the trainer is being contacted
- create a `sms_trainer_approval_requests` row
- send the trainer approval SMS

### 5. Trainer Approval Reply

Trainer approval handling should be deterministic and should not use the agent.

Supported command shape:

- `APPROVE <request_code>`
- `REJECT <request_code>`

Behavior:

- if the request code is valid and still pending, apply the decision
- if the reply is missing a code or uses an invalid code, send a clean retry
  message
- if the request is expired or already decided, say so explicitly

### 6. Promotion To Real Client

If the trainer approves:

- create the `users` row with an application-generated id
- create the linked `clients` row
- assign `trainer_id` from the approval request
- set the approved client phone number and normalized phone
- mark the lead approved
- store `approved_user_id` and `approved_client_id`
- text the client that they are now set up

If the trainer rejects:

- mark the request rejected
- mark the lead rejected
- send the client a polite rejection message

## Validation Rules

### Email

Email is required before approval.

For this slice, email validation should stay intentionally narrow:

- non-empty after trim
- passes a reasonable application-level email format check

If email is missing or clearly malformed, the agent should ask a follow-up.

### Timing Preferences

Preferences are complete when they are useful to a trainer, even if they are not
calendar-precise.

Examples that should count as complete:

- `weekdays after 4 is best`
- `tuesdays and thursdays work best`
- `mostly mornings, never fridays`

Examples that should trigger follow-up:

- `whenever`
- `not sure`
- `depends`

### Trainer Phone

Trainer approval by SMS requires a trainer phone number.

If the resolved trainer does not have a valid reachable phone number on their
linked `users.phone_number`, the system should:

- avoid sending a broken approval request
- mark the lead `needs_manual_review`
- text the client that setup is pending manual follow-up

## Failure Handling

### Duplicate Or Existing Identity Conflicts

Approval-time creation can fail if the app hits a uniqueness conflict such as:

- an existing `users.email`
- an existing client with the same phone or other conflicting identity data

In those cases, the system should:

- not partially create the client
- mark the lead `needs_manual_review`
- notify the trainer that the lead needs manual follow-up
- send the client a neutral setup-delay message instead of exposing internals

### Trainer Does Not Reply

If the trainer does not respond before request expiry:

- expire the approval request
- keep the lead blocked
- optionally allow the client to be told the request is still awaiting follow-up
  if they text again

### Agent Extraction Errors

If the agent returns low-confidence or contradictory output:

- do not persist uncertain field updates
- ask the next clarifying question
- never unlock approval readiness on low-confidence extraction alone

### SMS Delivery Failures

If the client-facing or trainer-facing SMS send fails:

- log the outbound failure in `sms_messages`
- do not advance state as though the message was definitely delivered
- leave the lead or approval request retryable by a later deterministic path if
  implementation adds retries

## Guardrails

- the agent may gather, clarify, summarize, and normalize
- the agent may not approve or reject
- the agent may not create real clients
- the agent may not unlock booking
- the agent may not silently guess trainer identity
- the agent may not silently invent scheduling preferences the client did not
  express
- all state changes that matter to the business should be backed by deterministic
  validators and explicit table updates

## Relation To Existing Booking Flow

This slice should not replace the current known-client deterministic booking
system.

For v1:

- approved known clients keep using the current deterministic flow
- the new agent receptionist is introduced only on the intake lane for unknown
  and unapproved senders

This is the simplest way to get value now without destabilizing the booking
engine.

Extending the receptionist to triage messy known-client booking requests can be a
later slice after the intake lane is stable.

## Relation To Client Calendar Attendee Work

This design should remain separate from the attendee feature.

Recommended sequencing:

1. implement SMS receptionist intake and trainer approval
2. then implement client calendar attendee invites

Why:

- this slice creates valid approved client email data for new leads
- the attendee slice should stay focused on Google sync correctness
- merging both features would unnecessarily tangle agent logic with calendar
  sync logic

## Likely Files

Expected implementation files:

- `app/api/twilio/inbound/route.ts`
- `lib/sms/orchestrator.ts`
- `lib/sms/client-directory.ts`
- new `lib/sms/intake-leads.ts`
- new `lib/sms/trainer-approval.ts`
- new `lib/sms/receptionist-agent.ts`
- new `lib/sms/phone-actor.ts`
- `lib/sms/twilio-sender.ts`
- `lib/sms/message-log.ts`
- `types/supabase.ts`
- new Supabase migration under `supabase/migrations/`
- `docs/sms-scheduling-mvp.md`
- `docs/live-pilot-runbook.md`

## Testing Strategy

### Automated

- lead creation and resume by normalized phone
- trainer resolution success, ambiguity, and unknown-name handling
- email validation checks
- preference completion thresholds
- blocked booking replies before approval
- trainer approval request parsing with request codes
- approval promotion creating real `users` and `clients` rows
- rejection behavior
- duplicate-identity conflict behavior

### Manual / Live Verification

1. text the booking line from a phone number that does not exist in the app
2. verify the system starts intake instead of rejecting the sender
3. complete trainer name, client name, email, and preference collection through
   natural-language SMS
4. verify the trainer receives an approval request with a request code
5. reply `APPROVE <code>` from the trainer phone
6. verify the client receives the success message
7. verify a new `users` row and `clients` row are created and linked to the
   approving trainer
8. verify that before approval the lead could not book, and after approval the
   phone number routes into the normal known-client booking flow

## Success Criteria

This slice is complete when:

- unknown senders are onboarded through SMS instead of hard-rejected
- the receptionist can collect useful intake information from natural-language
  replies
- booking remains blocked until trainer approval
- trainer approval works entirely over deterministic SMS commands
- approved leads become real clients without requiring Clerk sign-up
- the design leaves a clean seam for a future client portal and a future
  attendee-invite implementation
