# SMS Receptionist OpenAI Integration Design

**Date:** April 21, 2026

## Goal

Upgrade the SMS receptionist intake flow from a deterministic fallback adapter to
a real model-backed receptionist that can extract onboarding details from messy
client texts.

This slice should make the current intake feature behave like the intended
product:

- unknown senders can answer naturally instead of following a rigid script
- the system can pull out trainer name, client name, email, and scheduling
  preferences from mixed or incomplete messages
- the agent can ask a good next follow-up question when information is missing
- all durable state changes remain deterministic and validated in application
  code

## Current Baseline

The current `codex/sms-receptionist-intake` branch already has:

- intake routing for unknown senders
- lead persistence and resume-by-phone
- trainer approval by SMS
- approved lead promotion into `users` and `clients`
- a provider-agnostic receptionist adapter

What it does **not** have yet is a live model wired into the runtime path.

Today, the default intake path calls `runReceptionistAgent(...)` without a model
runner, which triggers the deterministic fallback behavior instead of real
natural-language extraction.

## Recommendation

Use **OpenAI only for v1**, with `gpt-5.4-mini` as the default model.

Keep the adapter boundary provider-agnostic so another provider can be swapped
in later, but do not add multi-provider orchestration, provider selection, or
OpenClaw-specific infrastructure in this slice.

This is the fastest safe route to a working receptionist because:

- the repo already includes the `openai` package
- the repo already documents `OPENAI_API_KEY`
- the current adapter shape is already compatible with an injected model runner
- the real risk now is not abstraction purity, it is closing the product gap
  between fallback logic and real client-language understanding

## Approaches Considered

### 1. Recommended: OpenAI-Only v1 Behind The Existing Adapter

- implement one OpenAI-backed runner that returns the existing structured output
- inject it into the intake runtime when `OPENAI_API_KEY` is present
- keep fallback behavior for missing key, API failure, timeout, schema failure,
  or low confidence

Trade-offs:

- fastest path to real value
- smallest code and operational surface
- easiest rollout and debugging story
- does not provide instant provider portability at runtime

### 2. Multi-Provider From Day One

- build first-class support for OpenAI plus Anthropic or OpenClaw immediately
- add provider config, routing, and provider-specific tests now

Trade-offs:

- better theoretical flexibility
- higher implementation and verification cost
- more ways to fail before the receptionist is useful
- wrong priority for the current stage

### 3. Keep The Current Fallback-Only System

- do not add any live model provider yet
- rely on deterministic prompting and manual follow-up

Trade-offs:

- lowest operational complexity
- does not satisfy the feature intent
- leaves the main product gap unresolved

## Product Decisions

- OpenAI is the only provider in scope for this slice
- `gpt-5.4-mini` is the default receptionist model
- missing or invalid OpenAI config must fail closed to the current deterministic
  fallback behavior
- the model may extract, summarize, and ask follow-up questions only
- the model may not approve a lead, reject a lead, promote a client, or trigger
  booking actions
- trainer identity remains deterministic and validated against known trainers
- the existing lead, approval, and promotion tables remain the source of truth

## Architecture

### High-Level Shape

Keep the existing receptionist adapter contract and add one OpenAI-backed runner
behind it.

Recommended runtime shape:

1. `lib/sms/orchestrator.ts`
   - continues to own intake routing
   - injects a default receptionist runner instead of calling the helper with no
     provider
2. `lib/sms/receptionist-agent.ts`
   - remains the provider-agnostic adapter boundary
   - continues to sanitize structured output
   - continues to enforce fallback behavior on unavailable, invalid, or
     low-confidence provider responses
3. new OpenAI runner module
   - constructs the prompt
   - calls OpenAI
   - returns the existing structured runner output shape
4. deterministic intake persistence
   - remains unchanged in authority
   - validates the agent output before storing any fields

### Proposed File Shape

- keep: `lib/sms/receptionist-agent.ts`
- create: `lib/sms/receptionist-openai.ts`
- optional small factory helper if it keeps `orchestrator.ts` cleaner:
  `lib/sms/receptionist-runner.ts`
- update: `lib/sms/orchestrator.ts`
- update: `.env.local.example`
- update rollout docs if the operator steps change

The goal is to keep provider-specific code out of the orchestrator.

## Model Contract

The OpenAI runner should accept the same intake context the adapter already
supports:

- lead snapshot
- recent transcript
- allowed trainers and aliases
- collected fields
- next missing field

It should return the same structured shape already enforced by the adapter:

- `resolved_fields`
- `follow_up_question`
- `summary_text`
- `preference_summary`
- `preference_json`
- `needs_follow_up`
- `confidence_score`

### Allowed Resolved Fields

The model may only suggest:

- `client_name`
- `email`
- `requested_trainer_name_raw`
- `scheduling_preferences_text`

It must **not** be trusted to emit:

- `requested_trainer_id`
- any approval or rejection action
- any client creation action
- any booking instruction

The adapter should continue stripping unsafe fields exactly as it does now.

### Prompt Rules

The prompt should make these boundaries explicit:

- the model is an intake receptionist, not a scheduler
- it must extract only what is directly supported by the transcript
- it must not invent trainer names or silently map to trainer ids
- if email is uncertain, leave it unset and ask for it directly
- if preferences are vague, preserve the raw meaning and ask a follow-up
- if the client asks to book before approval, do not interpret that as approval
  or a booking action

### Confidence Rules

The model should emit a numeric confidence score for its structured extraction.

Deterministic code should continue to fallback when:

- the runner throws
- the API returns no result
- the result does not match the expected shape
- the confidence score is below the existing threshold

This preserves the current safety model while improving the normal path.

## OpenAI Integration Details

### Configuration

Required:

- `OPENAI_API_KEY`

Optional:

- `SMS_RECEPTIONIST_OPENAI_MODEL`
  - default: `gpt-5.4-mini`

No OpenClaw install, local model server, or provider router is required for this
slice.

### API Boundary

Use the official OpenAI SDK already present in the repo.

The OpenAI runner should:

- use one structured-response call per intake turn
- request strict JSON output matching the runner schema
- keep prompts compact and transcript windows small
- time out cleanly and return control to the fallback path if the provider is
  unavailable

### Transcript Budget

Use the existing recent transcript helper rather than sending an unbounded SMS
history.

The initial budget should stay intentionally small:

- latest intake context from the lead snapshot
- latest recent transcript turns already returned by the existing helper

This keeps cost and latency predictable.

## Validation And Safety

The deterministic validation layer remains the real gatekeeper.

Validation rules:

- trainer resolution still happens only through deterministic matching against
  allowed trainers
- `requested_trainer_id` is derived by code, not accepted from the model
- email still goes through deterministic format validation
- preference JSON remains optional and must be plain JSON data
- low-confidence or malformed responses degrade to fallback instead of partially
  mutating state

Failure behavior:

- if OpenAI is not configured, continue using fallback
- if OpenAI times out or errors, continue using fallback
- if OpenAI returns unusable output, continue using fallback
- no provider failure should strand a lead in a half-written state

## Testing

Use TDD again for this slice.

### Required Test Coverage

1. OpenAI runner unit tests
   - prompt input is assembled from the expected lead snapshot, transcript, and
     trainer data
   - structured provider output maps into the runner shape
   - malformed provider output is treated as unavailable
   - provider timeout or thrown error degrades safely

2. Adapter behavior tests
   - existing sanitizer and low-confidence fallback behavior stays intact
   - unsafe fields remain stripped

3. Orchestrator wiring tests
   - default intake deps use the OpenAI-backed runner when configured
   - default intake deps still fallback when config is missing

4. Focused non-live verification
   - no network dependency in test runs
   - SDK calls are mocked at the module boundary

### Live Verification

After tests pass, run one supervised SMS intake flow with intentionally messy
client language, for example:

- trainer name plus schedule in one text
- name and email in another text
- vague preferences that require a follow-up

Success means:

- the system extracts the obvious fields correctly
- unresolved details trigger a sensible follow-up question
- trainer approval still works
- post-approval the client can enter the normal SMS scheduling flow

## Rollout

1. add `OPENAI_API_KEY` in the local environment used for verification
2. add `OPENAI_API_KEY` and optional model override in Vercel
3. run the focused test suite plus lint
4. run one supervised end-to-end SMS intake test
5. keep the fallback path in place during rollout so config issues degrade
   safely instead of breaking intake

## Out Of Scope

- OpenClaw integration
- Anthropic integration
- provider switching UI or runtime routing
- prompt tuning dashboards
- storing full prompt/response transcripts in a new analytics table
- autonomous booking from intake messages
- changing the trainer approval or promotion authority model

## Success Criteria

This slice is successful when:

- the receptionist can reliably extract onboarding details from normal messy SMS
  language
- the runtime no longer depends on the fallback-only path for the happy case
- provider failures safely degrade without corrupting lead state
- the rest of the deterministic intake, approval, and promotion flow remains
  unchanged in authority
