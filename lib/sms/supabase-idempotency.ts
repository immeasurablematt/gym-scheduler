import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export const DEFAULT_SMS_WEBHOOK_IDEMPOTENCY_TABLE = "sms_webhook_idempotency";
export const DEFAULT_SMS_WEBHOOK_PROVIDER = "twilio";

export interface SmsWebhookIdempotencyRecord {
  created_at?: string;
  event_key: string;
  id?: string;
  provider: string;
}

export interface FindWebhookEventReservationOptions {
  eventKey: string;
  provider?: string;
  supabase?: ReturnType<typeof createServerSupabaseClient>;
  tableName?: string;
}

export type ReserveWebhookEventOptions = FindWebhookEventReservationOptions;

export type ReserveWebhookEventResult =
  | {
      record: SmsWebhookIdempotencyRecord;
      status: "fresh";
    }
  | {
      record: SmsWebhookIdempotencyRecord | null;
      status: "duplicate";
    };

const DEFAULT_SELECT_COLUMNS = "id, provider, event_key, created_at";

type UntypedSupabaseClient = ReturnType<typeof createServerSupabaseClient> & {
  from: (table: string) => {
    insert: (value: Record<string, unknown>) => {
      select: (columns?: string) => {
        single: () => Promise<{
          data: SmsWebhookIdempotencyRecord | null;
          error: PostgrestError | null;
        }>;
      };
    };
    select: (columns?: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{
            data: SmsWebhookIdempotencyRecord | null;
            error: PostgrestError | null;
          }>;
        };
      };
    };
  };
};

function getSupabaseClient(client?: ReturnType<typeof createServerSupabaseClient>) {
  return (client ?? createServerSupabaseClient()) as UntypedSupabaseClient;
}

function isUniqueViolation(error: PostgrestError | null) {
  return error?.code === "23505";
}

export async function findWebhookEventReservation({
  eventKey,
  provider = DEFAULT_SMS_WEBHOOK_PROVIDER,
  supabase,
  tableName = DEFAULT_SMS_WEBHOOK_IDEMPOTENCY_TABLE,
}: FindWebhookEventReservationOptions): Promise<SmsWebhookIdempotencyRecord | null> {
  const client = getSupabaseClient(supabase);
  const { data, error } = await client
    .from(tableName)
    .select(DEFAULT_SELECT_COLUMNS)
    .eq("provider", provider)
    .eq("event_key", eventKey)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load SMS webhook idempotency record for ${provider}:${eventKey}: ${error.message}`,
    );
  }

  return data;
}

export async function reserveWebhookEvent({
  eventKey,
  provider = DEFAULT_SMS_WEBHOOK_PROVIDER,
  supabase,
  tableName = DEFAULT_SMS_WEBHOOK_IDEMPOTENCY_TABLE,
}: ReserveWebhookEventOptions): Promise<ReserveWebhookEventResult> {
  const client = getSupabaseClient(supabase);
  const { data, error } = await client
    .from(tableName)
    .insert({
      event_key: eventKey,
      provider,
    })
    .select(DEFAULT_SELECT_COLUMNS)
    .single();

  if (!error && data) {
    return {
      record: data,
      status: "fresh",
    };
  }

  if (!isUniqueViolation(error)) {
    throw new Error(
      `Failed to reserve SMS webhook idempotency key for ${provider}:${eventKey}: ${error?.message ?? "unknown error"}`,
    );
  }

  return {
    record: await findWebhookEventReservation({
      eventKey,
      provider,
      supabase: client,
      tableName,
    }),
    status: "duplicate",
  };
}
