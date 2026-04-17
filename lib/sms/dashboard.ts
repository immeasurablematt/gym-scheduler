import "server-only";

import { subDays } from "date-fns";

import {
  createServerSupabaseClient,
  hasSupabaseServerCredentials,
} from "@/lib/supabase/server";
import { formatSlotLabel } from "@/lib/sms/timezone";
import type { Database } from "@/types/supabase";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type TrainerRow = Database["public"]["Tables"]["trainers"]["Row"];
type UserRow = Database["public"]["Tables"]["users"]["Row"];
type SmsMessageRow = Database["public"]["Tables"]["sms_messages"]["Row"];
type SmsOfferRow = Database["public"]["Tables"]["sms_booking_offers"]["Row"];

export type SmsDashboardData = {
  isConfigured: boolean;
  pendingOffers: {
    clientName: string;
    createdAt: string;
    offerSetId: string;
    slots: string[];
    trainerName: string;
  }[];
  recentMessages: {
    body: string;
    clientName: string;
    createdAt: string;
    direction: SmsMessageRow["direction"];
    status: SmsMessageRow["status"];
    trainerName: string;
  }[];
  setupIssue: string | null;
  stats: {
    bookedLastWeek: number;
    inboundLastWeek: number;
    outboundLastWeek: number;
    pendingOfferSets: number;
  };
};

export async function getSmsDashboardData(): Promise<SmsDashboardData> {
  if (!hasSupabaseServerCredentials) {
    return {
      isConfigured: false,
      pendingOffers: [],
      recentMessages: [],
      setupIssue:
        "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable live SMS activity.",
      stats: {
        bookedLastWeek: 0,
        inboundLastWeek: 0,
        outboundLastWeek: 0,
        pendingOfferSets: 0,
      },
    };
  }

  try {
    const supabase = createServerSupabaseClient();
    const sinceIso = subDays(new Date(), 7).toISOString();
    const [recentMessages, pendingOffers, inboundCount, outboundCount, bookedCount] =
      await Promise.all([
        getRecentMessages(supabase),
        getPendingOffers(supabase),
        countSmsMessages(supabase, "inbound", sinceIso),
        countSmsMessages(supabase, "outbound", sinceIso),
        countBookedOfferSets(supabase, sinceIso),
      ]);

    return {
      isConfigured: true,
      pendingOffers,
      recentMessages,
      setupIssue: null,
      stats: {
        bookedLastWeek: bookedCount,
        inboundLastWeek: inboundCount,
        outboundLastWeek: outboundCount,
        pendingOfferSets: pendingOffers.length,
      },
    };
  } catch (error) {
    return {
      isConfigured: false,
      pendingOffers: [],
      recentMessages: [],
      setupIssue:
        error instanceof Error
          ? error.message
          : "Unexpected error loading SMS dashboard data.",
      stats: {
        bookedLastWeek: 0,
        inboundLastWeek: 0,
        outboundLastWeek: 0,
        pendingOfferSets: 0,
      },
    };
  }
}

async function getRecentMessages(
  supabase: ReturnType<typeof createServerSupabaseClient>,
) {
  const { data, error } = await supabase
    .from("sms_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(error.message);
  }

  const messages = (data ?? []) as SmsMessageRow[];
  const clientNames = await getClientNamesById(
    supabase,
    messages
      .map((message) => message.client_id)
      .filter((value): value is string => Boolean(value)),
  );
  const trainerNames = await getTrainerNamesById(
    supabase,
    messages
      .map((message) => message.trainer_id)
      .filter((value): value is string => Boolean(value)),
  );

  return messages.map((message) => ({
    body: message.body,
    clientName: message.client_id
      ? clientNames.get(message.client_id) ?? "Unknown client"
      : "Unknown sender",
    createdAt: message.created_at,
    direction: message.direction,
    status: message.status,
    trainerName: message.trainer_id
      ? trainerNames.get(message.trainer_id) ?? "Unknown trainer"
      : "Unassigned",
  }));
}

async function getPendingOffers(
  supabase: ReturnType<typeof createServerSupabaseClient>,
) {
  const { data, error } = await supabase
    .from("sms_booking_offers")
    .select("*")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(24);

  if (error) {
    throw new Error(error.message);
  }

  const offers = (data ?? []) as SmsOfferRow[];
  const groupedOffers = new Map<string, SmsOfferRow[]>();

  for (const offer of offers) {
    const group = groupedOffers.get(offer.offer_set_id) ?? [];
    group.push(offer);
    groupedOffers.set(offer.offer_set_id, group);
  }

  const clientNames = await getClientNamesById(
    supabase,
    Array.from(new Set(offers.map((offer) => offer.client_id))),
  );
  const trainerNames = await getTrainerNamesById(
    supabase,
    Array.from(new Set(offers.map((offer) => offer.trainer_id))),
  );

  return Array.from(groupedOffers.entries())
    .map(([offerSetId, rows]) => {
      const orderedRows = rows.sort(
        (left, right) => left.slot_position - right.slot_position,
      );
      const first = orderedRows[0];

      return {
        clientName:
          clientNames.get(first.client_id) ?? "Unknown client",
        createdAt: first.created_at,
        offerSetId,
        slots: orderedRows.map((row) =>
          formatSlotLabel(row.slot_starts_at, row.time_zone),
        ),
        trainerName:
          trainerNames.get(first.trainer_id) ?? "Unknown trainer",
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8);
}

async function countSmsMessages(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  direction: SmsMessageRow["direction"],
  sinceIso: string,
) {
  const { count, error } = await supabase
    .from("sms_messages")
    .select("id", { count: "exact", head: true })
    .eq("direction", direction)
    .gte("created_at", sinceIso);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function countBookedOfferSets(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  sinceIso: string,
) {
  const { count, error } = await supabase
    .from("sms_booking_offers")
    .select("offer_set_id", { count: "exact", head: true })
    .eq("status", "booked")
    .gte("created_at", sinceIso);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function getClientNamesById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  clientIds: string[],
) {
  if (clientIds.length === 0) {
    return new Map<string, string>();
  }

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("*")
    .in("id", clientIds);

  if (clientsError) {
    throw new Error(clientsError.message);
  }

  const clientRows = (clients ?? []) as ClientRow[];
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("*")
    .in(
      "id",
      clientRows.map((client) => client.user_id),
    );

  if (usersError) {
    throw new Error(usersError.message);
  }

  const usersById = new Map((users ?? []).map((user) => [user.id, user as UserRow]));

  return new Map(
    clientRows.map((client) => [
      client.id,
      usersById.get(client.user_id)?.full_name ?? "Unknown client",
    ]),
  );
}

async function getTrainerNamesById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  trainerIds: string[],
) {
  if (trainerIds.length === 0) {
    return new Map<string, string>();
  }

  const { data: trainers, error: trainersError } = await supabase
    .from("trainers")
    .select("*")
    .in("id", trainerIds);

  if (trainersError) {
    throw new Error(trainersError.message);
  }

  const trainerRows = (trainers ?? []) as TrainerRow[];
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("*")
    .in(
      "id",
      trainerRows.map((trainer) => trainer.user_id),
    );

  if (usersError) {
    throw new Error(usersError.message);
  }

  const usersById = new Map((users ?? []).map((user) => [user.id, user as UserRow]));

  return new Map(
    trainerRows.map((trainer) => [
      trainer.id,
      usersById.get(trainer.user_id)?.full_name ?? "Unknown trainer",
    ]),
  );
}
