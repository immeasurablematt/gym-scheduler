import crypto from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

test("smoke script signs requests with the explicit --base-url", async () => {
  const authToken = "test-auth-token";
  const staleWebhookUrl = "https://stale.example.com/api/twilio/inbound";

  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(500).end("Missing request URL");
      return;
    }

    const requestUrl = `http://127.0.0.1:${server.address().port}${request.url}`;

    if (request.method === "GET") {
      response.writeHead(405);
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405);
      response.end();
      return;
    }

    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    const params = Object.fromEntries(new URLSearchParams(rawBody).entries());
    const signature = request.headers["x-twilio-signature"];
    const expectedSignature = createTwilioSignature({
      authToken,
      params,
      webhookUrl: requestUrl,
    });

    if (signature !== expectedSignature) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Invalid Twilio signature." }));
      return;
    }

    if (!params.MessageSid) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Missing MessageSid." }));
      return;
    }

    response.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
    response.end("<Response/>");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const result = await runSmokeScript({
      baseUrl,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: authToken,
        TWILIO_PHONE_NUMBER: "+15555550101",
        TWILIO_WEBHOOK_URL: staleWebhookUrl,
      },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Twilio webhook smoke test passed\./);
  } finally {
    server.close();
    await once(server, "close");
  }
});

function runSmokeScript({ baseUrl, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/twilio-webhook-smoke.mjs", `--base-url=${baseUrl}`],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stderr,
        stdout,
      });
    });
  });
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
