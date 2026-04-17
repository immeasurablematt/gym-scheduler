import { after, NextResponse } from "next/server";

import { handleInboundTwilioWebhook } from "@/lib/sms/orchestrator";
import { reserveWebhookEvent } from "@/lib/sms/supabase-idempotency";
import {
  createEmptyTwilioResponse,
  getTwilioAuthToken,
  readTwilioFormPost,
  verifyTwilioSignature,
} from "@/lib/sms/twilio-webhook-primitives";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestUrl = process.env.TWILIO_WEBHOOK_URL?.trim();
  const parsedRequest = await readTwilioFormPost(request, {
    requestUrl,
  });
  const signature = verifyTwilioSignature({
    authToken: getTwilioAuthToken(),
    params: parsedRequest.params,
    signatureHeader: parsedRequest.signatureHeader,
    webhookUrl: requestUrl ?? parsedRequest.requestUrl,
  });

  if (!signature.ok) {
    return NextResponse.json(
      {
        error: "Invalid Twilio signature.",
        reason: signature.reason,
      },
      {
        status: 403,
      },
    );
  }

  const messageSid = parsedRequest.params.MessageSid?.trim();

  if (!messageSid) {
    return NextResponse.json(
      {
        error: "Missing MessageSid.",
      },
      {
        status: 400,
      },
    );
  }

  const reservation = await reserveWebhookEvent({
    eventKey: messageSid,
  });

  if (reservation.status === "duplicate") {
    return createEmptyTwilioResponse();
  }

  after(async () => {
    try {
      await handleInboundTwilioWebhook(parsedRequest.params);
    } catch (error) {
      console.error("[sms-webhook] failed to process inbound Twilio message", error);
    }
  });

  return createEmptyTwilioResponse();
}
