import "server-only";

import { TrainerCalendarUnavailableError } from "@/lib/google/client";
import { syncSessionToCalendar } from "@/lib/google/calendar-sync";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  findAvailableSmsSlots,
  hasAvailabilitySource,
} from "@/lib/sms/availability-engine";
import { getSmsRuntimeConfig } from "@/lib/sms/config";
import { SmsKnownClientContext } from "@/lib/sms/client-directory";
import { getFirstName } from "@/lib/sms/phone";
import {
  createSmsOfferSet,
  expirePendingOfferSets,
  getLatestPendingOfferSet,
  markOfferBooked,
  markOfferConflicted,
} from "@/lib/sms/offer-service";
import {
  isSessionConflictError,
  rescheduleSessionFromOffer,
} from "@/lib/sms/session-lifecycle";
import { formatSlotLabel } from "@/lib/sms/timezone";
import type { Database, Json } from "@/types/supabase";

type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];

export type SmsBookingOutcome =
  | {
      kind: "booked";
      replyBody: string;
      sessionId: string;
    }
  | {
      kind: "booking_conflict";
      replyBody: string;
    }
  | {
      kind: "invalid_selection";
      replyBody: string;
    }
  | {
      kind: "no_active_offer";
      replyBody: string;
    };

export type SmsOfferOutcome =
  | {
      kind: "no_availability";
      replyBody: string;
    }
  | {
      kind: "offered_slots";
      offerSetId: string;
      replyBody: string;
    }
  | {
      kind: "setup_needed";
      replyBody: string;
    }
  | {
      kind: "calendar_unavailable";
      replyBody: string;
    };

export async function offerAvailabilityBySms(
  context: SmsKnownClientContext,
  inboundMessageId: string | null,
): Promise<SmsOfferOutcome> {
  const config = getSmsRuntimeConfig();
  let slots;

  try {
    slots = await findAvailableSmsSlots({
      clientId: context.client.id,
      durationMinutes: config.sessionDurationMinutes,
      maxSlots: config.maxSlotsOffered,
      searchDays: config.searchDays,
      slotIntervalMinutes: config.slotIntervalMinutes,
      timeZone: config.timeZone,
      trainerAvailableHours: context.trainer.available_hours,
      trainerId: context.trainer.id,
    });
  } catch (error) {
    if (error instanceof TrainerCalendarUnavailableError) {
      return {
        kind: "calendar_unavailable",
        replyBody:
          "I couldn't check your trainer's live calendar just now, so I didn't offer a slot that might be wrong. Please text availability again in a moment.",
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
      replyBody: hasAvailabilitySetup
        ? `Hey ${getFirstName(context.clientUser.full_name)} - I don't see an opening in the next ${config.searchDays} days right now. Text availability again soon and I'll check again.`
        : `Hey ${getFirstName(context.clientUser.full_name)} - I found your profile, but your trainer's SMS availability isn't set up yet. Please contact the gym and we'll get that fixed.`,
    };
  }

  await expirePendingOfferSets(context.client.id, context.trainer.id);

  const expiresAt = new Date(
    Date.now() + config.offerExpiryHours * 60 * 60 * 1000,
  ).toISOString();
  const offerSet = await createSmsOfferSet({
    clientId: context.client.id,
    expiresAt,
    offeredByMessageId: inboundMessageId,
    slots,
    timeZone: config.timeZone,
    trainerId: context.trainer.id,
  });

  const replyLines = slots.map(
    (slot, index) => `${index + 1}) ${slot.label}`,
  );

  return {
    kind: "offered_slots",
    offerSetId: offerSet.offerSetId,
    replyBody: `Hey ${getFirstName(context.clientUser.full_name)}! I have:\n${replyLines.join("\n")}\nReply with 1, 2, or 3 and I'll lock it in.`,
  };
}

export async function bookSmsOfferSelection(
  context: SmsKnownClientContext,
  selectionText: string,
  inboundMessageId: string | null,
): Promise<SmsBookingOutcome> {
  const selection = extractOfferSelection(selectionText);

  if (!selection) {
    return {
      kind: "invalid_selection",
      replyBody:
        "Reply with 1, 2, or 3 from the most recent options and I'll book that slot.",
    };
  }

  const offers = await getLatestPendingOfferSet(context.client.id, context.trainer.id);

  if (!offers || offers.length === 0) {
    return {
      kind: "no_active_offer",
      replyBody:
        "I don't have a recent offer to book from. Text availability and I'll send a fresh set of times.",
    };
  }

  const selectedOffer = offers.find((offer) => offer.slot_position === selection);

  if (!selectedOffer || selectedOffer.status !== "pending") {
    return {
      kind: "invalid_selection",
      replyBody:
        "That option is no longer available. Reply with one of the current numbers, or text availability for a fresh set.",
    };
  }

  try {
    const session =
      selectedOffer.flow_type === "reschedule" && selectedOffer.target_session_id
        ? await rescheduleSessionFromOffer(
            context,
            selectedOffer.target_session_id,
            selectedOffer.slot_starts_at,
          )
        : await createSmsBookedSession(context, selectedOffer.slot_starts_at);

    await markOfferBooked(selectedOffer, session.id, inboundMessageId);

    return {
      kind: "booked",
      replyBody:
        selectedOffer.flow_type === "reschedule"
          ? `Your session is moved to ${formatSlotLabel(selectedOffer.slot_starts_at, selectedOffer.time_zone)}.`
          : `You're booked for ${formatSlotLabel(selectedOffer.slot_starts_at, selectedOffer.time_zone)}. See you then.`,
      sessionId: session.id,
    };
  } catch (error) {
    if (isSessionConflictError(error)) {
      await markOfferConflicted(selectedOffer.id, inboundMessageId);

      return {
        kind: "booking_conflict",
        replyBody:
          selectedOffer.flow_type === "reschedule"
            ? "That new time just got taken. Reply with one of the other current numbers, or text reschedule and I'll send fresh options."
            : "That slot just got taken. Reply with one of the other current numbers, or text availability and I'll send a fresh set.",
      };
    }

    throw error;
  }
}

export function extractOfferSelection(text: string) {
  const trimmed = text.trim().toLowerCase();
  const patterns = [
    /^(?:option\s*)?([1-3])(?:\s+(?:please|pls|works|ok|okay|thanks))?(?:[.!?])?$/,
    /^(?:i(?:'d| would)?\s+like|i(?:'ll| will)\s+take|pick|choose|book|do)\s+([1-3])(?:[.!?]| please| pls| works| okay| ok)?$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const selection = Number(match?.[1]);

    if (selection >= 1 && selection <= 3) {
      return selection;
    }
  }

  return null;
}

async function createSmsBookedSession(
  context: SmsKnownClientContext,
  scheduledAt: string,
) {
  const config = getSmsRuntimeConfig();
  const supabase = createServerSupabaseClient();
  const notes = "Booked via SMS.";
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({
      client_id: context.client.id,
      duration_minutes: config.sessionDurationMinutes,
      notes,
      scheduled_at: scheduledAt,
      session_type: config.sessionType,
      status: "scheduled",
      trainer_id: context.trainer.id,
    })
    .select("*")
    .single();

  if (sessionError) {
    throw sessionError;
  }

  const { error: changeError } = await supabase.from("session_changes").insert({
    changed_by: context.trainer.user_id,
    change_type: "created",
    new_values: toSessionSnapshot(session as SessionRow),
    old_values: null,
    reason: "Booked via SMS",
    session_id: session.id,
  });

  if (changeError) {
    throw new Error(changeError.message);
  }

  await syncSessionToCalendar(session.id, context.trainer.id);

  return session as SessionRow;
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
