export const DEFAULT_SMS_TIME_ZONE = "America/Toronto";

export function resolveSmsTimeZone(value: string | null | undefined) {
  const normalized = normalizeTimeZone(value);
  return normalized ?? DEFAULT_SMS_TIME_ZONE;
}

function normalizeTimeZone(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = trimmed.startsWith(":") ? trimmed.slice(1) : trimmed;

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: candidate,
    }).format(new Date());

    return candidate;
  } catch {
    return null;
  }
}
