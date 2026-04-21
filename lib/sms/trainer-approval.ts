import { randomUUID } from "node:crypto";

import { normalizePhoneNumber } from "./phone.ts";

type SmsIntakeLeadRecord = {
  id: string;
  raw_phone: string;
  normalized_phone: string;
  requested_trainer_id: string | null;
  requested_trainer_name_raw: string | null;
  client_name: string | null;
  email: string | null;
  scheduling_preferences_text: string | null;
  scheduling_preferences_json: Record<string, unknown>;
  status:
    | "collecting_info"
    | "awaiting_trainer_approval"
    | "approved"
    | "rejected"
    | "expired"
    | "needs_manual_review";
  conversation_state:
    | "needs_trainer"
    | "needs_name"
    | "needs_email"
    | "needs_preferences"
    | "ready_for_approval"
    | "awaiting_trainer_reply";
  summary_for_trainer: string | null;
  last_inbound_message_id: string | null;
  last_outbound_message_id: string | null;
  approved_user_id: string | null;
  approved_client_id: string | null;
  created_at: string;
  updated_at: string;
};

type SmsTrainerApprovalRequestRecord = {
  id: string;
  lead_id: string;
  trainer_id: string;
  request_code: string;
  status: "pending" | "approved" | "rejected" | "expired";
  outbound_message_id: string | null;
  decision_message_id: string | null;
  decided_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type SmsTrainerApprovalRequestCreateRecord = Pick<
  SmsTrainerApprovalRequestRecord,
  "id" | "lead_id" | "trainer_id" | "request_code"
>;

type SmsTrainerApprovalDecisionRequestRecord = Pick<
  SmsTrainerApprovalRequestRecord,
  "id" | "lead_id" | "trainer_id" | "request_code" | "status"
>;

type PrepareTrainerApprovalRepo = {
  getTrainerContact(trainerId: string): Promise<{
    trainer_id: string;
    trainer_name: string | null;
    phone_number: string | null;
  } | null>;
  createApprovalRequestWithLeadUpdate(input: {
    lead_id: string;
    trainer_id: string;
    request_code: string;
    expires_at: string;
    summary_for_trainer: string;
  }): Promise<{
    request: SmsTrainerApprovalRequestCreateRecord;
    lead: SmsIntakeLeadRecord;
  }>;
  updateLead(
    leadId: string,
    patch: Partial<SmsIntakeLeadRecord>,
  ): Promise<SmsIntakeLeadRecord>;
};

type TrainerDecisionLookup =
  | {
      kind: "pending";
      request: SmsTrainerApprovalDecisionRequestRecord;
    }
  | {
      kind: "unknown_code";
    }
  | {
      kind: "expired_request";
      request: SmsTrainerApprovalDecisionRequestRecord;
    }
  | {
      kind: "already_decided";
      request: SmsTrainerApprovalDecisionRequestRecord;
    };

type HandleTrainerApprovalRepo = {
  findDecisionRequest(input: {
    requestCode: string;
    senderPhone: string;
  }): Promise<TrainerDecisionLookup>;
  applyDecision(input: {
    requestId: string;
    leadId: string;
    decision: "approved" | "rejected";
    decidedAt: string;
    decisionMessageId: string;
  }): Promise<{
    request: SmsTrainerApprovalDecisionRequestRecord;
    lead: SmsIntakeLeadRecord;
  }>;
};

export function buildTrainerApprovalSummary(
  lead: Pick<
    SmsIntakeLeadRecord,
    | "client_name"
    | "email"
    | "scheduling_preferences_text"
    | "requested_trainer_name_raw"
  >,
  options: { trainerName?: string | null; requestCode: string },
): string {
  const trainerName =
    options.trainerName?.trim() ||
    lead.requested_trainer_name_raw?.trim() ||
    "trainer";
  const clientName = lead.client_name?.trim() || "Unknown client";
  const email = lead.email?.trim() || "missing email";
  const preferences =
    lead.scheduling_preferences_text?.trim() || "missing preferences";
  const requestCode = sanitizeRequestCode(options.requestCode);

  if (!requestCode) {
    throw new Error("Trainer approval summary requires a request code");
  }

  return `${clientName} wants to train with ${trainerName}. Email: ${email}. Scheduling preferences: ${preferences}. Reply APPROVE ${requestCode} or REJECT ${requestCode}.`;
}

export function generateTrainerRequestCode(
  tokenFactory: () => string = randomUUID,
): string {
  const primary = sanitizeRequestCode(tokenFactory());

  if (primary.length >= 6) {
    return primary.slice(0, 6);
  }

  return `${primary}${sanitizeRequestCode(randomUUID())}`.slice(0, 6);
}

export function parseTrainerApprovalCommand(
  commandText: string,
):
  | { kind: "approve"; requestCode: string }
  | { kind: "reject"; requestCode: string }
  | { kind: "invalid" } {
  const match = commandText.match(/^\s*(approve|reject)\s+(.+?)\s*$/i);

  if (!match) {
    return { kind: "invalid" };
  }

  const requestCode = sanitizeRequestCode(match[2]);

  if (!requestCode) {
    return { kind: "invalid" };
  }

  return {
    kind: match[1].toLowerCase() === "approve" ? "approve" : "reject",
    requestCode,
  };
}

export async function prepareTrainerApprovalRequest(
  repo: PrepareTrainerApprovalRepo,
  input: {
    lead: SmsIntakeLeadRecord;
    expiresAt: string;
    codeGenerator?: () => string;
  },
): Promise<
  | {
      kind: "needs_manual_review";
      reason: "trainer_unreachable";
      lead: SmsIntakeLeadRecord;
    }
  | {
      kind: "request_created";
      request: SmsTrainerApprovalRequestCreateRecord;
      lead: SmsIntakeLeadRecord;
      trainerPhone: string;
      summary: string;
    }
> {
  const trainerId = input.lead.requested_trainer_id;

  if (!trainerId) {
    const lead = await repo.updateLead(input.lead.id, {
      status: "needs_manual_review",
    });

    return {
      kind: "needs_manual_review",
      reason: "trainer_unreachable",
      lead,
    };
  }

  const trainerContact = await repo.getTrainerContact(trainerId);
  const trainerPhone = normalizePhoneNumber(trainerContact?.phone_number);

  if (
    !trainerContact ||
    trainerContact.trainer_id !== trainerId ||
    !trainerPhone
  ) {
    const lead = await repo.updateLead(input.lead.id, {
      status: "needs_manual_review",
    });

    return {
      kind: "needs_manual_review",
      reason: "trainer_unreachable",
      lead,
    };
  }

  const requestCode = generateTrainerRequestCode(input.codeGenerator);
  const summary = buildTrainerApprovalSummary(input.lead, {
    trainerName: trainerContact.trainer_name,
    requestCode,
  });
  const { request, lead } = await repo.createApprovalRequestWithLeadUpdate({
    lead_id: input.lead.id,
    trainer_id: trainerId,
    request_code: requestCode,
    expires_at: input.expiresAt,
    summary_for_trainer: summary,
  });

  return {
    kind: "request_created",
    request,
    lead,
    trainerPhone,
    summary,
  };
}

export async function handleTrainerApprovalDecision(
  repo: HandleTrainerApprovalRepo,
  input: {
    commandText: string;
    senderPhone: string;
    decidedAt: string;
    decisionMessageId: string;
  },
): Promise<
  | { kind: "invalid_command" }
  | { kind: "unknown_code"; requestCode: string }
  | { kind: "expired_request"; requestCode: string }
  | {
      kind: "already_decided";
      requestCode: string;
      status: Exclude<SmsTrainerApprovalRequestRecord["status"], "pending">;
    }
  | {
      kind: "approved" | "rejected";
      request: SmsTrainerApprovalDecisionRequestRecord;
      lead: SmsIntakeLeadRecord;
    }
> {
  const parsed = parseTrainerApprovalCommand(input.commandText);

  if (parsed.kind === "invalid") {
    return { kind: "invalid_command" };
  }

  const senderPhone =
    normalizePhoneNumber(input.senderPhone) ?? input.senderPhone.trim();
  const lookup = await repo.findDecisionRequest({
    requestCode: parsed.requestCode,
    senderPhone,
  });

  if (lookup.kind === "unknown_code") {
    return {
      kind: "unknown_code",
      requestCode: parsed.requestCode,
    };
  }

  if (lookup.kind === "expired_request") {
    return {
      kind: "expired_request",
      requestCode: parsed.requestCode,
    };
  }

  if (lookup.kind === "already_decided") {
    return {
      kind: "already_decided",
      requestCode: parsed.requestCode,
      status: lookup.request.status as Exclude<
        SmsTrainerApprovalRequestRecord["status"],
        "pending"
      >,
    };
  }

  const decision = parsed.kind === "approve" ? "approved" : "rejected";
  const { request, lead } = await repo.applyDecision({
    requestId: lookup.request.id,
    leadId: lookup.request.lead_id,
    decision,
    decidedAt: input.decidedAt,
    decisionMessageId: input.decisionMessageId,
  });

  return {
    kind: decision,
    request,
    lead,
  };
}

function sanitizeRequestCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
