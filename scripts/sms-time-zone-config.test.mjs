import assert from "node:assert/strict";
import test from "node:test";

test("resolveSmsTimeZone falls back to Toronto when SMS_TIME_ZONE is unset", async () => {
  const { resolveSmsTimeZone } = await import("../lib/sms/time-zone-config.ts");

  assert.equal(resolveSmsTimeZone(undefined), "America/Toronto");
});

test("resolveSmsTimeZone accepts explicit IANA zones", async () => {
  const { resolveSmsTimeZone } = await import("../lib/sms/time-zone-config.ts");

  assert.equal(resolveSmsTimeZone("America/Vancouver"), "America/Vancouver");
});

test("resolveSmsTimeZone normalizes leading-colon zones like :UTC", async () => {
  const { resolveSmsTimeZone } = await import("../lib/sms/time-zone-config.ts");

  assert.equal(resolveSmsTimeZone(":UTC"), "UTC");
});

test("resolveSmsTimeZone falls back to Toronto for invalid zones", async () => {
  const { resolveSmsTimeZone } = await import("../lib/sms/time-zone-config.ts");

  assert.equal(resolveSmsTimeZone("definitely-not-a-real-zone"), "America/Toronto");
});
