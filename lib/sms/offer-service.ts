import "server-only";

import crypto from "node:crypto";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

type SmsBookingOfferInsert =
  Database["public"]["Tables"]["sms_booking_offers"]["Insert"] & {
    flow_type?: "booking" | "reschedule" | null;
    target_session_id?: string | null;
  };
type SmsBookingOfferRow =
  Database["public"]["Tables"]["sms_booking_offers"]["Row"] & {
    flow_type?: "booking" | "reschedule" | null;
    target_session_id?: string | null;
  };

type CreateSmsOfferSetOptions = {
  clientId: string;
  expiresAt: string;
  flowType?: "booking" | "reschedule";
  offeredByMessageId: string | null;
  slots: {
    endsAt: string;
    startsAt: string;
  }[];
  targetSessionId?: string | null;
  timeZone: string;
  trainerId: string;
};

export async function expirePendingOfferSets(
  clientId: string,
  trainerId: string,
) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("sms_booking_offers")
    .update({
      status: "expired",
    })
    .eq("client_id", clientId)
    .eq("trainer_id", trainerId)
    .eq("status", "pending");

  if (error) {
    throw new Error(error.message);
  }
}

export async function createSmsOfferSet({
  clientId,
  expiresAt,
  flowType = "booking",
  offeredByMessageId,
  slots,
  targetSessionId = null,
  timeZone,
  trainerId,
}: CreateSmsOfferSetOptions) {
  const supabase = createServerSupabaseClient();
  const offerSetId = crypto.randomUUID();
  const payload: SmsBookingOfferInsert[] = slots.map((slot, index) => ({
    client_id: clientId,
    expires_at: expiresAt,
    flow_type: flowType,
    offer_set_id: offerSetId,
    offered_by_message_id: offeredByMessageId,
    slot_ends_at: slot.endsAt,
    slot_position: index + 1,
    slot_starts_at: slot.startsAt,
    target_session_id: targetSessionId,
    time_zone: timeZone,
    trainer_id: trainerId,
  }));
  const { data, error } = await supabase
    .from("sms_booking_offers")
    .insert(payload)
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return {
    offerSetId,
    offers: (data ?? []) as SmsBookingOfferRow[],
  };
}

export async function getLatestPendingOfferSet(
  clientId: string,
  trainerId: string,
) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sms_booking_offers")
    .select("*")
    .eq("client_id", clientId)
    .eq("trainer_id", trainerId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    throw new Error(error.message);
  }

  const offers = (data ?? []) as SmsBookingOfferRow[];
  const latestOfferSetId = offers[0]?.offer_set_id;

  if (!latestOfferSetId) {
    return null;
  }

  return offers
    .filter((offer) => offer.offer_set_id === latestOfferSetId)
    .sort((left, right) => left.slot_position - right.slot_position);
}

export async function markOfferBooked(
  offer: SmsBookingOfferRow,
  bookedSessionId: string,
  selectedByMessageId: string | null,
) {
  const supabase = createServerSupabaseClient();
  const { error: selectedError } = await supabase
    .from("sms_booking_offers")
    .update({
      booked_session_id: bookedSessionId,
      selected_by_message_id: selectedByMessageId,
      status: "booked",
    })
    .eq("id", offer.id);

  if (selectedError) {
    throw new Error(selectedError.message);
  }

  const { error: expireOthersError } = await supabase
    .from("sms_booking_offers")
    .update({
      status: "expired",
    })
    .eq("offer_set_id", offer.offer_set_id)
    .eq("status", "pending")
    .neq("id", offer.id);

  if (expireOthersError) {
    throw new Error(expireOthersError.message);
  }
}

export async function markOfferConflicted(
  offerId: string,
  selectedByMessageId: string | null,
) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("sms_booking_offers")
    .update({
      selected_by_message_id: selectedByMessageId,
      status: "conflicted",
    })
    .eq("id", offerId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function expireOfferSet(offerSetId: string) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("sms_booking_offers")
    .update({
      status: "expired",
    })
    .eq("offer_set_id", offerSetId)
    .eq("status", "pending");

  if (error) {
    throw new Error(error.message);
  }
}
