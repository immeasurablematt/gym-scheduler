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
