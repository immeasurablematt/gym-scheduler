import type {
  ReceptionistAgentInput,
  ReceptionistAgentRunner,
  ReceptionistAgentRunnerOutput,
} from "./receptionist-agent.ts";

const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_TIMEOUT_MS = 10_000;
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    resolved_fields: {
      type: "object",
      additionalProperties: false,
      properties: {
        client_name: { type: "string" },
        email: { type: "string" },
        requested_trainer_name_raw: { type: "string" },
        scheduling_preferences_text: { type: "string" },
      },
      required: [],
    },
    follow_up_question: { type: "string" },
    summary_text: { type: "string" },
    preference_summary: { type: "string" },
    preference_json: {
      type: "object",
      additionalProperties: true,
    },
    needs_follow_up: { type: "boolean" },
    confidence_score: { type: "number" },
  },
  required: [
    "resolved_fields",
    "follow_up_question",
    "summary_text",
    "preference_summary",
    "preference_json",
    "needs_follow_up",
    "confidence_score",
  ],
} as const;

type OpenAiResponsesClient = {
  responses: {
    create(input: Record<string, unknown>): Promise<{
      output_text?: string | null;
    }>;
  };
};

type CreateOpenAiReceptionistRunnerOptions = {
  apiKey: string;
  model?: string | null;
  timeoutMs?: number;
  createClient?: (apiKey: string) => OpenAiResponsesClient;
};

type ParsedOpenAiReceptionistOutput = {
  confidence_score: number;
  follow_up_question: string;
  needs_follow_up: boolean;
  preference_json: Record<string, unknown>;
  preference_summary: string;
  resolved_fields: Record<string, string>;
  summary_text: string;
};

const ALLOWED_RESOLVED_FIELD_KEYS = new Set([
  "client_name",
  "email",
  "requested_trainer_name_raw",
  "scheduling_preferences_text",
]);

export function createOpenAiReceptionistRunner(
  options: CreateOpenAiReceptionistRunnerOptions,
): ReceptionistAgentRunner {
  const apiKey = options.apiKey.trim();
  const model = options.model?.trim() || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function runOpenAiReceptionist(
    input: ReceptionistAgentInput,
  ): Promise<ReceptionistAgentRunnerOutput | null> {
    const client =
      options.createClient?.(apiKey) ?? (await createDefaultOpenAiClient(apiKey));

    const response = await withTimeout(
      client.responses.create({
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: buildSystemPrompt() }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify(buildUserPayload(input)) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "sms_receptionist_output",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
      timeoutMs,
    );

    return parseRunnerOutput(response.output_text);
  };
}

function buildSystemPrompt(): string {
  return [
    "You are an SMS intake receptionist for a gym.",
    "Extract only structured intake details from the lead snapshot and transcript.",
    "Ask at most one follow-up question when needed.",
    "Never approve, reject, create clients, or book sessions.",
    "Never invent trainer ids.",
    "Keep trainer names exactly as written when uncertain.",
  ].join(" ");
}

function buildUserPayload(input: ReceptionistAgentInput) {
  return {
    lead_snapshot: input.lead_snapshot,
    recent_sms_transcript: input.recent_sms_transcript,
    allowed_trainers: input.allowed_trainers,
    collected_fields: input.collected_fields,
    next_missing_field: input.next_missing_field,
  };
}

function parseRunnerOutput(
  outputText: string | null | undefined,
): ReceptionistAgentRunnerOutput | null {
  if (!outputText?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(outputText);

    if (!isUsableParsedOutput(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isUsableParsedOutput(value: unknown): value is ParsedOpenAiReceptionistOutput {
  if (!isPlainObject(value)) {
    return false;
  }

  const keys = Object.keys(value);
  for (const key of keys) {
    if (
      key !== "resolved_fields" &&
      key !== "follow_up_question" &&
      key !== "summary_text" &&
      key !== "preference_summary" &&
      key !== "preference_json" &&
      key !== "needs_follow_up" &&
      key !== "confidence_score"
    ) {
      return false;
    }
  }

  if (!isResolvedFields(value.resolved_fields)) {
    return false;
  }

  if (typeof value.follow_up_question !== "string") {
    return false;
  }

  if (typeof value.summary_text !== "string") {
    return false;
  }

  if (typeof value.preference_summary !== "string") {
    return false;
  }

  if (!isPlainObject(value.preference_json)) {
    return false;
  }

  if (typeof value.needs_follow_up !== "boolean") {
    return false;
  }

  if (typeof value.confidence_score !== "number" || !Number.isFinite(value.confidence_score)) {
    return false;
  }

  return true;
}

function isResolvedFields(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) {
    return false;
  }

  for (const [key, fieldValue] of Object.entries(value)) {
    if (!ALLOWED_RESOLVED_FIELD_KEYS.has(key)) {
      return false;
    }

    if (typeof fieldValue !== "string") {
      return false;
    }
  }

  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function createDefaultOpenAiClient(apiKey: string): Promise<OpenAiResponsesClient> {
  const { default: OpenAI } = await import("openai");

  return new OpenAI({ apiKey }) as OpenAiResponsesClient;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("OpenAI receptionist timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
