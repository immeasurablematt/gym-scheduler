import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { TrainerCalendarUnavailableError } from "@/lib/google/client";
import { assessClientInviteEligibility } from "@/lib/google/client-invite-eligibility";
import { syncSessionToCalendar } from "@/lib/google/calendar-sync";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  createSmsConversation,
  completeSmsConversation,
  type SmsConversation,
} from "@/lib/sms/conversation-service";
import {
  findAvailableSmsSlots,
  hasAvailabilitySource,
} from "@/lib/sms/availability-engine";
import { getSmsRuntimeConfig } from "@/lib/sms/config";
import type { SmsKnownClientContext } from "@/lib/sms/client-directory";
import {
  createSmsOfferSet,
  expireOfferSet,
  expirePendingOfferSets,
  getLatestPendingRescheduleOfferSet,
} from "@/lib/sms/offer-service";
import {
  parseRequestedSmsTime,
  type RequestedSmsTimeParseResult,
} from "@/lib/sms/requested-time-parser";
import { sendTrainerSessionNotification } from "@/lib/sms/trainer-notifications";
import { formatSlotLabel } from "@/lib/sms/timezone";
import type { Database, Json } from "@/types/supabase";

type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
type SessionSelectionOption = {
  label: string;
  selection: number;
  sessionId: string;
};
type RequestedSmsRescheduleOutcome =
  | { kind: "not_requested_time" }
  | { kind: "already_scheduled"; replyBody: string; sessionId: string }
  | { kind: "invalid_requested_time"; replyBody: string }
  | { kind: "invite_email_required"; replyBody: string; offerSetId: null }
  | { kind: "rescheduled"; replyBody: string; sessionId: string }
  | { kind: "retry_reschedule"; replyBody: string }
  | { kind: "offered_alternatives"; offerSetId: string; replyBody: string }
  | { kind: "calendar_unavailable"; replyBody: string }
  | { kind: "choose_session"; replyBody: string }
  | { kind: "no_availability"; replyBody: string }
  | { kind: "no_session"; replyBody: string }
  | { kind: "setup_needed"; replyBody: string };

type RescheduleTargetResolution =
  | { kind: "resolved"; session: SessionRow; offerSetId: string | null }
  | Extract<
      RequestedSmsRescheduleOutcome,
      { kind: "choose_session" | "no_session" }
    >;

export async function maybeHandleSessionSelectionReply(
  context: SmsKnownClientContext,
  selection: number,
  inboundMessageId: string | null,
  conversation: SmsConversation | null,
) {
  if (!conversation || conversation.state !== "awaiting_session_selection") {
    return null;
  }

  const sessionOptions = extractSessionOptions(conversation.context);
  const target = sessionOptions.find((option) => option.selection === selection);

  if (!target) {
    return {
      body: "That option doesn't match the current session choices. Reply with one of the numbers I sent.",
      handled: true,
    };
  }

  if (conversation.intent === "cancel") {
    const session = await loadUpcomingSessionForClient(
      context.client.id,
      context.trainer.id,
      target.sessionId,
    );

    if (!session) {
      await completeSmsConversation(conversation.id);
      return {
        body: "That session is no longer available to cancel. Text availability if you need a new time.",
        handled: true,
      };
    }

    await cancelSessionBySms(context, session, inboundMessageId);
    await completeSmsConversation(conversation.id, {
      target_session_id: session.id,
    });

    return {
      body: `Your session for ${formatSlotLabel(session.scheduled_at, getSmsRuntimeConfig().timeZone)} is cancelled.`,
      handled: true,
    };
  }

  const session = await loadUpcomingSessionForClient(
    context.client.id,
    context.trainer.id,
    target.sessionId,
  );

  if (!session) {
    await completeSmsConversation(conversation.id);
    return {
      body: "That session is no longer available to move. Text availability and I'll send fresh times.",
      handled: true,
    };
  }

  const offer = await offerRescheduleSlotsForSession(
    context,
    session,
    inboundMessageId,
  );
  await completeSmsConversation(conversation.id, {
    offer_set_id: offer.offerSetId,
    target_session_id: session.id,
  });

  return {
    body: offer.replyBody,
    handled: true,
    offerSetId: offer.offerSetId,
  };
}

export async function handleSmsCancelIntent(
  context: SmsKnownClientContext,
  inboundMessageId: string | null,
) {
  const sessions = await listUpcomingSessionsForClient(
    context.client.id,
    context.trainer.id,
  );

  if (sessions.length === 0) {
    return {
      replyBody:
        "I don't see an upcoming session to cancel right now. Text availability if you want to book a new one.",
    };
  }

  if (sessions.length === 1) {
    const [session] = sessions;
    await cancelSessionBySms(context, session, inboundMessageId);

    return {
      replyBody: `Your session for ${formatSlotLabel(session.scheduled_at, getSmsRuntimeConfig().timeZone)} is cancelled.`,
    };
  }

  const replyBody = await createSessionChoicePrompt(
    context,
    inboundMessageId,
    sessions.slice(0, 3),
    "cancel",
  );

  return {
    replyBody,
  };
}

export async function handleSmsRescheduleIntent(
  context: SmsKnownClientContext,
  inboundMessageId: string | null,
) {
  const sessions = await listUpcomingSessionsForClient(
    context.client.id,
    context.trainer.id,
  );

  if (sessions.length === 0) {
    return {
      kind: "no_session" as const,
      replyBody:
        "I don't see an upcoming session to move right now. Text availability if you want a fresh booking.",
    };
  }

  if (sessions.length === 1) {
    const [session] = sessions;
    return offerRescheduleSlotsForSession(context, session, inboundMessageId);
  }

  return {
    kind: "choose_session" as const,
    replyBody: await createSessionChoicePrompt(
      context,
      inboundMessageId,
      sessions.slice(0, 3),
      "reschedule",
    ),
  };
}

export async function handleRequestedRescheduleTime(
  context: SmsKnownClientContext,
  input: {
    body: string;
    inboundMessageId: string | null;
  },
): Promise<RequestedSmsRescheduleOutcome> {
  const config = getSmsRuntimeConfig();
  const parsed = parseRequestedSmsTime({
    body: input.body,
    now: new Date(),
    slotIntervalMinutes: config.slotIntervalMinutes,
    timeZone: config.timeZone,
  });

  if (parsed.kind === "not_requested_time") {
    return parsed;
  }

  if (parsed.kind === "invalid_requested_time") {
    return {
      kind: "invalid_requested_time",
      replyBody: buildInvalidRequestedRescheduleTimeReply(parsed),
    };
  }

  const inviteEligibility = assessClientInviteEligibility(
    context.clientUser.email,
  );

  if (inviteEligibility.kind === "ineligible") {
    return {
      kind: "invite_email_required" as const,
      offerSetId: null,
      replyBody: inviteEligibility.smsRescheduleReply,
    };
  }

  const target = await resolveRequestedRescheduleTargetSession(
    context,
    input.inboundMessageId,
  );

  if (target.kind !== "resolved") {
    return target;
  }

  if (parsed.startsAt === target.session.scheduled_at) {
    return {
      kind: "already_scheduled",
      replyBody: `Your session is already set for ${formatSlotLabel(target.session.scheduled_at, config.timeZone)}.`,
      sessionId: target.session.id,
    };
  }

  try {
    const slots = (
      await findAvailableSmsSlots({
        clientId: context.client.id,
        durationMinutes: target.session.duration_minutes,
        ignoredSessionIds: [target.session.id],
        maxSlots: config.maxSlotsOffered,
        searchDays: config.searchDays,
        searchStartAt: parsed.startsAt,
        slotIntervalMinutes: config.slotIntervalMinutes,
        timeZone: config.timeZone,
        trainerAvailableHours: context.trainer.available_hours,
        trainerId: context.trainer.id,
      })
    ).filter((slot) => slot.startsAt !== target.session.scheduled_at);

    if (slots.some((slot) => slot.startsAt === parsed.startsAt)) {
      let replacedOfferSetId = target.offerSetId;

      if (replacedOfferSetId) {
        try {
          await expireOfferSet(replacedOfferSetId);
          replacedOfferSetId = null;
        } catch {
          return {
            kind: "retry_reschedule",
            replyBody:
              "I couldn't update your last reschedule request just now, so I didn't move the session. Please text reschedule again in a moment.",
          };
        }
      }

      try {
        const session = await rescheduleSessionFromOffer(
          context,
          target.session.id,
          parsed.startsAt,
        );

        return {
          kind: "rescheduled",
          replyBody: `Your session is moved to ${formatSlotLabel(parsed.startsAt, config.timeZone)}.`,
          sessionId: session.id,
        };
      } catch (error) {
        if (isSessionConflictError(error)) {
          return offerRequestedRescheduleAlternatives(
            context,
            target.session,
            parsed.startsAt,
            input.inboundMessageId,
            replacedOfferSetId,
          );
        }

        throw error;
      }
    }

    return createRequestedRescheduleOfferOutcome(
      context,
      target.session,
      parsed.startsAt,
      input.inboundMessageId,
      target.offerSetId,
      slots,
    );
  } catch (error) {
    if (error instanceof TrainerCalendarUnavailableError) {
      return {
        kind: "calendar_unavailable",
        replyBody:
          "I couldn't check your trainer's live calendar just now, so I didn't move the session to a time that might be wrong. Please text reschedule again in a moment.",
      };
    }

    throw error;
  }
}

export async function rescheduleSessionFromOffer(
  context: SmsKnownClientContext,
  sessionId: string,
  scheduledAt: string,
) {
  const config = getSmsRuntimeConfig();
  const supabase = createServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("client_id", context.client.id)
    .eq("trainer_id", context.trainer.id)
    .neq("status", "cancelled")
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (!existing) {
    throw new Error("Session not found.");
  }

  const { data: updated, error: updateError } = await supabase
    .from("sessions")
    .update({
      scheduled_at: scheduledAt,
      status: "scheduled",
    })
    .eq("id", sessionId)
    .eq("trainer_id", context.trainer.id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  if (!updated) {
    throw new Error("Session reschedule did not return a record.");
  }

  const { data: sessionChange, error: changeError } = await supabase
    .from("session_changes")
    .insert({
      changed_by: context.trainer.user_id,
      change_type: "rescheduled",
      new_values: toSessionSnapshot(updated as SessionRow),
      old_values: toSessionSnapshot(existing as SessionRow),
      reason: "Rescheduled via SMS",
      session_id: sessionId,
    })
    .select("id")
    .single();

  if (changeError) {
    throw new Error(changeError.message);
  }

  await syncSessionToCalendar(sessionId, context.trainer.id);
  await sendTrainerSessionNotification({
    clientId: context.client.id,
    clientName: context.clientUser.full_name?.trim() || "Unknown client",
    kind: "reschedule",
    newSlotLabel: formatSlotLabel(scheduledAt, config.timeZone),
    oldSlotLabel: formatSlotLabel(existing.scheduled_at, config.timeZone),
    sourceChangeId: sessionChange.id,
    trainerId: context.trainer.id,
  });

  return updated as SessionRow;
}

export function isSessionConflictError(error: unknown) {
  if (!isPostgrestError(error) || error.code !== "23505") {
    return false;
  }

  const haystack = `${error.message} ${error.details ?? ""}`.toLowerCase();
  return (
    haystack.includes("trainer_id") ||
    haystack.includes("client_id") ||
    haystack.includes("double_booking") ||
    haystack.includes("unique")
  );
}

async function createSessionChoicePrompt(
  context: SmsKnownClientContext,
  inboundMessageId: string | null,
  sessions: SessionRow[],
  intent: "cancel" | "reschedule",
  introOverride?: string,
) {
  const config = getSmsRuntimeConfig();
  const options = sessions.map((session, index) => ({
    label: formatSlotLabel(session.scheduled_at, config.timeZone),
    selection: index + 1,
    sessionId: session.id,
  }));
  const expiresAt = new Date(
    Date.now() + config.offerExpiryHours * 60 * 60 * 1000,
  ).toISOString();

  await createSmsConversation({
    clientId: context.client.id,
    context: {
      session_options: options,
    },
    expiresAt,
    inboundMessageId,
    intent,
    state: "awaiting_session_selection",
    trainerId: context.trainer.id,
  });

  const lines = options.map((option) => `${option.selection}) ${option.label}`);

  if (introOverride) {
    return `${introOverride}\n${lines.join("\n")}`;
  }

  return intent === "cancel"
    ? `I found multiple upcoming sessions. Reply with the one to cancel:\n${lines.join("\n")}`
    : `I found multiple upcoming sessions. Reply with the one to move:\n${lines.join("\n")}`;
}

async function offerRescheduleSlotsForSession(
  context: SmsKnownClientContext,
  session: SessionRow,
  inboundMessageId: string | null,
) {
  const config = getSmsRuntimeConfig();
  let slots;

  try {
    slots = (await findAvailableSmsSlots({
      clientId: context.client.id,
      durationMinutes: session.duration_minutes,
      ignoredSessionIds: [session.id],
      maxSlots: config.maxSlotsOffered,
      searchDays: config.searchDays,
      slotIntervalMinutes: config.slotIntervalMinutes,
      timeZone: config.timeZone,
      trainerAvailableHours: context.trainer.available_hours,
      trainerId: context.trainer.id,
    })).filter((slot) => slot.startsAt !== session.scheduled_at);
  } catch (error) {
    if (error instanceof TrainerCalendarUnavailableError) {
      return {
        kind: "calendar_unavailable" as const,
        offerSetId: null,
        replyBody:
          "I couldn't check your trainer's live calendar just now, so I didn't move the session to a time that might be wrong. Please text reschedule again in a moment.",
      };
    }

    throw error;
  }

  if (slots.length === 0) {
    const hasAvailabilitySetup = await hasAvailabilitySource(
      context.trainer.id,
      context.trainer.available_hours,
    );

    return {
      kind: hasAvailabilitySetup ? "no_availability" : "setup_needed",
      offerSetId: null,
      replyBody: hasAvailabilitySetup
        ? `I couldn't find a new opening in the next ${config.searchDays} days right now. Keep your current session for ${formatSlotLabel(session.scheduled_at, config.timeZone)} or text me again later.`
        : `I found your session, but your trainer's live availability isn't set up yet. Please contact the gym and we'll get that fixed.`,
    } as const;
  }

  await expirePendingOfferSets(context.client.id, context.trainer.id);

  const expiresAt = new Date(
    Date.now() + config.offerExpiryHours * 60 * 60 * 1000,
  ).toISOString();
  const offerSet = await createSmsOfferSet({
    clientId: context.client.id,
    expiresAt,
    flowType: "reschedule",
    offeredByMessageId: inboundMessageId,
    slots,
    targetSessionId: session.id,
    timeZone: config.timeZone,
    trainerId: context.trainer.id,
  });
  const lines = slots.map((slot, index) => `${index + 1}) ${slot.label}`);

  return {
    kind: "offered_slots" as const,
    offerSetId: offerSet.offerSetId,
    replyBody: `Your current session is ${formatSlotLabel(session.scheduled_at, config.timeZone)}. I can move you to:\n${lines.join("\n")}\nReply with 1, 2, or 3 and I'll update it.`,
  };
}

async function resolveRequestedRescheduleTargetSession(
  context: SmsKnownClientContext,
  inboundMessageId: string | null,
): Promise<RescheduleTargetResolution> {
  const activeOfferSet = await getLatestPendingRescheduleOfferSet(
    context.client.id,
    context.trainer.id,
  );
  const activeTarget = extractPendingRescheduleTarget(activeOfferSet);

  if (activeTarget) {
    const session = await loadUpcomingSessionForClient(
      context.client.id,
      context.trainer.id,
      activeTarget.targetSessionId,
    );

    if (session) {
      return {
        kind: "resolved",
        offerSetId: activeTarget.offerSetId,
        session,
      };
    }

    const sessions = await listUpcomingSessionsForClient(
      context.client.id,
      context.trainer.id,
    );

    if (sessions.length === 0) {
      return {
        kind: "no_session",
        replyBody:
          "I don't see an upcoming session to move right now. Text availability if you want a fresh booking.",
      };
    }

    return {
      kind: "choose_session",
      replyBody: await createSessionChoicePrompt(
        context,
        inboundMessageId,
        sessions.slice(0, 3),
        "reschedule",
        "I couldn't match the session from your last reschedule request. Reply with the one to move:",
      ),
    };
  }

  const sessions = await listUpcomingSessionsForClient(
    context.client.id,
    context.trainer.id,
  );

  if (sessions.length === 0) {
    return {
      kind: "no_session",
      replyBody:
        "I don't see an upcoming session to move right now. Text availability if you want a fresh booking.",
    };
  }

  if (sessions.length === 1) {
    return {
      kind: "resolved",
      offerSetId: null,
      session: sessions[0],
    };
  }

  return {
    kind: "choose_session",
    replyBody: await createSessionChoicePrompt(
      context,
      inboundMessageId,
      sessions.slice(0, 3),
      "reschedule",
    ),
  };
}

function extractPendingRescheduleTarget(
  offers: Awaited<ReturnType<typeof getLatestPendingRescheduleOfferSet>>,
) {
  if (!offers || offers.length === 0) {
    return null;
  }

  const offerSetId = offers[0]?.offer_set_id ?? null;
  const targetSessionId = offers[0]?.target_session_id;

  if (
    !offerSetId ||
    !targetSessionId ||
    !offers.every(
      (offer) =>
        offer.flow_type === "reschedule" &&
        offer.offer_set_id === offerSetId &&
        offer.target_session_id === targetSessionId,
    )
  ) {
    return null;
  }

  return {
    offerSetId,
    targetSessionId,
  };
}

async function offerRequestedRescheduleAlternatives(
  context: SmsKnownClientContext,
  session: SessionRow,
  requestedStartsAt: string,
  inboundMessageId: string | null,
  replacedOfferSetId: string | null,
) {
  const config = getSmsRuntimeConfig();
  const slots = (
    await findAvailableSmsSlots({
      clientId: context.client.id,
      durationMinutes: session.duration_minutes,
      ignoredSessionIds: [session.id],
      maxSlots: config.maxSlotsOffered,
      searchDays: config.searchDays,
      searchStartAt: requestedStartsAt,
      slotIntervalMinutes: config.slotIntervalMinutes,
      timeZone: config.timeZone,
      trainerAvailableHours: context.trainer.available_hours,
      trainerId: context.trainer.id,
    })
  ).filter(
    (slot) =>
      slot.startsAt !== requestedStartsAt &&
      slot.startsAt !== session.scheduled_at,
  );

  return createRequestedRescheduleOfferOutcome(
    context,
    session,
    requestedStartsAt,
    inboundMessageId,
    replacedOfferSetId,
    slots,
  );
}

async function createRequestedRescheduleOfferOutcome(
  context: SmsKnownClientContext,
  session: SessionRow,
  requestedStartsAt: string,
  inboundMessageId: string | null,
  replacedOfferSetId: string | null,
  slots: {
    endsAt: string;
    label: string;
    startsAt: string;
  }[],
): Promise<
  Extract<
    RequestedSmsRescheduleOutcome,
    { kind: "offered_alternatives" | "no_availability" | "setup_needed" }
  >
> {
  const config = getSmsRuntimeConfig();

  if (slots.length === 0) {
    const hasAvailabilitySetup = await hasAvailabilitySource(
      context.trainer.id,
      context.trainer.available_hours,
    );

    return {
      kind: hasAvailabilitySetup ? "no_availability" : "setup_needed",
      replyBody: hasAvailabilitySetup
        ? `${formatSlotLabel(requestedStartsAt, config.timeZone)} isn't open, and I don't see another opening in the next ${config.searchDays} days right now. Keep your current session for ${formatSlotLabel(session.scheduled_at, config.timeZone)} or text reschedule again later.`
        : `I found your session, but your trainer's live availability isn't set up yet. Please contact the gym and we'll get that fixed.`,
    };
  }

  const expiresAt = new Date(
    Date.now() + config.offerExpiryHours * 60 * 60 * 1000,
  ).toISOString();
  const offerSet = await createSmsOfferSet({
    clientId: context.client.id,
    expiresAt,
    flowType: "reschedule",
    offeredByMessageId: inboundMessageId,
    slots,
    targetSessionId: session.id,
    timeZone: config.timeZone,
    trainerId: context.trainer.id,
  });

  if (replacedOfferSetId) {
    await expireOfferSet(replacedOfferSetId);
  }

  const lines = slots.map((slot, index) => `${index + 1}) ${slot.label}`);

  return {
    kind: "offered_alternatives",
    offerSetId: offerSet.offerSetId,
    replyBody: `${formatSlotLabel(requestedStartsAt, config.timeZone)} isn't open, but I can move you to:\n${lines.join("\n")}\nReply with 1, 2, or 3 and I'll update it.`,
  };
}

function buildInvalidRequestedRescheduleTimeReply(
  parsed: Extract<RequestedSmsTimeParseResult, { kind: "invalid_requested_time" }>,
) {
  if (parsed.reason === "off_interval") {
    return "I couldn't use that exact time to move your session. Text something like 'Monday 2 PM', 'tomorrow at 11 AM', or 'Apr 22 at 1:30 PM'.";
  }

  return "I couldn't tell whether you meant AM or PM to move your session. Text something like 'Monday 2 PM', 'tomorrow at 11 AM', or 'Apr 22 at 1:30 PM'.";
}

export async function cancelSessionBySms(
  context: SmsKnownClientContext,
  session: SessionRow,
  inboundMessageId: string | null,
) {
  const supabase = createServerSupabaseClient();
  const { data: updated, error: updateError } = await supabase
    .from("sessions")
    .update({
      status: "cancelled",
    })
    .eq("id", session.id)
    .eq("trainer_id", context.trainer.id)
    .eq("client_id", context.client.id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (!updated) {
    throw new Error("Session cancellation did not return a record.");
  }

  const { data: sessionChange, error: changeError } = await supabase
    .from("session_changes")
    .insert({
      changed_by: context.trainer.user_id,
      change_type: "cancelled",
      new_values: toSessionSnapshot(updated as SessionRow),
      old_values: toSessionSnapshot(session),
      reason: inboundMessageId ? "Cancelled via SMS" : "Cancelled",
      session_id: session.id,
    })
    .select("id")
    .single();

  if (changeError) {
    throw new Error(changeError.message);
  }

  const timeZone = getSmsRuntimeConfig().timeZone;
  await expirePendingOfferSets(context.client.id, context.trainer.id);
  await syncSessionToCalendar(session.id, context.trainer.id);
  await sendTrainerSessionNotification({
    clientId: context.client.id,
    clientName: context.clientUser.full_name?.trim() || "Unknown client",
    kind: "cancel",
    slotLabel: formatSlotLabel(session.scheduled_at, timeZone),
    sourceChangeId: sessionChange.id,
    trainerId: context.trainer.id,
  });
}

async function listUpcomingSessionsForClient(clientId: string, trainerId: string) {
  const supabase = createServerSupabaseClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("client_id", clientId)
    .eq("trainer_id", trainerId)
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(6);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SessionRow[];
}

async function loadUpcomingSessionForClient(
  clientId: string,
  trainerId: string,
  sessionId: string,
) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("client_id", clientId)
    .eq("trainer_id", trainerId)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SessionRow | null) ?? null;
}

function extractSessionOptions(value: Json | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const options = "session_options" in value ? value.session_options : null;

  if (!Array.isArray(options)) {
    return [];
  }

  return options.flatMap((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      return [];
    }

    if (
      typeof option.sessionId !== "string" ||
      typeof option.selection !== "number" ||
      typeof option.label !== "string"
    ) {
      return [];
    }

    return [
      {
        label: option.label,
        selection: option.selection,
        sessionId: option.sessionId,
      } satisfies SessionSelectionOption,
    ];
  });
}

function toSessionSnapshot(session: SessionRow): Json {
  return {
    client_id: session.client_id,
    duration_minutes: session.duration_minutes,
    gym_space_id: session.gym_space_id,
    notes: session.notes,
    scheduled_at: session.scheduled_at,
    session_type: session.session_type,
    status: session.status,
    trainer_id: session.trainer_id,
  };
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error,
  );
}
