import assert from "node:assert/strict";
import test from "node:test";

function createSupabaseStub({
  duplicateCount = 0,
  trainerPhone = "+14165550123",
  trainerUserId = "trainer-user-1",
}: {
  duplicateCount?: number;
  trainerPhone?: string | null;
  trainerUserId?: string;
}) {
  return {
    from(table: string) {
      if (table === "sms_messages") {
        return createCountQuery(duplicateCount);
      }

      if (table === "trainers") {
        return createSingleRowQuery({ user_id: trainerUserId });
      }

      if (table === "users") {
        return createSingleRowQuery(
          trainerPhone === null ? null : { phone_number: trainerPhone },
        );
      }

      throw new Error(`Unexpected table lookup: ${table}`);
    },
  };
}

function createCountQuery(count: number) {
  return {
    count,
    error: null,
    eq() {
      return this;
    },
    select() {
      return this;
    },
  };
}

function createSingleRowQuery<Row>(row: Row | null) {
  return {
    eq() {
      return this;
    },
    maybeSingle: async () => ({
      data: row,
      error: null,
    }),
    select() {
      return this;
    },
  };
}

async function importTrainerNotificationsModule(
  suffix: string,
  moduleMocker: {
    module: (specifier: string, options: object) => unknown;
  },
) {
  await moduleMocker.module("server-only", {
    defaultExport: {},
  });

  return import(`./trainer-notifications.ts?case=${suffix}`);
}

test("sendTrainerSessionNotification sends, skips, and dedupes trainer notifications", async (t) => {
  const sendTwilioSms = t.mock.fn(async (input: unknown) => {
    void input;
  });
  const logSmsMessage = t.mock.fn(async (input: unknown) => {
    void input;
  });
  let currentScenario: {
    duplicateCount?: number;
    trainerPhone?: string | null;
  } = {};

  await t.mock.module("../supabase/server", {
    namedExports: {
      createServerSupabaseClient: () => createSupabaseStub(currentScenario),
    },
  });
  await t.mock.module("./twilio-sender", {
    namedExports: {
      sendTwilioSms,
    },
  });
  await t.mock.module("./message-log", {
    namedExports: {
      logSmsMessage,
    },
  });
  await t.mock.module("./config", {
    namedExports: {
      getTwilioSenderConfig: () => ({
        accountSid: "AC123",
        authToken: "secret",
        fromPhone: "+14165550000",
      }),
    },
  });

  const { sendTrainerSessionNotification } = await importTrainerNotificationsModule(
    "scenarios",
    t.mock,
  );

  currentScenario = {};
  await sendTrainerSessionNotification({
    clientId: "client-1",
    clientName: "Alex Client",
    kind: "book",
    newSlotLabel: "Tue, Apr 21, 9:00 AM",
    sourceChangeId: "change-1",
    trainerId: "trainer-1",
  });

  assert.equal(sendTwilioSms.mock.calls.length, 1);
  const [sendCall] = sendTwilioSms.mock.calls;
  assert.ok(sendCall);
  assert.deepEqual(sendCall.arguments[0], {
    audience: "trainer",
    body: "Gym Scheduler: Alex Client booked Tue, Apr 21, 9:00 AM via SMS. No reply needed.",
    clientId: "client-1",
    messageKind: "book",
    sourceChangeId: "change-1",
    toPhone: "+14165550123",
    trainerId: "trainer-1",
  });
  assert.equal(logSmsMessage.mock.calls.length, 0);

  currentScenario = {
    trainerPhone: null,
  };
  await sendTrainerSessionNotification({
    clientId: "client-1",
    clientName: "Alex Client",
    kind: "cancel",
    slotLabel: "Tue, Apr 21, 9:00 AM",
    sourceChangeId: "change-2",
    trainerId: "trainer-1",
  });

  assert.equal(sendTwilioSms.mock.calls.length, 1);
  assert.equal(logSmsMessage.mock.calls.length, 1);
  const [logCall] = logSmsMessage.mock.calls.slice(-1);
  assert.ok(logCall);
  assert.deepEqual(logCall.arguments[0], {
    account_sid: "AC123",
    audience: "trainer",
    body: "Gym Scheduler: Alex Client cancelled Tue, Apr 21, 9:00 AM via SMS. No reply needed.",
    client_id: "client-1",
    direction: "outbound",
    error_message:
      "Trainer phone number is missing. Update users.phone_number to enable trainer SMS.",
    from_phone: "+14165550000",
    message_kind: "cancel",
    normalized_from_phone: "+14165550000",
    normalized_to_phone: "",
    provider: "twilio",
    source_change_id: "change-2",
    status: "failed",
    to_phone: "",
    trainer_id: "trainer-1",
  });

  currentScenario = {
    duplicateCount: 1,
  };
  await sendTrainerSessionNotification({
    clientId: "client-1",
    clientName: "Alex Client",
    kind: "reschedule",
    newSlotLabel: "Tue, Apr 21, 11:00 AM",
    oldSlotLabel: "Tue, Apr 21, 9:00 AM",
    sourceChangeId: "change-3",
    trainerId: "trainer-1",
  });

  assert.equal(sendTwilioSms.mock.calls.length, 1);
  assert.equal(logSmsMessage.mock.calls.length, 1);
});
