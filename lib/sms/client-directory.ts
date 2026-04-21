import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizePhoneNumber } from "@/lib/sms/phone";
import type { Database } from "@/types/supabase";

type UserRow = Database["public"]["Tables"]["users"]["Row"];
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type TrainerRow = Database["public"]["Tables"]["trainers"]["Row"];

export type SmsKnownClientContext = {
  client: ClientRow;
  clientUser: UserRow;
  normalizedPhone: string;
  trainer: TrainerRow;
  trainerUser: UserRow | null;
};

export type SmsClientLookupResult =
  | {
      kind: "unknown_sender";
      normalizedPhone: string | null;
    }
  | {
      kind: "missing_client";
      clientUser: UserRow;
      normalizedPhone: string;
    }
  | {
      kind: "missing_trainer";
      client: ClientRow;
      clientUser: UserRow;
      normalizedPhone: string;
    }
  | {
      kind: "known_client";
      value: SmsKnownClientContext;
    };

export type SmsTrainerPhoneContext = {
  id: string;
  name: string;
  normalizedPhone: string;
};

export type SmsPhoneActorResult =
  | SmsClientLookupResult
  | {
      kind: "trainer";
      trainer: SmsTrainerPhoneContext;
    };

export async function resolveSmsClientContextByPhone(
  rawPhoneNumber: string | null | undefined,
): Promise<SmsClientLookupResult> {
  const normalizedPhone = normalizePhoneNumber(rawPhoneNumber);

  if (!normalizedPhone) {
    return {
      kind: "unknown_sender",
      normalizedPhone: null,
    };
  }

  const supabase = createServerSupabaseClient();
  const { data: clientUsers, error: clientUsersError } = await supabase
    .from("users")
    .select("*")
    .eq("role", "client")
    .not("phone_number", "is", null);

  if (clientUsersError) {
    throw new Error(clientUsersError.message);
  }

  const clientUser = (clientUsers ?? []).find(
    (candidate) =>
      normalizePhoneNumber(candidate.phone_number) === normalizedPhone,
  );

  if (!clientUser) {
    return {
      kind: "unknown_sender",
      normalizedPhone,
    };
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", clientUser.id)
    .maybeSingle();

  if (clientError) {
    throw new Error(clientError.message);
  }

  if (!client) {
    return {
      kind: "missing_client",
      clientUser,
      normalizedPhone,
    };
  }

  if (!client.trainer_id) {
    return {
      kind: "missing_trainer",
      client,
      clientUser,
      normalizedPhone,
    };
  }

  const { data: trainer, error: trainerError } = await supabase
    .from("trainers")
    .select("*")
    .eq("id", client.trainer_id)
    .maybeSingle();

  if (trainerError) {
    throw new Error(trainerError.message);
  }

  if (!trainer) {
    return {
      kind: "missing_trainer",
      client,
      clientUser,
      normalizedPhone,
    };
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
    kind: "known_client",
    value: {
      client,
      clientUser,
      normalizedPhone,
      trainer,
      trainerUser,
    },
  };
}

export async function resolveSmsPhoneActorByPhone(
  rawPhoneNumber: string | null | undefined,
): Promise<SmsPhoneActorResult> {
  const clientContext = await resolveSmsClientContextByPhone(rawPhoneNumber);

  if (clientContext.kind !== "unknown_sender") {
    return clientContext;
  }

  if (!clientContext.normalizedPhone) {
    return clientContext;
  }

  const trainers = await listTrainerDirectory();
  const trainer = trainers.find(
    (candidate) => candidate.normalizedPhone === clientContext.normalizedPhone,
  );

  if (!trainer) {
    return clientContext;
  }

  return {
    kind: "trainer",
    trainer: {
      id: trainer.id,
      name: trainer.name,
      normalizedPhone: trainer.normalizedPhone,
    },
  };
}

export async function listSmsTrainerCandidates() {
  const trainers = await listTrainerDirectory();

  return trainers.map((trainer) => ({
    id: trainer.id,
    name: trainer.name,
    aliases: [],
  }));
}

async function listTrainerDirectory() {
  const supabase = createServerSupabaseClient();
  const { data: trainers, error: trainersError } = await supabase
    .from("trainers")
    .select("*");

  if (trainersError) {
    throw new Error(trainersError.message);
  }

  const userIds = (trainers ?? []).map((trainer) => trainer.user_id);

  if (userIds.length === 0) {
    return [];
  }

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("*")
    .in("id", userIds);

  if (usersError) {
    throw new Error(usersError.message);
  }

  return (trainers ?? [])
    .map((trainer) => {
      const trainerUser = (users ?? []).find((user) => user.id === trainer.user_id);
      const normalizedPhone = normalizePhoneNumber(trainerUser?.phone_number);

      if (!trainerUser || !normalizedPhone) {
        return null;
      }

      return {
        id: trainer.id,
        name: trainerUser.full_name,
        normalizedPhone,
      };
    })
    .filter((trainer): trainer is SmsTrainerPhoneContext => trainer !== null);
}
