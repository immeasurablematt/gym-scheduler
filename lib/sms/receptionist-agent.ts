export type ReceptionistLeadSnapshot = {
  client_name?: string | null;
  email?: string | null;
  requested_trainer_id?: string | null;
  requested_trainer_name_raw?: string | null;
  scheduling_preferences_text?: string | null;
};

export type ReceptionistTrainerCandidate = {
  aliases?: readonly string[] | null;
  id: string;
  name: string;
};

export type ReceptionistTranscriptTurn = {
  body: string;
  direction: "inbound" | "outbound";
};

export type ReceptionistAgentInput = {
  allowed_trainers: readonly ReceptionistTrainerCandidate[];
  collected_fields: readonly string[];
  lead_snapshot: ReceptionistLeadSnapshot;
  next_missing_field: string | null | undefined;
  recent_sms_transcript: readonly ReceptionistTranscriptTurn[];
};

export type ReceptionistAgentOutput = {
  confidence_flags: readonly string[];
  follow_up_question: string;
  needs_follow_up: boolean;
  preference_json: Record<string, unknown>;
  preference_summary: string;
  resolved_fields: Record<string, string>;
  summary_text: string;
};

export type ReceptionistAgentRunnerOutput = Partial<ReceptionistAgentOutput> & {
  approve_client?: unknown;
  confidence?: number | null;
  confidence_score?: number | null;
  create_client?: unknown;
  reject_client?: unknown;
};

export type ReceptionistAgentRunner =
  | ((
      input: ReceptionistAgentInput,
    ) => Promise<ReceptionistAgentRunnerOutput | null | undefined> | ReceptionistAgentRunnerOutput | null | undefined)
  | null
  | undefined;

const CONFIDENCE_THRESHOLD = 0.7;
const SAFE_RESOLVED_FIELD_KEYS = new Set([
  "client_name",
  "email",
  "requested_trainer_name_raw",
  "scheduling_preferences_text",
]);

export async function runReceptionistAgent(
  input: ReceptionistAgentInput,
  runModel?: ReceptionistAgentRunner,
): Promise<ReceptionistAgentOutput> {
  if (!runModel) {
    return createFallbackReceptionistOutput(input, "fallback:runner-unavailable");
  }

  let rawOutput: ReceptionistAgentRunnerOutput | null | undefined;

  try {
    rawOutput = await runModel(input);
  } catch {
    return createFallbackReceptionistOutput(input, "fallback:runner-error");
  }

  if (rawOutput == null) {
    return createFallbackReceptionistOutput(input, "fallback:runner-unavailable");
  }

  const confidenceScore = readConfidenceScore(rawOutput);

  if (confidenceScore !== null && confidenceScore < CONFIDENCE_THRESHOLD) {
    return createFallbackReceptionistOutput(input, "fallback:low-confidence");
  }

  return sanitizeReceptionistOutput(input, rawOutput);
}

function sanitizeReceptionistOutput(
  input: ReceptionistAgentInput,
  rawOutput: ReceptionistAgentRunnerOutput | null | undefined,
): ReceptionistAgentOutput {
  const resolvedFields = sanitizeResolvedFields(rawOutput?.resolved_fields);

  return {
    resolved_fields: resolvedFields,
    follow_up_question: sanitizeString(
      rawOutput?.follow_up_question,
      getFallbackQuestion(input.next_missing_field),
    ),
    summary_text: sanitizeString(
      rawOutput?.summary_text,
      buildFallbackSummary(input.lead_snapshot),
    ),
    preference_summary: sanitizeString(
      rawOutput?.preference_summary,
      getPreferenceSummary(input.lead_snapshot.scheduling_preferences_text),
    ),
    preference_json: sanitizePreferenceJson(rawOutput?.preference_json),
    needs_follow_up:
      typeof rawOutput?.needs_follow_up === "boolean"
        ? rawOutput.needs_follow_up
        : true,
    confidence_flags: ["provider:ok"],
  };
}

function createFallbackReceptionistOutput(
  input: ReceptionistAgentInput,
  confidenceFlag: string,
): ReceptionistAgentOutput {
  return {
    resolved_fields: {},
    follow_up_question: getFallbackQuestion(input.next_missing_field),
    summary_text: buildFallbackSummary(input.lead_snapshot),
    preference_summary: getPreferenceSummary(input.lead_snapshot.scheduling_preferences_text),
    preference_json: {},
    needs_follow_up: true,
    confidence_flags: [confidenceFlag],
  };
}

function sanitizeResolvedFields(
  resolvedFields: unknown,
): Record<string, string> {
  if (!resolvedFields || typeof resolvedFields !== "object") {
    return {};
  }

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(resolvedFields as Record<string, unknown>)) {
    if (!SAFE_RESOLVED_FIELD_KEYS.has(key)) {
      continue;
    }

    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      continue;
    }

    sanitized[key] = trimmed;
  }

  return sanitized;
}

function sanitizePreferenceJson(
  preferenceJson: unknown,
): Record<string, unknown> {
  if (!preferenceJson || typeof preferenceJson !== "object") {
    return {};
  }

  try {
    const cloned = JSON.parse(JSON.stringify(preferenceJson));

    if (cloned && typeof cloned === "object" && !Array.isArray(cloned)) {
      return cloned as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();

  return trimmed || fallback;
}

function readConfidenceScore(
  rawOutput: ReceptionistAgentRunnerOutput | null | undefined,
): number | null {
  const score = rawOutput?.confidence_score ?? rawOutput?.confidence;

  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function getFallbackQuestion(nextMissingField: string | null | undefined): string {
  switch (nextMissingField) {
    case "requested_trainer_id":
      return "Which trainer would you like to work with?";
    case "client_name":
      return "What is your full name?";
    case "email":
      return "What is the best email address to reach you at?";
    case "scheduling_preferences_text":
      return "When are you usually available to train?";
    default:
      return "What details should I collect next?";
  }
}

function buildFallbackSummary(leadSnapshot: ReceptionistLeadSnapshot): string {
  const parts: string[] = [];

  if (leadSnapshot.requested_trainer_name_raw?.trim()) {
    parts.push(`trainer ${leadSnapshot.requested_trainer_name_raw.trim()}`);
  }

  if (leadSnapshot.client_name?.trim()) {
    parts.push(`client name ${leadSnapshot.client_name.trim()}`);
  }

  if (leadSnapshot.scheduling_preferences_text?.trim()) {
    parts.push(`preferences ${leadSnapshot.scheduling_preferences_text.trim()}`);
  }

  return parts.length > 0
    ? `Collected: ${parts.join(", ")}.`
    : "Collected: no structured intake details yet.";
}

function getPreferenceSummary(
  schedulingPreferencesText: string | null | undefined,
): string {
  return schedulingPreferencesText?.trim() ?? "";
}
