import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  'data:text/javascript,import { pathToFileURL } from "node:url"; import { join, extname } from "node:path"; export async function resolve(specifier, context, nextResolve) { if (specifier === "server-only") { return { url: "data:text/javascript,export{}", shortCircuit: true }; } if (specifier.startsWith("@/")) { const relativePath = specifier.slice(2); const resolvedPath = extname(relativePath) ? relativePath : `${relativePath}.ts`; return { url: pathToFileURL(join(process.cwd(), resolvedPath)).href, shortCircuit: true }; } return nextResolve(specifier, context); }',
  import.meta.url,
);

let importCounter = 0;
const hasModuleMocks = process.execArgv.includes("--experimental-test-module-mocks");

async function importBookingService() {
  return import(
    new URL(`../lib/sms/booking-service.ts?case=${++importCounter}`, import.meta.url).href
  );
}

function createKnownClientContext() {
  return {
    client: {
      id: "client-1",
    },
    clientUser: {
      email: "not-an-email",
      full_name: "Alex Client",
    },
    normalizedPhone: "+15555550000",
    trainer: {
      available_hours: null,
      id: "trainer-1",
    },
    trainerUser: null,
  };
}

test("assessClientInviteEligibility returns dashboard and SMS messages for invalid email", async () => {
  const { assessClientInviteEligibility } = await import("../lib/google/client-invite-eligibility.ts");

  const result = assessClientInviteEligibility("not-an-email");

  assert.deepEqual(result, {
    dashboardMessage:
      "This client needs a valid email before the session can sync Google Calendar invites.",
    kind: "ineligible",
    smsBookReply:
      "I can't book that yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
    smsRescheduleReply:
      "I can't move that session yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
    syncError:
      "Client email must be present and valid for Google Calendar invites.",
  });
});

test("assessClientInviteEligibility returns eligible for valid email", async () => {
  const { assessClientInviteEligibility } = await import("../lib/google/client-invite-eligibility.ts");

  assert.deepEqual(assessClientInviteEligibility("client@example.com"), {
    email: "client@example.com",
    kind: "eligible",
  });
});

if (!hasModuleMocks) {
  test.skip(
    "bookRequestedSmsTime returns invite_email_required for exact-time booking when client email is invalid",
  );
} else {
  test("bookRequestedSmsTime returns invite_email_required for exact-time booking when client email is invalid", async (t) => {
    const calls = {
      createServerSupabaseClient: 0,
      expirePendingOfferSets: 0,
      findAvailableSmsSlots: 0,
      sendTrainerSessionNotification: 0,
      syncSessionToCalendar: 0,
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
        syncSessionToCalendar: async () => {
          calls.syncSessionToCalendar++;
        },
      },
    });
    await t.mock.module("@/lib/supabase/server", {
      namedExports: {
        createServerSupabaseClient: () => {
          calls.createServerSupabaseClient++;

          return {
            from() {
              throw new Error("Unexpected supabase access in exact-time booking test");
            },
          };
        },
      },
    });
    await t.mock.module("@/lib/sms/availability-engine", {
      namedExports: {
        findAvailableSmsSlots: async () => {
          calls.findAvailableSmsSlots++;

          return [
            {
              endsAt: "2026-04-21T19:00:00.000Z",
              label: "Tue, Apr 21, 2:00 PM",
              startsAt: "2026-04-21T18:00:00.000Z",
            },
          ];
        },
        hasAvailabilitySource: async () => true,
      },
    });
    await t.mock.module("@/lib/sms/client-directory", {
      namedExports: {
        SmsKnownClientContext: {},
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
        expirePendingOfferSets: async () => {
          calls.expirePendingOfferSets++;
        },
        getLatestPendingOfferSet: async () => [],
        markOfferBooked: async () => undefined,
        markOfferConflicted: async () => undefined,
      },
    });
    await t.mock.module("@/lib/sms/phone", {
      namedExports: {
        getFirstName: (value) => value,
        normalizePhoneNumber: (value) => value,
      },
    });
    await t.mock.module("@/lib/sms/requested-time-parser", {
      namedExports: {
        parseRequestedSmsTime: () => ({
          kind: "requested_time",
          startsAt: "2026-04-21T18:00:00.000Z",
        }),
      },
    });
    await t.mock.module("@/lib/sms/session-lifecycle", {
      namedExports: {
        isSessionConflictError: () => false,
        rescheduleSessionFromOffer: async () => {
          throw new Error("Unexpected reschedule path");
        },
      },
    });
    await t.mock.module("@/lib/sms/trainer-notifications", {
      namedExports: {
        sendTrainerSessionNotification: async () => {
          calls.sendTrainerSessionNotification++;
        },
      },
    });
    await t.mock.module("@/lib/sms/timezone", {
      namedExports: {
        formatSlotLabel: () => "Tue, Apr 21, 2:00 PM",
      },
    });

    const { bookRequestedSmsTime } = await importBookingService();
    const result = await bookRequestedSmsTime(
      createKnownClientContext(),
      "tomorrow at 2pm",
      "inbound-1",
    );

    assert.deepEqual(result, {
      kind: "invite_email_required",
      replyBody:
        "I can't book that yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
    });
    assert.equal(calls.findAvailableSmsSlots, 0);
    assert.equal(calls.createServerSupabaseClient, 0);
    assert.equal(calls.expirePendingOfferSets, 0);
    assert.equal(calls.syncSessionToCalendar, 0);
    assert.equal(calls.sendTrainerSessionNotification, 0);
  });
}
