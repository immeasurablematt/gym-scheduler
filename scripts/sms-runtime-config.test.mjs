import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  'data:text/javascript,import { pathToFileURL } from "node:url"; import { join, extname } from "node:path"; export async function resolve(specifier, context, nextResolve) { if (specifier === "server-only") { return { url: "data:text/javascript,export{}", shortCircuit: true }; } if (specifier.startsWith("@/")) { const relativePath = specifier.slice(2); const resolvedPath = extname(relativePath) ? relativePath : `${relativePath}.ts`; return { url: pathToFileURL(join(process.cwd(), resolvedPath)).href, shortCircuit: true }; } return nextResolve(specifier, context); }',
  import.meta.url,
);

let importCounter = 0;

async function importSmsConfig() {
  return import(
    new URL(`../lib/sms/config.ts?case=${++importCounter}`, import.meta.url).href
  );
}

async function importRequestedTimeParser() {
  return import(
    new URL(`../lib/sms/requested-time-parser.ts?case=${++importCounter}`, import.meta.url).href
  );
}

function withSmsEnv(next, env = {}) {
  const previousSmsTimeZone = process.env.SMS_TIME_ZONE;
  const previousTz = process.env.TZ;

  if (Object.hasOwn(env, "SMS_TIME_ZONE")) {
    const value = env.SMS_TIME_ZONE;
    if (value == null) {
      delete process.env.SMS_TIME_ZONE;
    } else {
      process.env.SMS_TIME_ZONE = value;
    }
  }

  if (Object.hasOwn(env, "TZ")) {
    const value = env.TZ;
    if (value == null) {
      delete process.env.TZ;
    } else {
      process.env.TZ = value;
    }
  }

  return Promise.resolve()
    .then(next)
    .finally(() => {
      if (previousSmsTimeZone == null) {
        delete process.env.SMS_TIME_ZONE;
      } else {
        process.env.SMS_TIME_ZONE = previousSmsTimeZone;
      }

      if (previousTz == null) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    });
}

test("getSmsRuntimeConfig defaults to the gym timezone instead of inheriting host UTC", async () => {
  await withSmsEnv(async () => {
    const { getSmsRuntimeConfig } = await importSmsConfig();

    assert.equal(getSmsRuntimeConfig().timeZone, "America/Toronto");
  }, {
    SMS_TIME_ZONE: null,
    TZ: "UTC",
  });
});

test("requested-time parsing stays in the gym timezone when host TZ is UTC", async () => {
  await withSmsEnv(async () => {
    const [{ getSmsRuntimeConfig }, { parseRequestedSmsTime }] = await Promise.all([
      importSmsConfig(),
      importRequestedTimeParser(),
    ]);

    const result = parseRequestedSmsTime({
      body: "friday at 2:30pm",
      now: new Date("2026-04-21T21:00:00.000Z"),
      slotIntervalMinutes: getSmsRuntimeConfig().slotIntervalMinutes,
      timeZone: getSmsRuntimeConfig().timeZone,
    });

    assert.deepEqual(result, {
      kind: "requested_time",
      startsAt: "2026-04-24T18:30:00.000Z",
    });
  }, {
    SMS_TIME_ZONE: null,
    TZ: "UTC",
  });
});
