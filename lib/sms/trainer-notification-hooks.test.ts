import assert from "node:assert/strict";
import test from "node:test";

const BOOKED_AT = "2026-04-21T13:00:00.000Z";
const RESCHEDULED_FROM = "2026-04-21T13:00:00.000Z";
const RESCHEDULED_TO = "2026-04-21T15:00:00.000Z";
const REQUESTED_RESCHEDULE_AT = "2026-04-21T18:00:00.000Z";

function createBookingSupabaseStub() {
  return {
    from(table: string) {
      if (table === "sessions") {
        return {
          insert() {
            return {
              select() {
                return {
                  single: async () => ({
                    data: createSessionRow({
                      id: "session-booked",
                      scheduledAt: BOOKED_AT,
                    }),
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      if (table === "session_changes") {
        return {
          insert() {
            return {
              error: null,
              select() {
                return {
                  single: async () => ({
                    data: { id: "change-booked" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table lookup: ${table}`);
    },
  };
}

function createRescheduleSupabaseStub() {
  let sessionsCall = 0;

  return {
    from(table: string) {
      if (table === "sessions") {
        sessionsCall += 1;

        if (sessionsCall === 1) {
          const query = {
            eq() {
              return query;
            },
            maybeSingle: async () => ({
              data: createSessionRow({
                id: "session-reschedule",
                scheduledAt: RESCHEDULED_FROM,
              }),
              error: null,
            }),
            neq() {
              return query;
            },
            select() {
              return query;
            },
          };

          return query;
        }

        const query = {
          eq() {
            return query;
          },
          maybeSingle: async () => ({
            data: createSessionRow({
              id: "session-reschedule",
              scheduledAt: RESCHEDULED_TO,
            }),
            error: null,
          }),
          select() {
            return query;
          },
          update() {
            return query;
          },
        };

        return query;
      }

      if (table === "session_changes") {
        return {
          insert() {
            return {
              error: null,
              select() {
                return {
                  single: async () => ({
                    data: { id: "change-reschedule" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table lookup: ${table}`);
    },
  };
}

function createCancelSupabaseStub() {
  return {
    from(table: string) {
      if (table === "sessions") {
        let isUpdateQuery = false;
        const query = {
          eq() {
            return query;
          },
          gte() {
            return query;
          },
          limit: async () => ({
            data: [
              createSessionRow({
                id: "session-cancel",
                scheduledAt: BOOKED_AT,
              }),
            ],
            error: null,
          }),
          maybeSingle: async () => ({
            data: isUpdateQuery
              ? createSessionRow({
                  id: "session-cancel",
                  scheduledAt: BOOKED_AT,
                  status: "cancelled",
                })
              : createSessionRow({
                  id: "session-cancel",
                  scheduledAt: BOOKED_AT,
                }),
            error: null,
          }),
          order() {
            return query;
          },
          select() {
            return query;
          },
          update() {
            isUpdateQuery = true;
            return query;
          },
        };

        return query;
      }

      if (table === "session_changes") {
        return {
          insert() {
            return {
              error: null,
              select() {
                return {
                  single: async () => ({
                    data: { id: "change-cancel" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table lookup: ${table}`);
    },
  };
}

function createExactTimeRescheduleSupabaseStub() {
  let sessionsCall = 0;

  return {
    from(table: string) {
      if (table === "sessions") {
        sessionsCall += 1;

        if (sessionsCall === 1) {
          const query = {
            eq() {
              return query;
            },
            gte() {
              return query;
            },
            limit: async () => ({
              data: [
                createSessionRow({
                  id: "session-reschedule",
                  scheduledAt: RESCHEDULED_FROM,
                }),
              ],
              error: null,
            }),
            order() {
              return query;
            },
            select() {
              return query;
            },
          };

          return query;
        }

        if (sessionsCall === 2) {
          const query = {
            eq() {
              return query;
            },
            maybeSingle: async () => ({
              data: createSessionRow({
                id: "session-reschedule",
                scheduledAt: RESCHEDULED_FROM,
              }),
              error: null,
            }),
            neq() {
              return query;
            },
            select() {
              return query;
            },
          };

          return query;
        }

        const query = {
          eq() {
            return query;
          },
          maybeSingle: async () => ({
            data: createSessionRow({
              id: "session-reschedule",
              scheduledAt: REQUESTED_RESCHEDULE_AT,
            }),
            error: null,
          }),
          select() {
            return query;
          },
          update() {
            return query;
          },
        };

        return query;
      }

      if (table === "session_changes") {
        return {
          insert() {
            return {
              error: null,
              select() {
                return {
                  single: async () => ({
                    data: { id: "change-exact-reschedule" },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table lookup: ${table}`);
    },
  };
}

function createSessionRow({
  id,
  scheduledAt,
  status = "scheduled",
}: {
  id: string;
  scheduledAt: string;
  status?: "scheduled" | "cancelled";
}) {
  return {
    client_id: "client-1",
    duration_minutes: 60,
    gym_space_id: null,
    id,
    notes: "Booked via SMS.",
    scheduled_at: scheduledAt,
    session_type: "personal_training",
    status,
    trainer_id: "trainer-1",
  };
}

function createSmsContext() {
  return {
    client: {
      id: "client-1",
    },
    clientUser: {
      full_name: "Alex Client",
    },
    trainer: {
      id: "trainer-1",
      user_id: "trainer-user-1",
    },
  };
}

async function importBookingService(suffix: string) {
  return import(new URL(`./booking-service.ts?case=${suffix}`, import.meta.url).href);
}

async function importSessionLifecycle(suffix: string) {
  return import(
    new URL(`./session-lifecycle.ts?case=${suffix}`, import.meta.url).href
  );
}

test("bookRequestedSmsTime sends one trainer notification after a successful SMS booking", async (t) => {
  const sendTrainerSessionNotification = t.mock.fn(
    async (input: unknown) => {
      void input;
    },
  );
  const syncSessionToCalendar = t.mock.fn(async () => undefined);

  await t.mock.module("server-only", {
    defaultExport: {},
  });
  await t.mock.module("@/lib/google/client", {
    namedExports: {
      TrainerCalendarUnavailableError: class TrainerCalendarUnavailableError extends Error {},
    },
  });
  await t.mock.module("@/lib/google/calendar-sync", {
    namedExports: {
      syncSessionToCalendar,
    },
  });
  await t.mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseClient: () => createBookingSupabaseStub(),
    },
  });
  await t.mock.module("@/lib/sms/availability-engine", {
    namedExports: {
      findAvailableSmsSlots: async () => [
        {
          endsAt: "2026-04-21T14:00:00.000Z",
          label: "Tue, Apr 21, 9:00 AM",
          startsAt: BOOKED_AT,
        },
      ],
      hasAvailabilitySource: async () => true,
    },
  });
  await t.mock.module("@/lib/sms/config", {
    namedExports: {
      getSmsRuntimeConfig: () => ({
        maxSlotsOffered: 3,
        offerExpiryHours: 4,
        searchDays: 7,
        sessionDurationMinutes: 60,
        sessionType: "personal_training",
        slotIntervalMinutes: 30,
        timeZone: "America/Toronto",
      }),
    },
  });
  await t.mock.module("@/lib/sms/client-directory", {
    namedExports: {
      SmsKnownClientContext: class {},
    },
  });
  await t.mock.module("@/lib/sms/phone", {
    namedExports: {
      getFirstName: () => "Alex",
    },
  });
  await t.mock.module("@/lib/sms/requested-time-parser", {
    namedExports: {
      parseRequestedSmsTime: () => ({
        kind: "requested_time",
        startsAt: BOOKED_AT,
      }),
    },
  });
  await t.mock.module("@/lib/sms/offer-service", {
    namedExports: {
      createSmsOfferSet: async () => ({ offerSetId: "offer-1" }),
      expirePendingOfferSets: async () => undefined,
      getLatestPendingOfferSet: async () => null,
      markOfferBooked: async () => undefined,
      markOfferConflicted: async () => undefined,
    },
  });
  await t.mock.module("@/lib/sms/session-lifecycle", {
    namedExports: {
      isSessionConflictError: () => false,
      rescheduleSessionFromOffer: async () => createSessionRow({
        id: "unused",
        scheduledAt: RESCHEDULED_TO,
      }),
    },
  });
  await t.mock.module("@/lib/sms/timezone", {
    namedExports: {
      formatSlotLabel: () => "Tue, Apr 21, 9:00 AM",
    },
  });
  await t.mock.module("@/lib/sms/trainer-notifications", {
    namedExports: {
      sendTrainerSessionNotification,
    },
  });

  const { bookRequestedSmsTime } = await importBookingService("book");
  const result = await bookRequestedSmsTime(
    createSmsContext(),
    "Tuesday at 9 AM",
    "inbound-1",
  );

  assert.equal(result.kind, "booked");
  assert.equal(syncSessionToCalendar.mock.calls.length, 1);
  assert.equal(sendTrainerSessionNotification.mock.calls.length, 1);
  const [bookNotificationCall] = sendTrainerSessionNotification.mock.calls;
  assert.ok(bookNotificationCall);
  assert.deepEqual(bookNotificationCall.arguments[0], {
    clientId: "client-1",
    clientName: "Alex Client",
    kind: "book",
    newSlotLabel: "Tue, Apr 21, 9:00 AM",
    sourceChangeId: "change-booked",
    trainerId: "trainer-1",
  });
});

test("session lifecycle hooks preserve single-send trainer notifications", async (t) => {
  const sendTrainerSessionNotification = t.mock.fn(
    async (input: unknown) => {
      void input;
    },
  );
  const syncSessionToCalendar = t.mock.fn(async () => undefined);
  const expirePendingOfferSets = t.mock.fn(async () => undefined);
  let exactTimeSupabaseClient = createExactTimeRescheduleSupabaseStub();
  let scenario:
    | { kind: "exact-time" }
    | { kind: "reschedule-and-cancel"; clientCall: number } = {
    kind: "exact-time",
  };

  await t.mock.module("server-only", {
    defaultExport: {},
  });
  await t.mock.module("@/lib/google/client", {
    namedExports: {
      TrainerCalendarUnavailableError: class TrainerCalendarUnavailableError extends Error {},
    },
  });
  await t.mock.module("@/lib/google/calendar-sync", {
    namedExports: {
      syncSessionToCalendar,
    },
  });
  await t.mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseClient: () => {
        if (scenario.kind === "exact-time") {
          return exactTimeSupabaseClient;
        }

        scenario.clientCall += 1;
        return scenario.clientCall === 1
          ? createRescheduleSupabaseStub()
          : createCancelSupabaseStub();
      },
    },
  });
  await t.mock.module("@/lib/sms/conversation-service", {
    namedExports: {
      completeSmsConversation: async () => undefined,
      createSmsConversation: async () => ({ id: "conversation-1" }),
    },
  });
  await t.mock.module("@/lib/sms/availability-engine", {
    namedExports: {
      findAvailableSmsSlots: async () =>
        scenario.kind === "exact-time"
          ? [
              {
                endsAt: "2026-04-21T19:00:00.000Z",
                label: "Tue, Apr 21, 2:00 PM",
                startsAt: REQUESTED_RESCHEDULE_AT,
              },
            ]
          : [],
      hasAvailabilitySource: async () => true,
    },
  });
  await t.mock.module("@/lib/sms/config", {
    namedExports: {
      getSmsRuntimeConfig: () => ({
        maxSlotsOffered: 3,
        offerExpiryHours: 4,
        searchDays: 7,
        sessionDurationMinutes: 60,
        sessionType: "personal_training",
        slotIntervalMinutes: 30,
        timeZone: "America/Toronto",
      }),
    },
  });
  await t.mock.module("@/lib/sms/offer-service", {
    namedExports: {
      createSmsOfferSet: async () => ({ offerSetId: "offer-1" }),
      expireOfferSet: async () => undefined,
      expirePendingOfferSets,
      getLatestPendingRescheduleOfferSet: async () => null,
    },
  });
  await t.mock.module("@/lib/sms/requested-time-parser", {
    namedExports: {
      parseRequestedSmsTime: () => ({
        kind: "requested_time",
        startsAt: REQUESTED_RESCHEDULE_AT,
      }),
    },
  });
  await t.mock.module("@/lib/sms/timezone", {
    namedExports: {
      formatSlotLabel: (value: string) =>
        value === RESCHEDULED_FROM
          ? "Tue, Apr 21, 9:00 AM"
          : value === REQUESTED_RESCHEDULE_AT
            ? "Tue, Apr 21, 2:00 PM"
            : "Tue, Apr 21, 11:00 AM",
    },
  });
  await t.mock.module("@/lib/sms/trainer-notifications", {
    namedExports: {
      sendTrainerSessionNotification,
    },
  });

  const {
    cancelSessionBySms,
    handleRequestedRescheduleTime,
    rescheduleSessionFromOffer,
  } = await importSessionLifecycle(
    "notification-hooks",
  );

  await t.test(
    "handleRequestedRescheduleTime sends one trainer notification for a successful exact-time reschedule",
    async () => {
      scenario = { kind: "exact-time" };
      exactTimeSupabaseClient = createExactTimeRescheduleSupabaseStub();
      sendTrainerSessionNotification.mock.resetCalls();
      syncSessionToCalendar.mock.resetCalls();

      const result = await handleRequestedRescheduleTime(
        createSmsContext(),
        {
          body: "tomorrow at 2pm",
          inboundMessageId: "inbound-5",
        },
      );

      assert.equal(result.kind, "rescheduled");
      assert.equal(sendTrainerSessionNotification.mock.calls.length, 1);
      const [notificationCall] = sendTrainerSessionNotification.mock.calls;
      assert.ok(notificationCall);
      assert.deepEqual(notificationCall.arguments[0], {
        clientId: "client-1",
        clientName: "Alex Client",
        kind: "reschedule",
        newSlotLabel: "Tue, Apr 21, 2:00 PM",
        oldSlotLabel: "Tue, Apr 21, 9:00 AM",
        sourceChangeId: "change-exact-reschedule",
        trainerId: "trainer-1",
      });
      assert.equal(syncSessionToCalendar.mock.calls.length, 1);
    },
  );

  await t.test(
    "rescheduleSessionFromOffer and cancelSessionBySms each send one trainer notification",
    async () => {
      scenario = { kind: "reschedule-and-cancel", clientCall: 0 };
      expirePendingOfferSets.mock.resetCalls();
      sendTrainerSessionNotification.mock.resetCalls();
      syncSessionToCalendar.mock.resetCalls();

      await rescheduleSessionFromOffer(
        createSmsContext(),
        "session-reschedule",
        RESCHEDULED_TO,
      );

      const session = createSessionRow({
        id: "session-cancel",
        scheduledAt: BOOKED_AT,
      });
      await cancelSessionBySms(createSmsContext(), session, "inbound-1");

      assert.equal(expirePendingOfferSets.mock.calls.length, 1);
      assert.equal(sendTrainerSessionNotification.mock.calls.length, 2);
      const [rescheduleNotificationCall, cancelNotificationCall] =
        sendTrainerSessionNotification.mock.calls;
      assert.ok(rescheduleNotificationCall);
      assert.deepEqual(rescheduleNotificationCall.arguments[0], {
        clientId: "client-1",
        clientName: "Alex Client",
        kind: "reschedule",
        newSlotLabel: "Tue, Apr 21, 11:00 AM",
        oldSlotLabel: "Tue, Apr 21, 9:00 AM",
        sourceChangeId: "change-reschedule",
        trainerId: "trainer-1",
      });
      assert.ok(cancelNotificationCall);
      assert.deepEqual(cancelNotificationCall.arguments[0], {
        clientId: "client-1",
        clientName: "Alex Client",
        kind: "cancel",
        slotLabel: "Tue, Apr 21, 9:00 AM",
        sourceChangeId: "change-cancel",
        trainerId: "trainer-1",
      });
      assert.equal(syncSessionToCalendar.mock.calls.length, 2);
    },
  );
});
