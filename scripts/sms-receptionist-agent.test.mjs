import assert from "node:assert/strict";
import test from "node:test";

import {
  runReceptionistAgent,
} from "../lib/sms/receptionist-agent.ts";

function createInput(overrides = {}) {
  return {
    lead_snapshot: {
      client_name: "Alex Client",
      email: "alex@example.com",
      requested_trainer_id: "trainer-1",
      requested_trainer_name_raw: "Maya",
      scheduling_preferences_text: "weekday evenings after 6pm",
    },
    recent_sms_transcript: [
      { direction: "inbound", body: "I want to train with Maya." },
      { direction: "outbound", body: "Thanks, I can help with that." },
    ],
    allowed_trainers: [
      { id: "trainer-1", name: "Maya", aliases: ["coach maya"] },
      { id: "trainer-2", name: "Ben", aliases: ["coach ben"] },
    ],
    collected_fields: ["requested_trainer_id", "client_name"],
    next_missing_field: "email",
    ...overrides,
  };
}

test("runReceptionistAgent returns a provider-agnostic structured payload", async () => {
  let receivedInput;

  const result = await runReceptionistAgent(createInput(), async (input) => {
    receivedInput = input;

    return {
      resolved_fields: {
        client_name: "Alex Client",
      },
      follow_up_question: "What is your email address?",
      summary_text: "Alex wants to train with Maya.",
      preference_summary: "weekday evenings",
      preference_json: { preferred_days: ["weekday"], preferred_time: "evenings" },
      needs_follow_up: true,
      confidence_score: 0.94,
    };
  });

  assert.deepEqual(receivedInput, createInput());
  assert.deepEqual(result, {
    resolved_fields: {
      client_name: "Alex Client",
    },
    follow_up_question: "What is your email address?",
    summary_text: "Alex wants to train with Maya.",
    preference_summary: "weekday evenings",
    preference_json: { preferred_days: ["weekday"], preferred_time: "evenings" },
    needs_follow_up: true,
    confidence_flags: ["provider:ok"],
  });
});

test("runReceptionistAgent strips unsafe action fields on the normal provider path", async () => {
  const result = await runReceptionistAgent(createInput(), async () => ({
    resolved_fields: {
      client_name: "Alex Client",
      email: "alex@example.com",
      requested_trainer_id: "trainer-1",
    },
    follow_up_question: "What is your email address?",
    summary_text: "Alex wants to train with Maya.",
    preference_summary: "weekday evenings",
    preference_json: { preferred_days: ["weekday"] },
    needs_follow_up: false,
    approve_client: true,
    reject_client: true,
    create_client: true,
    confidence_score: 0.95,
  }));

  assert.deepEqual(result, {
    resolved_fields: {
      client_name: "Alex Client",
      email: "alex@example.com",
      requested_trainer_id: "trainer-1",
    },
    follow_up_question: "What is your email address?",
    summary_text: "Alex wants to train with Maya.",
    preference_summary: "weekday evenings",
    preference_json: { preferred_days: ["weekday"] },
    needs_follow_up: false,
    confidence_flags: ["provider:ok"],
  });
});

test("runReceptionistAgent falls back deterministically when no runner is available", async () => {
  const result = await runReceptionistAgent(createInput(), null);

  assert.deepEqual(result, {
    resolved_fields: {},
    follow_up_question: "What is the best email address to reach you at?",
    summary_text: "Collected: trainer Maya, client name Alex Client, preferences weekday evenings after 6pm.",
    preference_summary: "weekday evenings after 6pm",
    preference_json: {},
    needs_follow_up: true,
    confidence_flags: ["fallback:runner-unavailable"],
  });
});

test("runReceptionistAgent falls back deterministically when the runner returns no output", async () => {
  const nullResult = await runReceptionistAgent(createInput(), async () => null);
  const undefinedResult = await runReceptionistAgent(createInput(), async () => undefined);

  assert.deepEqual(nullResult, {
    resolved_fields: {},
    follow_up_question: "What is the best email address to reach you at?",
    summary_text: "Collected: trainer Maya, client name Alex Client, preferences weekday evenings after 6pm.",
    preference_summary: "weekday evenings after 6pm",
    preference_json: {},
    needs_follow_up: true,
    confidence_flags: ["fallback:runner-unavailable"],
  });

  assert.deepEqual(undefinedResult, {
    resolved_fields: {},
    follow_up_question: "What is the best email address to reach you at?",
    summary_text: "Collected: trainer Maya, client name Alex Client, preferences weekday evenings after 6pm.",
    preference_summary: "weekday evenings after 6pm",
    preference_json: {},
    needs_follow_up: true,
    confidence_flags: ["fallback:runner-unavailable"],
  });
});

test("runReceptionistAgent ignores low-confidence provider output and falls back", async () => {
  const result = await runReceptionistAgent(
    createInput({ next_missing_field: "requested_trainer_id" }),
    async () => ({
      resolved_fields: {
        requested_trainer_id: "trainer-2",
      },
      follow_up_question: "Who would you like to train with?",
      summary_text: "Maybe Ben.",
      preference_summary: "anytime",
      preference_json: { preferred_time: "anytime" },
      needs_follow_up: false,
      approve_client: true,
      reject_client: true,
      create_client: true,
      confidence_score: 0.2,
    }),
  );

  assert.deepEqual(result, {
    resolved_fields: {},
    follow_up_question: "Which trainer would you like to work with?",
    summary_text: "Collected: trainer Maya, client name Alex Client, preferences weekday evenings after 6pm.",
    preference_summary: "weekday evenings after 6pm",
    preference_json: {},
    needs_follow_up: true,
    confidence_flags: ["fallback:low-confidence"],
  });
});
