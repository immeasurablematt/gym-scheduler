import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCKED_SCHEDULING_REPLY,
  createOrResumeIntakeLead,
  getBlockedSchedulingReply,
  persistValidatedLeadUpdates,
} from "../lib/sms/intake-leads.ts";
import {
  buildTrainerApprovalSummary,
  generateTrainerRequestCode,
  handleTrainerApprovalDecision,
  parseTrainerApprovalCommand,
  prepareTrainerApprovalRequest,
} from "../lib/sms/trainer-approval.ts";
import {
  SETUP_DELAY_REPLY,
  promoteApprovedLead,
} from "../lib/sms/lead-promotion.ts";

function createLead(overrides = {}) {
  return {
    id: "lead-1",
    raw_phone: "(647) 555-0101",
    normalized_phone: "+16475550101",
    requested_trainer_name_raw: "Coach Maya",
    requested_trainer_id: "trainer-1",
    client_name: "Alex Client",
    email: "alex@example.com",
    scheduling_preferences_text: "weekday evenings after 6pm",
    scheduling_preferences_json: {},
    status: "collecting_info",
    conversation_state: "ready_for_approval",
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

function createApprovalRequest(overrides = {}) {
  return {
    id: "request-1",
    lead_id: "lead-1",
    trainer_id: "trainer-1",
    request_code: "ABC123",
    status: "pending",
    outbound_message_id: "outbound-1",
    decision_message_id: null,
    decided_at: null,
    expires_at: "2026-04-22T12:00:00.000Z",
    created_at: "2026-04-21T12:00:00.000Z",
    updated_at: "2026-04-21T12:00:00.000Z",
    ...overrides,
  };
}

test("createOrResumeIntakeLead creates a new lead or resumes the active lead by normalized phone", async () => {
  const createdInputs = [];
  const createdLead = createLead({
    id: "lead-created",
    raw_phone: "(416) 555-0102",
    normalized_phone: "+14165550102",
    requested_trainer_name_raw: null,
    requested_trainer_id: null,
    client_name: null,
    email: null,
    scheduling_preferences_text: null,
    status: "collecting_info",
    conversation_state: "needs_trainer",
  });
  const resumeRepo = {
    async findActiveLeadByNormalizedPhone(normalizedPhone) {
      assert.equal(normalizedPhone, "+16475550101");
      return createLead({ id: "lead-existing" });
    },
    async createLead() {
      throw new Error("should not create when resuming");
    },
  };
  const createRepo = {
    async findActiveLeadByNormalizedPhone(normalizedPhone) {
      assert.equal(normalizedPhone, "+14165550102");
      return null;
    },
    async createLead(input) {
      createdInputs.push(input);
      return createdLead;
    },
  };

  const resumed = await createOrResumeIntakeLead(resumeRepo, {
    rawPhone: "(647) 555-0101",
  });
  const created = await createOrResumeIntakeLead(createRepo, {
    rawPhone: "(416) 555-0102",
  });

  assert.equal(resumed.kind, "resumed");
  assert.equal(resumed.lead.id, "lead-existing");
  assert.equal(created.kind, "created");
  assert.equal(created.lead.id, "lead-created");
  assert.deepEqual(createdInputs, [
    {
      raw_phone: "(416) 555-0102",
      normalized_phone: "+14165550102",
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
    },
  ]);
});

test("persistValidatedLeadUpdates only writes validated intake fields and only trusts deterministic trainer identity", async () => {
  const updates = [];
  const repo = {
    async updateLead(leadId, patch) {
      updates.push({ leadId, patch });
      return createLead({
        id: leadId,
        ...patch,
      });
    },
  };

  const result = await persistValidatedLeadUpdates(repo, {
    lead: createLead(),
    updates: {
      requested_trainer_id: "trainer-from-agent",
      requested_trainer_name_raw: "Coach Ben",
      client_name: "  Jordan Client  ",
      email: "not-an-email",
      scheduling_preferences_text: "whenever",
      summary_for_trainer: "ignore me",
    },
    validatedTrainer: {
      id: "trainer-validated",
    },
  });

  assert.deepEqual(result.persistedFields, [
    "requested_trainer_id",
    "requested_trainer_name_raw",
    "client_name",
  ]);
  assert.deepEqual(updates, [
    {
      leadId: "lead-1",
      patch: {
        requested_trainer_id: "trainer-validated",
        requested_trainer_name_raw: "Coach Ben",
        client_name: "Jordan Client",
        conversation_state: "ready_for_approval",
      },
    },
  ]);
  assert.equal(result.lead.requested_trainer_id, "trainer-validated");
  assert.equal(result.lead.client_name, "Jordan Client");
  assert.equal(result.lead.email, "alex@example.com");
  assert.equal(
    result.lead.scheduling_preferences_text,
    "weekday evenings after 6pm",
  );
});

test("persistValidatedLeadUpdates keeps validated structured scheduling preferences", async () => {
  const updates = [];
  const repo = {
    async updateLead(leadId, patch) {
      updates.push({ leadId, patch });
      return createLead({
        id: leadId,
        ...patch,
      });
    },
  };

  const result = await persistValidatedLeadUpdates(repo, {
    lead: createLead({
      scheduling_preferences_text: null,
      scheduling_preferences_json: {},
    }),
    updates: {
      scheduling_preferences_text: "Tuesday and Thursday evenings after 6pm",
      scheduling_preferences_json: {
        preferred_days: ["tuesday", "thursday"],
        preferred_windows: ["evening"],
      },
    },
  });

  assert.deepEqual(result.persistedFields, [
    "scheduling_preferences_text",
    "scheduling_preferences_json",
  ]);
  assert.deepEqual(updates, [
    {
      leadId: "lead-1",
      patch: {
        scheduling_preferences_text: "Tuesday and Thursday evenings after 6pm",
        scheduling_preferences_json: {
          preferred_days: ["tuesday", "thursday"],
          preferred_windows: ["evening"],
        },
        conversation_state: "ready_for_approval",
      },
    },
  ]);
});

test("persistValidatedLeadUpdates keeps structured preference JSON even when the free-text summary stays below the text heuristic", async () => {
  const updates = [];
  const repo = {
    async updateLead(leadId, patch) {
      updates.push({ leadId, patch });
      return createLead({
        id: leadId,
        scheduling_preferences_text: null,
        scheduling_preferences_json: {},
        ...patch,
      });
    },
  };

  const result = await persistValidatedLeadUpdates(repo, {
    lead: createLead({
      scheduling_preferences_text: null,
      scheduling_preferences_json: {},
    }),
    updates: {
      scheduling_preferences_text: "after work",
      scheduling_preferences_json: {
        preferred_windows: ["evening"],
        flexibility: "medium",
      },
    },
  });

  assert.deepEqual(result.persistedFields, [
    "scheduling_preferences_json",
  ]);
  assert.deepEqual(updates, [
    {
      leadId: "lead-1",
      patch: {
        scheduling_preferences_json: {
          preferred_windows: ["evening"],
          flexibility: "medium",
        },
        conversation_state: "needs_preferences",
      },
    },
  ]);
});

test("getBlockedSchedulingReply uses the approved-design message before approval", () => {
  assert.equal(
    getBlockedSchedulingReply(createLead({ status: "collecting_info" })),
    BLOCKED_SCHEDULING_REPLY,
  );
  assert.equal(
    getBlockedSchedulingReply(createLead({ status: "awaiting_trainer_approval" })),
    BLOCKED_SCHEDULING_REPLY,
  );
  assert.equal(
    getBlockedSchedulingReply(createLead({ status: "approved" })),
    null,
  );
});

test("buildTrainerApprovalSummary injects the real request code", () => {
  const summary = buildTrainerApprovalSummary(createLead(), {
    trainerName: "Maya",
    requestCode: "ABC123",
  });

  assert.match(summary, /Reply APPROVE ABC123 or REJECT ABC123\.$/);
  assert.doesNotMatch(summary, /<code>/i);
});

test("trainer request code generation and parsing are deterministic", () => {
  assert.equal(generateTrainerRequestCode(() => "abc123xyz"), "ABC123");
  assert.deepEqual(parseTrainerApprovalCommand(" approve abc123 "), {
    kind: "approve",
    requestCode: "ABC123",
  });
  assert.deepEqual(parseTrainerApprovalCommand("REJECT zx91q2"), {
    kind: "reject",
    requestCode: "ZX91Q2",
  });
  assert.deepEqual(parseTrainerApprovalCommand("hello there"), {
    kind: "invalid",
  });
});

test("handleTrainerApprovalDecision authorizes decisions against the trainer sender identity", async () => {
  const lookups = [];
  const requestUpdates = [];
  const leadUpdates = [];
  const pendingRequest = createApprovalRequest();
  const repo = {
    async findDecisionRequest(input) {
      lookups.push(input);

      if (
        input.requestCode === "ABC123" &&
        input.senderPhone === "+16475550199"
      ) {
        return {
          kind: "pending",
          request: pendingRequest,
        };
      }

      return {
        kind: "unknown_code",
      };
    },
    async applyDecision(input) {
      requestUpdates.push({
        requestId: input.requestId,
        patch: {
          status: input.decision,
          decided_at: input.decidedAt,
          decision_message_id: input.decisionMessageId,
        },
      });
      leadUpdates.push({
        leadId: input.leadId,
        patch: {
          status: input.decision,
        },
      });

      return {
        request: {
          ...pendingRequest,
          status: input.decision,
          decided_at: input.decidedAt,
          decision_message_id: input.decisionMessageId,
        },
        lead: createLead({
          id: input.leadId,
          status: input.decision,
        }),
      };
    },
  };

  const approved = await handleTrainerApprovalDecision(repo, {
    commandText: "APPROVE abc123",
    senderPhone: "+16475550199",
    decidedAt: "2026-04-21T15:30:00.000Z",
    decisionMessageId: "inbound-approve",
  });
  const wrongTrainer = await handleTrainerApprovalDecision(repo, {
    commandText: "APPROVE abc123",
    senderPhone: "+16475550198",
    decidedAt: "2026-04-21T15:31:00.000Z",
    decisionMessageId: "inbound-wrong-trainer",
  });
  const rejected = await handleTrainerApprovalDecision(repo, {
    commandText: "REJECT abc123",
    senderPhone: "+16475550199",
    decidedAt: "2026-04-21T15:35:00.000Z",
    decisionMessageId: "inbound-reject",
  });

  assert.equal(approved.kind, "approved");
  assert.deepEqual(wrongTrainer, {
    kind: "unknown_code",
    requestCode: "ABC123",
  });
  assert.equal(rejected.kind, "rejected");
  assert.deepEqual(lookups, [
    {
      requestCode: "ABC123",
      senderPhone: "+16475550199",
    },
    {
      requestCode: "ABC123",
      senderPhone: "+16475550198",
    },
    {
      requestCode: "ABC123",
      senderPhone: "+16475550199",
    },
  ]);
  assert.deepEqual(requestUpdates, [
    {
      requestId: "request-1",
      patch: {
        status: "approved",
        decided_at: "2026-04-21T15:30:00.000Z",
        decision_message_id: "inbound-approve",
      },
    },
    {
      requestId: "request-1",
      patch: {
        status: "rejected",
        decided_at: "2026-04-21T15:35:00.000Z",
        decision_message_id: "inbound-reject",
      },
    },
  ]);
  assert.deepEqual(leadUpdates, [
    {
      leadId: "lead-1",
      patch: {
        status: "approved",
      },
    },
    {
      leadId: "lead-1",
      patch: {
        status: "rejected",
      },
    },
  ]);
});

test("handleTrainerApprovalDecision distinguishes invalid, unknown, expired, and already decided requests", async () => {
  const repo = {
    async findDecisionRequest({ requestCode }) {
      switch (requestCode) {
        case "ZZZ999":
          return {
            kind: "unknown_code",
          };
        case "EXP123":
          return {
            kind: "expired_request",
            request: createApprovalRequest({
              request_code: "EXP123",
              status: "expired",
            }),
          };
        case "APR123":
          return {
            kind: "already_decided",
            request: createApprovalRequest({
              request_code: "APR123",
              status: "approved",
              decided_at: "2026-04-21T16:00:00.000Z",
              decision_message_id: "decision-1",
            }),
          };
        default:
          throw new Error(`Unexpected request code: ${requestCode}`);
      }
    },
    async applyDecision() {
      throw new Error("should not apply terminal decision states");
    },
  };

  const invalid = await handleTrainerApprovalDecision(repo, {
    commandText: "hello there",
    senderPhone: "+16475550199",
    decidedAt: "2026-04-21T15:29:00.000Z",
    decisionMessageId: "inbound-invalid",
  });
  const unknown = await handleTrainerApprovalDecision(repo, {
    commandText: "APPROVE zzz999",
    senderPhone: "+16475550199",
    decidedAt: "2026-04-21T15:30:00.000Z",
    decisionMessageId: "inbound-unknown",
  });
  const expired = await handleTrainerApprovalDecision(repo, {
    commandText: "REJECT exp123",
    senderPhone: "+16475550199",
    decidedAt: "2026-04-21T15:31:00.000Z",
    decisionMessageId: "inbound-expired",
  });
  const alreadyDecided = await handleTrainerApprovalDecision(repo, {
    commandText: "APPROVE apr123",
    senderPhone: "+16475550199",
    decidedAt: "2026-04-21T15:32:00.000Z",
    decisionMessageId: "inbound-already-decided",
  });

  assert.deepEqual(invalid, {
    kind: "invalid_command",
  });
  assert.deepEqual(unknown, {
    kind: "unknown_code",
    requestCode: "ZZZ999",
  });
  assert.deepEqual(expired, {
    kind: "expired_request",
    requestCode: "EXP123",
  });
  assert.deepEqual(alreadyDecided, {
    kind: "already_decided",
    requestCode: "APR123",
    status: "approved",
  });
});

test("handleTrainerApprovalDecision leaves request and lead mutation to one atomic repo operation", async () => {
  const decisionWrites = [];
  const repo = {
    async findDecisionRequest() {
      return {
        kind: "pending",
        request: createApprovalRequest(),
      };
    },
    async applyDecision(input) {
      decisionWrites.push(input);
      throw new Error("atomic decision write failed");
    },
  };

  await assert.rejects(
    () =>
      handleTrainerApprovalDecision(repo, {
        commandText: "APPROVE abc123",
        senderPhone: "+16475550199",
        decidedAt: "2026-04-21T15:33:00.000Z",
        decisionMessageId: "inbound-approve",
      }),
    /atomic decision write failed/,
  );
  assert.deepEqual(decisionWrites, [
    {
      requestId: "request-1",
      leadId: "lead-1",
      decision: "approved",
      decidedAt: "2026-04-21T15:33:00.000Z",
      decisionMessageId: "inbound-approve",
    },
  ]);
});

test("prepareTrainerApprovalRequest returns needs_manual_review when the trainer has no reachable phone", async () => {
  const leadUpdates = [];
  const repo = {
    async getTrainerContact(trainerId) {
      assert.equal(trainerId, "trainer-1");
      return {
        trainer_id: "trainer-1",
        trainer_name: "Maya",
        phone_number: null,
      };
    },
    async createApprovalRequestWithLeadUpdate() {
      throw new Error(
        "should not create approval request without a reachable trainer phone",
      );
    },
    async updateLead(leadId, patch) {
      leadUpdates.push({ leadId, patch });
      return createLead({ id: leadId, ...patch });
    },
  };

  const result = await prepareTrainerApprovalRequest(repo, {
    lead: createLead(),
    expiresAt: "2026-04-22T12:00:00.000Z",
    codeGenerator: () => "abc123",
  });

  assert.deepEqual(result, {
    kind: "needs_manual_review",
    reason: "trainer_unreachable",
    lead: createLead({
      status: "needs_manual_review",
    }),
  });
  assert.deepEqual(leadUpdates, [
    {
      leadId: "lead-1",
      patch: {
        status: "needs_manual_review",
      },
    },
  ]);
});

test("prepareTrainerApprovalRequest fails closed when the trainer lookup does not match the requested trainer id", async () => {
  const leadUpdates = [];
  const repo = {
    async getTrainerContact() {
      return {
        trainer_id: "trainer-other",
        trainer_name: "Wrong Trainer",
        phone_number: "+16475550199",
      };
    },
    async createApprovalRequestWithLeadUpdate() {
      throw new Error("should not create approval requests for mismatched trainer lookups");
    },
    async updateLead(leadId, patch) {
      leadUpdates.push({ leadId, patch });
      return createLead({ id: leadId, ...patch });
    },
  };

  const result = await prepareTrainerApprovalRequest(repo, {
    lead: createLead({
      requested_trainer_id: "trainer-1",
    }),
    expiresAt: "2026-04-22T12:00:00.000Z",
    codeGenerator: () => "abc123",
  });

  assert.deepEqual(result, {
    kind: "needs_manual_review",
    reason: "trainer_unreachable",
    lead: createLead({
      requested_trainer_id: "trainer-1",
      status: "needs_manual_review",
    }),
  });
  assert.deepEqual(leadUpdates, [
    {
      leadId: "lead-1",
      patch: {
        status: "needs_manual_review",
      },
    },
  ]);
});

test("prepareTrainerApprovalRequest creates the request and lead update through one atomic repo boundary", async () => {
  const atomicWrites = [];
  const repo = {
    async getTrainerContact() {
      return {
        trainer_id: "trainer-1",
        trainer_name: "Maya",
        phone_number: "+16475550199",
      };
    },
    async createApprovalRequestWithLeadUpdate(input) {
      atomicWrites.push(input);

      return {
        request: createApprovalRequest({
          lead_id: input.lead_id,
          trainer_id: input.trainer_id,
          request_code: input.request_code,
          expires_at: input.expires_at,
        }),
        lead: createLead({
          status: "awaiting_trainer_approval",
          conversation_state: "awaiting_trainer_reply",
          summary_for_trainer: input.summary_for_trainer,
        }),
      };
    },
    async updateLead() {
      throw new Error("should not issue a separate lead update");
    },
  };

  const result = await prepareTrainerApprovalRequest(repo, {
    lead: createLead(),
    expiresAt: "2026-04-22T12:00:00.000Z",
    codeGenerator: () => "abc123",
  });

  const expectedSummary = buildTrainerApprovalSummary(createLead(), {
    trainerName: "Maya",
    requestCode: "ABC123",
  });

  assert.equal(result.kind, "request_created");
  assert.equal(result.request.request_code, "ABC123");
  assert.equal(result.trainerPhone, "+16475550199");
  assert.equal(result.summary, expectedSummary);
  assert.deepEqual(atomicWrites, [
    {
      lead_id: "lead-1",
      trainer_id: "trainer-1",
      request_code: "ABC123",
      expires_at: "2026-04-22T12:00:00.000Z",
      summary_for_trainer: expectedSummary,
    },
  ]);
});

test("prepareTrainerApprovalRequest surfaces atomic write failures without issuing a second durable step", async () => {
  const atomicWrites = [];
  const repo = {
    async getTrainerContact() {
      return {
        trainer_id: "trainer-1",
        trainer_name: "Maya",
        phone_number: "+16475550199",
      };
    },
    async createApprovalRequestWithLeadUpdate(input) {
      atomicWrites.push(input);
      throw new Error("atomic approval write failed");
    },
    async updateLead() {
      throw new Error("should not issue a separate lead update");
    },
  };

  await assert.rejects(
    () =>
      prepareTrainerApprovalRequest(repo, {
        lead: createLead(),
        expiresAt: "2026-04-22T12:00:00.000Z",
        codeGenerator: () => "abc123",
      }),
    /atomic approval write failed/,
  );
  assert.equal(atomicWrites.length, 1);
});

test("promoteApprovedLead creates linked user and client records through one atomic repo operation", async () => {
  const promotionCalls = [];
  const repo = {
    async promoteLeadAtomically(input) {
      promotionCalls.push(input);

      return {
        kind: "promoted",
        user: {
          id: input.user.id,
          email: input.user.email,
          full_name: input.user.full_name,
          role: "client",
          phone_number: input.user.phone_number,
        },
        client: {
          id: "client-1",
          user_id: input.user.id,
          trainer_id: input.client.trainer_id,
        },
        lead: createLead({
          status: "approved",
          approved_user_id: input.user.id,
          approved_client_id: "client-1",
        }),
      };
    },
  };

  const result = await promoteApprovedLead(repo, {
    lead: createLead({ status: "approved" }),
    createUuid: () => "uuid-123",
  });

  assert.equal(result.kind, "promoted");
  assert.equal(result.user.id, "sms-client-uuid-123");
  assert.equal(result.client.id, "client-1");
  assert.deepEqual(promotionCalls, [
    {
      lead_id: "lead-1",
      user: {
        id: "sms-client-uuid-123",
        email: "alex@example.com",
        full_name: "Alex Client",
        phone_number: "+16475550101",
        role: "client",
      },
      client: {
        trainer_id: "trainer-1",
      },
    },
  ]);
});

test("promoteApprovedLead routes duplicate identity conflicts to needs_manual_review without partial creation", async () => {
  const promotionCalls = [];
  const repo = {
    async promoteLeadAtomically(input) {
      promotionCalls.push(input);

      return {
        kind: "needs_manual_review",
        reason: "duplicate_identity_conflict",
        lead: createLead({
          status: "needs_manual_review",
        }),
      };
    },
  };

  const result = await promoteApprovedLead(repo, {
    lead: createLead({ status: "approved" }),
    createUuid: () => "uuid-123",
  });

  assert.deepEqual(result, {
    kind: "needs_manual_review",
    reason: "duplicate_identity_conflict",
    clientReply: SETUP_DELAY_REPLY,
    lead: createLead({
      status: "needs_manual_review",
    }),
  });
  assert.equal(promotionCalls.length, 1);
});
