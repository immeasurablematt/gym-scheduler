import "server-only";

import { getTwilioSenderConfig } from "@/lib/sms/config";
import { logSmsMessage } from "@/lib/sms/message-log";
import { normalizePhoneNumber } from "@/lib/sms/phone";
import type { Database } from "@/types/supabase";

type SmsMessageAudience = Database["public"]["Enums"]["sms_message_audience"];
type SmsMessageKind = Database["public"]["Enums"]["sms_message_kind"];

type SendSmsInput = {
  audience?: SmsMessageAudience;
  body: string;
  clientId?: string | null;
  messageKind?: SmsMessageKind;
  offerSetId?: string | null;
  sourceChangeId?: string | null;
  toPhone: string;
  trainerId?: string | null;
};

export async function sendTwilioSms({
  audience = "client",
  body,
  clientId = null,
  messageKind = "conversation",
  offerSetId = null,
  sourceChangeId = null,
  toPhone,
  trainerId = null,
}: SendSmsInput) {
  const config = getTwilioSenderConfig();
  const normalizedFromPhone = normalizePhoneNumber(config.fromPhone) ?? config.fromPhone;
  const normalizedToPhone = normalizePhoneNumber(toPhone) ?? toPhone;
  const payload = new URLSearchParams({
    Body: body,
    From: config.fromPhone,
    To: toPhone,
  });
  const authorization = Buffer.from(
    `${config.accountSid}:${config.authToken}`,
  ).toString("base64");

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        body: payload,
        headers: {
          authorization: `Basic ${authorization}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
    );
    const responseBody = (await response.json().catch(() => null)) as
      | {
          message?: string;
          sid?: string;
          status?: string;
        }
      | null;

    if (!response.ok) {
      const errorMessage =
        responseBody?.message ??
        `Twilio send failed with status ${response.status}.`;

      throw new Error(errorMessage);
    }

    const status = mapTwilioStatus(responseBody?.status);

    await logSmsMessage({
      account_sid: config.accountSid,
      audience,
      body,
      client_id: clientId,
      direction: "outbound",
      from_phone: config.fromPhone,
      message_kind: messageKind,
      message_sid: responseBody?.sid ?? null,
      normalized_from_phone: normalizedFromPhone,
      normalized_to_phone: normalizedToPhone,
      offer_set_id: offerSetId,
      provider: "twilio",
      source_change_id: sourceChangeId,
      sent_at: new Date().toISOString(),
      status,
      to_phone: toPhone,
      trainer_id: trainerId,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unexpected error sending SMS.";

    await logSmsMessage({
      audience,
      body,
      client_id: clientId,
      direction: "outbound",
      error_message: errorMessage,
      from_phone: config.fromPhone,
      message_kind: messageKind,
      normalized_from_phone: normalizedFromPhone,
      normalized_to_phone: normalizedToPhone,
      offer_set_id: offerSetId,
      provider: "twilio",
      source_change_id: sourceChangeId,
      status: "failed",
      to_phone: toPhone,
      trainer_id: trainerId,
    });

    throw new Error(errorMessage);
  }
}

function mapTwilioStatus(value: string | undefined) {
  switch (value) {
    case "delivered":
      return "delivered" as const;
    case "queued":
    case "accepted":
    case "scheduled":
      return "queued" as const;
    case "failed":
    case "undelivered":
      return "failed" as const;
    default:
      return "sent" as const;
  }
}
