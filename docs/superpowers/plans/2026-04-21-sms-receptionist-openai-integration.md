# SMS Receptionist OpenAI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fallback-only SMS receptionist happy path with a real OpenAI-backed extraction runner while keeping all durable intake, approval, and promotion decisions deterministic.

**Architecture:** Add one small OpenAI runner module that converts intake context into strict structured output, then add one tiny runtime factory that reads environment config and supplies the default runner to `lib/sms/orchestrator.ts`. Keep the existing adapter in `lib/sms/receptionist-agent.ts` as the safety boundary so malformed, missing, or low-confidence provider output still degrades to the current deterministic fallback.

**Tech Stack:** Next.js App Router, TypeScript, OpenAI Node SDK, Node test runner, ESLint, existing SMS intake helpers.

---

## File Map

- Create: `lib/sms/receptionist-openai.ts`
  - owns OpenAI prompt assembly, structured-response parsing, and one injected `ReceptionistAgentRunner`
- Create: `lib/sms/receptionist-runner.ts`
  - owns environment-driven default runner construction for runtime use
- Modify: `lib/sms/orchestrator.ts`
  - replaces the fallback-only default call with the env-backed runner factory
- Create: `scripts/sms-receptionist-openai.test.mjs`
  - focused unit tests for prompt assembly, structured parsing, and malformed response handling
- Create: `scripts/sms-receptionist-runner.test.mjs`
  - focused tests for env gating and default model selection
- Modify: `scripts/sms-intake-orchestrator.test.mjs`
  - preserve routing behavior while verifying the OpenAI-backed happy path still fits the current intake flow
- Modify: `.env.local.example`
  - document `SMS_RECEPTIONIST_OPENAI_MODEL`
- Modify: `docs/live-pilot-runbook.md`
  - document the required OpenAI env var and the live messy-text verification path
- Modify: `docs/sms-scheduling-mvp.md`
  - update the rollout description so the receptionist lane is described accurately

### Task 1: Add The OpenAI Receptionist Runner

**Files:**
- Create: `lib/sms/receptionist-openai.ts`
- Create: `scripts/sms-receptionist-openai.test.mjs`

- [ ] **Step 1: Write the failing OpenAI runner tests**

Create `scripts/sms-receptionist-openai.test.mjs` with focused tests around one injected fake OpenAI client:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiReceptionistRunner,
} from "../lib/sms/receptionist-openai.ts";

function createInput(overrides = {}) {
  return {
    lead_snapshot: {
      client_name: null,
      email: null,
      requested_trainer_id: null,
      requested_trainer_name_raw: null,
      scheduling_preferences_text: null,
    },
    recent_sms_transcript: [
      { direction: "inbound", body: "Hey, I'm Alex. I want Maya. Evenings work best." },
    ],
    allowed_trainers: [
      { id: "trainer-1", name: "Maya", aliases: ["Coach Maya"] },
      { id: "trainer-2", name: "Ben", aliases: ["Coach Ben"] },
    ],
    collected_fields: [],
    next_missing_field: "requested_trainer_id",
    ...overrides,
  };
}

test("createOpenAiReceptionistRunner maps structured OpenAI output into the provider shape", async () => {
  const calls = [];
  const runner = createOpenAiReceptionistRunner({
    apiKey: "test-key",
    createClient() {
      return {
        responses: {
          async create(request) {
            calls.push(request);
            return {
              output_text: JSON.stringify({
                resolved_fields: {
                  client_name: "Alex",
                  requested_trainer_name_raw: "Maya",
                  scheduling_preferences_text: "weekday evenings",
                },
                follow_up_question: "What is your email address?",
                summary_text: "Alex wants to train with Maya and prefers weekday evenings.",
                preference_summary: "weekday evenings",
                preference_json: { preferred_days: ["weekday"], preferred_time: "evenings" },
                needs_follow_up: true,
                confidence_score: 0.91,
              }),
            };
          },
        },
      };
    },
  });

  const result = await runner(createInput());

  assert.equal(calls[0].model, "gpt-5.4-mini");
  assert.match(calls[0].input[1].content[0].text, /Coach Maya/);
  assert.deepEqual(result, {
    resolved_fields: {
      client_name: "Alex",
      requested_trainer_name_raw: "Maya",
      scheduling_preferences_text: "weekday evenings",
    },
    follow_up_question: "What is your email address?",
    summary_text: "Alex wants to train with Maya and prefers weekday evenings.",
    preference_summary: "weekday evenings",
    preference_json: { preferred_days: ["weekday"], preferred_time: "evenings" },
    needs_follow_up: true,
    confidence_score: 0.91,
  });
});

test("createOpenAiReceptionistRunner returns null when the provider response is malformed", async () => {
  const runner = createOpenAiReceptionistRunner({
    apiKey: "test-key",
    createClient() {
      return {
        responses: {
          async create() {
            return {
              output_text: "{\"resolved_fields\":{\"client_name\":42}}",
            };
          },
        },
      };
    },
  });

  const result = await runner(createInput());
  assert.equal(result, null);
});

test("createOpenAiReceptionistRunner sends the current lead snapshot, transcript, and next missing field", async () => {
  let requestText = "";
  const runner = createOpenAiReceptionistRunner({
    apiKey: "test-key",
    createClient() {
      return {
        responses: {
          async create(request) {
            requestText = request.input[1].content[0].text;
            return { output_text: JSON.stringify({
              resolved_fields: {},
              follow_up_question: "What is your full name?",
              summary_text: "No structured details yet.",
              preference_summary: "",
              preference_json: {},
              needs_follow_up: true,
              confidence_score: 0.82,
            }) };
          },
        },
      };
    },
  });

  await runner(createInput({
    lead_snapshot: { client_name: "Alex", email: null, requested_trainer_name_raw: "Maya" },
    next_missing_field: "email",
  }));

  assert.match(requestText, /"next_missing_field":"email"/);
  assert.match(requestText, /"requested_trainer_name_raw":"Maya"/);
  assert.match(requestText, /"allowed_trainers"/);
});
```

- [ ] **Step 2: Run the focused runner tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test scripts/sms-receptionist-openai.test.mjs
```

Expected:

- FAIL because `lib/sms/receptionist-openai.ts` does not exist yet

- [ ] **Step 3: Implement the minimal OpenAI runner**

Create `lib/sms/receptionist-openai.ts` with one small factory and one schema-aware parser:

```ts
import OpenAI from "openai";

import type {
  ReceptionistAgentInput,
  ReceptionistAgentRunner,
  ReceptionistAgentRunnerOutput,
} from "./receptionist-agent.ts";

const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_TIMEOUT_MS = 10_000;

type OpenAiResponsesClient = {
  responses: {
    create(input: Record<string, unknown>): Promise<{
      output_text?: string | null;
    }>;
  };
};

type CreateOpenAiReceptionistRunnerOptions = {
  apiKey: string;
  model?: string | null;
  timeoutMs?: number;
  createClient?: (apiKey: string) => OpenAiResponsesClient;
};

export function createOpenAiReceptionistRunner(
  options: CreateOpenAiReceptionistRunnerOptions,
): ReceptionistAgentRunner {
  const apiKey = options.apiKey.trim();
  const model = options.model?.trim() || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function runOpenAiReceptionist(
    input: ReceptionistAgentInput,
  ): Promise<ReceptionistAgentRunnerOutput | null> {
    const client =
      options.createClient?.(apiKey) ??
      new OpenAI({ apiKey });
    const response = await withTimeout(
      client.responses.create({
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: buildSystemPrompt() }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify(buildUserPayload(input)) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "sms_receptionist_output",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
      timeoutMs,
    );

    return parseRunnerOutput(response.output_text);
  };
}

function buildSystemPrompt(): string {
  return [
    "You are an SMS intake receptionist for a gym.",
    "You may only extract, summarize, and ask one follow-up question.",
    "Do not approve, reject, create clients, or book sessions.",
    "Never invent trainer ids. Use trainer names exactly as written by the client when uncertain.",
  ].join(" ");
}

function buildUserPayload(input: ReceptionistAgentInput) {
  return {
    lead_snapshot: input.lead_snapshot,
    recent_sms_transcript: input.recent_sms_transcript,
    allowed_trainers: input.allowed_trainers,
    collected_fields: input.collected_fields,
    next_missing_field: input.next_missing_field,
  };
}

function parseRunnerOutput(
  outputText: string | null | undefined,
): ReceptionistAgentRunnerOutput | null {
  if (!outputText?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(outputText);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as ReceptionistAgentRunnerOutput;
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("OpenAI receptionist timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
```

Add one strict response schema object in this file that only permits:

- `resolved_fields`
- `follow_up_question`
- `summary_text`
- `preference_summary`
- `preference_json`
- `needs_follow_up`
- `confidence_score`

and only the allowed resolved field names:

- `client_name`
- `email`
- `requested_trainer_name_raw`
- `scheduling_preferences_text`

- [ ] **Step 4: Run the focused runner tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test scripts/sms-receptionist-openai.test.mjs
```

Expected:

- PASS

- [ ] **Step 5: Commit the runner slice**

```bash
git add lib/sms/receptionist-openai.ts scripts/sms-receptionist-openai.test.mjs
git commit -m "feat: add openai receptionist runner"
```

### Task 2: Add The Default Runtime Runner And Wire It Into Intake

**Files:**
- Create: `lib/sms/receptionist-runner.ts`
- Modify: `lib/sms/orchestrator.ts`
- Create: `scripts/sms-receptionist-runner.test.mjs`
- Modify: `scripts/sms-intake-orchestrator.test.mjs`

- [ ] **Step 1: Write the failing default-runner tests**

Create `scripts/sms-receptionist-runner.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultReceptionistRunner,
} from "../lib/sms/receptionist-runner.ts";

test("buildDefaultReceptionistRunner returns null when OPENAI_API_KEY is missing", () => {
  const runner = buildDefaultReceptionistRunner({
    OPENAI_API_KEY: "",
  });

  assert.equal(runner, null);
});

test("buildDefaultReceptionistRunner uses the configured model override", async () => {
  let receivedModel = null;

  const runner = buildDefaultReceptionistRunner(
    {
      OPENAI_API_KEY: "test-key",
      SMS_RECEPTIONIST_OPENAI_MODEL: "gpt-5.4-mini",
    },
    {
      createOpenAiReceptionistRunner({ model }) {
        receivedModel = model;
        return async () => null;
      },
    },
  );

  await runner({
    allowed_trainers: [],
    collected_fields: [],
    lead_snapshot: {},
    next_missing_field: "client_name",
    recent_sms_transcript: [],
  });

  assert.equal(receivedModel, "gpt-5.4-mini");
});
```

Then extend `scripts/sms-intake-orchestrator.test.mjs` with one intake-path assertion that the returned follow-up question from a model-backed agent still becomes the SMS reply:

```js
test("continueIntakeConversation uses the structured agent follow-up question on the happy path", async () => {
  const result = await continueIntakeConversation(
    {
      body: "I'm Alex and evenings are best",
      fromPhone: "+16475550101",
      inboundMessageId: "inbound-openai-happy-path",
      lead: createLead({
        requested_trainer_name_raw: "Maya",
        requested_trainer_id: "trainer-1",
        conversation_state: "needs_name",
      }),
    },
    {
      async listTrainerCandidates() {
        return [{ id: "trainer-1", name: "Maya" }];
      },
      async listRecentTranscriptByPhone() {
        return [{ direction: "inbound", body: "I'm Alex and evenings are best" }];
      },
      async runReceptionistAgent() {
        return {
          confidence_flags: ["provider:ok"],
          follow_up_question: "What is your email address?",
          needs_follow_up: true,
          preference_json: { preferred_time: "evenings" },
          preference_summary: "evenings",
          resolved_fields: {
            client_name: "Alex",
            scheduling_preferences_text: "evenings",
          },
          summary_text: "Alex wants evenings.",
        };
      },
      async persistValidatedLeadUpdates({ lead, updates }) {
        return {
          lead: {
            ...lead,
            client_name: updates.client_name,
            scheduling_preferences_text: updates.scheduling_preferences_text,
            scheduling_preferences_json: updates.scheduling_preferences_json,
            conversation_state: "needs_email",
          },
          persistedFields: ["client_name", "scheduling_preferences_text"],
        };
      },
      async createOrResumeIntakeLead() {
        throw new Error("should not create a second lead");
      },
      async prepareTrainerApprovalRequest() {
        throw new Error("lead is not ready for approval yet");
      },
    },
  );

  assert.deepEqual(result.messages, [
    {
      body: "What is your email address?",
      toPhone: "+16475550101",
    },
  ]);
});
```

- [ ] **Step 2: Run the focused runtime tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test scripts/sms-receptionist-runner.test.mjs
node --experimental-strip-types --test scripts/sms-intake-orchestrator.test.mjs
```

Expected:

- first command FAILS because `lib/sms/receptionist-runner.ts` does not exist
- second command still PASS or FAIL only if the new assertion references missing wiring helpers

- [ ] **Step 3: Implement the default runtime runner and orchestrator wiring**

Create `lib/sms/receptionist-runner.ts`:

```ts
import type { ReceptionistAgentRunner } from "./receptionist-agent.ts";
import { createOpenAiReceptionistRunner } from "./receptionist-openai.ts";

const DEFAULT_MODEL = "gpt-5.4-mini";

type EnvShape = {
  OPENAI_API_KEY?: string | undefined;
  SMS_RECEPTIONIST_OPENAI_MODEL?: string | undefined;
};

type RunnerDeps = {
  createOpenAiReceptionistRunner: typeof createOpenAiReceptionistRunner;
};

export function buildDefaultReceptionistRunner(
  env: EnvShape = process.env,
  deps: RunnerDeps = { createOpenAiReceptionistRunner },
): ReceptionistAgentRunner {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return deps.createOpenAiReceptionistRunner({
    apiKey,
    model: env.SMS_RECEPTIONIST_OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  });
}
```

Then modify `lib/sms/orchestrator.ts`:

```ts
import { buildDefaultReceptionistRunner } from "./receptionist-runner.ts";
```

and replace the current fallback-only call:

```ts
runReceptionistAgent: (input) => runReceptionistAgentHelper(input),
```

with:

```ts
runReceptionistAgent: (input) =>
  runReceptionistAgentHelper(input, buildDefaultReceptionistRunner()),
```

Keep everything else in `continueIntakeConversation` unchanged so the existing
deterministic validation and trainer approval path stay intact.

- [ ] **Step 4: Run the focused runtime tests to verify they pass**

Run:

```bash
node --experimental-strip-types --test scripts/sms-receptionist-runner.test.mjs
node --experimental-strip-types --test scripts/sms-intake-orchestrator.test.mjs
node --experimental-strip-types --test scripts/sms-receptionist-agent.test.mjs
```

Expected:

- PASS

- [ ] **Step 5: Commit the runtime wiring slice**

```bash
git add lib/sms/receptionist-runner.ts lib/sms/orchestrator.ts scripts/sms-receptionist-runner.test.mjs scripts/sms-intake-orchestrator.test.mjs
git commit -m "feat: wire openai receptionist into sms intake"
```

### Task 3: Document The Config And Live Verification Path

**Files:**
- Modify: `.env.local.example`
- Modify: `docs/live-pilot-runbook.md`
- Modify: `docs/sms-scheduling-mvp.md`

- [ ] **Step 1: Write the failing docs expectations as a quick checklist**

Add this checklist to the task notes before editing:

```text
- .env.local.example must show SMS_RECEPTIONIST_OPENAI_MODEL
- live pilot doc must say OPENAI_API_KEY is required for the model-backed receptionist happy path
- rollout doc must stop implying the current intake path is model-backed without env configuration
```

- [ ] **Step 2: Update the environment example**

Add the model override near the existing AI settings:

```dotenv
# AI APIs
ANTHROPIC_API_KEY=your_anthropic_api_key
OPENAI_API_KEY=your_openai_api_key
SMS_RECEPTIONIST_OPENAI_MODEL=gpt-5.4-mini
```

- [ ] **Step 3: Update the live pilot runbook**

Add a short operator section like this:

```md
## OpenAI Receptionist Check

Before running the unknown-sender intake test:

- confirm `OPENAI_API_KEY` is set in the active environment
- optionally set `SMS_RECEPTIONIST_OPENAI_MODEL` if not using the default
- use one intentionally messy intake conversation:
  - trainer + timing in one message
  - name + email in another
  - one vague preference that should trigger a follow-up question

If the OpenAI call fails or is unconfigured, the system will fall back to the deterministic receptionist prompts.
```

- [ ] **Step 4: Update the MVP doc**

Update the receptionist section so it reads like:

```md
Unknown SMS senders enter the intake lane first. In the normal configured path,
the receptionist uses OpenAI to extract trainer, name, email, and timing
preferences from messy client language, but the system still validates and
persists those fields deterministically. If OpenAI is unavailable, the intake
lane degrades to the existing fallback prompts instead of breaking SMS intake.
```

- [ ] **Step 5: Run the targeted regression checks**

Run:

```bash
node --experimental-strip-types --test scripts/sms-receptionist-openai.test.mjs
node --experimental-strip-types --test scripts/sms-receptionist-runner.test.mjs
node --experimental-strip-types --test scripts/sms-receptionist-agent.test.mjs
node --experimental-strip-types --test scripts/sms-intake-orchestrator.test.mjs
npm run lint
```

Expected:

- PASS

- [ ] **Step 6: Commit the docs slice**

```bash
git add .env.local.example docs/live-pilot-runbook.md docs/sms-scheduling-mvp.md
git commit -m "docs: add openai receptionist rollout notes"
```

### Task 4: Full Verification Before Pilot

**Files:**
- No new files

- [ ] **Step 1: Run the full intake verification suite**

Run:

```bash
node --test scripts/sms-intake-schema.test.mjs
node --experimental-strip-types --test scripts/sms-intake-state.test.mjs
node --experimental-strip-types --test scripts/sms-receptionist-agent.test.mjs
node --experimental-strip-types --test scripts/sms-receptionist-openai.test.mjs
node --experimental-strip-types --test scripts/sms-receptionist-runner.test.mjs
node --experimental-strip-types --test scripts/sms-intake-persistence.test.mjs
node --experimental-strip-types --test scripts/sms-intake-orchestrator.test.mjs
npm run lint
```

Expected:

- PASS

- [ ] **Step 2: Run one supervised live intake flow**

Use one real phone number that is not already an approved client and verify this exact sequence:

1. text a messy first message that includes trainer name plus a rough schedule
2. text a second message with full name and email
3. verify the system asks a follow-up only for genuinely missing details
4. approve from the trainer phone with the real request code
5. text `Availability` from the new client phone and verify the normal booking flow responds

Expected:

- the model-backed path extracts obvious details
- unresolved details trigger one sensible follow-up
- trainer approval still promotes the lead correctly
- post-approval the client enters the normal SMS scheduler

- [ ] **Step 3: Commit any final fixes from verification**

```bash
git add lib/sms/receptionist-openai.ts lib/sms/receptionist-runner.ts lib/sms/orchestrator.ts scripts/sms-receptionist-openai.test.mjs scripts/sms-receptionist-runner.test.mjs scripts/sms-intake-orchestrator.test.mjs .env.local.example docs/live-pilot-runbook.md docs/sms-scheduling-mvp.md
git commit -m "fix: polish openai receptionist rollout"
```
