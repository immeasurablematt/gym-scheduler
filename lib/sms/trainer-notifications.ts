import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTwilioSenderConfig } from "@/lib/sms/config";
import { logSmsMessage } from "@/lib/sms/message-log";
import { normalizePhoneNumber } from "@/lib/sms/phone";
import {
  buildTrainerNotificationBody,
  normalizeTrainerDestinationPhone,
  type TrainerNotificationBodyInput,
} from "@/lib/sms/trainer-notification-copy";
import { sendTwilioSms } from "@/lib/sms/twilio-sender";
import type { Database } from "@/types/supabase";

type SmsMessageAudience = Database["public"]["Enums"]["sms_message_audience"];
type SmsMessageKind = Database["public"]["Enums"]["sms_message_kind"];

type SendTrainerSessionNotificationInput = TrainerNotificationBodyInput & {
  clientId: string;
  sourceChangeId: string;
  trainerId: string;
};

const TRAINER_SMS_AUDIENCE: SmsMessageAudience = "trainer";

export async function sendTrainerSessionNotification(
  input: SendTrainerSessionNotificationInput,
) {
  try {
    const alreadyLogged = await hasTrainerNotificationRecord(
      input.sourceChangeId,
      input.kind,
    );

    if (alreadyLogged) {
      return;
    }

    const body = buildTrainerNotificationBody(input);
    const destination = await resolveTrainerDestination(input.trainerId);

    if (!destination.normalizedPhone) {
      await logSkippedTrainerNotification({
        body,
        clientId: input.clientId,
        errorMessage: destination.rawPhone
          ? "Trainer phone number is invalid. Update users.phone_number to enable trainer SMS."
          : "Trainer phone number is missing. Update users.phone_number to enable trainer SMS.",
        kind: input.kind,
        rawPhone: destination.rawPhone,
        sourceChangeId: input.sourceChangeId,
        trainerId: input.trainerId,
      });

      console.warn(
        "[sms-trainer-notification] skipped trainer SMS because the trainer phone number is missing or invalid",
        {
          sourceChangeId: input.sourceChangeId,
          trainerId: input.trainerId,
        },
      );
      return;
    }

    await sendTwilioSms({
      audience: TRAINER_SMS_AUDIENCE,
      body,
      clientId: input.clientId,
      messageKind: input.kind,
      sourceChangeId: input.sourceChangeId,
      toPhone: destination.normalizedPhone,
      trainerId: input.trainerId,
    });
  } catch (error) {
    console.error(
      "[sms-trainer-notification] failed to send trainer notification",
      error,
    );
  }
}

async function hasTrainerNotificationRecord(
  sourceChangeId: string,
  kind: SmsMessageKind,
) {
  const supabase = createServerSupabaseClient();
  const { count, error } = await supabase
    .from("sms_messages")
    .select("id", { count: "exact", head: true })
    .eq("audience", TRAINER_SMS_AUDIENCE)
    .eq("direction", "outbound")
    .eq("message_kind", kind)
    .eq("source_change_id", sourceChangeId);

  if (error) {
    throw new Error(error.message);
  }

  return (count ?? 0) > 0;
}

async function resolveTrainerDestination(trainerId: string) {
  const supabase = createServerSupabaseClient();
  const { data: trainer, error: trainerError } = await supabase
    .from("trainers")
    .select("user_id")
    .eq("id", trainerId)
    .maybeSingle();

  if (trainerError) {
    throw new Error(trainerError.message);
  }

  if (!trainer) {
    return {
      normalizedPhone: null,
      rawPhone: null,
    };
  }

  const { data: trainerUser, error: trainerUserError } = await supabase
    .from("users")
    .select("phone_number")
    .eq("id", trainer.user_id)
    .maybeSingle();

  if (trainerUserError) {
    throw new Error(trainerUserError.message);
  }

  return {
    normalizedPhone: normalizeTrainerDestinationPhone(
      trainerUser?.phone_number ?? null,
    ),
    rawPhone: trainerUser?.phone_number?.trim() ?? null,
  };
}

async function logSkippedTrainerNotification({
  body,
  clientId,
  errorMessage,
  kind,
  rawPhone,
  sourceChangeId,
  trainerId,
}: {
  body: string;
  clientId: string;
  errorMessage: string;
  kind: SmsMessageKind;
  rawPhone: string | null;
  sourceChangeId: string;
  trainerId: string;
}) {
  const senderConfig = getSafeTwilioSenderConfig();

  if (!senderConfig) {
    return;
  }

  await logSmsMessage({
    account_sid: senderConfig.accountSid,
    audience: TRAINER_SMS_AUDIENCE,
    body,
    client_id: clientId,
    direction: "outbound",
    error_message: errorMessage,
    from_phone: senderConfig.fromPhone,
    message_kind: kind,
    normalized_from_phone: senderConfig.normalizedFromPhone,
    normalized_to_phone: normalizePhoneNumber(rawPhone) ?? "",
    provider: "twilio",
    source_change_id: sourceChangeId,
    status: "failed",
    to_phone: rawPhone ?? "",
    trainer_id: trainerId,
  });
}

function getSafeTwilioSenderConfig() {
  try {
    const config = getTwilioSenderConfig();

    return {
      accountSid: config.accountSid,
      fromPhone: config.fromPhone,
      normalizedFromPhone:
        normalizePhoneNumber(config.fromPhone) ?? config.fromPhone,
    };
  } catch {
    console.warn(
      "[sms-trainer-notification] unable to log skipped trainer SMS because Twilio sender config is unavailable",
    );

    return null;
  }
}
