import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  'data:text/javascript,import { pathToFileURL } from "node:url"; import { join, extname } from "node:path"; export async function resolve(specifier, context, nextResolve) { if (specifier === "server-only") { return { url: "data:text/javascript,export{}", shortCircuit: true }; } if (specifier === "@/lib/google/config") { return { url: "data:text/javascript,export function getGoogleCalendarConfig(){ return { clientId: \\"client\\", clientSecret: \\"secret\\", redirectUri: \\"https://example.com/callback\\" }; }", shortCircuit: true }; } if (specifier === "@/lib/google/connection-service") { return { url: "data:text/javascript,export async function updateTrainerCalendarConnection(){}", shortCircuit: true }; } if (specifier.startsWith("@/")) { const relativePath = specifier.slice(2); const resolvedPath = extname(relativePath) ? relativePath : `${relativePath}.ts`; return { url: pathToFileURL(join(process.cwd(), resolvedPath)).href, shortCircuit: true }; } return nextResolve(specifier, context); }',
  import.meta.url,
);

test("upsertGoogleCalendarEvent sends attendees and sendUpdates=all on create", async () => {
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ init, url: String(url) });

    if (String(url).includes("/token")) {
      return Response.json({ access_token: "token", expires_in: 3600 });
    }

    return Response.json({ id: "event-123" });
  };

  const { upsertGoogleCalendarEvent } = await import("../lib/google/client.ts");

  await upsertGoogleCalendarEvent(
    {
      access_token: "token",
      calendar_time_zone: "America/Toronto",
      google_calendar_id: "primary",
      provider: "google",
      refresh_token: "refresh",
      sync_enabled: true,
      token_expires_at: new Date(Date.now() + 300_000).toISOString(),
      trainer_id: "trainer-1",
    },
    {
      attendees: [{ email: "client@example.com" }],
      description: "Desc",
      endTime: "2026-04-21T16:00:00.000Z",
      startTime: "2026-04-21T15:00:00.000Z",
      timeZone: "America/Toronto",
      title: "Client · Strength",
    },
  );

  const request = requests.at(-1);
  assert.match(request.url, /sendUpdates=all/);
  assert.equal(request.init.method, "POST");

  const payload = JSON.parse(request.init.body);
  assert.deepEqual(payload.attendees, [{ email: "client@example.com" }]);
});

test("deleteGoogleCalendarEvent sends guest updates on delete", async () => {
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ init, url: String(url) });
    return new Response(null, { status: 204 });
  };

  const { deleteGoogleCalendarEvent } = await import("../lib/google/client.ts");

  await deleteGoogleCalendarEvent(
    {
      access_token: "token",
      calendar_time_zone: "America/Toronto",
      google_calendar_id: "primary",
      provider: "google",
      refresh_token: "refresh",
      sync_enabled: true,
      token_expires_at: new Date(Date.now() + 300_000).toISOString(),
      trainer_id: "trainer-1",
    },
    "event-123",
  );

  const request = requests.at(-1);
  assert.match(request.url, /sendUpdates=all/);
  assert.equal(request.init.method, "DELETE");
});
