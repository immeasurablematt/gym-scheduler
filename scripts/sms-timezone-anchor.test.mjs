import assert from "node:assert/strict";
import test from "node:test";

test("getPlainDateInTimeZone returns the date for an arbitrary anchor", async () => {
  const { getPlainDateInTimeZone } = await import("../lib/sms/timezone.ts");

  assert.equal(typeof getPlainDateInTimeZone, "function");

  const result = getPlainDateInTimeZone(
    new Date("2026-04-20T02:30:00.000Z"),
    "America/Toronto",
  );

  assert.deepEqual(result, {
    day: 19,
    month: 4,
    year: 2026,
  });
});
