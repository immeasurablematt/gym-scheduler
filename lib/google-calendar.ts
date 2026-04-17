import "server-only";

import { hasGoogleCalendarCredentials } from "@/lib/google/config";
import { getTrainerCalendarConnection } from "@/lib/google/connection-service";
import { resolveTrainerAuthContext } from "@/lib/google/trainer-context";

export type GoogleCalendarConnectionState =
  | "connected"
  | "needs_connection"
  | "not_configured";

export type GoogleCalendarConnectionStatus = {
  accountLabel: string;
  calendarLabel: string;
  description: string;
  label: string;
  lastSyncLabel: string;
  state: GoogleCalendarConnectionState;
};

export async function getGoogleCalendarConnectionStatus(): Promise<GoogleCalendarConnectionStatus> {
  if (!hasGoogleCalendarCredentials()) {
    return {
      accountLabel: "OAuth credentials missing",
      calendarLabel: "No calendar connected",
      description:
        "Google Calendar OAuth is not configured in this environment yet.",
      label: "Not configured",
      lastSyncLabel: "No sync history",
      state: "not_configured",
    };
  }

  const trainerContext = await resolveTrainerAuthContext();
  const connection = trainerContext
    ? await getTrainerCalendarConnection(trainerContext.trainer.id)
    : null;

  if (!connection || !connection.refresh_token || !connection.sync_enabled) {
    return {
      accountLabel: "Waiting for trainer connection",
      calendarLabel: "Primary calendar will be selected during OAuth",
      description:
        "Google Calendar OAuth is ready, but this trainer has not connected an account yet.",
      label: "Ready to connect",
      lastSyncLabel: "No sync history",
      state: "needs_connection",
    };
  }

  return {
    accountLabel:
      connection.google_calendar_email ?? "Google account connected",
    calendarLabel: connection.google_calendar_id ?? "Primary calendar",
    description:
      connection.last_sync_error
        ? `Connected, but the last sync failed: ${connection.last_sync_error}`
        : "The trainer calendar connection is active and ready for live availability and session sync.",
    label: connection.last_sync_error ? "Connected with issues" : "Connected",
    lastSyncLabel: connection.last_sync_at
      ? new Date(connection.last_sync_at).toLocaleString("en-CA", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "No successful sync yet",
    state: "connected",
  };
}
