import {
  mergeClientAttendee,
  requireInviteSuitableEmail,
  type GoogleCalendarAttendee,
} from "./calendar-attendees.ts";

export type CalendarSyncMutation =
  | {
      kind: "delete";
      sendUpdates: "all";
    }
  | {
      attendees: GoogleCalendarAttendee[];
      kind: "upsert";
      sendUpdates: "all";
    };

export function buildCalendarSyncMutation(input: {
  clientEmail: string | null | undefined;
  existingAttendees?: GoogleCalendarAttendee[] | null;
  sessionStatus: "scheduled" | "completed" | "cancelled" | "no_show";
}): CalendarSyncMutation {
  if (input.sessionStatus === "cancelled") {
    return {
      kind: "delete",
      sendUpdates: "all",
    };
  }

  const clientEmail = requireInviteSuitableEmail(input.clientEmail);

  return {
    attendees: mergeClientAttendee(input.existingAttendees, clientEmail),
    kind: "upsert",
    sendUpdates: "all",
  };
}
