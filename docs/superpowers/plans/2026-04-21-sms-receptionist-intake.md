# SMS Receptionist Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an SMS receptionist intake lane for unknown phone numbers so the system can collect trainer, name, email, and scheduling preferences in natural language, route the lead to the named trainer for deterministic SMS approval, and promote approved leads into real scheduling clients without requiring portal sign-in.

**Architecture:** Keep the current known-client booking flow intact. Add a new intake lane ahead of it in `lib/sms/orchestrator.ts`. The receptionist agent may only extract, summarize, and ask follow-up questions. All durable state transitions remain deterministic: lead creation, field validation, readiness checks, trainer approval request creation, trainer approve/reject handling, and approved lead promotion into `users` and `clients`.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Twilio, existing SMS routing/logging utilities, Node test runner, ESLint.

---

### Task 1: Add Intake And Approval Schema

**Files:**
- Create: `supabase/migrations/<timestamp>_sms_receptionist_intake.sql`
- Modify: `types/supabase.ts`
- Create: `scripts/sms-intake-schema.test.mjs`

- [ ] **Step 1: Write the failing schema test**

Create a focused Node test that reads the new migration file path and asserts the schema includes:

- `sms_intake_leads`
- `sms_trainer_approval_requests`
- intake status values: `collecting_info`, `awaiting_trainer_approval`, `approved`, `rejected`, `expired`, `needs_manual_review`
- conversation state values: `needs_trainer`, `needs_name`, `needs_email`, `needs_preferences`, `ready_for_approval`, `awaiting_trainer_reply`
- approval status values: `pending`, `approved`, `rejected`, `expired`
- one-active-lead uniqueness protection by normalized phone

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```bash
node --test scripts/sms-intake-schema.test.mjs
```

Expected:

- FAIL because the migration file does not exist yet

- [ ] **Step 3: Add the migration**

Implement the smallest migration that adds:

- `sms_intake_leads`
  - raw and normalized phone
  - requested trainer raw text and resolved trainer id
  - client name and email
  - raw text plus structured JSON preferences
  - `status` and `conversation_state`
  - trainer-facing summary
  - last inbound and outbound message ids
  - approved user/client ids
  - timestamps
- `sms_trainer_approval_requests`
  - linked lead id
  - trainer id
  - short request code
  - status
  - outbound and decision message ids
  - decided/expires timestamps plus created/updated timestamps
- supporting indexes and foreign keys
- uniqueness rules that prevent duplicate pending approval request codes and multiple active leads for one normalized phone

- [ ] **Step 4: Update generated Supabase types**

Update `types/supabase.ts` so the new tables and status unions are represented in the application layer.

- [ ] **Step 5: Re-run the schema test to verify it passes**

Run:

```bash
node --test scripts/sms-intake-schema.test.mjs
```

Expected:

- PASS

- [ ] **Step 6: Commit the schema slice**

```bash
git add supabase/migrations types/supabase.ts scripts/sms-intake-schema.test.mjs
git commit -m "feat: add sms intake schema"
```

### Task 2: Add Pure Intake-State And Trainer-Matching Helpers

**Files:**
- Create: `lib/sms/intake-state.ts`
- Create: `lib/sms/trainer-match.ts`
- Create: `scripts/sms-intake-state.test.mjs`

- [ ] **Step 1: Write the failing helper tests**

Cover pure deterministic behavior:

- next missing intake field from the current lead snapshot
- readiness for trainer approval
- preference usefulness thresholds
- email validation
- trainer name resolution success
- trainer name ambiguity
- trainer name unknown handling

- [ ] **Step 2: Run the focused helper tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test scripts/sms-intake-state.test.mjs
```

Expected:

- FAIL because the new helper modules do not exist yet

- [ ] **Step 3: Implement the minimal pure helpers**

Add deterministic helpers that:

- compute the next `conversation_state`
- validate when a lead is complete enough for approval
- treat vague timing answers like `whenever` as incomplete
- validate email format narrowly
- resolve trainer names against allowed trainer names and aliases without silently guessing

- [ ] **Step 4: Re-run the focused helper tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test scripts/sms-intake-state.test.mjs
```

Expected:

- PASS

- [ ] **Step 5: Commit the helper slice**

```bash
git add lib/sms/intake-state.ts lib/sms/trainer-match.ts scripts/sms-intake-state.test.mjs
git commit -m "feat: add sms intake state helpers"
```

### Task 3: Add The Receptionist Agent Adapter With Deterministic Fallback

**Files:**
- Create: `lib/sms/receptionist-agent.ts`
- Create: `scripts/sms-receptionist-agent.test.mjs`

- [ ] **Step 1: Write the failing adapter tests**

Cover:

- provider-agnostic adapter shape
- structured return payload with resolved fields, summary text, preference JSON, follow-up question, and confidence flags
- deterministic fallback behavior when the agent is unavailable or low confidence
- no path where the adapter can directly approve, reject, or create clients

- [ ] **Step 2: Run the focused adapter tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test scripts/sms-receptionist-agent.test.mjs
```

Expected:

- FAIL because the adapter does not exist yet

- [ ] **Step 3: Implement the minimal adapter**

Implement a small provider-agnostic module that:

- accepts lead snapshot, recent transcript, trainer candidates, collected fields, and next missing field
- returns structured extraction output only
- falls back to deterministic prompts and empty field updates if the model call is unavailable or low confidence
- keeps agent behavior strictly informational and never authoritative

- [ ] **Step 4: Re-run the focused adapter tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test scripts/sms-receptionist-agent.test.mjs
```

Expected:

- PASS

- [ ] **Step 5: Commit the adapter slice**

```bash
git add lib/sms/receptionist-agent.ts scripts/sms-receptionist-agent.test.mjs
git commit -m "feat: add receptionist agent adapter"
```

### Task 4: Add Lead Persistence, Trainer Approval, And Client-Promotion Helpers

**Files:**
- Create: `lib/sms/intake-leads.ts`
- Create: `lib/sms/trainer-approval.ts`
- Create: `lib/sms/lead-promotion.ts`
- Create: `scripts/sms-intake-persistence.test.mjs`

- [ ] **Step 1: Write the failing persistence and approval tests**

Cover:

- create-or-resume lead by normalized phone
- validated field persistence only
- blocked scheduling response before approval
- request-code generation and parsing
- deterministic trainer approve/reject handling
- approved lead promotion creating linked `users` and `clients`
- duplicate identity conflict path -> `needs_manual_review`
- trainer missing reachable phone path -> `needs_manual_review`

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test scripts/sms-intake-persistence.test.mjs
```

Expected:

- FAIL because the persistence helpers do not exist yet

- [ ] **Step 3: Implement the minimal persistence and promotion helpers**

Add deterministic service-layer helpers that:

- create or resume active intake leads
- write only validated field updates from the receptionist adapter
- generate trainer-facing approval summaries and request codes
- handle `APPROVE <code>` and `REJECT <code>` replies without using the agent
- promote approved leads into application-generated `users.id` plus linked `clients`
- surface manual-review states instead of partial creation on conflicts or missing trainer phone

- [ ] **Step 4: Re-run the focused tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test scripts/sms-intake-persistence.test.mjs
```

Expected:

- PASS

- [ ] **Step 5: Commit the persistence slice**

```bash
git add lib/sms/intake-leads.ts lib/sms/trainer-approval.ts lib/sms/lead-promotion.ts scripts/sms-intake-persistence.test.mjs
git commit -m "feat: add sms intake persistence and approval"
```

### Task 5: Wire Intake Routing Into The SMS Orchestrator

**Files:**
- Modify: `lib/sms/orchestrator.ts`
- Modify: `app/api/twilio/inbound/route.ts`
- Modify: `lib/sms/client-directory.ts`
- Modify: `lib/sms/twilio-sender.ts`
- Modify: `lib/sms/message-log.ts`
- Create: `scripts/sms-intake-orchestrator.test.mjs`

- [ ] **Step 1: Write the failing orchestrator tests**

Cover the inbound decision order from the spec:

1. known approved client -> existing booking flow
2. active intake lead -> continue intake
3. trainer approval reply -> deterministic approval handling
4. otherwise unknown number -> create lead and start intake

Also cover:

- polite blocked response if an unapproved lead tries to book
- trainer approval retry message for missing or invalid codes
- success handoff into normal known-client routing after approval

- [ ] **Step 2: Run the focused orchestrator tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test scripts/sms-intake-orchestrator.test.mjs
```

Expected:

- FAIL because the new routing branches do not exist yet

- [ ] **Step 3: Implement the orchestrator wiring**

Wire the intake helpers into the live SMS path while preserving the current deterministic known-client booking logic. Keep ACK behavior intact in the Twilio route and keep audit logging additive.

- [ ] **Step 4: Re-run the focused orchestrator tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test scripts/sms-intake-orchestrator.test.mjs
```

Expected:

- PASS

- [ ] **Step 5: Commit the routing slice**

```bash
git add lib/sms/orchestrator.ts app/api/twilio/inbound/route.ts lib/sms/client-directory.ts lib/sms/twilio-sender.ts lib/sms/message-log.ts scripts/sms-intake-orchestrator.test.mjs
git commit -m "feat: wire sms receptionist intake"
```

### Task 6: Update Rollout Docs And Live Verification Steps

**Files:**
- Modify: `docs/sms-scheduling-mvp.md`
- Modify: `docs/live-pilot-runbook.md`

- [ ] **Step 1: Update docs for the new intake flow**

Document:

- intake decision order
- required trainer approval SMS commands
- lead promotion behavior
- manual-review conditions

- [ ] **Step 2: Add live verification steps**

Document the manual intake flow:

1. unknown phone starts intake
2. collect trainer, name, email, and preferences
3. confirm trainer approval SMS
4. approve via trainer phone
5. verify client promotion
6. verify the newly approved phone routes into the normal booking flow

- [ ] **Step 3: Commit the doc slice**

```bash
git add docs/sms-scheduling-mvp.md docs/live-pilot-runbook.md
git commit -m "docs: add sms receptionist rollout steps"
```

## Verification

Run these checks before claiming the feature is complete:

```bash
node --experimental-strip-types --test scripts/sms-intake-schema.test.mjs
node --experimental-strip-types --test scripts/sms-intake-state.test.mjs
node --experimental-strip-types --test scripts/sms-receptionist-agent.test.mjs
node --experimental-strip-types --test scripts/sms-intake-persistence.test.mjs
node --experimental-strip-types --test scripts/sms-intake-orchestrator.test.mjs
npm run lint
```

Twilio webhook smoke test:

```bash
curl -i https://<deployment>/api/twilio/inbound
curl -i -X POST https://<deployment>/api/twilio/inbound
```

Expected:

- unsigned `GET` returns `405`
- unsigned `POST` returns a request-validation or missing-message error rather than a crash

Manual end-to-end intake flow:

1. Text the booking line from an unknown phone number.
2. Complete trainer name, client name, email, and general scheduling preferences.
3. Verify the trainer receives `APPROVE <code>` / `REJECT <code>` instructions.
4. Reply `APPROVE <code>` from the trainer phone.
5. Verify the client receives the setup-success SMS.
6. Verify `users` and `clients` rows are created and linked to the trainer.
7. Verify the phone number now routes into the existing known-client booking path.
