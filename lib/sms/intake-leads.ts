import {
  getNextIntakeConversationState,
  hasUsefulSchedulingPreferences,
  isValidIntakeEmail,
} from "./intake-state.ts";
import { normalizePhoneNumber } from "./phone.ts";

export const BLOCKED_SCHEDULING_REPLY =
  "I can help get you set up first. Once your trainer approves, I can help with scheduling by text.";

type SmsIntakeLeadRecord = {
  id: string;
  raw_phone: string;
  normalized_phone: string;
  requested_trainer_name_raw: string | null;
  requested_trainer_id: string | null;
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

type CreateOrResumeLeadRepo = {
  findActiveLeadByNormalizedPhone(
    normalizedPhone: string,
  ): Promise<SmsIntakeLeadRecord | null>;
  createLead(
    input: Omit<SmsIntakeLeadRecord, "id" | "created_at" | "updated_at">,
  ): Promise<SmsIntakeLeadRecord>;
};

type PersistValidatedLeadRepo = {
  updateLead(
    leadId: string,
    patch: Partial<SmsIntakeLeadRecord>,
  ): Promise<SmsIntakeLeadRecord>;
};

type PersistValidatedLeadUpdatesInput = {
  lead: SmsIntakeLeadRecord;
  updates: Partial<SmsIntakeLeadRecord> & Record<string, unknown>;
  validatedTrainer?: {
    id: string | null | undefined;
  } | null;
};

export async function createOrResumeIntakeLead(
  repo: CreateOrResumeLeadRepo,
  input: { rawPhone: string },
): Promise<
  | { kind: "created"; lead: SmsIntakeLeadRecord }
  | { kind: "resumed"; lead: SmsIntakeLeadRecord }
> {
  const normalizedPhone = normalizePhoneNumber(input.rawPhone);

  if (!normalizedPhone) {
    throw new Error("A valid intake phone number is required");
  }

  const existingLead =
    await repo.findActiveLeadByNormalizedPhone(normalizedPhone);

  if (existingLead) {
    return {
      kind: "resumed",
      lead: existingLead,
    };
  }

  const lead = await repo.createLead({
    raw_phone: input.rawPhone,
    normalized_phone: normalizedPhone,
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
  });

  return {
    kind: "created",
    lead,
  };
}

export async function persistValidatedLeadUpdates(
  repo: PersistValidatedLeadRepo,
  input: PersistValidatedLeadUpdatesInput,
): Promise<{ lead: SmsIntakeLeadRecord; persistedFields: string[] }> {
  const patch: Partial<SmsIntakeLeadRecord> = {};
  const persistedFields: string[] = [];

  const trainerId = normalizeOptionalText(input.validatedTrainer?.id);
  if (trainerId) {
    patch.requested_trainer_id = trainerId;
    persistedFields.push("requested_trainer_id");
  }

  const trainerName = normalizeOptionalText(
    input.updates.requested_trainer_name_raw,
  );
  if (trainerName) {
    patch.requested_trainer_name_raw = trainerName;
    persistedFields.push("requested_trainer_name_raw");
  }

  const clientName = normalizeOptionalText(input.updates.client_name);
  if (clientName) {
    patch.client_name = clientName;
    persistedFields.push("client_name");
  }

  const email = normalizeOptionalText(input.updates.email);
  if (email && isValidIntakeEmail(email)) {
    patch.email = email;
    persistedFields.push("email");
  }

  const schedulingPreferences = normalizeOptionalText(
    input.updates.scheduling_preferences_text,
  );
  const schedulingPreferencesJson = normalizeJsonObject(
    input.updates.scheduling_preferences_json,
  );
  if (
    schedulingPreferences &&
    hasUsefulSchedulingPreferences(schedulingPreferences)
  ) {
    patch.scheduling_preferences_text = schedulingPreferences;
    persistedFields.push("scheduling_preferences_text");
  }

  if (schedulingPreferencesJson) {
    patch.scheduling_preferences_json = schedulingPreferencesJson;
    persistedFields.push("scheduling_preferences_json");
  }

  if (persistedFields.length === 0) {
    return {
      lead: input.lead,
      persistedFields,
    };
  }

  const mergedLead = {
    ...input.lead,
    ...patch,
  };
  patch.conversation_state = getNextIntakeConversationState(mergedLead);

  const lead = await repo.updateLead(input.lead.id, patch);

  return {
    lead,
    persistedFields,
  };
}

export function getBlockedSchedulingReply(
  lead: Pick<SmsIntakeLeadRecord, "status">,
): string | null {
  return lead.status === "approved" ? null : BLOCKED_SCHEDULING_REPLY;
}

export function createAwaitingTrainerApprovalPatch(summaryForTrainer: string) {
  return {
    status: "awaiting_trainer_approval" as const,
    conversation_state: "awaiting_trainer_reply" as const,
    summary_for_trainer: summaryForTrainer,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  try {
    const cloned = JSON.parse(JSON.stringify(value));

    if (cloned && typeof cloned === "object" && !Array.isArray(cloned)) {
      return cloned as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}
