import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

type SmsMessageInsert = Database["public"]["Tables"]["sms_messages"]["Insert"];
type SmsMessageRow = Database["public"]["Tables"]["sms_messages"]["Row"];

export async function logSmsMessage(input: SmsMessageInsert) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sms_messages")
    .insert(input)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SmsMessageRow;
}

export async function listRecentSmsTranscriptByPhone(
  normalizedPhone: string,
  limit = 6,
) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sms_messages")
    .select("body, direction, created_at")
    .or(
      `normalized_from_phone.eq.${normalizedPhone},normalized_to_phone.eq.${normalizedPhone}`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .slice()
    .reverse()
    .map((message) => ({
      body: message.body,
      direction: message.direction,
    }));
}
