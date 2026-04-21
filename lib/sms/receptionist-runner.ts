import type { ReceptionistAgentRunner } from "./receptionist-agent.ts";
import { createOpenAiReceptionistRunner } from "./receptionist-openai.ts";

const DEFAULT_MODEL = "gpt-5.4-mini";

type EnvShape = {
  OPENAI_API_KEY?: string | undefined;
  SMS_RECEPTIONIST_OPENAI_MODEL?: string | undefined;
};

type RunnerDeps = {
  createOpenAiReceptionistRunner: typeof createOpenAiReceptionistRunner;
};

export function buildDefaultReceptionistRunner(
  env: EnvShape = process.env,
  deps: RunnerDeps = { createOpenAiReceptionistRunner },
): ReceptionistAgentRunner {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  return deps.createOpenAiReceptionistRunner({
    apiKey,
    model: env.SMS_RECEPTIONIST_OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  });
}
