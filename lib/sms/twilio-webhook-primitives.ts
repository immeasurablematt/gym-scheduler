import "server-only";

import crypto from "node:crypto";

export const EMPTY_TWIML_RESPONSE = "<Response/>";

export type TwilioFormPostParams = Record<string, string>;

export interface ParsedTwilioFormPost {
  params: TwilioFormPostParams;
  rawBody: string;
  requestUrl: string;
  signatureHeader: string | null;
}

export interface ReadTwilioFormPostOptions {
  requestUrl?: string;
}

export interface VerifyTwilioSignatureInput {
  webhookUrl: string;
  params: TwilioFormPostParams;
  signatureHeader: string | null;
  authToken: string;
}

export type VerifyTwilioSignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing-header" | "invalid-header" | "mismatch" };

export const hasTwilioAuthToken = Boolean(process.env.TWILIO_AUTH_TOKEN);

export function getTwilioAuthToken() {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
    throw new Error("Missing Twilio auth token. Set TWILIO_AUTH_TOKEN.");
  }

  return authToken;
}

export function createEmptyTwilioResponse(init?: ResponseInit) {
  return new Response(EMPTY_TWIML_RESPONSE, {
    ...init,
    status: init?.status ?? 200,
    headers: {
      "content-type": "text/xml; charset=utf-8",
      ...Object.fromEntries(new Headers(init?.headers).entries()),
    },
  });
}

export function parseUrlEncodedBody(rawBody: string): TwilioFormPostParams {
  const params = new URLSearchParams(rawBody);
  const parsed: TwilioFormPostParams = {};

  for (const [key, value] of params.entries()) {
    parsed[key] = value;
  }

  return parsed;
}

export function resolveWebhookUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");

  if (forwardedProto) {
    url.protocol = `${forwardedProto.split(",")[0].trim()}:`;
  }

  if (forwardedHost) {
    url.host = forwardedHost.split(",")[0].trim();
  }

  return url.toString();
}

export async function readTwilioFormPost(
  request: Request,
  options?: ReadTwilioFormPostOptions,
): Promise<ParsedTwilioFormPost> {
  const rawBody = await request.text();

  return {
    params: parseUrlEncodedBody(rawBody),
    rawBody,
    requestUrl: options?.requestUrl ?? resolveWebhookUrl(request),
    signatureHeader: request.headers.get("x-twilio-signature"),
  };
}

export function verifyTwilioSignature({
  webhookUrl,
  params,
  signatureHeader,
  authToken,
}: VerifyTwilioSignatureInput): VerifyTwilioSignatureResult {
  if (!signatureHeader) {
    return { ok: false, reason: "missing-header" };
  }

  const sortedKeys = Object.keys(params).sort();
  const stringToSign = sortedKeys.reduce(
    (accumulator, key) => accumulator + key + (params[key] ?? ""),
    webhookUrl,
  );

  const computedSignature = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(stringToSign, "utf8"))
    .digest("base64");

  try {
    const computedBytes = Buffer.from(computedSignature, "base64");
    const headerBytes = Buffer.from(signatureHeader, "base64");

    if (!headerBytes.length || computedBytes.length !== headerBytes.length) {
      return { ok: false, reason: "invalid-header" };
    }

    if (!crypto.timingSafeEqual(computedBytes, headerBytes)) {
      return { ok: false, reason: "mismatch" };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid-header" };
  }
}
