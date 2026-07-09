import assert from "node:assert/strict";
import test from "node:test";

let importCounter = 0;

function createKnownClientContext() {
  return {
    kind: "known_client" as const,
    value: {
      client: {
        id: "client-1",
      },
      clientUser: {
        full_name: "Alex Client",
      },
      trainer: {
        id: "trainer-1",
      },
    },
  };
}

type ScenarioState = {
  activeConversation: {
    intent?: "cancel" | "reschedule" | null;
    state?: "awaiting_session_selection" | null;
  } | null;
  bookingOutcome:
    | { kind: "booked"; replyBody: string }
    | { kind: "offered_alternatives"; offerSetId: string; replyBody: string }
    | { kind: "invalid_requested_time"; replyBody: string }
    | { kind: "calendar_unavailable"; replyBody: string }
    | { kind: "not_requested_time" };
  calls: {
    bookRequestedSmsTime: Array<unknown[]>;
    getLatestPendingRescheduleOfferSet: Array<unknown[]>;
    handleRequestedRescheduleTime: Array<unknown[]>;
    handleSmsRescheduleIntent: Array<unknown[]>;
  };
  pendingRescheduleOffers: Array<{
    offer_set_id?: string | null;
    target_session_id?: string | null;
  }> | null;
  requestedRescheduleOutcome:
    | { kind: "booked"; replyBody: string; sessionId: string }
    | { kind: "calendar_unavailable"; replyBody: string }
    | { kind: "choose_session"; replyBody: string }
    | { kind: "invalid_requested_time"; replyBody: string }
    | { kind: "no_availability"; replyBody: string }
    | { kind: "no_session"; replyBody: string }
    | { kind: "not_requested_time" }
    | { kind: "offered_alternatives"; offerSetId: string; replyBody: string }
    | { kind: "rescheduled"; replyBody: string; sessionId: string }
    | { kind: "setup_needed"; replyBody: string };
  rescheduleIntentOutcome:
    | { kind: "choose_session"; replyBody: string }
    | { kind: "offered_slots"; offerSetId: string; replyBody: string };
};

function createScenarioState(): ScenarioState {
  return {
    activeConversation: null,
    bookingOutcome: {
      kind: "booked",
      replyBody: "You're booked for Tue, Apr 21, 2:00 PM. See you then.",
    },
    calls: {
      bookRequestedSmsTime: [],
      getLatestPendingRescheduleOfferSet: [],
      handleRequestedRescheduleTime: [],
      handleSmsRescheduleIntent: [],
    },
    pendingRescheduleOffers: null,
    requestedRescheduleOutcome: {
      kind: "rescheduled",
      replyBody: "Your session is moved to Tue, Apr 21, 2:00 PM.",
      sessionId: "session-1",
    },
    rescheduleIntentOutcome: {
      kind: "choose_session",
      replyBody: "I found multiple upcoming sessions. Reply with the one to move:\n1) Tue, Apr 21, 11:00 AM",
    },
  };
}

async function importOrchestrator(suffix: string) {
  return import(new URL(`./orchestrator.ts?case=${suffix}`, import.meta.url).href);
}

test("buildReply routes exact-time reschedule texts correctly", async (t) => {
  let scenario = createScenarioState();

  await t.mock.module("server-only", {
    defaultExport: {},
  });
  await t.mock.module("@/lib/supabase/server", {
    namedExports: {
      createServerSupabaseClient: () => ({
        from() {
          throw new Error("Unexpected supabase access in buildReply test");
        },
      }),
    },
  });
  await t.mock.module("@/lib/sms/booking-service", {
    namedExports: {
      bookRequestedSmsTime: async (...args: unknown[]) => {
        scenario.calls.bookRequestedSmsTime.push(args);
        return scenario.bookingOutcome;
      },
      bookSmsOfferSelection: async () => ({
        kind: "booked",
        replyBody: "Booked from selection.",
        sessionId: "session-booked",
      }),
      extractOfferSelection: () => null,
      offerAvailabilityBySms: async () => ({
        kind: "offered_slots",
        offerSetId: "offer-booking-1",
        replyBody: "I have:\n1) Tue, Apr 21, 2:00 PM",
      }),
    },
  });
  await t.mock.module("@/lib/sms/conversation-service", {
    namedExports: {
      getLatestActiveSmsConversation: async () => scenario.activeConversation,
    },
  });
  await t.mock.module("@/lib/sms/client-directory", {
    namedExports: {
      resolveSmsClientContextByPhone: async () => createKnownClientContext(),
    },
  });
  await t.mock.module("@/lib/sms/message-log", {
    namedExports: {
      logSmsMessage: async () => ({ id: "inbound-1" }),
    },
  });
  await t.mock.module("@/lib/sms/phone", {
    namedExports: {
      normalizePhoneNumber: (value: string) => value,
    },
  });
  await t.mock.module("@/lib/sms/offer-service", {
    namedExports: {
      expireOfferSet: async () => undefined,
      getLatestPendingRescheduleOfferSet: async (...args: unknown[]) => {
        scenario.calls.getLatestPendingRescheduleOfferSet.push(args);
        return scenario.pendingRescheduleOffers;
      },
    },
  });
  await t.mock.module("@/lib/sms/session-lifecycle", {
    namedExports: {
      handleRequestedRescheduleTime: async (...args: unknown[]) => {
        scenario.calls.handleRequestedRescheduleTime.push(args);
        return scenario.requestedRescheduleOutcome;
      },
      handleSmsCancelIntent: async () => ({
        replyBody: "Cancelled.",
      }),
      handleSmsRescheduleIntent: async (...args: unknown[]) => {
        scenario.calls.handleSmsRescheduleIntent.push(args);
        return scenario.rescheduleIntentOutcome;
      },
      maybeHandleSessionSelectionReply: async () => null,
    },
  });
  await t.mock.module("@/lib/sms/twilio-sender", {
    namedExports: {
      sendTwilioSms: async () => undefined,
    },
  });

  const { buildReply } = await importOrchestrator(`integration-${++importCounter}`);

  await t.test(
    "reschedule to tomorrow at 2pm uses the exact-time reschedule path for one upcoming session",
    async () => {
      scenario = createScenarioState();
      scenario.requestedRescheduleOutcome = {
        kind: "rescheduled",
        replyBody: "Your session is moved to Tue, Apr 21, 2:00 PM.",
        sessionId: "session-1",
      };

      const reply = await buildReply(
        "Can you move it to tomorrow at 2pm",
        createKnownClientContext(),
        "inbound-1",
      );

      assert.match(reply.body, /Your session is moved to/);
      assert.equal(reply.offerSetId, null);
      assert.equal(scenario.calls.handleRequestedRescheduleTime.length, 1);
      assert.equal(scenario.calls.handleSmsRescheduleIntent.length, 0);
    },
  );

  await t.test(
    "tues at 2pm after choosing a session stays in the reschedule flow",
    async () => {
      scenario = createScenarioState();
      scenario.pendingRescheduleOffers = [
        {
          offer_set_id: "offer-res-1",
          target_session_id: "session-1",
        },
      ];
      scenario.requestedRescheduleOutcome = {
        kind: "offered_alternatives",
        offerSetId: "offer-res-1",
        replyBody:
          "Tue, Apr 21, 2:00 PM isn't open, but I can move you to:\n1) Tue, Apr 21, 2:30 PM\nReply with 1, 2, or 3 and I'll update it.",
      };

      const reply = await buildReply(
        "tues at 2pm",
        createKnownClientContext(),
        "inbound-2",
      );

      assert.match(reply.body, /Your session is moved to|isn't open, but I can move you to:/);
      assert.equal(reply.offerSetId, "offer-res-1");
      assert.equal(scenario.calls.handleRequestedRescheduleTime.length, 1);
      assert.equal(scenario.calls.bookRequestedSmsTime.length, 0);
    },
  );

  await t.test(
    "free-text booking still routes through the booking path when no reschedule target exists",
    async () => {
      scenario = createScenarioState();
      scenario.bookingOutcome = {
        kind: "offered_alternatives",
        offerSetId: "offer-booking-2",
        replyBody:
          "Tue, Apr 21, 2:00 PM isn't open, but I have:\n1) Tue, Apr 21, 2:30 PM\nReply with 1, 2, or 3 and I'll lock it in.",
      };

      const reply = await buildReply(
        "Tuesday at 2pm",
        createKnownClientContext(),
        "inbound-3",
      );

      assert.match(reply.body, /You're booked for|isn't open, but I have:/);
      assert.equal(reply.offerSetId, "offer-booking-2");
      assert.equal(scenario.calls.handleRequestedRescheduleTime.length, 0);
      assert.equal(scenario.calls.bookRequestedSmsTime.length, 1);
    },
  );
});
