import { randomUUID } from "node:crypto";

type SmsIntakeLeadRecord = {
  id: string;
  raw_phone: string;
  normalized_phone: string;
  requested_trainer_id: string | null;
  requested_trainer_name_raw: string | null;
  client_name: string | null;
  email: string | null;
  scheduling_preferences_text: string | null;
  scheduling_preferences_json: Record<string, unknown>;
  status:
    | "collecting_info"
    | "awaiting_trainer_approval"
    | "approved"
    | "rejected"
    | "expired"
    | "needs_manual_review";
  conversation_state:
    | "needs_trainer"
    | "needs_name"
    | "needs_email"
    | "needs_preferences"
    | "ready_for_approval"
    | "awaiting_trainer_reply";
  summary_for_trainer: string | null;
  last_inbound_message_id: string | null;
  last_outbound_message_id: string | null;
  approved_user_id: string | null;
  approved_client_id: string | null;
  created_at: string;
  updated_at: string;
};

type UserRecord = {
  id: string;
  email: string;
  full_name: string;
  role: "trainer" | "client" | "admin";
  phone_number: string | null;
};

type ClientRecord = {
  id: string;
  user_id: string;
  trainer_id: string | null;
};

type PromotedUserRecord = Pick<UserRecord, "id" | "full_name" | "phone_number">;
type PromotedClientRecord = Pick<ClientRecord, "id" | "trainer_id">;

type LeadPromotionRepo = {
  promoteLeadAtomically(input: {
    lead_id: string;
    user: UserRecord;
    client: {
      trainer_id: string | null;
    };
  }): Promise<
    | {
        kind: "promoted";
        user: PromotedUserRecord;
        client: PromotedClientRecord;
        lead: SmsIntakeLeadRecord;
      }
    | {
        kind: "needs_manual_review";
        reason: "duplicate_identity_conflict";
        lead: SmsIntakeLeadRecord;
      }
  >;
};

export const SETUP_DELAY_REPLY =
  "Your setup is taking a little longer than expected. We'll follow up shortly.";

export async function promoteApprovedLead(
  repo: LeadPromotionRepo,
  input: {
    lead: SmsIntakeLeadRecord;
    createUuid?: () => string;
  },
): Promise<
  | {
      kind: "promoted";
      user: PromotedUserRecord;
      client: PromotedClientRecord;
      lead: SmsIntakeLeadRecord;
    }
  | {
      kind: "needs_manual_review";
      reason: "duplicate_identity_conflict";
      clientReply: string;
      lead: SmsIntakeLeadRecord;
    }
> {
  if (input.lead.status !== "approved") {
    throw new Error("Only approved intake leads can be promoted");
  }

  const email = input.lead.email?.trim();
  const fullName = input.lead.client_name?.trim();

  if (!email || !fullName) {
    throw new Error("Approved intake leads must include client identity details");
  }

  const userId = `sms-client-${(input.createUuid ?? randomUUID)()}`;
  const outcome = await repo.promoteLeadAtomically({
    lead_id: input.lead.id,
    user: {
      id: userId,
      email,
      full_name: fullName,
      role: "client",
      phone_number: input.lead.normalized_phone,
    },
    client: {
      trainer_id: input.lead.requested_trainer_id,
    },
  });

  if (outcome.kind === "needs_manual_review") {
    return {
      ...outcome,
      clientReply: SETUP_DELAY_REPLY,
    };
  }

  return outcome;
}
