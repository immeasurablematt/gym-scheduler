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

test("createOpenAiReceptionistRunner includes the required intake guardrails in the system prompt", async () => {
  let systemPrompt = "";
  const runner = createOpenAiReceptionistRunner({
    apiKey: "test-key",
    createClient() {
      return {
        responses: {
          async create(request) {
            systemPrompt = request.input[0].content[0].text;
            return {
              output_text: JSON.stringify({
                resolved_fields: {},
                follow_up_question: "What is your email address?",
                summary_text: "Need an email before continuing.",
                preference_summary: "",
                preference_json: {},
                needs_follow_up: true,
                confidence_score: 0.84,
              }),
            };
          },
        },
      };
    },
  });

  await runner(createInput());

  assert.match(systemPrompt, /leave email unset and ask for it directly/i);
  assert.match(systemPrompt, /preserve vague preferences/i);
  assert.match(systemPrompt, /do not interpret booking requests before approval/i);
  assert.match(systemPrompt, /do not silently map trainer ids/i);
  assert.match(systemPrompt, /confidence_score.*0 to 1/i);
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

test("createOpenAiReceptionistRunner returns null when confidence_score is outside the expected range", async () => {
  const runner = createOpenAiReceptionistRunner({
    apiKey: "test-key",
    createClient() {
      return {
        responses: {
          async create() {
            return {
              output_text: JSON.stringify({
                resolved_fields: {},
                follow_up_question: "What is your email address?",
                summary_text: "Need an email before continuing.",
                preference_summary: "",
                preference_json: {},
                needs_follow_up: true,
                confidence_score: 42,
              }),
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
  assert.match(requestText, /"recent_sms_transcript"/);
  assert.match(requestText, /"body":"Hey, I'm Alex\. I want Maya\. Evenings work best\."/);
});
