import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/supabase";

export type SmsConversationIntent = "cancel" | "reschedule";
export type SmsConversationState = "awaiting_session_selection";

export type SmsConversation =
  Omit<Database["public"]["Tables"]["sms_conversations"]["Row"], "intent" | "state"> & {
    intent: SmsConversationIntent | null;
    state: SmsConversationState | null;
  };

type CreateConversationInput = {
  clientId: string;
  context: Json;
  expiresAt: string;
  inboundMessageId: string | null;
  intent: SmsConversationIntent;
  state: SmsConversationState;
  targetSessionId?: string | null;
  trainerId: string;
};

export async function getLatestActiveSmsConversation(
  clientId: string,
  trainerId: string,
) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sms_conversations")
    .select("*")
    .eq("client_id", clientId)
    .eq("trainer_id", trainerId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SmsConversation | null) ?? null;
}

export async function createSmsConversation(input: CreateConversationInput) {
  await expireActiveSmsConversations(input.clientId, input.trainerId);

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sms_conversations")
    .insert({
      client_id: input.clientId,
      context: input.context,
      expires_at: input.expiresAt,
      intent: input.intent,
      last_inbound_message_id: input.inboundMessageId,
      state: input.state,
      status: "active",
      target_session_id: input.targetSessionId ?? null,
      trainer_id: input.trainerId,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SmsConversation;
}

export async function completeSmsConversation(
  conversationId: string,
  updates?: Partial<SmsConversation>,
) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("sms_conversations")
    .update({
      ...updates,
      status: "completed",
    })
    .eq("id", conversationId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function expireActiveSmsConversations(
  clientId: string,
  trainerId: string,
) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("sms_conversations")
    .update({
      status: "expired",
    })
    .eq("client_id", clientId)
    .eq("trainer_id", trainerId)
    .eq("status", "active");

  if (error) {
    throw new Error(error.message);
  }
}
