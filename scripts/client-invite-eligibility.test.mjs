import assert from "node:assert/strict";
import test from "node:test";

test("assessClientInviteEligibility returns dashboard and SMS messages for invalid email", async () => {
  const { assessClientInviteEligibility } = await import("../lib/google/client-invite-eligibility.ts");

  const result = assessClientInviteEligibility("not-an-email");

  assert.deepEqual(result, {
    dashboardMessage:
      "This client needs a valid email before the session can sync Google Calendar invites.",
    kind: "ineligible",
    smsBookReply:
      "I can't book that yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
    smsRescheduleReply:
      "I can't move that session yet because your account needs a valid email for calendar invites. Please contact the gym so we can fix it.",
    syncError:
      "Client email must be present and valid for Google Calendar invites.",
  });
});

test("assessClientInviteEligibility returns eligible for valid email", async () => {
  const { assessClientInviteEligibility } = await import("../lib/google/client-invite-eligibility.ts");

  assert.deepEqual(assessClientInviteEligibility("client@example.com"), {
    email: "client@example.com",
    kind: "eligible",
  });
});
