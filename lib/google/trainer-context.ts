import "server-only";

import { auth } from "@clerk/nextjs/server";

import { hasClerkServerKeys } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

type TrainerRow = Database["public"]["Tables"]["trainers"]["Row"];
type UserRow = Database["public"]["Tables"]["users"]["Row"];

export type TrainerAuthContext = {
  isPreview: boolean;
  trainer: TrainerRow;
  trainerUser: UserRow | null;
};

export async function resolveTrainerAuthContext(): Promise<TrainerAuthContext | null> {
  const supabase = createServerSupabaseClient();

  if (hasClerkServerKeys) {
    const { userId } = await auth();

    if (!userId) {
      return null;
    }

    const { data: trainer, error: trainerError } = await supabase
      .from("trainers")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (trainerError) {
      throw new Error(trainerError.message);
    }

    if (!trainer) {
      return null;
    }

    const { data: trainerUser, error: trainerUserError } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (trainerUserError) {
      throw new Error(trainerUserError.message);
    }

    return {
      isPreview: false,
      trainer,
      trainerUser,
    };
  }

  const { data: trainer, error: trainerError } = await supabase
    .from("trainers")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (trainerError) {
    throw new Error(trainerError.message);
  }

  if (!trainer) {
    return null;
  }

  const { data: trainerUser, error: trainerUserError } = await supabase
    .from("users")
    .select("*")
    .eq("id", trainer.user_id)
    .maybeSingle();

  if (trainerUserError) {
    throw new Error(trainerUserError.message);
  }

  return {
    isPreview: true,
    trainer,
    trainerUser,
  };
}

export async function requireTrainerAuthContext() {
  const context = await resolveTrainerAuthContext();

  if (!context) {
    throw new Error("Trainer account not found.");
  }

  return context;
}
