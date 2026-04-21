import { randomUUID } from "node:crypto";

import { createAwaitingTrainerApprovalPatch } from "./intake-leads.ts";
import { normalizePhoneNumber } from "./phone.ts";

type SmsIntakeLeadRecord = {
  id: string;
  requested_trainer_id: string | null;
  requested_trainer_name_raw: string | null;
  client_name: string | null;
  email: string | null;
  scheduling_preferences_text: string | null;
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

type PrepareTrainerApprovalRepo = {
  getTrainerContact(trainerId: string): Promise<{
    trainer_id: string;
    trainer_name: string | null;
    phone_number: string | null;
  } | null>;
  createApprovalRequest(input: {
    lead_id: string;
    trainer_id: string;
    request_code: string;
    expires_at: string;
  }): Promise<SmsTrainerApprovalRequestRecord>;
  updateLead(
    leadId: string,
    patch: Partial<SmsIntakeLeadRecord>,
  ): Promise<SmsIntakeLeadRecord>;
};

type HandleTrainerApprovalRepo = {
  findPendingRequestByCode(
    requestCode: string,
  ): Promise<SmsTrainerApprovalRequestRecord | null>;
  updateApprovalRequest(
    requestId: string,
    patch: Partial<SmsTrainerApprovalRequestRecord>,
  ): Promise<SmsTrainerApprovalRequestRecord>;
  updateLead(
    leadId: string,
    patch: Partial<SmsIntakeLeadRecord>,
  ): Promise<SmsIntakeLeadRecord>;
};

export function buildTrainerApprovalSummary(
  lead: Pick<
    SmsIntakeLeadRecord,
    | "client_name"
    | "email"
    | "scheduling_preferences_text"
    | "requested_trainer_name_raw"
  >,
  options?: { trainerName?: string | null },
): string {
  const trainerName =
    options?.trainerName?.trim() ||
    lead.requested_trainer_name_raw?.trim() ||
    "trainer";
  const clientName = lead.client_name?.trim() || "Unknown client";
  const email = lead.email?.trim() || "missing email";
  const preferences =
    lead.scheduling_preferences_text?.trim() || "missing preferences";

  return `${clientName} wants to train with ${trainerName}. Email: ${email}. Scheduling preferences: ${preferences}. Reply APPROVE <code> or REJECT <code>.`;
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
      request: SmsTrainerApprovalRequestRecord;
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

  if (!trainerContact || !trainerPhone) {
    const lead = await repo.updateLead(input.lead.id, {
      status: "needs_manual_review",
    });

    return {
      kind: "needs_manual_review",
      reason: "trainer_unreachable",
      lead,
    };
  }

  const summary = buildTrainerApprovalSummary(input.lead, {
    trainerName: trainerContact.trainer_name,
  });
  const requestCode = generateTrainerRequestCode(input.codeGenerator);
  const request = await repo.createApprovalRequest({
    lead_id: input.lead.id,
    trainer_id: trainerId,
    request_code: requestCode,
    expires_at: input.expiresAt,
  });
  const lead = await repo.updateLead(
    input.lead.id,
    createAwaitingTrainerApprovalPatch(summary),
  );

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
    decidedAt: string;
    decisionMessageId: string;
  },
): Promise<
  | { kind: "invalid" }
  | { kind: "unknown_request"; requestCode: string }
  | {
      kind: "approved" | "rejected";
      request: SmsTrainerApprovalRequestRecord;
      lead: SmsIntakeLeadRecord;
    }
> {
  const parsed = parseTrainerApprovalCommand(input.commandText);

  if (parsed.kind === "invalid") {
    return parsed;
  }

  const request = await repo.findPendingRequestByCode(parsed.requestCode);

  if (!request) {
    return {
      kind: "unknown_request",
      requestCode: parsed.requestCode,
    };
  }

  const decision = parsed.kind === "approve" ? "approved" : "rejected";
  const updatedRequest = await repo.updateApprovalRequest(request.id, {
    status: decision,
    decided_at: input.decidedAt,
    decision_message_id: input.decisionMessageId,
  });
  const lead = await repo.updateLead(request.lead_id, {
    status: decision,
  });

  return {
    kind: decision,
    request: updatedRequest,
    lead,
  };
}

function sanitizeRequestCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
