import { randomUUID } from "node:crypto";

type SmsIntakeLeadRecord = {
  id: string;
  normalized_phone: string;
  requested_trainer_id: string | null;
  client_name: string | null;
  email: string | null;
  status:
    | "collecting_info"
    | "awaiting_trainer_approval"
    | "approved"
    | "rejected"
    | "expired"
    | "needs_manual_review";
  approved_user_id?: string | null;
  approved_client_id?: string | null;
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

type LeadPromotionRepo = {
  findUserIdentityConflict(identity: {
    email: string;
    normalizedPhone: string;
  }): Promise<unknown | null>;
  createUser(input: UserRecord): Promise<UserRecord>;
  createClient(input: {
    user_id: string;
    trainer_id: string | null;
  }): Promise<ClientRecord>;
  updateLead(
    leadId: string,
    patch: Partial<SmsIntakeLeadRecord>,
  ): Promise<SmsIntakeLeadRecord>;
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
      user: UserRecord;
      client: ClientRecord;
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

  const conflict = await repo.findUserIdentityConflict({
    email,
    normalizedPhone: input.lead.normalized_phone,
  });

  if (conflict) {
    const lead = await repo.updateLead(input.lead.id, {
      status: "needs_manual_review",
    });

    return {
      kind: "needs_manual_review",
      reason: "duplicate_identity_conflict",
      clientReply: SETUP_DELAY_REPLY,
      lead,
    };
  }

  const userId = `sms-client-${(input.createUuid ?? randomUUID)()}`;
  const user = await repo.createUser({
    id: userId,
    email,
    full_name: fullName,
    role: "client",
    phone_number: input.lead.normalized_phone,
  });
  const client = await repo.createClient({
    user_id: user.id,
    trainer_id: input.lead.requested_trainer_id,
  });
  const lead = await repo.updateLead(input.lead.id, {
    approved_user_id: user.id,
    approved_client_id: client.id,
    status: "approved",
  });

  return {
    kind: "promoted",
    user,
    client,
    lead,
  };
}
