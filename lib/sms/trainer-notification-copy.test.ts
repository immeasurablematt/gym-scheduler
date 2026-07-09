import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTrainerNotificationBody,
  normalizeTrainerDestinationPhone,
} from "./trainer-notification-copy";

test("buildTrainerNotificationBody returns the exact booking message copy", () => {
  assert.equal(
    buildTrainerNotificationBody({
      clientName: "Alex Client",
      kind: "book",
      newSlotLabel: "Tue, Apr 21, 9:00 AM",
    }),
    "Gym Scheduler: Alex Client booked Tue, Apr 21, 9:00 AM via SMS. No reply needed.",
  );
});

test("buildTrainerNotificationBody returns the exact reschedule message copy", () => {
  assert.equal(
    buildTrainerNotificationBody({
      clientName: "Alex Client",
      kind: "reschedule",
      newSlotLabel: "Tue, Apr 21, 11:00 AM",
      oldSlotLabel: "Tue, Apr 21, 9:00 AM",
    }),
    "Gym Scheduler: Alex Client moved from Tue, Apr 21, 9:00 AM to Tue, Apr 21, 11:00 AM via SMS. No reply needed.",
  );
});

test("buildTrainerNotificationBody returns the exact cancellation message copy", () => {
  assert.equal(
    buildTrainerNotificationBody({
      clientName: "Alex Client",
      kind: "cancel",
      slotLabel: "Tue, Apr 21, 9:00 AM",
    }),
    "Gym Scheduler: Alex Client cancelled Tue, Apr 21, 9:00 AM via SMS. No reply needed.",
  );
});

test("normalizeTrainerDestinationPhone accepts a valid North American number", () => {
  assert.equal(
    normalizeTrainerDestinationPhone("(416) 555-0123"),
    "+14165550123",
  );
});

test("normalizeTrainerDestinationPhone rejects missing or clearly invalid numbers", () => {
  assert.equal(normalizeTrainerDestinationPhone(""), null);
  assert.equal(normalizeTrainerDestinationPhone("1234"), null);
});
