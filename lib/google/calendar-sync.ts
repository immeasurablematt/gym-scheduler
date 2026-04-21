import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSmsRuntimeConfig } from "@/lib/sms/config";
import type { Database } from "@/types/supabase";
import { buildCalendarSyncMutation } from "@/lib/google/calendar-sync-contract";
import { assessClientInviteEligibility } from "@/lib/google/client-invite-eligibility";
import {
  deleteGoogleCalendarEvent,
  getGoogleCalendarEvent,
  upsertGoogleCalendarEvent,
} from "@/lib/google/client";
import {
  getTrainerCalendarConnection,
  setTrainerCalendarConnectionError,
} from "@/lib/google/connection-service";

type SessionRow = Database["public"]["Tables"]["sessions"]["Row"] & {
  calendar_event_provider?: string | null;
};
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type TrainerRow = Database["public"]["Tables"]["trainers"]["Row"];
type UserRow = Database["public"]["Tables"]["users"]["Row"];
type CalendarSyncJob = Database["public"]["Tables"]["calendar_sync_jobs"]["Row"];

export async function syncSessionToCalendar(
  sessionId: string,
  trainerId?: string | null,
) {
  const job = await enqueueSessionCalendarSync(sessionId, trainerId ?? null);
  return processCalendarSyncJob(job.id);
}

export async function enqueueSessionCalendarSync(
  sessionId: string,
  trainerId?: string | null,
) {
  const resolvedTrainerId = trainerId ?? (await getTrainerIdForSession(sessionId));
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("calendar_sync_jobs")
    .insert({
      attempt_count: 0,
      available_at: new Date().toISOString(),
      payload: {},
      processed_at: null,
      provider: "google",
      session_id: sessionId,
      status: "queued",
      trainer_id: resolvedTrainerId,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as CalendarSyncJob;
}

export async function enqueueTrainerSessionBackfill(trainerId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("id")
    .eq("trainer_id", trainerId)
    .neq("status", "cancelled")
    .gte("scheduled_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (error) {
    throw new Error(error.message);
  }

  for (const session of data ?? []) {
    await enqueueSessionCalendarSync(session.id, trainerId);
  }
}

export async function processPendingCalendarSyncJobs(limit = 10) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("calendar_sync_jobs")
    .select("*")
    .in("status", ["queued", "failed"])
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  let processed = 0;

  for (const row of (data ?? []) as CalendarSyncJob[]) {
    const result = await processCalendarSyncJob(row.id);
    if (result !== "skipped") {
      processed += 1;
    }
  }

  return processed;
}

export async function processCalendarSyncJob(jobId: string) {
  const claimed = await claimCalendarSyncJob(jobId);

  if (!claimed) {
    return "skipped" as const;
  }

  try {
    const session = await getSessionById(claimed.session_id);

    if (!session) {
      await markCalendarSyncJobCompleted(claimed.id);
      return "completed" as const;
    }

    const connection = await getTrainerCalendarConnection(claimed.trainer_id);

    if (!connection || !connection.sync_enabled) {
      await updateSessionCalendarState(session.id, {
        calendar_event_provider: null,
        calendar_last_synced_at: null,
        calendar_sync_error: null,
        calendar_sync_status: "not_connected",
      });
      await markCalendarSyncJobCompleted(claimed.id);
      return "completed" as const;
    }

    const view = await loadSessionCalendarView(session);
    const timeZone = connection.calendar_time_zone || getSmsRuntimeConfig().timeZone;
    const inviteEligibility = assessClientInviteEligibility(view.clientUser?.email ?? null);

    if (inviteEligibility.kind === "ineligible" && session.status !== "cancelled") {
      throw new Error(inviteEligibility.syncError);
    }

    const syncMutation = buildCalendarSyncMutation({
      clientEmail:
        inviteEligibility.kind === "eligible"
          ? inviteEligibility.email
          : null,
      existingAttendees:
        session.calendar_external_id && session.status !== "cancelled"
          ? (
              await getGoogleCalendarEvent(connection, session.calendar_external_id)
            )?.attendees ?? []
          : [],
      sessionStatus: session.status,
    });

    if (syncMutation.kind === "delete") {
      if (session.calendar_external_id) {
        await deleteGoogleCalendarEvent(connection, session.calendar_external_id);
      }

      await updateSessionCalendarState(session.id, {
        calendar_event_provider: "google",
        calendar_external_id: null,
        calendar_last_synced_at: new Date().toISOString(),
        calendar_sync_error: null,
        calendar_sync_status: "synced",
      });
      await setTrainerCalendarConnectionError(connection.trainer_id, null);
      await markCalendarSyncJobCompleted(claimed.id);
      return "completed" as const;
    }

    const event = await upsertGoogleCalendarEvent(connection, {
      attendees: syncMutation.attendees,
      description: buildCalendarEventDescription(view),
      endTime: new Date(
        new Date(session.scheduled_at).getTime() +
          session.duration_minutes * 60 * 1000,
      ).toISOString(),
      eventId: session.calendar_external_id ?? null,
      startTime: session.scheduled_at,
      timeZone,
      title: buildCalendarEventTitle(view),
    });

    await updateSessionCalendarState(session.id, {
      calendar_event_provider: "google",
      calendar_external_id: event.eventId,
      calendar_last_synced_at: new Date().toISOString(),
      calendar_sync_error: null,
      calendar_sync_status: "synced",
    });
    await setTrainerCalendarConnectionError(connection.trainer_id, null);
    await markCalendarSyncJobCompleted(claimed.id);
    return "completed" as const;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected calendar sync failure.";
    await markCalendarSyncJobFailed(claimed.id, claimed.attempt_count, message);
    await updateSessionCalendarState(claimed.session_id, {
      calendar_last_synced_at: null,
      calendar_sync_error: message,
      calendar_sync_status: "failed",
    });
    await setTrainerCalendarConnectionError(claimed.trainer_id, message);
    throw error;
  }
}

async function claimCalendarSyncJob(jobId: string) {
  const supabase = createServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("calendar_sync_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const row = existing as CalendarSyncJob | null;

  if (!row || !["queued", "failed"].includes(row.status)) {
    return null;
  }

  const { data, error } = await supabase
    .from("calendar_sync_jobs")
    .update({
      attempt_count: (row.attempt_count ?? 0) + 1,
      status: "processing",
    })
    .eq("id", jobId)
    .in("status", ["queued", "failed"])
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as CalendarSyncJob | null) ?? null;
}

async function markCalendarSyncJobCompleted(jobId: string) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("calendar_sync_jobs")
    .update({
      last_error: null,
      processed_at: new Date().toISOString(),
      status: "completed",
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }
}

async function markCalendarSyncJobFailed(
  jobId: string,
  attemptCount: number,
  message: string,
) {
  const retryDelayMinutes = Math.min(60, Math.max(2, 2 ** Math.min(attemptCount, 5)));
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("calendar_sync_jobs")
    .update({
      available_at: new Date(
        Date.now() + retryDelayMinutes * 60 * 1000,
      ).toISOString(),
      last_error: message,
      status: "failed",
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }
}

async function getTrainerIdForSession(sessionId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("trainer_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.trainer_id) {
    throw new Error(`Session ${sessionId} does not exist.`);
  }

  return data.trainer_id;
}

async function getSessionById(sessionId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SessionRow | null) ?? null;
}

async function loadSessionCalendarView(session: SessionRow) {
  const supabase = createServerSupabaseClient();
  const [{ data: client, error: clientError }, { data: trainer, error: trainerError }] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", session.client_id).maybeSingle(),
      supabase.from("trainers").select("*").eq("id", session.trainer_id).maybeSingle(),
    ]);

  if (clientError) {
    throw new Error(clientError.message);
  }

  if (trainerError) {
    throw new Error(trainerError.message);
  }

  const [{ data: clientUser, error: clientUserError }, { data: trainerUser, error: trainerUserError }] =
    await Promise.all([
      client
        ? supabase.from("users").select("*").eq("id", client.user_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      trainer
        ? supabase.from("users").select("*").eq("id", trainer.user_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (clientUserError) {
    throw new Error(clientUserError.message);
  }

  if (trainerUserError) {
    throw new Error(trainerUserError.message);
  }

  return {
    client: (client as ClientRow | null) ?? null,
    clientUser: (clientUser as UserRow | null) ?? null,
    session,
    trainer: (trainer as TrainerRow | null) ?? null,
    trainerUser: (trainerUser as UserRow | null) ?? null,
  };
}

async function updateSessionCalendarState(
  sessionId: string,
  updates: Partial<SessionRow>,
) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("sessions")
    .update(updates)
    .eq("id", sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

function buildCalendarEventTitle(view: {
  clientUser: UserRow | null;
  session: SessionRow;
}) {
  const clientName = view.clientUser?.full_name ?? "Client";
  return `${clientName} · ${view.session.session_type}`;
}

function buildCalendarEventDescription(view: {
  clientUser: UserRow | null;
  session: SessionRow;
  trainerUser: UserRow | null;
}) {
  const lines = [
    `Trainer: ${view.trainerUser?.full_name ?? "Unknown trainer"}`,
    `Client: ${view.clientUser?.full_name ?? "Unknown client"}`,
    `Session type: ${view.session.session_type}`,
    `Duration: ${view.session.duration_minutes} minutes`,
  ];

  if (view.session.notes) {
    lines.push(`Notes: ${view.session.notes}`);
  }

  return lines.join("\n");
}
