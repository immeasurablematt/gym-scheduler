export type GoogleCalendarAttendee = {
  email: string;
};

const INVITE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hasInviteSuitableEmail(email: string | null | undefined) {
  if (typeof email !== "string") {
    return false;
  }

  return INVITE_EMAIL_PATTERN.test(email.trim());
}

export function requireInviteSuitableEmail(
  email: string | null | undefined,
  message = "Client email must be present and valid for Google Calendar invites.",
) {
  if (!hasInviteSuitableEmail(email)) {
    throw new Error(message);
  }

  return email.trim();
}

export function mergeClientAttendee(
  existing: GoogleCalendarAttendee[] | null | undefined,
  clientEmail: string,
) {
  const trimmedClientEmail = clientEmail.trim().toLowerCase();
  const normalized = (existing ?? []).filter(
    (attendee) => attendee && typeof attendee.email === "string" && attendee.email.trim(),
  );

  const hasClient = normalized.some(
    (attendee) => attendee.email.trim().toLowerCase() === trimmedClientEmail,
  );

  return hasClient ? normalized : [...normalized, { email: clientEmail.trim() }];
}
