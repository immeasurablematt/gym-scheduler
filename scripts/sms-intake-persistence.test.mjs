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

test("persistValidatedLeadUpdates only writes validated intake fields", async () => {
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
      requested_trainer_id: "trainer-2",
      requested_trainer_name_raw: "Coach Ben",
      client_name: "  Jordan Client  ",
      email: "not-an-email",
      scheduling_preferences_text: "whenever",
      summary_for_trainer: "ignore me",
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
        requested_trainer_id: "trainer-2",
        requested_trainer_name_raw: "Coach Ben",
        client_name: "Jordan Client",
        conversation_state: "ready_for_approval",
      },
    },
  ]);
  assert.equal(result.lead.client_name, "Jordan Client");
  assert.equal(result.lead.email, "alex@example.com");
  assert.equal(result.lead.scheduling_preferences_text, "weekday evenings after 6pm");
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

test("handleTrainerApprovalDecision applies approve and reject deterministically", async () => {
  const requestUpdates = [];
  const leadUpdates = [];
  const pendingRequest = {
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
  };
  const repo = {
    async findPendingRequestByCode(requestCode) {
      return requestCode === "ABC123" ? pendingRequest : null;
    },
    async updateApprovalRequest(requestId, patch) {
      requestUpdates.push({ requestId, patch });
      return { ...pendingRequest, ...patch };
    },
    async updateLead(leadId, patch) {
      leadUpdates.push({ leadId, patch });
      return createLead({ id: leadId, ...patch });
    },
  };

  const approved = await handleTrainerApprovalDecision(repo, {
    commandText: "APPROVE abc123",
    decidedAt: "2026-04-21T15:30:00.000Z",
    decisionMessageId: "inbound-approve",
  });
  const rejected = await handleTrainerApprovalDecision(repo, {
    commandText: "REJECT abc123",
    decidedAt: "2026-04-21T15:35:00.000Z",
    decisionMessageId: "inbound-reject",
  });

  assert.equal(approved.kind, "approved");
  assert.equal(rejected.kind, "rejected");
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
    async createApprovalRequest() {
      throw new Error("should not create approval request without trainer phone");
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

test("prepareTrainerApprovalRequest creates a deterministic approval request when the trainer is reachable", async () => {
  const createdRequests = [];
  const leadUpdates = [];
  const repo = {
    async getTrainerContact() {
      return {
        trainer_id: "trainer-1",
        trainer_name: "Maya",
        phone_number: "+16475550199",
      };
    },
    async createApprovalRequest(input) {
      createdRequests.push(input);
      return {
        id: "request-1",
        lead_id: input.lead_id,
        trainer_id: input.trainer_id,
        request_code: input.request_code,
        status: "pending",
        outbound_message_id: null,
        decision_message_id: null,
        decided_at: null,
        expires_at: input.expires_at,
        created_at: "2026-04-21T12:00:00.000Z",
        updated_at: "2026-04-21T12:00:00.000Z",
      };
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

  assert.equal(result.kind, "request_created");
  assert.equal(result.request.request_code, "ABC123");
  assert.equal(result.trainerPhone, "+16475550199");
  assert.equal(
    result.summary,
    buildTrainerApprovalSummary(createLead(), { trainerName: "Maya" }),
  );
  assert.deepEqual(createdRequests, [
    {
      lead_id: "lead-1",
      trainer_id: "trainer-1",
      request_code: "ABC123",
      expires_at: "2026-04-22T12:00:00.000Z",
    },
  ]);
  assert.deepEqual(leadUpdates, [
    {
      leadId: "lead-1",
      patch: {
        status: "awaiting_trainer_approval",
        conversation_state: "awaiting_trainer_reply",
        summary_for_trainer: buildTrainerApprovalSummary(createLead(), {
          trainerName: "Maya",
        }),
      },
    },
  ]);
});

test("promoteApprovedLead creates linked user and client records for approved leads", async () => {
  const userInserts = [];
  const clientInserts = [];
  const leadUpdates = [];
  const repo = {
    async findUserIdentityConflict() {
      return null;
    },
    async createUser(input) {
      userInserts.push(input);
      return {
        ...input,
        created_at: "2026-04-21T12:00:00.000Z",
        updated_at: "2026-04-21T12:00:00.000Z",
      };
    },
    async createClient(input) {
      clientInserts.push(input);
      return {
        id: "client-1",
        ...input,
        fitness_goals: null,
        medical_conditions: null,
        membership_start_date: null,
        membership_end_date: null,
        created_at: "2026-04-21T12:00:00.000Z",
        updated_at: "2026-04-21T12:00:00.000Z",
      };
    },
    async updateLead(leadId, patch) {
      leadUpdates.push({ leadId, patch });
      return createLead({ id: leadId, status: "approved", ...patch });
    },
  };

  const result = await promoteApprovedLead(repo, {
    lead: createLead({ status: "approved" }),
    createUuid: () => "uuid-123",
  });

  assert.equal(result.kind, "promoted");
  assert.equal(result.user.id, "sms-client-uuid-123");
  assert.equal(result.client.id, "client-1");
  assert.deepEqual(userInserts, [
    {
      id: "sms-client-uuid-123",
      email: "alex@example.com",
      full_name: "Alex Client",
      role: "client",
      phone_number: "+16475550101",
    },
  ]);
  assert.deepEqual(clientInserts, [
    {
      user_id: "sms-client-uuid-123",
      trainer_id: "trainer-1",
    },
  ]);
  assert.deepEqual(leadUpdates, [
    {
      leadId: "lead-1",
      patch: {
        approved_user_id: "sms-client-uuid-123",
        approved_client_id: "client-1",
        status: "approved",
      },
    },
  ]);
});

test("promoteApprovedLead routes duplicate identity conflicts to needs_manual_review without partial creation", async () => {
  const userInserts = [];
  const clientInserts = [];
  const leadUpdates = [];
  const repo = {
    async findUserIdentityConflict(identity) {
      assert.deepEqual(identity, {
        email: "alex@example.com",
        normalizedPhone: "+16475550101",
      });
      return {
        field: "email",
        user_id: "existing-user-1",
      };
    },
    async createUser(input) {
      userInserts.push(input);
      throw new Error("should not create user on duplicate conflict");
    },
    async createClient(input) {
      clientInserts.push(input);
      throw new Error("should not create client on duplicate conflict");
    },
    async updateLead(leadId, patch) {
      leadUpdates.push({ leadId, patch });
      return createLead({ id: leadId, ...patch });
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
  assert.deepEqual(userInserts, []);
  assert.deepEqual(clientInserts, []);
  assert.deepEqual(leadUpdates, [
    {
      leadId: "lead-1",
      patch: {
        status: "needs_manual_review",
      },
    },
  ]);
});
