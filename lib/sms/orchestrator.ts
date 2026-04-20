import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  bookRequestedSmsTime,
  bookSmsOfferSelection,
  extractOfferSelection,
  offerAvailabilityBySms,
} from "@/lib/sms/booking-service";
import {
  getLatestActiveSmsConversation,
} from "@/lib/sms/conversation-service";
import { resolveSmsClientContextByPhone } from "@/lib/sms/client-directory";
import { logSmsMessage } from "@/lib/sms/message-log";
import { normalizePhoneNumber } from "@/lib/sms/phone";
import {
  expireOfferSet,
  getLatestPendingRescheduleOfferSet,
} from "@/lib/sms/offer-service";
import {
  handleRequestedRescheduleTime,
  handleSmsCancelIntent,
  handleSmsRescheduleIntent,
  maybeHandleSessionSelectionReply,
} from "@/lib/sms/session-lifecycle";
import { sendTwilioSms } from "@/lib/sms/twilio-sender";
import type { TwilioFormPostParams } from "@/lib/sms/twilio-webhook-primitives";

export async function handleInboundTwilioWebhook(params: TwilioFormPostParams) {
  const fromPhone = params.From?.trim() ?? "";
  const toPhone = params.To?.trim() ?? "";
  const body = params.Body?.trim() ?? "";
  const messageSid = params.MessageSid?.trim() ?? "";
  const normalizedFromPhone = normalizePhoneNumber(fromPhone) ?? fromPhone;
  const normalizedToPhone = normalizePhoneNumber(toPhone) ?? toPhone;
  const context = await resolveSmsClientContextByPhone(fromPhone);
  const inboundMessage = await logSmsMessage({
    account_sid: params.AccountSid?.trim() || null,
    body,
    client_id:
      context.kind === "known_client"
        ? context.value.client.id
        : context.kind === "missing_trainer"
          ? context.client.id
          : null,
    direction: "inbound",
    from_phone: fromPhone,
    message_sid: messageSid || null,
    normalized_from_phone: normalizedFromPhone,
    normalized_to_phone: normalizedToPhone,
    provider: "twilio",
    status: "received",
    to_phone: toPhone,
    trainer_id:
      context.kind === "known_client"
        ? context.value.trainer.id
        : null,
  });

  try {
    const reply = await buildReply(body, context, inboundMessage.id);

    try {
      await sendTwilioSms({
        body: reply.body,
        clientId:
          context.kind === "known_client"
            ? context.value.client.id
            : context.kind === "missing_trainer"
              ? context.client.id
              : null,
        offerSetId: reply.offerSetId,
        toPhone: fromPhone,
        trainerId:
          context.kind === "known_client"
            ? context.value.trainer.id
            : null,
      });
    } catch (error) {
      if (reply.offerSetId) {
        await expireOfferSet(reply.offerSetId);
      }

      throw error;
    }

    if (messageSid) {
      await markWebhookEvent(messageSid, normalizedFromPhone, "processed");
    }
  } catch (error) {
    if (messageSid) {
      await markWebhookEvent(
        messageSid,
        normalizedFromPhone,
        "failed",
        error instanceof Error ? error.message : "Unexpected SMS processing failure.",
      );
    }

    throw error;
  }
}

export async function buildReply(
  body: string,
  context: Awaited<ReturnType<typeof resolveSmsClientContextByPhone>>,
  inboundMessageId: string,
) {
  if (context.kind === "unknown_sender" || context.kind === "missing_client") {
    return {
      body: "I couldn't match this phone number to an existing client profile. Ask your trainer to update your phone number, then try again.",
      offerSetId: null,
    };
  }

  if (context.kind === "missing_trainer") {
    return {
      body: "I found your client profile, but it isn't linked to a trainer yet. Please contact the gym so we can finish setup.",
      offerSetId: null,
    };
  }

  const selection = extractOfferSelection(body);

  if (selection) {
    const activeConversation = await getLatestActiveSmsConversation(
      context.value.client.id,
      context.value.trainer.id,
    );

    const reply = await maybeHandleSessionSelectionReply(
      context.value,
      selection,
      inboundMessageId,
      activeConversation,
    );

    if (reply?.handled) {
      return {
        body: reply.body,
        offerSetId: reply.offerSetId ?? null,
      };
    }
  }

  if (selection) {
    const outcome = await bookSmsOfferSelection(
      context.value,
      body,
      inboundMessageId,
    );

    return {
      body: outcome.replyBody,
      offerSetId: null,
    };
  }

  if (looksLikeCancellation(body)) {
    const outcome = await handleSmsCancelIntent(context.value, inboundMessageId);

    return {
      body: outcome.replyBody,
      offerSetId: null,
    };
  }

  const hasActiveRescheduleTarget = Boolean(
    (
      await getLatestPendingRescheduleOfferSet(
        context.value.client.id,
        context.value.trainer.id,
      )
    )?.[0]?.target_session_id,
  );

  if (looksLikeReschedule(body) || hasActiveRescheduleTarget) {
    const requestedRescheduleOutcome = await handleRequestedRescheduleTime(
      context.value,
      {
        body,
        inboundMessageId,
      },
    );

    if (requestedRescheduleOutcome.kind !== "not_requested_time") {
      return {
        body: requestedRescheduleOutcome.replyBody,
        offerSetId:
          "offerSetId" in requestedRescheduleOutcome
            ? requestedRescheduleOutcome.offerSetId
            : null,
      };
    }
  }

  if (looksLikeReschedule(body)) {
    const outcome = await handleSmsRescheduleIntent(context.value, inboundMessageId);

    return {
      body: outcome.replyBody,
      offerSetId: "offerSetId" in outcome ? outcome.offerSetId : null,
    };
  }

  const requestedTimeOutcome = await bookRequestedSmsTime(
    context.value,
    body,
    inboundMessageId,
  );

  if (requestedTimeOutcome.kind === "booked") {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: null,
    };
  }

  if (requestedTimeOutcome.kind === "offered_alternatives") {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: requestedTimeOutcome.offerSetId,
    };
  }

  if (
    requestedTimeOutcome.kind === "invalid_requested_time" ||
    requestedTimeOutcome.kind === "calendar_unavailable"
  ) {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: null,
    };
  }

  if (looksLikeAvailabilityRequest(body)) {
    const outcome = await offerAvailabilityBySms(context.value, inboundMessageId);

    return {
      body: outcome.replyBody,
      offerSetId: outcome.kind === "offered_slots" ? outcome.offerSetId : null,
    };
  }

  return {
    body: "Text availability when you want a few opening times, or reply with 1, 2, or 3 from your latest options to book one.",
    offerSetId: null,
  };
}

function looksLikeAvailabilityRequest(body: string) {
  const normalized = body.trim().toLowerCase();

  if (normalized.length === 0) {
    return false;
  }

  return /\b(book|booking|schedule|session|appointment|available|availability|slot|open|when|time|day|today|tomorrow|week|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
    normalized,
  );
}

function looksLikeReschedule(body: string) {
  const normalized = body.trim().toLowerCase();
  return /\b(reschedule|move|change|another time|different time|can't make it|cant make it|need to move|later|earlier)\b/.test(
    normalized,
  );
}

function looksLikeCancellation(body: string) {
  const normalized = body.trim().toLowerCase();
  return /\b(cancel|cxl|call it off|skip it|drop it)\b/.test(normalized);
}

async function markWebhookEvent(
  eventKey: string,
  fromPhone: string,
  status: "processed" | "failed",
  errorMessage?: string,
) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("sms_webhook_idempotency")
    .update({
      error_message: errorMessage ?? null,
      from_phone: fromPhone,
      processed_at: new Date().toISOString(),
      status,
    })
    .eq("provider", "twilio")
    .eq("event_key", eventKey);

  if (error) {
    throw new Error(error.message);
  }
}
