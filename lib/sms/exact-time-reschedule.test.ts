import assert from "node:assert/strict";
import test from "node:test";

const CURRENT_SLOT = "2026-04-21T15:00:00.000Z";
const REQUESTED_SLOT = "2026-04-21T18:00:00.000Z";
const ALTERNATIVE_SLOT_1 = "2026-04-21T18:30:00.000Z";
const ALTERNATIVE_SLOT_2 = "2026-04-22T14:00:00.000Z";
const ALTERNATIVE_SLOT_3 = "2026-04-23T16:00:00.000Z";
let importCounter = 0;

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
      available_hours: [],
      id: "trainer-1",
      user_id: "trainer-user-1",
    },
  };
}

function createAvailabilitySlot(startsAt: string, label: string) {
  return {
    endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString(),
    label,
    startsAt,
  };
}

function createSessionLifecycleSupabaseFactory(options: {
  sessionSteps: Array<
    | {
        type: "existing" | "load" | "update";
        session: ReturnType<typeof createSessionRow> | null;
      }
    | {
        type: "list";
        sessions: ReturnType<typeof createSessionRow>[];
      }
  >;
}) {
  let sessionsCall = 0;

  const client = {
    from(table: string) {
      if (table === "sessions") {
        const step = options.sessionSteps[sessionsCall];
        sessionsCall += 1;

        if (!step) {
          throw new Error("Unexpected sessions query.");
        }

        if (step.type === "load") {
          const query = {
            eq() {
              return query;
            },
            gte() {
              return query;
            },
            maybeSingle: async () => ({
              data: step.session,
              error: null,
            }),
            select() {
              return query;
            },
          };

          return query;
        }

        if (step.type === "list") {
          const query = {
            eq() {
              return query;
            },
            gte() {
              return query;
            },
            limit: async () => ({
              data: step.sessions,
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

        if (step.type === "existing") {
          const query = {
            eq() {
              return query;
            },
            maybeSingle: async () => ({
              data: step.session,
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
            data: step.session,
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
              select() {
                return {
                  single: async () => ({
                    data: { id: "change-1" },
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

  return () => client;
}

async function importSessionLifecycle(suffix: string) {
  return import(
    new URL(`./session-lifecycle.ts?case=${suffix}`, import.meta.url).href
  );
}

type ScenarioOptions = {
  availableSlots?: ReturnType<typeof createAvailabilitySlot>[];
  existingSession?: ReturnType<typeof createSessionRow>;
  expireOfferSetError?: Error | null;
  listedSessions?: ReturnType<typeof createSessionRow>[];
  offerSet?: { offerSetId: string };
  parsedResult?:
    | { kind: "requested_time"; startsAt: string }
    | { kind: "invalid_requested_time"; reason: "ambiguous_hour" | "off_interval" }
    | { kind: "not_requested_time" };
  pendingRescheduleOffers?: Array<{
    flow_type?: "booking" | "reschedule" | null;
    offer_set_id?: string | null;
    target_session_id?: string | null;
  }>;
  targetSession?: ReturnType<typeof createSessionRow> | null;
  updatedSession?: ReturnType<typeof createSessionRow>;
};

type ScenarioState = {
  availableSlots: ReturnType<typeof createAvailabilitySlot>[];
  calls: {
    createSmsConversation: Array<unknown>;
    createSmsOfferSet: Array<unknown>;
    expireOfferSet: Array<string>;
    expirePendingOfferSets: Array<unknown[]>;
    findAvailableSmsSlots: Array<unknown>;
    sendTrainerSessionNotification: Array<unknown>;
    syncSessionToCalendar: Array<unknown[]>;
  };
  expireOfferSetError: Error | null;
  existingSession: ReturnType<typeof createSessionRow>;
  listedSessions: ReturnType<typeof createSessionRow>[];
  offerSet: { offerSetId: string };
  parsedResult:
    | { kind: "requested_time"; startsAt: string }
    | { kind: "invalid_requested_time"; reason: "ambiguous_hour" | "off_interval" }
    | { kind: "not_requested_time" };
  pendingRescheduleOffers: Array<{
    flow_type?: "booking" | "reschedule" | null;
    offer_set_id?: string | null;
    target_session_id?: string | null;
  }> | null;
  supabaseClient: ReturnType<ReturnType<typeof createSessionLifecycleSupabaseFactory>>;
  targetSession: ReturnType<typeof createSessionRow> | null;
  updatedSession: ReturnType<typeof createSessionRow>;
};

function createScenarioState(options: ScenarioOptions = {}): ScenarioState {
  const existingSession =
    options.existingSession ??
    createSessionRow({
      id: "session-1",
      scheduledAt: CURRENT_SLOT,
    });
  const listedSessions =
    options.listedSessions ??
    [
      createSessionRow({
        id: "session-1",
        scheduledAt: CURRENT_SLOT,
      }),
    ];
  const updatedSession =
    options.updatedSession ??
    createSessionRow({
      id: "session-1",
      scheduledAt: REQUESTED_SLOT,
    });
  const targetSession =
    "targetSession" in options ? options.targetSession ?? null : null;
  const sessionSteps = targetSession
    ? [
        { type: "load" as const, session: targetSession },
        { type: "existing" as const, session: existingSession },
        { type: "update" as const, session: updatedSession },
      ]
    : options.pendingRescheduleOffers
      ? [
          { type: "load" as const, session: null },
          { type: "list" as const, sessions: listedSessions },
        ]
      : [
          { type: "list" as const, sessions: listedSessions },
          { type: "existing" as const, session: existingSession },
          { type: "update" as const, session: updatedSession },
        ];

  return {
    availableSlots: options.availableSlots ?? [],
    calls: {
      createSmsConversation: [],
      createSmsOfferSet: [],
      expireOfferSet: [],
      expirePendingOfferSets: [],
      findAvailableSmsSlots: [],
      sendTrainerSessionNotification: [],
      syncSessionToCalendar: [],
    },
    expireOfferSetError: options.expireOfferSetError ?? null,
    existingSession,
    listedSessions,
    offerSet: options.offerSet ?? { offerSetId: "offer-1" },
    parsedResult:
      options.parsedResult ?? { kind: "requested_time", startsAt: REQUESTED_SLOT },
    pendingRescheduleOffers: options.pendingRescheduleOffers ?? null,
    supabaseClient: createSessionLifecycleSupabaseFactory({
      sessionSteps,
    })(),
    targetSession,
    updatedSession,
  };
}

test("handleRequestedRescheduleTime exact-time reschedule flows", async (t) => {
  let scenario = createScenarioState();

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
      syncSessionToCalendar: async (...args: unknown[]) => {
        scenario.calls.syncSessionToCalendar.push(args);
      },
    },
  });
  await t.mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseClient: () => scenario.supabaseClient,
    },
  });
  await t.mock.module("@/lib/sms/conversation-service", {
    namedExports: {
      completeSmsConversation: async () => undefined,
      createSmsConversation: async (input: unknown) => {
        scenario.calls.createSmsConversation.push(input);
        return { id: "conversation-1" };
      },
    },
  });
  await t.mock.module("@/lib/sms/availability-engine", {
    namedExports: {
      findAvailableSmsSlots: async (input: unknown) => {
        scenario.calls.findAvailableSmsSlots.push(input);
        return scenario.availableSlots;
      },
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
      createSmsOfferSet: async (input: unknown) => {
        scenario.calls.createSmsOfferSet.push(input);
        return scenario.offerSet;
      },
      expireOfferSet: async (offerSetId: string) => {
        scenario.calls.expireOfferSet.push(offerSetId);

        if (scenario.expireOfferSetError) {
          throw scenario.expireOfferSetError;
        }
      },
      expirePendingOfferSets: async (...args: unknown[]) => {
        scenario.calls.expirePendingOfferSets.push(args);
      },
      getLatestPendingRescheduleOfferSet: async () =>
        scenario.pendingRescheduleOffers,
    },
  });
  await t.mock.module("@/lib/sms/requested-time-parser", {
    namedExports: {
      parseRequestedSmsTime: () => scenario.parsedResult,
    },
  });
  await t.mock.module("@/lib/sms/timezone", {
    namedExports: {
      formatSlotLabel: (value: string) =>
        ({
          [ALTERNATIVE_SLOT_1]: "Tue, Apr 21, 2:30 PM",
          [ALTERNATIVE_SLOT_2]: "Wed, Apr 22, 10:00 AM",
          [ALTERNATIVE_SLOT_3]: "Thu, Apr 23, 12:00 PM",
          [CURRENT_SLOT]: "Tue, Apr 21, 11:00 AM",
          [REQUESTED_SLOT]: "Tue, Apr 21, 2:00 PM",
        })[value] ?? value,
    },
  });
  await t.mock.module("@/lib/sms/trainer-notifications", {
    namedExports: {
      sendTrainerSessionNotification: async (input: unknown) => {
        scenario.calls.sendTrainerSessionNotification.push(input);
      },
    },
  });

  const { handleRequestedRescheduleTime } = await importSessionLifecycle(
    `exact-time-${++importCounter}`,
  );

  await t.test(
    "reschedules the only upcoming session when the requested exact time is open",
    async () => {
      scenario = createScenarioState({
        availableSlots: [
          createAvailabilitySlot(REQUESTED_SLOT, "Tue, Apr 21, 2:00 PM"),
        ],
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "tomorrow at 2pm",
        inboundMessageId: "inbound-1",
      });

      assert.equal(result.kind, "rescheduled");
      assert.match(result.replyBody, /Your session is moved to/);
      assert.equal(scenario.calls.sendTrainerSessionNotification.length, 1);
    },
  );

  await t.test(
    "reschedules immediately when the exact slot exists later in the availability list",
    async () => {
      scenario = createScenarioState({
        availableSlots: [
          createAvailabilitySlot(ALTERNATIVE_SLOT_1, "Tue, Apr 21, 2:30 PM"),
          createAvailabilitySlot(REQUESTED_SLOT, "Tue, Apr 21, 2:00 PM"),
        ],
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "tomorrow at 2pm",
        inboundMessageId: "inbound-1b",
      });

      assert.equal(result.kind, "rescheduled");
      assert.match(result.replyBody, /Your session is moved to/);
      assert.equal(scenario.calls.createSmsOfferSet.length, 0);
    },
  );

  await t.test(
    "uses the active reschedule offer target without falling back to session choice",
    async () => {
      scenario = createScenarioState({
        availableSlots: [
          createAvailabilitySlot(REQUESTED_SLOT, "Tue, Apr 21, 2:00 PM"),
        ],
        existingSession: createSessionRow({
          id: "session-2",
          scheduledAt: ALTERNATIVE_SLOT_2,
        }),
        listedSessions: [
          createSessionRow({
            id: "session-1",
            scheduledAt: CURRENT_SLOT,
          }),
          createSessionRow({
            id: "session-2",
            scheduledAt: ALTERNATIVE_SLOT_2,
          }),
        ],
        pendingRescheduleOffers: [
          {
            flow_type: "reschedule",
            offer_set_id: "res-offer-1",
            target_session_id: "session-2",
          },
        ],
        targetSession: createSessionRow({
          id: "session-2",
          scheduledAt: ALTERNATIVE_SLOT_2,
        }),
        updatedSession: createSessionRow({
          id: "session-2",
          scheduledAt: REQUESTED_SLOT,
        }),
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "tues at 2pm",
        inboundMessageId: "inbound-1c",
      });

      assert.equal(result.kind, "rescheduled");
      assert.equal(scenario.calls.createSmsConversation.length, 0);
      assert.deepEqual(
        (scenario.calls.findAvailableSmsSlots[0] as { ignoredSessionIds: string[] })
          .ignoredSessionIds,
        ["session-2"],
      );
      assert.deepEqual(scenario.calls.expireOfferSet, ["res-offer-1"]);
    },
  );

  await t.test(
    "returns already-scheduled guidance when the requested time matches the current session",
    async () => {
      scenario = createScenarioState({
        parsedResult: {
          kind: "requested_time",
          startsAt: CURRENT_SLOT,
        },
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "move it to tues at 11am",
        inboundMessageId: "inbound-1c-same-time",
      });

      assert.equal(result.kind, "already_scheduled");
      assert.match(result.replyBody, /already set for/i);
      assert.equal(scenario.calls.findAvailableSmsSlots.length, 0);
      assert.equal(scenario.calls.sendTrainerSessionNotification.length, 0);
    },
  );

  await t.test(
    "does not move the session when expiring the active reschedule offer set fails",
    async () => {
      scenario = createScenarioState({
        availableSlots: [
          createAvailabilitySlot(REQUESTED_SLOT, "Tue, Apr 21, 2:00 PM"),
        ],
        existingSession: createSessionRow({
          id: "session-2",
          scheduledAt: ALTERNATIVE_SLOT_2,
        }),
        expireOfferSetError: new Error("cleanup failed"),
        pendingRescheduleOffers: [
          {
            flow_type: "reschedule",
            offer_set_id: "res-offer-3",
            target_session_id: "session-2",
          },
        ],
        targetSession: createSessionRow({
          id: "session-2",
          scheduledAt: ALTERNATIVE_SLOT_2,
        }),
        updatedSession: createSessionRow({
          id: "session-2",
          scheduledAt: REQUESTED_SLOT,
        }),
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "tues at 2pm",
        inboundMessageId: "inbound-1c-cleanup-failure",
      });

      assert.equal(result.kind, "retry_reschedule");
      assert.match(result.replyBody, /didn't move the session/i);
      assert.deepEqual(scenario.calls.expireOfferSet, ["res-offer-3"]);
      assert.equal(scenario.calls.syncSessionToCalendar.length, 0);
      assert.equal(scenario.calls.sendTrainerSessionNotification.length, 0);
    },
  );

  await t.test(
    "fails closed when the active reschedule target session is stale",
    async () => {
      scenario = createScenarioState({
        listedSessions: [
          createSessionRow({
            id: "session-1",
            scheduledAt: CURRENT_SLOT,
          }),
        ],
        pendingRescheduleOffers: [
          {
            flow_type: "reschedule",
            offer_set_id: "res-offer-2",
            target_session_id: "session-missing",
          },
        ],
        targetSession: null,
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "tues at 2pm",
        inboundMessageId: "inbound-1d",
      });

      assert.equal(result.kind, "choose_session");
      assert.match(result.replyBody, /last reschedule request/);
      assert.equal(scenario.calls.createSmsConversation.length, 1);
      assert.equal(scenario.calls.sendTrainerSessionNotification.length, 0);
    },
  );

  await t.test(
    "returns choose-session when multiple upcoming sessions exist and no target is active",
    async () => {
      scenario = createScenarioState({
        listedSessions: [
          createSessionRow({
            id: "session-1",
            scheduledAt: CURRENT_SLOT,
          }),
          createSessionRow({
            id: "session-2",
            scheduledAt: ALTERNATIVE_SLOT_2,
          }),
        ],
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "tues at 2pm",
        inboundMessageId: "inbound-2",
      });

      assert.equal(result.kind, "choose_session");
      assert.match(result.replyBody, /Reply with the one to move/);
      assert.equal(scenario.calls.createSmsConversation.length, 1);
    },
  );

  await t.test(
    "offers anchored alternatives when the requested reschedule time is unavailable",
    async () => {
      scenario = createScenarioState({
        availableSlots: [
          createAvailabilitySlot(ALTERNATIVE_SLOT_1, "Tue, Apr 21, 2:30 PM"),
          createAvailabilitySlot(ALTERNATIVE_SLOT_2, "Wed, Apr 22, 10:00 AM"),
          createAvailabilitySlot(ALTERNATIVE_SLOT_3, "Thu, Apr 23, 12:00 PM"),
        ],
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "tomorrow at 2pm",
        inboundMessageId: "inbound-3",
      });

      assert.equal(result.kind, "offered_alternatives");
      assert.match(result.replyBody, /isn't open, but I can move you to:/);
      assert.match(result.replyBody, /Reply with 1, 2, or 3/);
      assert.equal(
        (scenario.calls.findAvailableSmsSlots[0] as { searchStartAt: string }).searchStartAt,
        REQUESTED_SLOT,
      );
      assert.deepEqual(
        (scenario.calls.findAvailableSmsSlots[0] as { ignoredSessionIds: string[] })
          .ignoredSessionIds,
        ["session-1"],
      );
      assert.equal(
        (scenario.calls.createSmsOfferSet[0] as { flowType: string }).flowType,
        "reschedule",
      );
      assert.equal(
        (scenario.calls.createSmsOfferSet[0] as { targetSessionId: string })
          .targetSessionId,
        "session-1",
      );
    },
  );

  await t.test(
    "returns reschedule-specific guidance for ambiguous requested times",
    async () => {
      scenario = createScenarioState({
        parsedResult: {
          kind: "invalid_requested_time",
          reason: "ambiguous_hour",
        },
      });

      const result = await handleRequestedRescheduleTime(createSmsContext(), {
        body: "move it to tues at 2",
        inboundMessageId: "inbound-4",
      });

      assert.equal(result.kind, "invalid_requested_time");
      assert.match(result.replyBody, /I couldn't tell whether you meant AM or PM/);
      assert.match(result.replyBody, /move your session/i);
      assert.equal(scenario.calls.sendTrainerSessionNotification.length, 0);
    },
  );
});
