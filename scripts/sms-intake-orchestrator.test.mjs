import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrainerApprovalConversation,
  continueIntakeConversation,
  routeInboundSmsMessage,
} from "../lib/sms/orchestrator.ts";

function createKnownClientContext() {
  return {
    client: {
      id: "client-1",
      trainer_id: "trainer-1",
    },
    clientUser: {
      id: "user-1",
      phone_number: "+16475550101",
    },
    normalizedPhone: "+16475550101",
    trainer: {
      id: "trainer-1",
      user_id: "trainer-user-1",
    },
    trainerUser: {
      id: "trainer-user-1",
      phone_number: "+16475550199",
    },
  };
}

function createLead(overrides = {}) {
  return {
    id: "lead-1",
    raw_phone: "(647) 555-0101",
    normalized_phone: "+16475550101",
    requested_trainer_name_raw: null,
    requested_trainer_id: null,
    client_name: null,
    email: null,
    scheduling_preferences_text: null,
    scheduling_preferences_json: {},
    status: "collecting_info",
    conversation_state: "needs_trainer",
    summary_for_trainer: null,
    last_inbound_message_id: null,
    last_outbound_message_id: null,
    approved_user_id: null,
    approved_client_id: null,
    created_at: "2026-04-21T12:00:00.000Z",
    updated_at: "2026-04-21T12:00:00.000Z",
    ...overrides,
  };
}

test("routeInboundSmsMessage sends known approved clients into the existing booking flow before intake or trainer approval", async () => {
  let leadLookupCalled = false;
  let trainerReplyCalled = false;
  let intakeCalled = false;

  const result = await routeInboundSmsMessage(
    {
      body: "availability tomorrow morning",
      fromPhone: "+16475550101",
      toPhone: "+16475550000",
      inboundMessageId: "inbound-1",
    },
    {
      async resolvePhoneActorByPhone() {
        return {
          kind: "known_client",
          value: createKnownClientContext(),
        };
      },
      async findActiveIntakeLeadByPhone() {
        leadLookupCalled = true;
        return createLead();
      },
      async buildKnownClientReply() {
        return {
          body: "Known-client booking reply",
          offerSetId: "offer-set-1",
        };
      },
      async continueIntakeConversation() {
        intakeCalled = true;
        throw new Error("should not continue intake for a known approved client");
      },
      async buildTrainerApprovalConversation() {
        trainerReplyCalled = true;
        throw new Error("should not route known clients through trainer approval");
      },
    },
  );

  assert.equal(leadLookupCalled, false);
  assert.equal(intakeCalled, false);
  assert.equal(trainerReplyCalled, false);
  assert.deepEqual(result, {
    messages: [
      {
        body: "Known-client booking reply",
        clientId: "client-1",
        offerSetId: "offer-set-1",
        toPhone: "+16475550101",
        trainerId: "trainer-1",
      },
    ],
  });
});

test("routeInboundSmsMessage continues an active intake lead before trainer approval routing", async () => {
  let trainerReplyCalled = false;

  const result = await routeInboundSmsMessage(
    {
      body: "still waiting",
      fromPhone: "+16475550101",
      toPhone: "+16475550000",
      inboundMessageId: "inbound-2",
    },
    {
      async resolvePhoneActorByPhone() {
        return {
          kind: "trainer",
          trainer: {
            id: "trainer-1",
            name: "Coach Maya",
            normalizedPhone: "+16475550101",
          },
        };
      },
      async findActiveIntakeLeadByPhone() {
        return createLead({
          status: "awaiting_trainer_approval",
          conversation_state: "awaiting_trainer_reply",
          requested_trainer_id: "trainer-1",
        });
      },
      async continueIntakeConversation({ lead }) {
        assert.equal(lead.id, "lead-1");
        return {
          messages: [
            {
              body: "Intake branch reply",
              toPhone: "+16475550101",
            },
          ],
        };
      },
      async buildTrainerApprovalConversation() {
        trainerReplyCalled = true;
        throw new Error("should not prefer trainer approval before the active lead");
      },
    },
  );

  assert.equal(trainerReplyCalled, false);
  assert.deepEqual(result.messages, [
    {
      body: "Intake branch reply",
      toPhone: "+16475550101",
    },
  ]);
});

test("continueIntakeConversation blocks explicit scheduling attempts from unapproved leads", async () => {
  const result = await continueIntakeConversation(
    {
      body: "Can you book me tomorrow at 6?",
      fromPhone: "+16475550101",
      inboundMessageId: "inbound-3",
      lead: createLead({
        status: "awaiting_trainer_approval",
        conversation_state: "awaiting_trainer_reply",
        requested_trainer_id: "trainer-1",
        client_name: "Alex Client",
        email: "alex@example.com",
        scheduling_preferences_text: "weekday evenings after 6pm",
      }),
    },
    {
      async listTrainerCandidates() {
        throw new Error("should not inspect trainers for blocked scheduling");
      },
      async listRecentTranscriptByPhone() {
        throw new Error("should not inspect transcript for blocked scheduling");
      },
      async runReceptionistAgent() {
        throw new Error("should not run the receptionist agent for blocked scheduling");
      },
      async createOrResumeIntakeLead() {
        throw new Error("should not create a lead when one already exists");
      },
      async persistValidatedLeadUpdates() {
        throw new Error("should not persist updates for blocked scheduling");
      },
      async prepareTrainerApprovalRequest() {
        throw new Error("should not create another approval request");
      },
    },
  );

  assert.deepEqual(result.messages, [
    {
      body: "I can help get you set up first. Once your trainer approves, I can help with scheduling by text.",
      toPhone: "+16475550101",
    },
  ]);
});

test("continueIntakeConversation creates a new lead and starts intake for an unknown sender", async () => {
  let createdLead = false;

  const result = await continueIntakeConversation(
    {
      body: "Hi there",
      fromPhone: "+16475550101",
      inboundMessageId: "inbound-4",
      lead: null,
    },
    {
      async createOrResumeIntakeLead() {
        createdLead = true;
        return {
          kind: "created",
          lead: createLead(),
        };
      },
      async listTrainerCandidates() {
        return [
          {
            id: "trainer-1",
            name: "Coach Maya",
          },
        ];
      },
      async listRecentTranscriptByPhone() {
        return [];
      },
      async runReceptionistAgent() {
        return {
          confidence_flags: ["fallback:test"],
          follow_up_question: "Which trainer would you like to work with?",
          needs_follow_up: true,
          preference_json: {},
          preference_summary: "",
          resolved_fields: {},
          summary_text: "Collected: no structured intake details yet.",
        };
      },
      async persistValidatedLeadUpdates({ lead }) {
        return {
          lead,
          persistedFields: [],
        };
      },
      async prepareTrainerApprovalRequest() {
        throw new Error("should not request trainer approval before the lead is complete");
      },
    },
  );

  assert.equal(createdLead, true);
  assert.deepEqual(result.messages, [
    {
      body: "Which trainer would you like to work with?",
      toPhone: "+16475550101",
    },
  ]);
});

test("continueIntakeConversation keeps the intake happy path when the receptionist agent returns structured output", async () => {
  let persistedUpdates = null;

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
        persistedUpdates = updates;

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

  assert.deepEqual(persistedUpdates, {
    client_name: "Alex",
    scheduling_preferences_text: "evenings",
    scheduling_preferences_json: { preferred_time: "evenings" },
  });
  assert.deepEqual(result.messages, [
    {
      body: "What is the best email address to reach you at?",
      toPhone: "+16475550101",
    },
  ]);
});

test("continueIntakeConversation accepts a unique trainer first name and moves to the next intake question", async () => {
  let persistedTrainer = null;

  const result = await continueIntakeConversation(
    {
      body: "Gabe",
      fromPhone: "+16475550101",
      inboundMessageId: "inbound-trainer-first-name",
      lead: createLead({
        requested_trainer_name_raw: null,
        requested_trainer_id: null,
        conversation_state: "needs_trainer",
      }),
    },
    {
      async listTrainerCandidates() {
        return [{ id: "trainer-1", name: "Gabe Loiselle" }];
      },
      async listRecentTranscriptByPhone() {
        return [{ direction: "inbound", body: "Gabe" }];
      },
      async runReceptionistAgent() {
        return {
          confidence_flags: ["fallback:test"],
          follow_up_question: "Which trainer would you like to work with?",
          needs_follow_up: true,
          preference_json: {},
          preference_summary: "",
          resolved_fields: {},
          summary_text: "Collected: trainer Gabe.",
        };
      },
      async persistValidatedLeadUpdates({ lead, updates, validatedTrainer }) {
        persistedTrainer = { updates, validatedTrainer };

        return {
          lead: {
            ...lead,
            requested_trainer_name_raw: updates.requested_trainer_name_raw,
            requested_trainer_id: validatedTrainer?.id ?? null,
            conversation_state: "needs_name",
          },
          persistedFields: ["requested_trainer_name_raw", "requested_trainer_id"],
        };
      },
      async createOrResumeIntakeLead() {
        throw new Error("should not create a new lead for an existing conversation");
      },
      async prepareTrainerApprovalRequest() {
        throw new Error("lead is not ready for approval yet");
      },
    },
  );

  assert.deepEqual(persistedTrainer, {
    updates: {
      requested_trainer_name_raw: "Gabe",
    },
    validatedTrainer: { id: "trainer-1" },
  });
  assert.deepEqual(result.messages, [
    {
      body: "What is your full name?",
      toPhone: "+16475550101",
    },
  ]);
});

test("continueIntakeConversation uses the default fallback runner wiring when OPENAI_API_KEY is missing", async () => {
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";

  try {
    const result = await continueIntakeConversation(
      {
        body: "Hi there",
        fromPhone: "+16475550101",
        inboundMessageId: "inbound-default-runner-fallback",
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
          return [];
        },
        async persistValidatedLeadUpdates({ lead }) {
          return {
            lead,
            persistedFields: [],
          };
        },
        async prepareTrainerApprovalRequest() {
          throw new Error("lead is not ready for approval yet");
        },
      },
    );

    assert.deepEqual(result.messages, [
      {
        body: "What is your full name?",
        toPhone: "+16475550101",
      },
    ]);
  } finally {
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  }
});

test("buildTrainerApprovalConversation returns retry messaging for invalid and unknown approval codes", async () => {
  const invalid = await buildTrainerApprovalConversation(
    {
      body: "hello there",
      fromPhone: "+16475550199",
      inboundMessageId: "inbound-invalid",
    },
    {
      async handleTrainerApprovalDecision() {
        return {
          kind: "invalid_command",
        };
      },
      async promoteApprovedLead() {
        throw new Error("should not promote on invalid commands");
      },
    },
  );
  const unknown = await buildTrainerApprovalConversation(
    {
      body: "APPROVE ABC123",
      fromPhone: "+16475550199",
      inboundMessageId: "inbound-unknown",
    },
    {
      async handleTrainerApprovalDecision() {
        return {
          kind: "unknown_code",
          requestCode: "ABC123",
        };
      },
      async promoteApprovedLead() {
        throw new Error("should not promote on unknown approval codes");
      },
    },
  );

  assert.deepEqual(invalid.messages, [
    {
      body: "Please reply APPROVE <code> or REJECT <code> with the approval code from the lead summary.",
      toPhone: "+16475550199",
    },
  ]);
  assert.deepEqual(unknown.messages, [
    {
      body: "I couldn't find approval code ABC123. Please reply with the exact code from the lead summary.",
      toPhone: "+16475550199",
    },
  ]);
});

test("buildTrainerApprovalConversation approves the lead, promotes the client, and sends both trainer and client messages", async () => {
  const result = await buildTrainerApprovalConversation(
    {
      body: "APPROVE ABC123",
      fromPhone: "+16475550199",
      inboundMessageId: "inbound-approved",
    },
    {
      async handleTrainerApprovalDecision() {
        return {
          kind: "approved",
          request: {
            id: "request-1",
            lead_id: "lead-1",
            trainer_id: "trainer-1",
            request_code: "ABC123",
          },
          lead: createLead({
            status: "approved",
            requested_trainer_id: "trainer-1",
            client_name: "Alex Client",
            email: "alex@example.com",
          }),
        };
      },
      async promoteApprovedLead() {
        return {
          kind: "promoted",
          user: {
            id: "sms-client-1",
            full_name: "Alex Client",
            phone_number: "+16475550101",
          },
          client: {
            id: "client-1",
            trainer_id: "trainer-1",
          },
          lead: createLead({
            status: "approved",
            approved_user_id: "sms-client-1",
            approved_client_id: "client-1",
          }),
        };
      },
    },
  );

  assert.deepEqual(result.messages, [
    {
      body: "Approved Alex Client. They can now use SMS scheduling.",
      toPhone: "+16475550199",
      trainerId: "trainer-1",
    },
    {
      body: "You're all set. You can now text me for availability and booking.",
      clientId: "client-1",
      trainerId: "trainer-1",
      toPhone: "+16475550101",
    },
  ]);
});

test("routeInboundSmsMessage hands the approved phone back into the known-client path on the next message", async () => {
  const knownClientContext = createKnownClientContext();
  const actors = [
    {
      kind: "trainer",
      trainer: {
        id: "trainer-1",
        name: "Coach Maya",
        normalizedPhone: "+16475550199",
      },
    },
    {
      kind: "known_client",
      value: knownClientContext,
    },
  ];

  const firstResult = await routeInboundSmsMessage(
    {
      body: "APPROVE ABC123",
      fromPhone: "+16475550199",
      toPhone: "+16475550000",
      inboundMessageId: "inbound-approval",
    },
    {
      async resolvePhoneActorByPhone() {
        return actors.shift();
      },
      async findActiveIntakeLeadByPhone() {
        return null;
      },
      async buildTrainerApprovalConversation() {
        return {
          messages: [
            {
              body: "Approved Alex Client. They can now use SMS scheduling.",
              toPhone: "+16475550199",
              trainerId: "trainer-1",
            },
          ],
        };
      },
    },
  );

  const secondResult = await routeInboundSmsMessage(
    {
      body: "availability Friday morning",
      fromPhone: "+16475550101",
      toPhone: "+16475550000",
      inboundMessageId: "inbound-known-client",
    },
    {
      async resolvePhoneActorByPhone() {
        return actors.shift();
      },
      async findActiveIntakeLeadByPhone() {
        throw new Error("should not check intake leads after the phone becomes a known client");
      },
      async buildKnownClientReply() {
        return {
          body: "Known-client booking reply after approval",
          offerSetId: null,
        };
      },
    },
  );

  assert.deepEqual(firstResult.messages, [
    {
      body: "Approved Alex Client. They can now use SMS scheduling.",
      toPhone: "+16475550199",
      trainerId: "trainer-1",
    },
  ]);
  assert.deepEqual(secondResult.messages, [
    {
      body: "Known-client booking reply after approval",
      clientId: "client-1",
      offerSetId: null,
      toPhone: "+16475550101",
      trainerId: "trainer-1",
    },
  ]);
});
