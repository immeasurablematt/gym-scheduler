#!/usr/bin/env node

import crypto from "node:crypto";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_WEBHOOK_URL",
];

const missing = requiredEnv.filter((name) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const baseUrl = parseBaseUrl();
const webhookUrl = parseWebhookUrl({ baseUrl });

if (!webhookUrl.pathname.endsWith("/api/twilio/inbound")) {
  console.error(
    `TWILIO_WEBHOOK_URL must point at /api/twilio/inbound, got ${webhookUrl.toString()}`,
  );
  process.exit(1);
}

await assertReachable(`${baseUrl}/api/twilio/inbound`);
await assertSignedWebhook(`${baseUrl}/api/twilio/inbound`, webhookUrl.toString());

console.log("Twilio webhook smoke test passed.");

function parseBaseUrl() {
  const arg = getPositionalBaseUrlArg();
  const flag = getBaseUrlFlag();
  const webhookOrigin = process.env.TWILIO_WEBHOOK_URL
    ? new URL(process.env.TWILIO_WEBHOOK_URL).origin
    : null;
  const candidate =
    flag ||
    arg ||
    process.env.TWILIO_SMOKE_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    webhookOrigin ||
    "http://localhost:3000";

  return new URL(candidate).toString().replace(/\/$/, "");
}

function parseWebhookUrl({ baseUrl }) {
  const explicitBaseUrl = getBaseUrlFlag() || getPositionalBaseUrlArg();

  if (explicitBaseUrl) {
    return new URL("/api/twilio/inbound", `${baseUrl}/`);
  }

  return new URL(process.env.TWILIO_WEBHOOK_URL.trim());
}

function getBaseUrlFlag() {
  return process.argv
    .slice(2)
    .find((value) => value.startsWith("--base-url="))
    ?.slice("--base-url=".length);
}

function getPositionalBaseUrlArg() {
  return process.argv.slice(2).find((value) => !value.startsWith("--"));
}

async function assertReachable(url) {
  const response = await fetch(url, {
    redirect: "manual",
    method: "GET",
  });

  if (response.status === 405) {
    console.log(`GET ${url} -> 405`);
    return;
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "<missing>";
    throw new Error(
      `GET ${url} was redirected to ${location} instead of returning 405. The webhook route is not public.`,
    );
  }

  throw new Error(`GET ${url} returned ${response.status}, expected 405.`);
}

async function assertSignedWebhook(url, webhookUrl) {
  const bodyParams = new URLSearchParams({
    Body: "smoke test",
    From: "+15555550100",
    To: "+15555550101",
  });
  const signature = createTwilioSignature({
    authToken: process.env.TWILIO_AUTH_TOKEN.trim(),
    params: Object.fromEntries(bodyParams.entries()),
    webhookUrl,
  });

  const response = await fetch(url, {
    body: bodyParams,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    method: "POST",
  });

  const text = await response.text();

  if (response.status === 400 && text.includes("Missing MessageSid")) {
    console.log(`POST ${url} -> 400 Missing MessageSid`);
    return;
  }

  if (response.status === 403) {
    throw new Error(
      `POST ${url} returned 403. The webhook URL or TWILIO_AUTH_TOKEN does not match the inbound route's signing expectations.`,
    );
  }

  throw new Error(
    `POST ${url} returned ${response.status} with body: ${text.slice(0, 200)}`,
  );
}

function createTwilioSignature({ authToken, params, webhookUrl }) {
  const stringToSign = Object.keys(params)
    .sort()
    .reduce((accumulator, key) => accumulator + key + (params[key] ?? ""), webhookUrl);

  return crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(stringToSign, "utf8"))
    .digest("base64");
}
