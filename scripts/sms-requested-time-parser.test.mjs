import assert from "node:assert/strict";
import test from "node:test";

test("parses weekday shorthand like monday at 2 as a requested time", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "can you do monday at 2?",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "requested_time",
    startsAt: "2026-04-20T18:00:00.000Z",
  });
});

test("parses tues at 2pm as a requested time", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "tues at 2pm",
    now: new Date("2026-04-20T18:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "requested_time",
    startsAt: "2026-04-21T18:00:00.000Z",
  });
});

test("parses thurs 11am as a requested time", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "thurs 11am",
    now: new Date("2026-04-20T18:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "requested_time",
    startsAt: "2026-04-23T15:00:00.000Z",
  });
});

test("parses the approved weekday alias set", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const cases = [
    ["mon at 2pm", "2026-04-27T18:00:00.000Z"],
    ["tue at 2pm", "2026-04-21T18:00:00.000Z"],
    ["wed at 2pm", "2026-04-22T18:00:00.000Z"],
    ["thu at 2pm", "2026-04-23T18:00:00.000Z"],
    ["thur at 2pm", "2026-04-23T18:00:00.000Z"],
    ["fri at 2pm", "2026-04-24T18:00:00.000Z"],
    ["sat at 2pm", "2026-04-25T18:00:00.000Z"],
    ["sun at 2pm", "2026-04-26T18:00:00.000Z"],
  ];

  for (const [body, startsAt] of cases) {
    const result = parseRequestedSmsTime({
      body,
      now: new Date("2026-04-20T18:00:00.000Z"),
      slotIntervalMinutes: 30,
      timeZone: "America/Toronto",
    });

    assert.deepEqual(result, {
      kind: "requested_time",
      startsAt,
    });
  }
});

test("does not match weekday prefixes inside longer words", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "thursdayish at 2pm",
    now: new Date("2026-04-20T18:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "not_requested_time",
  });
});

test("parses tomorrow with explicit am/pm", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "tomorrow 11am",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "requested_time",
    startsAt: "2026-04-19T15:00:00.000Z",
  });
});

test("parses explicit month/day requests", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "is 4/22 2pm open?",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "requested_time",
    startsAt: "2026-04-22T18:00:00.000Z",
  });
});

test("rejects vague phrases that are out of scope", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "after work next week",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "not_requested_time",
  });
});

test("flags off-interval minute values instead of rounding", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "monday 2:15 pm",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "invalid_requested_time",
    reason: "off_interval",
  });
});

test("requires am or pm for bare hours outside the approved shorthand window", async () => {
  const { parseRequestedSmsTime } = await import("../lib/sms/requested-time-parser.ts");
  const result = parseRequestedSmsTime({
    body: "monday at 8",
    now: new Date("2026-04-18T16:00:00.000Z"),
    slotIntervalMinutes: 30,
    timeZone: "America/Toronto",
  });

  assert.deepEqual(result, {
    kind: "invalid_requested_time",
    reason: "ambiguous_hour",
  });
});
