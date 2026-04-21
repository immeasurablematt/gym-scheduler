import { hasInviteSuitableEmail } from "./calendar-attendees.ts";

export type ClientInviteEligibility =
  | {
      email: string;
      kind: "eligible";
    }
  | {
      dashboardMessage: string;
      kind: "ineligible";
      smsBookReply: string;
      smsRescheduleReply: string;
      syncError: string;
    };

export function assessClientInviteEligibility(
  email: string | null | undefined,
): ClientInviteEligibility {
  if (!hasInviteSuitableEmail(email)) {
    return {
      dashboardMessage:
        "This client needs a valid email before the session can sync Google Calendar invites.",
      kind: "ineligible",
      smsBookReply:
        "I can't book that yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
      smsRescheduleReply:
        "I can't move that session yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
      syncError:
        "Client email must be present and valid for Google Calendar invites.",
    };
  }

  return {
    email: email.trim(),
    kind: "eligible",
  };
}
