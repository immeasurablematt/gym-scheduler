import assert from "node:assert/strict";
import test from "node:test";

import {
  getNextIntakeConversationState,
  hasUsefulSchedulingPreferences,
  isLeadReadyForTrainerApproval,
  isValidIntakeEmail,
} from "../lib/sms/intake-state.ts";
import { resolveTrainerName } from "../lib/sms/trainer-match.ts";

function createLead(overrides = {}) {
  return {
    client_name: "Alex Client",
    email: "alex@example.com",
    requested_trainer_id: "trainer-1",
    requested_trainer_name_raw: "Maya",
    scheduling_preferences_text: "weekday evenings after 6pm",
    ...overrides,
  };
}

test("getNextIntakeConversationState picks the next missing intake field", () => {
  assert.equal(
    getNextIntakeConversationState(createLead({ requested_trainer_id: null })),
    "needs_trainer",
  );
  assert.equal(
    getNextIntakeConversationState(createLead({ client_name: null })),
    "needs_name",
  );
  assert.equal(
    getNextIntakeConversationState(createLead({ email: "not-an-email" })),
    "needs_email",
  );
  assert.equal(
    getNextIntakeConversationState(
      createLead({ scheduling_preferences_text: "whenever" }),
    ),
    "needs_preferences",
  );
  assert.equal(getNextIntakeConversationState(createLead()), "ready_for_approval");
});

test("isLeadReadyForTrainerApproval only accepts complete leads", () => {
  assert.equal(isLeadReadyForTrainerApproval(createLead()), true);
  assert.equal(
    isLeadReadyForTrainerApproval(createLead({ scheduling_preferences_text: "not sure" })),
    false,
  );
});

test("hasUsefulSchedulingPreferences rejects vague timing answers", () => {
  assert.equal(hasUsefulSchedulingPreferences("weekday evenings after 6pm"), true);
  assert.equal(hasUsefulSchedulingPreferences("weekdays after 4 is best"), true);
  assert.equal(hasUsefulSchedulingPreferences("tuesdays and thursdays work best"), true);
  assert.equal(
    hasUsefulSchedulingPreferences("flexible, but weekdays after 4 is best"),
    true,
  );
  assert.equal(hasUsefulSchedulingPreferences("whenever"), false);
  assert.equal(hasUsefulSchedulingPreferences("not sure"), false);
  assert.equal(hasUsefulSchedulingPreferences("depends"), false);
});

test("isValidIntakeEmail accepts narrow valid emails only", () => {
  assert.equal(isValidIntakeEmail("alex@example.com"), true);
  assert.equal(isValidIntakeEmail("alex@example"), false);
  assert.equal(isValidIntakeEmail("not-an-email"), false);
});

test("resolveTrainerName resolves an allowed trainer by name or alias", () => {
  const result = resolveTrainerName("Coach Maya", [
    { id: "trainer-1", name: "Maya", aliases: ["coach maya", "maya coach"] },
    { id: "trainer-2", name: "Ben", aliases: ["coach ben"] },
  ]);

  assert.deepEqual(result, {
    kind: "resolved",
    trainer: { id: "trainer-1", name: "Maya", aliases: ["coach maya", "maya coach"] },
  });
});

test("resolveTrainerName tolerates light punctuation noise", () => {
  const result = resolveTrainerName("Maya?", [
    { id: "trainer-1", name: "Maya", aliases: ["coach maya", "maya coach"] },
  ]);

  assert.deepEqual(result, {
    kind: "resolved",
    trainer: { id: "trainer-1", name: "Maya", aliases: ["coach maya", "maya coach"] },
  });
});

test("resolveTrainerName reports ambiguity instead of guessing", () => {
  const result = resolveTrainerName("Coach", [
    { id: "trainer-1", name: "Maya", aliases: ["coach"] },
    { id: "trainer-2", name: "Ben", aliases: ["coach"] },
  ]);

  assert.deepEqual(result, {
    kind: "ambiguous",
    matches: [
      { id: "trainer-1", name: "Maya", aliases: ["coach"] },
      { id: "trainer-2", name: "Ben", aliases: ["coach"] },
    ],
  });
});

test("resolveTrainerName reports unknown when nothing matches", () => {
  const result = resolveTrainerName("Ghost", [
    { id: "trainer-1", name: "Maya", aliases: ["coach maya"] },
  ]);

  assert.deepEqual(result, {
    kind: "unknown",
    matches: [],
  });
});
