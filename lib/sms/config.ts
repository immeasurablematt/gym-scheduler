import "server-only";

export type SmsRuntimeConfig = {
  maxSlotsOffered: number;
  offerExpiryHours: number;
  searchDays: number;
  sessionDurationMinutes: number;
  sessionType: string;
  slotIntervalMinutes: number;
  timeZone: string;
};

export type TwilioSenderConfig = {
  accountSid: string;
  authToken: string;
  fromPhone: string;
};

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum) {
    return fallback;
  }

  return parsed;
}

export function getSmsRuntimeConfig(): SmsRuntimeConfig {
  return {
    maxSlotsOffered: readPositiveInteger(process.env.SMS_MAX_SLOTS_OFFERED, 3, 1),
    offerExpiryHours: readPositiveInteger(process.env.SMS_OFFER_EXPIRY_HOURS, 24, 1),
    searchDays: readPositiveInteger(process.env.SMS_SLOT_SEARCH_DAYS, 7, 1),
    sessionDurationMinutes: readPositiveInteger(
      process.env.SMS_SESSION_DURATION_MINUTES,
      60,
      15,
    ),
    sessionType:
      process.env.SMS_SESSION_TYPE?.trim() || "Personal Training",
    slotIntervalMinutes: readPositiveInteger(
      process.env.SMS_SLOT_INTERVAL_MINUTES,
      30,
      15,
    ),
    timeZone:
      process.env.SMS_TIME_ZONE?.trim() ||
      process.env.TZ?.trim() ||
      "America/Toronto",
  };
}

export function getTwilioSenderConfig(): TwilioSenderConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromPhone = process.env.TWILIO_PHONE_NUMBER?.trim();

  if (!accountSid || !authToken || !fromPhone) {
    throw new Error(
      "Missing Twilio sender config. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.",
    );
  }

  return {
    accountSid,
    authToken,
    fromPhone,
  };
}
