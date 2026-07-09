import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultReceptionistRunner,
} from "../lib/sms/receptionist-runner.ts";

function createInput() {
  return {
    allowed_trainers: [],
    collected_fields: [],
    lead_snapshot: {},
    next_missing_field: "client_name",
    recent_sms_transcript: [],
  };
}

test("buildDefaultReceptionistRunner returns null when OPENAI_API_KEY is missing", () => {
  const runner = buildDefaultReceptionistRunner({
    OPENAI_API_KEY: "",
  });

  assert.equal(runner, null);
});

test("buildDefaultReceptionistRunner uses the configured model override", async () => {
  let receivedOptions = null;

  const runner = buildDefaultReceptionistRunner(
    {
      OPENAI_API_KEY: "test-key",
      SMS_RECEPTIONIST_OPENAI_MODEL: "gpt-5.4",
    },
    {
      createOpenAiReceptionistRunner(options) {
        receivedOptions = options;
        return async () => null;
      },
    },
  );

  assert.equal(typeof runner, "function");
  await runner(createInput());
  assert.equal(receivedOptions.apiKey, "test-key");
  assert.equal(receivedOptions.model, "gpt-5.4");
});
