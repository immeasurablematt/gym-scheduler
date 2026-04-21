export type SmsIntakeConversationState =
  | "needs_trainer"
  | "needs_name"
  | "needs_email"
  | "needs_preferences"
  | "ready_for_approval"
  | "awaiting_trainer_reply";

export type SmsIntakeLeadSnapshot = {
  client_name?: string | null;
  email?: string | null;
  requested_trainer_id?: string | null;
  requested_trainer_name_raw?: string | null;
  scheduling_preferences_text?: string | null;
};

const VAGUE_PREFERENCE_PHRASES = [
  "anytime",
  "depends",
  "dont care",
  "don't care",
  "flexible",
  "no preference",
  "not sure",
  "whatever works",
  "whenever",
];

const TIME_HINT_PATTERNS = [
  /\b\d{1,2}\s*(?:am|pm)\b/i,
  /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i,
  /\b(?:before|after)\s+\d{1,2}\b/i,
  /\b(?:morning|afternoon|evening|night|weekend|weekday|weekdays|weekends|mon|tue|wed|thu|fri|sat|sun)(?:s)?\b/i,
];

export function isValidIntakeEmail(email: string | null | undefined): boolean {
  const trimmedEmail = email?.trim();

  if (!trimmedEmail) {
    return false;
  }

  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmedEmail);
}

export function hasUsefulSchedulingPreferences(
  schedulingPreferencesText: string | null | undefined,
): boolean {
  const normalized = normalizePreferenceText(schedulingPreferencesText);

  if (!normalized) {
    return false;
  }

  if (VAGUE_PREFERENCE_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return false;
  }

  return TIME_HINT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getNextIntakeConversationState(
  lead: SmsIntakeLeadSnapshot,
): SmsIntakeConversationState {
  if (!lead.requested_trainer_id) {
    return "needs_trainer";
  }

  if (!lead.client_name?.trim()) {
    return "needs_name";
  }

  if (!isValidIntakeEmail(lead.email)) {
    return "needs_email";
  }

  if (!hasUsefulSchedulingPreferences(lead.scheduling_preferences_text)) {
    return "needs_preferences";
  }

  return "ready_for_approval";
}

export function isLeadReadyForTrainerApproval(
  lead: SmsIntakeLeadSnapshot,
): boolean {
  return getNextIntakeConversationState(lead) === "ready_for_approval";
}

function normalizePreferenceText(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}
