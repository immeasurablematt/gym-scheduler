import "server-only";

import type { GoogleCalendarAttendee } from "@/lib/google/calendar-attendees";
import { getGoogleCalendarConfig } from "@/lib/google/config";
import {
  type TrainerCalendarConnection,
  updateTrainerCalendarConnection,
} from "@/lib/google/connection-service";

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleCalendarMetadata = {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  timeZone?: string;
};

type GoogleFreeBusyResponse = {
  calendars?: Record<
    string,
    {
      busy?: Array<{
        end: string;
        start: string;
      }>;
    }
  >;
};

type GoogleCalendarEventResponse = {
  attendees?: GoogleCalendarAttendee[];
  id?: string;
};

export type GoogleBusyInterval = {
  endTime: string;
  startTime: string;
};

export class TrainerCalendarUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainerCalendarUnavailableError";
  }
}

export async function exchangeGoogleCalendarCode(code: string) {
  const config = getGoogleCalendarConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as GoogleTokenResponse | {
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !body || !("access_token" in body)) {
    throw new Error(
      body && "error_description" in body && body.error_description
        ? body.error_description
        : "Failed to exchange Google Calendar OAuth code.",
    );
  }

  return body;
}

export async function fetchPrimaryGoogleCalendarMetadataFromAccessToken(
  accessToken: string,
) {
  return authorizedGoogleRequest<GoogleCalendarMetadata>(
    accessToken,
    "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary",
  );
}

export async function getGoogleCalendarEvent(
  connection: TrainerCalendarConnection,
  eventId: string,
) {
  const accessToken = await ensureFreshGoogleAccessToken(connection);
  const calendarId = connection.google_calendar_id || "primary";

  return authorizedGoogleRequest<GoogleCalendarEventResponse>(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
}

export async function getGoogleCalendarBusyIntervals(
  connection: TrainerCalendarConnection,
  timeMin: string,
  timeMax: string,
) {
  const accessToken = await ensureFreshGoogleAccessToken(connection);
  const calendarId = connection.google_calendar_id || "primary";
  const body = await authorizedGoogleRequest<GoogleFreeBusyResponse>(
    accessToken,
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      body: JSON.stringify({
        items: [{ id: calendarId }],
        timeMax,
        timeMin,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const busy = body.calendars?.[calendarId]?.busy ?? [];

  return busy.map((interval) => ({
    endTime: interval.end,
    startTime: interval.start,
  }));
}

export async function upsertGoogleCalendarEvent(
  connection: TrainerCalendarConnection,
  input: {
    attendees?: GoogleCalendarAttendee[];
    description: string;
    endTime: string;
    eventId?: string | null;
    startTime: string;
    timeZone: string;
    title: string;
  },
  ) {
  const accessToken = await ensureFreshGoogleAccessToken(connection);
  const calendarId = connection.google_calendar_id || "primary";
  const url = new URL(
    input.eventId
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("sendUpdates", "all");
  const eventPayload = {
    ...(input.attendees ? { attendees: input.attendees } : {}),
    description: input.description,
    end: {
      dateTime: input.endTime,
      timeZone: input.timeZone,
    },
    start: {
      dateTime: input.startTime,
      timeZone: input.timeZone,
    },
    summary: input.title,
  };
  const body = await authorizedGoogleRequest<GoogleCalendarEventResponse>(
    accessToken,
    url.toString(),
    {
      body: JSON.stringify(eventPayload),
      headers: {
        "content-type": "application/json",
      },
      method: input.eventId ? "PATCH" : "POST",
    },
  );

  return {
    calendarId,
    eventId: body.id ?? null,
  };
}

export async function deleteGoogleCalendarEvent(
  connection: TrainerCalendarConnection,
  eventId: string,
) {
  const accessToken = await ensureFreshGoogleAccessToken(connection);
  const calendarId = connection.google_calendar_id || "primary";
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  url.searchParams.set("sendUpdates", "all");
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    method: "DELETE",
  });

  if (response.status === 404 || response.status === 410) {
    return;
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as
      | {
          error?: {
            message?: string;
          };
        }
      | null;
    throw new Error(
      errorBody?.error?.message ??
        `Google Calendar delete failed with status ${response.status}.`,
    );
  }
}

async function ensureFreshGoogleAccessToken(
  connection: TrainerCalendarConnection,
) {
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;
  const isFresh = Boolean(connection.access_token) && expiresAt - Date.now() > 60_000;

  if (isFresh && connection.access_token) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    throw new TrainerCalendarUnavailableError(
      "Google Calendar refresh token is missing for this trainer.",
    );
  }

  const config = getGoogleCalendarConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as GoogleTokenResponse | {
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !body || !("access_token" in body)) {
    throw new TrainerCalendarUnavailableError(
      body && "error_description" in body && body.error_description
        ? body.error_description
        : "Failed to refresh Google Calendar access token.",
    );
  }

  const tokenExpiresAt = new Date(
    Date.now() + body.expires_in * 1000,
  ).toISOString();

  await updateTrainerCalendarConnection(connection.trainer_id, {
    access_token: body.access_token,
    token_expires_at: tokenExpiresAt,
  });

  return body.access_token;
}

async function authorizedGoogleRequest<T>(
  accessToken: string,
  url: string,
  init?: RequestInit,
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as
      | {
          error?: {
            message?: string;
          };
        }
      | null;
    throw new TrainerCalendarUnavailableError(
      errorBody?.error?.message ??
        `Google Calendar request failed with status ${response.status}.`,
    );
  }

  return (await response.json()) as T;
}
