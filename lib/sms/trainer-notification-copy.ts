import { normalizePhoneNumber } from "./phone";

type TrainerNotificationBodyInput =
  | {
      clientName: string;
      kind: "book";
      newSlotLabel: string;
    }
  | {
      clientName: string;
      kind: "reschedule";
      newSlotLabel: string;
      oldSlotLabel: string;
    }
  | {
      clientName: string;
      kind: "cancel";
      slotLabel: string;
    };

const VALID_SMS_DESTINATION_PATTERN = /^\+[1-9]\d{9,14}$/;

export type { TrainerNotificationBodyInput };

export function buildTrainerNotificationBody(
  input: TrainerNotificationBodyInput,
) {
  switch (input.kind) {
    case "book":
      return `Gym Scheduler: ${input.clientName} booked ${input.newSlotLabel} via SMS. No reply needed.`;
    case "reschedule":
      return `Gym Scheduler: ${input.clientName} moved from ${input.oldSlotLabel} to ${input.newSlotLabel} via SMS. No reply needed.`;
    case "cancel":
      return `Gym Scheduler: ${input.clientName} cancelled ${input.slotLabel} via SMS. No reply needed.`;
  }
}

export function normalizeTrainerDestinationPhone(
  value: string | null | undefined,
) {
  const normalized = normalizePhoneNumber(value);

  if (!normalized || !VALID_SMS_DESTINATION_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}
