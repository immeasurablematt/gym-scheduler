import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/supabase";
import {
  addDaysToPlainDate,
  formatSlotLabel,
  getCurrentPlainDateInTimeZone,
  getWeekdayForPlainDate,
  minutesToTimeParts,
  timePartsToMinutes,
  zonedLocalDateTimeToUtc,
} from "@/lib/sms/timezone";
import {
  type GoogleBusyInterval,
  TrainerCalendarUnavailableError,
  getGoogleCalendarBusyIntervals,
} from "@/lib/google/client";
import { getTrainerCalendarConnection } from "@/lib/google/connection-service";

type AvailabilityTemplateRow =
  Database["public"]["Tables"]["availability_templates"]["Row"];
type BlockedTimeSlotRow =
  Database["public"]["Tables"]["blocked_time_slots"]["Row"];
type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];

type AvailabilityWindow = {
  dayOfWeek: number;
  endTime: string;
  startTime: string;
};

export type AvailabilitySlot = {
  endsAt: string;
  label: string;
  startsAt: string;
};

type FindAvailableSmsSlotsOptions = {
  clientId: string;
  durationMinutes: number;
  ignoredSessionIds?: string[];
  maxSlots: number;
  searchDays: number;
  slotIntervalMinutes: number;
  timeZone: string;
  trainerAvailableHours: Json | null;
  trainerId: string;
};

export async function findAvailableSmsSlots({
  clientId,
  durationMinutes,
  ignoredSessionIds = [],
  maxSlots,
  searchDays,
  slotIntervalMinutes,
  timeZone,
  trainerAvailableHours,
  trainerId,
}: FindAvailableSmsSlotsOptions): Promise<AvailabilitySlot[]> {
  const supabase = createServerSupabaseClient();
  const now = new Date();
  const searchEnd = new Date(
    now.getTime() + searchDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const nowIso = now.toISOString();
  const [templates, blockedSlots, trainerSessions, clientSessions, externalBusyIntervals] =
    await Promise.all([
      getAvailabilityTemplates(supabase, trainerId),
      getBlockedTimeSlots(supabase, trainerId, nowIso, searchEnd),
      getScheduledSessionsForTrainer(supabase, trainerId, nowIso, searchEnd),
      getScheduledSessionsForClient(supabase, clientId, nowIso, searchEnd),
      getTrainerExternalBusyIntervals(trainerId, nowIso, searchEnd),
    ]);

  const windows = toAvailabilityWindows(templates, trainerAvailableHours);

  if (windows.length === 0) {
    return [];
  }

  const conflicts = dedupeSessions([...trainerSessions, ...clientSessions]).filter(
    (session) => !ignoredSessionIds.includes(session.id),
  );
  const slots: AvailabilitySlot[] = [];
  const today = getCurrentPlainDateInTimeZone(timeZone);

  for (let offset = 0; offset < searchDays; offset += 1) {
    const date = addDaysToPlainDate(today, offset);
    const weekday = getWeekdayForPlainDate(date);
    const dayWindows = windows.filter((window) => window.dayOfWeek === weekday);

    for (const window of dayWindows) {
      const startMinutes = timePartsToMinutes(window.startTime);
      const endMinutes = timePartsToMinutes(window.endTime);

      for (
        let cursorMinutes = startMinutes;
        cursorMinutes + durationMinutes <= endMinutes;
        cursorMinutes += slotIntervalMinutes
      ) {
        const timeParts = minutesToTimeParts(cursorMinutes);
        const candidateStart = zonedLocalDateTimeToUtc(
          date,
          timeParts.hour,
          timeParts.minute,
          timeZone,
        );
        const candidateEnd = new Date(
          candidateStart.getTime() + durationMinutes * 60 * 1000,
        );

        if (candidateStart <= now || candidateStart.toISOString() > searchEnd) {
          continue;
        }

        if (
          overlapsExistingSession(candidateStart, candidateEnd, conflicts) ||
          overlapsBlockedTime(candidateStart, candidateEnd, blockedSlots) ||
          overlapsExternalBusyTime(candidateStart, candidateEnd, externalBusyIntervals)
        ) {
          continue;
        }

        slots.push({
          endsAt: candidateEnd.toISOString(),
          label: formatSlotLabel(candidateStart, timeZone),
          startsAt: candidateStart.toISOString(),
        });

        if (slots.length >= maxSlots) {
          return slots;
        }
      }
    }
  }

  return slots;
}

export async function hasAvailabilitySource(
  trainerId: string,
  availableHours: Json | null,
) {
  if (toAvailabilityWindows([], availableHours).length > 0) {
    return true;
  }

  const supabase = createServerSupabaseClient();
  const { count, error } = await supabase
    .from("availability_templates")
    .select("id", { count: "exact", head: true })
    .eq("trainer_id", trainerId)
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  return (count ?? 0) > 0;
}

async function getAvailabilityTemplates(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  trainerId: string,
) {
  const { data, error } = await supabase
    .from("availability_templates")
    .select("*")
    .eq("trainer_id", trainerId)
    .eq("is_active", true)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function getBlockedTimeSlots(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  trainerId: string,
  startIso: string,
  endIso: string,
) {
  const { data, error } = await supabase
    .from("blocked_time_slots")
    .select("*")
    .eq("trainer_id", trainerId)
    .lt("start_time", endIso)
    .gt("end_time", startIso);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function getScheduledSessionsForTrainer(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  trainerId: string,
  startIso: string,
  endIso: string,
) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("trainer_id", trainerId)
    .neq("status", "cancelled")
    .lt("scheduled_at", endIso)
    .order("scheduled_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return filterSessionsThatOverlapRange((data ?? []) as SessionRow[], startIso, endIso);
}

async function getScheduledSessionsForClient(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  clientId: string,
  startIso: string,
  endIso: string,
) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("client_id", clientId)
    .neq("status", "cancelled")
    .lt("scheduled_at", endIso);

  if (error) {
    throw new Error(error.message);
  }

  return filterSessionsThatOverlapRange((data ?? []) as SessionRow[], startIso, endIso);
}

function toAvailabilityWindows(
  templates: AvailabilityTemplateRow[],
  availableHours: Json | null,
) {
  if (templates.length > 0) {
    return templates.map((template) => ({
      dayOfWeek: template.day_of_week,
      endTime: template.end_time,
      startTime: template.start_time,
    }));
  }

  return parseAvailableHours(availableHours);
}

function parseAvailableHours(value: Json | null): AvailabilityWindow[] {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return [];
  }

  const windows: AvailabilityWindow[] = [];
  const weekdayMap: Record<string, number> = {
    friday: 5,
    monday: 1,
    saturday: 6,
    sunday: 0,
    thursday: 4,
    tuesday: 2,
    wednesday: 3,
  };

  for (const [key, rawRanges] of Object.entries(value)) {
    const parsedDay = Number(key);
    const dayOfWeek =
      Number.isInteger(parsedDay) && parsedDay >= 0 && parsedDay <= 6
        ? parsedDay
        : weekdayMap[key.toLowerCase()];

    if (typeof dayOfWeek !== "number" || !Array.isArray(rawRanges)) {
      continue;
    }

    for (const range of rawRanges) {
      if (!range || Array.isArray(range) || typeof range !== "object") {
        continue;
      }

      const start =
        typeof range.start === "string"
          ? range.start
          : typeof range.start_time === "string"
            ? range.start_time
            : null;
      const end =
        typeof range.end === "string"
          ? range.end
          : typeof range.end_time === "string"
            ? range.end_time
            : null;

      if (!start || !end) {
        continue;
      }

      windows.push({
        dayOfWeek,
        endTime: end,
        startTime: start,
      });
    }
  }

  return windows.sort((left, right) =>
    left.dayOfWeek === right.dayOfWeek
      ? left.startTime.localeCompare(right.startTime)
      : left.dayOfWeek - right.dayOfWeek,
  );
}

function overlapsExistingSession(
  start: Date,
  end: Date,
  sessions: SessionRow[],
) {
  return sessions.some((session) => {
    const sessionStart = new Date(session.scheduled_at);
    const sessionEnd = new Date(
      sessionStart.getTime() + session.duration_minutes * 60 * 1000,
    );

    return start < sessionEnd && end > sessionStart;
  });
}

function overlapsBlockedTime(
  start: Date,
  end: Date,
  blockedSlots: BlockedTimeSlotRow[],
) {
  return blockedSlots.some((slot) => {
    const blockedStart = new Date(slot.start_time);
    const blockedEnd = new Date(slot.end_time);
    return start < blockedEnd && end > blockedStart;
  });
}

function overlapsExternalBusyTime(
  start: Date,
  end: Date,
  intervals: GoogleBusyInterval[],
) {
  return intervals.some((interval) => {
    const busyStart = new Date(interval.startTime);
    const busyEnd = new Date(interval.endTime);
    return start < busyEnd && end > busyStart;
  });
}

function dedupeSessions(sessions: SessionRow[]) {
  return Array.from(
    new Map(sessions.map((session) => [session.id, session])).values(),
  );
}

function filterSessionsThatOverlapRange(
  sessions: SessionRow[],
  startIso: string,
  endIso: string,
) {
  const rangeStart = new Date(startIso);
  const rangeEnd = new Date(endIso);

  return sessions.filter((session) => {
    const sessionStart = new Date(session.scheduled_at);
    const sessionEnd = new Date(
      sessionStart.getTime() + session.duration_minutes * 60 * 1000,
    );

    return sessionStart < rangeEnd && sessionEnd > rangeStart;
  });
}

async function getTrainerExternalBusyIntervals(
  trainerId: string,
  startIso: string,
  endIso: string,
) {
  const connection = await getTrainerCalendarConnection(trainerId);

  if (!connection || !connection.sync_enabled) {
    return [];
  }

  try {
    return await getGoogleCalendarBusyIntervals(connection, startIso, endIso);
  } catch (error) {
    if (error instanceof TrainerCalendarUnavailableError) {
      throw error;
    }

    throw new TrainerCalendarUnavailableError(
      error instanceof Error ? error.message : "Failed to load trainer busy time.",
    );
  }
}
