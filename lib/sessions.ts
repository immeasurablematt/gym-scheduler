import "server-only";

import { auth } from "@clerk/nextjs/server";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  endOfDay,
  endOfWeek,
  format,
  formatDistanceToNow,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { z } from "zod";

import { hasClerkServerKeys } from "@/lib/auth";
import {
  createServerSupabaseClient,
  hasSupabaseServerCredentials,
} from "@/lib/supabase/server";
import type { Database, Json } from "@/types/supabase";

type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
type SessionChangeRow = Database["public"]["Tables"]["session_changes"]["Row"];
type TrainerRow = Database["public"]["Tables"]["trainers"]["Row"];
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type GymSpaceRow = Database["public"]["Tables"]["gym_spaces"]["Row"];
type UserRow = Database["public"]["Tables"]["users"]["Row"];
type SessionStatus = SessionRow["status"];

type TrainerContext = {
  actingUserId: string;
  isPreview: boolean;
  trainer: TrainerRow;
  trainerName: string | null;
};

export type TrainerSession = {
  clientName: string;
  durationMinutes: number;
  gymSpaceName: string | null;
  id: string;
  notes: string | null;
  scheduledAt: string;
  sessionType: string;
  status: SessionStatus;
  updatedAt: string;
};

export type ScheduleClientOption = {
  id: string;
  name: string;
};

export type ScheduleGymSpaceOption = {
  id: string;
  name: string;
};

export type DashboardData = {
  isConfigured: boolean;
  isPreview: boolean;
  setupIssue: string | null;
  recentActivity: {
    action: string;
    detail: string;
    id: string;
    time: string;
  }[];
  stats: {
    activeClients: number;
    completionRate: number;
    todaySessions: number;
    weeklyRevenue: number;
  };
  trainerName: string | null;
  upcomingSessions: TrainerSession[];
};

export type ScheduleData = {
  clientOptions: ScheduleClientOption[];
  gymSpaceOptions: ScheduleGymSpaceOption[];
  isConfigured: boolean;
  isPreview: boolean;
  setupIssue: string | null;
  sessions: TrainerSession[];
  trainerName: string | null;
};

const sessionUpdateSchema = z.object({
  durationMinutes: z.coerce.number().int().min(15).max(240),
  notes: z
    .union([z.string().trim().max(1000), z.null(), z.undefined()])
    .transform(normalizeOptionalString),
  reason: z
    .union([z.string().trim().max(300), z.null(), z.undefined()])
    .transform(normalizeOptionalString),
  scheduledAt: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid scheduledAt"),
  sessionType: z.string().trim().min(1).max(120),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
});

const sessionCreateSchema = z.object({
  clientId: z.string().trim().min(1),
  durationMinutes: z.coerce.number().int().min(15).max(240),
  gymSpaceId: z
    .union([z.string().trim(), z.null(), z.undefined()])
    .transform(normalizeOptionalString),
  notes: z
    .union([z.string().trim().max(1000), z.null(), z.undefined()])
    .transform(normalizeOptionalString),
  scheduledAt: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid scheduledAt"),
  sessionType: z.string().trim().min(1).max(120),
});

export type SessionUpdateInput = z.infer<typeof sessionUpdateSchema>;
export type SessionCreateInput = z.infer<typeof sessionCreateSchema>;

export class SessionUpdateError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class SessionCreateError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function parseSessionUpdateInput(input: unknown) {
  return sessionUpdateSchema.parse(input);
}

export function parseSessionCreateInput(input: unknown) {
  return sessionCreateSchema.parse(input);
}

export async function getTrainerDashboardData(): Promise<DashboardData> {
  if (!hasSupabaseServerCredentials) {
    return {
      isConfigured: false,
      isPreview: !hasClerkServerKeys,
      setupIssue:
        "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable live scheduling data.",
      recentActivity: [],
      stats: {
        activeClients: 0,
        completionRate: 0,
        todaySessions: 0,
        weeklyRevenue: 0,
      },
      trainerName: null,
      upcomingSessions: [],
    };
  }

  try {
    const context = await resolveTrainerContext();

    if (!context) {
      return {
        isConfigured: true,
        isPreview: !hasClerkServerKeys,
        setupIssue: null,
        recentActivity: [],
        stats: {
          activeClients: 0,
          completionRate: 0,
          todaySessions: 0,
          weeklyRevenue: 0,
        },
        trainerName: null,
        upcomingSessions: [],
      };
    }

    const supabase = createServerSupabaseClient();
    const sessionRows = await getTrainerSessions(supabase, context.trainer.id);
    const mappedSessions = await mapSessions(supabase, sessionRows);
    const upcomingSessions = toUpcomingSessions(mappedSessions);
    const recentActivity = await getRecentActivity(
      supabase,
      mappedSessions,
      sessionRows,
      context.trainer.hourly_rate,
    );

    return {
      isConfigured: true,
      isPreview: context.isPreview,
      setupIssue: null,
      recentActivity,
      stats: buildDashboardStats(sessionRows, context.trainer.hourly_rate),
      trainerName: context.trainerName,
      upcomingSessions,
    };
  } catch (error) {
    return {
      isConfigured: false,
      isPreview: !hasClerkServerKeys,
      setupIssue: getSupabaseSetupIssue(error),
      recentActivity: [],
      stats: {
        activeClients: 0,
        completionRate: 0,
        todaySessions: 0,
        weeklyRevenue: 0,
      },
      trainerName: null,
      upcomingSessions: [],
    };
  }
}

export async function getTrainerScheduleData(): Promise<ScheduleData> {
  if (!hasSupabaseServerCredentials) {
    return {
      clientOptions: [],
      gymSpaceOptions: [],
      isConfigured: false,
      isPreview: !hasClerkServerKeys,
      setupIssue:
        "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable live scheduling data.",
      sessions: [],
      trainerName: null,
    };
  }

  try {
    const context = await resolveTrainerContext();

    if (!context) {
      return {
        clientOptions: [],
        gymSpaceOptions: [],
        isConfigured: true,
        isPreview: !hasClerkServerKeys,
        setupIssue: null,
        sessions: [],
        trainerName: null,
      };
    }

    const supabase = createServerSupabaseClient();
    const sessionRows = await getTrainerSessions(supabase, context.trainer.id);
    const [clientOptions, gymSpaceOptions, sessions] = await Promise.all([
      getTrainerClientOptions(supabase, context.trainer.id),
      getGymSpaceOptions(supabase),
      mapSessions(supabase, sessionRows),
    ]);

    return {
      clientOptions,
      gymSpaceOptions,
      isConfigured: true,
      isPreview: context.isPreview,
      setupIssue: null,
      sessions,
      trainerName: context.trainerName,
    };
  } catch (error) {
    return {
      clientOptions: [],
      gymSpaceOptions: [],
      isConfigured: false,
      isPreview: !hasClerkServerKeys,
      setupIssue: getSupabaseSetupIssue(error),
      sessions: [],
      trainerName: null,
    };
  }
}

export async function createTrainerSession(
  rawInput: unknown,
): Promise<TrainerSession> {
  try {
    const input = parseSessionCreateInput(rawInput);

    if (!hasSupabaseServerCredentials) {
      throw new SessionCreateError(
        "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable session creation.",
        503,
      );
    }

    const context = await resolveTrainerContext();

    if (!context) {
      throw new SessionCreateError("Trainer account not found.", 401);
    }

    const supabase = createServerSupabaseClient();
    const client = await getTrainerClientById(
      supabase,
      context.trainer.id,
      input.clientId,
    );

    if (!client) {
      throw new SessionCreateError(
        "Choose a client assigned to this trainer before creating a session.",
        400,
      );
    }

    if (input.gymSpaceId) {
      const gymSpace = await getGymSpaceById(supabase, input.gymSpaceId);

      if (!gymSpace) {
        throw new SessionCreateError("Choose a valid gym space.", 400);
      }
    }

    const { data: insertedSession, error: insertError } = await supabase
      .from("sessions")
      .insert({
        client_id: client.id,
        duration_minutes: input.durationMinutes,
        gym_space_id: input.gymSpaceId,
        notes: input.notes,
        scheduled_at: new Date(input.scheduledAt).toISOString(),
        session_type: input.sessionType,
        status: "scheduled",
        trainer_id: context.trainer.id,
      })
      .select("*")
      .maybeSingle();

    if (insertError) {
      throw mapSessionCreateError(insertError);
    }

    if (!insertedSession) {
      throw new SessionCreateError("Session creation did not return a record.", 500);
    }

    const { error: changeLogError } = await supabase.from("session_changes").insert({
      changed_by: context.actingUserId,
      change_type: "created",
      new_values: toSessionSnapshot(insertedSession),
      old_values: null,
      reason: null,
      session_id: insertedSession.id,
    });

    if (changeLogError) {
      throw new SessionCreateError(changeLogError.message, 500);
    }

    return mapSingleSession(supabase, insertedSession);
  } catch (error) {
    if (error instanceof SessionCreateError) {
      throw error;
    }

    throw new SessionCreateError(getSupabaseSetupIssue(error), 503);
  }
}

export async function updateTrainerSession(
  sessionId: string,
  rawInput: unknown,
): Promise<TrainerSession> {
  try {
    const input = parseSessionUpdateInput(rawInput);

    if (!hasSupabaseServerCredentials) {
      throw new SessionUpdateError(
        "Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable schedule updates.",
        503,
      );
    }

    const context = await resolveTrainerContext();

    if (!context) {
      throw new SessionUpdateError("Trainer account not found.", 401);
    }

    const supabase = createServerSupabaseClient();
    const { data: existingSession, error: existingSessionError } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("trainer_id", context.trainer.id)
      .maybeSingle();

    if (existingSessionError) {
      throw new SessionUpdateError(existingSessionError.message, 500);
    }

    if (!existingSession) {
      throw new SessionUpdateError("Session not found.", 404);
    }

    const updates = buildSessionUpdatePayload(existingSession, input);

    if (Object.keys(updates).length === 0) {
      return mapSingleSession(supabase, existingSession);
    }

    const { data: updatedSession, error: updateError } = await supabase
      .from("sessions")
      .update(updates)
      .eq("id", sessionId)
      .eq("trainer_id", context.trainer.id)
      .select("*")
      .maybeSingle();

    if (updateError) {
      throw mapSessionUpdateError(updateError);
    }

    if (!updatedSession) {
      throw new SessionUpdateError("Session update did not return a record.", 500);
    }

    const { error: changeLogError } = await supabase.from("session_changes").insert({
      changed_by: context.actingUserId,
      change_type: getChangeType(existingSession, updatedSession),
      new_values: toChangedValues(existingSession, updatedSession),
      old_values: toChangedValues(updatedSession, existingSession),
      reason: input.reason,
      session_id: sessionId,
    });

    if (changeLogError) {
      throw new SessionUpdateError(changeLogError.message, 500);
    }

    return mapSingleSession(supabase, updatedSession);
  } catch (error) {
    if (error instanceof SessionUpdateError) {
      throw error;
    }

    throw new SessionUpdateError(getSupabaseSetupIssue(error), 503);
  }
}

async function resolveTrainerContext(): Promise<TrainerContext | null> {
  const supabase = createServerSupabaseClient();

  if (hasClerkServerKeys) {
    const { userId } = await auth();

    if (!userId) {
      return null;
    }

    const trainer = await getTrainerByUserId(supabase, userId);

    if (!trainer) {
      return null;
    }

    const trainerUser = await getUserById(supabase, userId);

    return {
      actingUserId: userId,
      isPreview: false,
      trainer,
      trainerName: trainerUser?.full_name ?? null,
    };
  }

  const { data: trainer, error } = await supabase
    .from("trainers")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!trainer) {
    return null;
  }

  const trainerUser = await getUserById(supabase, trainer.user_id);

  return {
    actingUserId: trainer.user_id,
    isPreview: true,
    trainer,
    trainerName: trainerUser?.full_name ?? null,
  };
}

async function getTrainerByUserId(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("trainers")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getUserById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getTrainerSessions(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  trainerId: string,
) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("trainer_id", trainerId)
    .order("scheduled_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function mapSingleSession(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  session: SessionRow,
) {
  const [mappedSession] = await mapSessions(supabase, [session]);

  if (!mappedSession) {
    throw new Error("Session could not be mapped.");
  }

  return mappedSession;
}

async function mapSessions(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  sessions: SessionRow[],
) {
  const clientsById = await getClientsById(
    supabase,
    dedupe(sessions.map((session) => session.client_id)),
  );
  const clientUsersById = await getUsersById(
    supabase,
    dedupe(
      Array.from(clientsById.values())
        .map((client) => client.user_id)
        .filter(Boolean),
    ),
  );
  const gymSpacesById = await getGymSpacesById(
    supabase,
    dedupe(
      sessions
        .map((session) => session.gym_space_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return sessions.map((session) => {
    const client = clientsById.get(session.client_id);
    const clientName = client
      ? clientUsersById.get(client.user_id)?.full_name ?? "Unknown client"
      : "Unknown client";

    return {
      clientName,
      durationMinutes: session.duration_minutes,
      gymSpaceName: session.gym_space_id
        ? gymSpacesById.get(session.gym_space_id)?.name ?? null
        : null,
      id: session.id,
      notes: session.notes,
      scheduledAt: session.scheduled_at,
      sessionType: session.session_type,
      status: session.status,
      updatedAt: session.updated_at,
    };
  });
}

async function getClientsById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  clientIds: string[],
) {
  if (clientIds.length === 0) {
    return new Map<string, ClientRow>();
  }

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .in("id", clientIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((client) => [client.id, client]));
}

async function getTrainerClientById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  trainerId: string,
  clientId: string,
) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .eq("trainer_id", trainerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getTrainerClientOptions(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  trainerId: string,
) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("trainer_id", trainerId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const clients = data ?? [];
  const clientUsersById = await getUsersById(
    supabase,
    dedupe(clients.map((client) => client.user_id)),
  );

  return clients
    .map((client) => ({
      id: client.id,
      name: clientUsersById.get(client.user_id)?.full_name ?? "Unknown client",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function getUsersById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userIds: string[],
) {
  if (userIds.length === 0) {
    return new Map<string, UserRow>();
  }

  const { data, error } = await supabase.from("users").select("*").in("id", userIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((user) => [user.id, user]));
}

async function getGymSpaceById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  gymSpaceId: string,
) {
  const { data, error } = await supabase
    .from("gym_spaces")
    .select("id, name")
    .eq("id", gymSpaceId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function getGymSpaceOptions(
  supabase: ReturnType<typeof createServerSupabaseClient>,
) {
  const { data, error } = await supabase
    .from("gym_spaces")
    .select("id, name")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((gymSpace) => ({
    id: gymSpace.id,
    name: gymSpace.name,
  }));
}

async function getGymSpacesById(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  gymSpaceIds: string[],
) {
  if (gymSpaceIds.length === 0) {
    return new Map<string, GymSpaceRow>();
  }

  const { data, error } = await supabase
    .from("gym_spaces")
    .select("*")
    .in("id", gymSpaceIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map((data ?? []).map((space) => [space.id, space]));
}

function toUpcomingSessions(sessions: TrainerSession[]) {
  const now = new Date();

  return sessions
    .filter(
      (session) => session.status === "scheduled" && new Date(session.scheduledAt) >= now,
    )
    .slice(0, 5);
}

async function getRecentActivity(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  mappedSessions: TrainerSession[],
  sessionRows: SessionRow[],
  hourlyRate: number | null,
) {
  if (sessionRows.length === 0) {
    return [];
  }

  const sessionIds = sessionRows.map((session) => session.id);
  const sessionMap = new Map(sessionRows.map((session) => [session.id, session]));
  const mappedSessionMap = new Map(mappedSessions.map((session) => [session.id, session]));
  const { data: changes, error } = await supabase
    .from("session_changes")
    .select("*")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(error.message);
  }

  return (changes ?? []).map((change) =>
    toRecentActivityItem(change, sessionMap, mappedSessionMap, hourlyRate),
  );
}

function toRecentActivityItem(
  change: SessionChangeRow,
  sessionMap: Map<string, SessionRow>,
  mappedSessionMap: Map<string, TrainerSession>,
  hourlyRate: number | null,
) {
  const mappedSession = mappedSessionMap.get(change.session_id);
  const session = sessionMap.get(change.session_id);
  const action = formatChangeType(change.change_type);

  if (!mappedSession || !session) {
    return {
      action,
      detail: "Session updated",
      id: change.id,
      time: formatDistanceToNow(new Date(change.created_at), { addSuffix: true }),
    };
  }

  const newValues = asObject(change.new_values);
  const detail =
    change.change_type === "created"
      ? `${mappedSession.clientName} scheduled for ${formatSessionDate(session.scheduled_at)}`
      : change.change_type === "rescheduled" &&
          typeof newValues.scheduled_at === "string"
      ? `${mappedSession.clientName} moved to ${formatSessionDate(newValues.scheduled_at)}`
      : change.change_type === "cancelled"
        ? `${mappedSession.clientName}${change.reason ? ` - ${change.reason}` : ""}`
        : mappedSession.status === "completed" && hourlyRate
          ? `${mappedSession.clientName} - $${Math.round(
              (hourlyRate * session.duration_minutes) / 60,
            )}`
          : `${mappedSession.clientName} - ${mappedSession.sessionType}`;

  return {
    action,
    detail,
    id: change.id,
    time: formatDistanceToNow(new Date(change.created_at), { addSuffix: true }),
  };
}

function buildDashboardStats(sessions: SessionRow[], hourlyRate: number | null) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const todaySessions = sessions.filter((session) =>
    isWithinRange(session.scheduled_at, todayStart, todayEnd),
  ).length;
  const weeklySessions = sessions.filter((session) =>
    isWithinRange(session.scheduled_at, weekStart, weekEnd),
  );
  const completedWeeklySessions = weeklySessions.filter(
    (session) => session.status === "completed",
  );
  const activeClients = new Set(
    sessions
      .filter((session) => session.status !== "cancelled")
      .map((session) => session.client_id),
  ).size;
  const completionRate = weeklySessions.length
    ? Math.round((completedWeeklySessions.length / weeklySessions.length) * 100)
    : 0;
  const weeklyRevenue = hourlyRate
    ? Math.round(
        completedWeeklySessions.reduce(
          (total, session) => total + (hourlyRate * session.duration_minutes) / 60,
          0,
        ),
      )
    : 0;

  return {
    activeClients,
    completionRate,
    todaySessions,
    weeklyRevenue,
  };
}

function buildSessionUpdatePayload(
  existingSession: SessionRow,
  input: SessionUpdateInput,
) {
  const scheduledAt = new Date(input.scheduledAt).toISOString();
  const notes = input.notes;
  const updates: Database["public"]["Tables"]["sessions"]["Update"] = {};

  if (existingSession.scheduled_at !== scheduledAt) {
    updates.scheduled_at = scheduledAt;
  }

  if (existingSession.duration_minutes !== input.durationMinutes) {
    updates.duration_minutes = input.durationMinutes;
  }

  if (existingSession.session_type !== input.sessionType) {
    updates.session_type = input.sessionType;
  }

  if ((existingSession.notes ?? null) !== notes) {
    updates.notes = notes;
  }

  if (existingSession.status !== input.status) {
    updates.status = input.status;
  }

  return updates;
}

function getChangeType(existingSession: SessionRow, updatedSession: SessionRow) {
  if (existingSession.status !== updatedSession.status && updatedSession.status === "cancelled") {
    return "cancelled";
  }

  if (existingSession.scheduled_at !== updatedSession.scheduled_at) {
    return "rescheduled";
  }

  return "modified";
}

function toChangedValues(
  before: SessionRow,
  after: SessionRow,
): Json | null {
  const changedValues: Record<string, Json> = {};

  if (before.scheduled_at !== after.scheduled_at) {
    changedValues.scheduled_at = after.scheduled_at;
  }

  if (before.duration_minutes !== after.duration_minutes) {
    changedValues.duration_minutes = after.duration_minutes;
  }

  if (before.session_type !== after.session_type) {
    changedValues.session_type = after.session_type;
  }

  if ((before.notes ?? null) !== (after.notes ?? null)) {
    changedValues.notes = after.notes;
  }

  if (before.status !== after.status) {
    changedValues.status = after.status;
  }

  return Object.keys(changedValues).length > 0 ? changedValues : null;
}

function toSessionSnapshot(session: SessionRow): Json {
  return {
    client_id: session.client_id,
    duration_minutes: session.duration_minutes,
    gym_space_id: session.gym_space_id,
    notes: session.notes,
    scheduled_at: session.scheduled_at,
    session_type: session.session_type,
    status: session.status,
    trainer_id: session.trainer_id,
  };
}

function normalizeOptionalString(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupe(values: string[]) {
  return Array.from(new Set(values));
}

function asObject(value: Json | null) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {} as Record<string, Json | undefined>;
  }

  return value as Record<string, Json | undefined>;
}

function formatChangeType(changeType: string) {
  switch (changeType) {
    case "created":
      return "Session created";
    case "cancelled":
      return "Session cancelled";
    case "rescheduled":
      return "Session rescheduled";
    default:
      return "Session updated";
  }
}

function formatSessionDate(value: string) {
  return format(new Date(value), "EEE, MMM d 'at' h:mm a");
}

function isWithinRange(value: string, start: Date, end: Date) {
  const date = new Date(value);
  return date >= start && date <= end;
}

function getSupabaseSetupIssue(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unexpected Supabase error.";

  if (message.includes("schema cache")) {
    return "Your Supabase project does not have the gym-scheduler tables yet. Run supabase/schema.sql in the Supabase SQL editor, then refresh.";
  }

  return message;
}

function mapSessionCreateError(error: PostgrestError) {
  const conflictMessage = getSessionConflictMessage(error);

  if (conflictMessage) {
    return new SessionCreateError(conflictMessage, 409);
  }

  return new SessionCreateError(error.message, 500);
}

function mapSessionUpdateError(error: PostgrestError) {
  const conflictMessage = getSessionConflictMessage(error);

  if (conflictMessage) {
    return new SessionUpdateError(conflictMessage, 409);
  }

  return new SessionUpdateError(error.message, 500);
}

function getSessionConflictMessage(error: PostgrestError) {
  if (error.code !== "23505") {
    return null;
  }

  const haystack = `${error.message} ${error.details ?? ""}`.toLowerCase();

  if (
    haystack.includes("trainer_id") ||
    haystack.includes("double_booking_trainer") ||
    haystack.includes("unique_trainer_time")
  ) {
    return "You already have another session at that start time.";
  }

  if (
    haystack.includes("client_id") ||
    haystack.includes("double_booking_client") ||
    haystack.includes("unique_client_time")
  ) {
    return "This client already has a session at that start time.";
  }

  if (
    haystack.includes("gym_space_id") ||
    haystack.includes("double_booking_space") ||
    haystack.includes("unique_space_time")
  ) {
    return "That gym space is already booked at that start time.";
  }

  return "Another session already exists at that start time.";
}
