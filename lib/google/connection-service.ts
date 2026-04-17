import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

export type TrainerCalendarConnection =
  Database["public"]["Tables"]["trainer_calendar_connections"]["Row"];

type UpsertTrainerCalendarConnectionInput = Partial<TrainerCalendarConnection> & {
  trainer_id: string;
};

export async function getTrainerCalendarConnection(trainerId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_calendar_connections")
    .select("*")
    .eq("trainer_id", trainerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as TrainerCalendarConnection | null) ?? null;
}

export async function upsertTrainerCalendarConnection(
  input: UpsertTrainerCalendarConnectionInput,
) {
  const supabase = createServerSupabaseClient();
  const payload = {
    provider: "google",
    sync_enabled: true,
    ...input,
  };
  const { data, error } = await supabase
    .from("trainer_calendar_connections")
    .upsert(payload, {
      onConflict: "trainer_id",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as TrainerCalendarConnection;
}

export async function updateTrainerCalendarConnection(
  trainerId: string,
  updates: Partial<TrainerCalendarConnection>,
) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("trainer_calendar_connections")
    .update(updates)
    .eq("trainer_id", trainerId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as TrainerCalendarConnection | null) ?? null;
}

export async function setTrainerCalendarConnectionError(
  trainerId: string,
  errorMessage: string | null,
) {
  return updateTrainerCalendarConnection(trainerId, {
    last_sync_error: errorMessage,
    last_sync_at: errorMessage ? null : new Date().toISOString(),
  });
}
