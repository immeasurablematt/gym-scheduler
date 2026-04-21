import {
  BLOCKED_SCHEDULING_REPLY,
  createAwaitingTrainerApprovalPatch,
  createOrResumeIntakeLead as createOrResumeIntakeLeadHelper,
  getBlockedSchedulingReply,
  persistValidatedLeadUpdates as persistValidatedLeadUpdatesHelper,
} from "./intake-leads.ts";
import {
  getNextIntakeConversationState,
  isLeadReadyForTrainerApproval,
} from "./intake-state.ts";
import {
  promoteApprovedLead as promoteApprovedLeadHelper,
} from "./lead-promotion.ts";
import { normalizePhoneNumber } from "./phone.ts";
import { runReceptionistAgent as runReceptionistAgentHelper } from "./receptionist-agent.ts";
import {
  handleTrainerApprovalDecision as handleTrainerApprovalDecisionHelper,
  prepareTrainerApprovalRequest as prepareTrainerApprovalRequestHelper,
} from "./trainer-approval.ts";
import { resolveTrainerName } from "./trainer-match.ts";
import type { TwilioFormPostParams } from "./twilio-webhook-primitives.ts";
type KnownClientContext = {
  client: {
    id: string;
    trainer_id: string | null;
  };
  clientUser: {
    id: string;
    phone_number: string | null;
  };
  normalizedPhone: string;
  trainer: {
    id: string;
    user_id: string;
  };
  trainerUser: {
    id: string;
    phone_number: string | null;
  } | null;
};

type TrainerPhoneActor = {
  id: string;
  name: string;
  normalizedPhone: string;
};

type PhoneActor =
  | {
      kind: "known_client";
      value: KnownClientContext;
    }
  | {
      kind: "trainer";
      trainer: TrainerPhoneActor;
    }
  | {
      kind: "missing_client";
      clientUser: {
        id: string;
        phone_number: string | null;
      };
      normalizedPhone: string;
    }
  | {
      kind: "missing_trainer";
      client: {
        id: string;
      };
      normalizedPhone: string;
    }
  | {
      kind: "unknown_sender";
      normalizedPhone: string | null;
    };

type IntakeLeadRecord = {
  id: string;
  raw_phone: string;
  normalized_phone: string;
  requested_trainer_name_raw: string | null;
  requested_trainer_id: string | null;
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

type TrainerCandidate = {
  id: string;
  name: string;
  aliases?: readonly string[] | null;
};

type TranscriptTurn = {
  body: string;
  direction: "inbound" | "outbound";
};

type OutboundSmsPlan = {
  body: string;
  toPhone: string;
  clientId?: string | null;
  trainerId?: string | null;
  offerSetId?: string | null;
};

type InboundSmsPlan = {
  messages: OutboundSmsPlan[];
};

type TrainerDecisionResult =
  | { kind: "invalid_command" }
  | { kind: "unknown_code"; requestCode: string }
  | { kind: "expired_request"; requestCode: string }
  | {
      kind: "already_decided";
      requestCode: string;
      status: "approved" | "rejected" | "expired";
    }
  | {
      kind: "approved" | "rejected";
      request: {
        id: string;
        lead_id: string;
        trainer_id: string;
        request_code: string;
      };
      lead: IntakeLeadRecord;
    };

type PromotionResult =
  | {
      kind: "promoted";
      user: {
        id: string;
        full_name: string;
        phone_number: string | null;
      };
      client: {
        id: string;
        trainer_id: string | null;
      };
      lead: IntakeLeadRecord;
    }
  | {
      kind: "needs_manual_review";
      reason: "duplicate_identity_conflict";
      clientReply: string;
      lead: IntakeLeadRecord;
    };

type KnownClientReply = {
  body: string;
  offerSetId: string | null;
};

type RouteInboundSmsDeps = {
  resolvePhoneActorByPhone(rawPhone: string): Promise<PhoneActor>;
  findActiveIntakeLeadByPhone(normalizedPhone: string): Promise<IntakeLeadRecord | null>;
  buildKnownClientReply(input: {
    body: string;
    context: KnownClientContext;
    inboundMessageId: string;
  }): Promise<KnownClientReply>;
  continueIntakeConversation(input: {
    body: string;
    fromPhone: string;
    inboundMessageId: string;
    lead: IntakeLeadRecord | null;
  }): Promise<InboundSmsPlan>;
  buildTrainerApprovalConversation(input: {
    body: string;
    fromPhone: string;
    inboundMessageId: string;
  }): Promise<InboundSmsPlan>;
};

type ContinueIntakeConversationDeps = {
  createOrResumeIntakeLead(input: {
    rawPhone: string;
  }): Promise<
    | { kind: "created"; lead: IntakeLeadRecord }
    | { kind: "resumed"; lead: IntakeLeadRecord }
  >;
  listTrainerCandidates(): Promise<TrainerCandidate[]>;
  listRecentTranscriptByPhone(normalizedPhone: string): Promise<TranscriptTurn[]>;
  runReceptionistAgent(input: {
    allowed_trainers: readonly TrainerCandidate[];
    collected_fields: readonly string[];
    lead_snapshot: {
      client_name?: string | null;
      email?: string | null;
      requested_trainer_id?: string | null;
      requested_trainer_name_raw?: string | null;
      scheduling_preferences_text?: string | null;
    };
    next_missing_field: string | null | undefined;
    recent_sms_transcript: readonly TranscriptTurn[];
  }): Promise<{
    confidence_flags: readonly string[];
    follow_up_question: string;
    needs_follow_up: boolean;
    preference_json: Record<string, unknown>;
    preference_summary: string;
    resolved_fields: Record<string, string>;
    summary_text: string;
  }>;
  persistValidatedLeadUpdates(input: {
    lead: IntakeLeadRecord;
    updates: Record<string, unknown>;
    validatedTrainer?: {
      id: string | null | undefined;
    } | null;
  }): Promise<{ lead: IntakeLeadRecord; persistedFields: string[] }>;
  prepareTrainerApprovalRequest(input: {
    lead: IntakeLeadRecord;
    expiresAt: string;
  }): Promise<
    | {
        kind: "needs_manual_review";
        reason: "trainer_unreachable";
        lead: IntakeLeadRecord;
      }
    | {
        kind: "request_created";
        request: {
          id: string;
          lead_id: string;
          trainer_id: string;
          request_code: string;
        };
        lead: IntakeLeadRecord;
        trainerPhone: string;
        summary: string;
      }
  >;
};

type TrainerApprovalConversationDeps = {
  handleTrainerApprovalDecision(input: {
    commandText: string;
    senderPhone: string;
    decidedAt: string;
    decisionMessageId: string;
  }): Promise<TrainerDecisionResult>;
  promoteApprovedLead(input: {
    lead: IntakeLeadRecord;
  }): Promise<PromotionResult>;
};

export async function handleInboundTwilioWebhook(params: TwilioFormPostParams) {
  const fromPhone = params.From?.trim() ?? "";
  const toPhone = params.To?.trim() ?? "";
  const body = params.Body?.trim() ?? "";
  const messageSid = params.MessageSid?.trim() ?? "";
  const normalizedFromPhone = normalizePhoneNumber(fromPhone) ?? fromPhone;
  const normalizedToPhone = normalizePhoneNumber(toPhone) ?? toPhone;
  const routeDeps = createDefaultRouteDeps();
  const { logSmsMessage } = await import("./message-log.ts");
  const { sendTwilioSms } = await import("./twilio-sender.ts");
  const { expireOfferSet } = await import("@/lib/sms/offer-service");
  const phoneActor = await routeDeps.resolvePhoneActorByPhone(fromPhone);
  const inboundMessage = await logSmsMessage({
    account_sid: params.AccountSid?.trim() || null,
    body,
    client_id: getInboundClientId(phoneActor),
    direction: "inbound",
    from_phone: fromPhone,
    message_sid: messageSid || null,
    normalized_from_phone: normalizedFromPhone,
    normalized_to_phone: normalizedToPhone,
    provider: "twilio",
    status: "received",
    to_phone: toPhone,
    trainer_id: getInboundTrainerId(phoneActor),
  });

  try {
    const plan = await routeInboundSmsMessage(
      {
        body,
        fromPhone,
        toPhone,
        inboundMessageId: inboundMessage.id,
        phoneActor,
      },
      routeDeps,
    );

    for (const message of plan.messages) {
      try {
        await sendTwilioSms({
          body: message.body,
          clientId: message.clientId ?? null,
          offerSetId: message.offerSetId ?? null,
          toPhone: message.toPhone,
          trainerId: message.trainerId ?? null,
        });
      } catch (error) {
        if (message.offerSetId) {
          await expireOfferSet(message.offerSetId);
        }

        throw error;
      }
    }

    if (messageSid) {
      await markWebhookEvent(messageSid, normalizedFromPhone, "processed");
    }
  } catch (error) {
    if (messageSid) {
      await markWebhookEvent(
        messageSid,
        normalizedFromPhone,
        "failed",
        error instanceof Error ? error.message : "Unexpected SMS processing failure.",
      );
    }

    throw error;
  }
}

export async function routeInboundSmsMessage(
  input: {
    body: string;
    fromPhone: string;
    toPhone: string;
    inboundMessageId: string;
    phoneActor?: PhoneActor;
  },
  deps?: Partial<RouteInboundSmsDeps>,
): Promise<InboundSmsPlan> {
  const mergedDeps = {
    ...createDefaultRouteDeps(),
    ...deps,
  } satisfies RouteInboundSmsDeps;
  const phoneActor =
    input.phoneActor ?? (await mergedDeps.resolvePhoneActorByPhone(input.fromPhone));

  if (phoneActor.kind === "known_client") {
    const reply = await mergedDeps.buildKnownClientReply({
      body: input.body,
      context: phoneActor.value,
      inboundMessageId: input.inboundMessageId,
    });
    return {
      messages: [
        {
          body: reply.body,
          clientId: phoneActor.value.client.id,
          offerSetId: reply.offerSetId,
          toPhone: input.fromPhone,
          trainerId: phoneActor.value.trainer.id,
        },
      ],
    };
  }

  const normalizedFromPhone = normalizePhoneNumber(input.fromPhone);

  if (normalizedFromPhone) {
    const activeLead = await mergedDeps.findActiveIntakeLeadByPhone(
      normalizedFromPhone,
    );

    if (activeLead) {
      return mergedDeps.continueIntakeConversation({
        body: input.body,
        fromPhone: input.fromPhone,
        inboundMessageId: input.inboundMessageId,
        lead: activeLead,
      });
    }
  }

  if (phoneActor.kind === "trainer") {
    return mergedDeps.buildTrainerApprovalConversation({
      body: input.body,
      fromPhone: input.fromPhone,
      inboundMessageId: input.inboundMessageId,
    });
  }

  if (phoneActor.kind === "missing_trainer") {
    return {
      messages: [
        {
          body: "I found your client profile, but it isn't linked to a trainer yet. Please contact the gym so we can finish setup.",
          toPhone: input.fromPhone,
        },
      ],
    };
  }

  if (phoneActor.kind === "missing_client") {
    return {
      messages: [
        {
          body: "I couldn't match this phone number to an existing client profile. Ask your trainer to update your phone number, then try again.",
          toPhone: input.fromPhone,
        },
      ],
    };
  }

  return mergedDeps.continueIntakeConversation({
    body: input.body,
    fromPhone: input.fromPhone,
    inboundMessageId: input.inboundMessageId,
    lead: null,
  });
}

export async function continueIntakeConversation(
  input: {
    body: string;
    fromPhone: string;
    inboundMessageId: string;
    lead: IntakeLeadRecord | null;
  },
  deps?: Partial<ContinueIntakeConversationDeps>,
): Promise<InboundSmsPlan> {
  const mergedDeps = {
    ...createDefaultContinueIntakeDeps(),
    ...deps,
  } satisfies ContinueIntakeConversationDeps;
  const leadRecord =
    input.lead ??
    (await mergedDeps.createOrResumeIntakeLead({
      rawPhone: input.fromPhone,
    })).lead;

  if (
    leadRecord.status === "awaiting_trainer_approval" ||
    leadRecord.conversation_state === "awaiting_trainer_reply"
  ) {
    return {
      messages: [
        {
          body:
            looksLikeExplicitSchedulingRequest(input.body)
              ? BLOCKED_SCHEDULING_REPLY
              : "I've already reached out to your trainer. Once they reply, I can help with scheduling by text.",
          toPhone: input.fromPhone,
        },
      ],
    };
  }

  const trainers = await mergedDeps.listTrainerCandidates();
  const transcript = await mergedDeps.listRecentTranscriptByPhone(
    leadRecord.normalized_phone,
  );
  const nextConversationState = getNextIntakeConversationState(leadRecord);
  const agentOutput = await mergedDeps.runReceptionistAgent({
    allowed_trainers: trainers,
    collected_fields: getCollectedFields(leadRecord),
    lead_snapshot: leadRecord,
    next_missing_field: mapConversationStateToField(nextConversationState),
    recent_sms_transcript: transcript,
  });
  const fallbackResolvedFields = buildFallbackResolvedFields(
    nextConversationState,
    input.body,
    agentOutput.preference_summary,
  );
  const updates: Record<string, unknown> = {
    ...fallbackResolvedFields,
    ...agentOutput.resolved_fields,
  };
  const preferenceSummary = normalizeOptionalText(agentOutput.preference_summary);

  if (!updates.scheduling_preferences_text && preferenceSummary) {
    updates.scheduling_preferences_text = preferenceSummary;
  }

  if (Object.keys(agentOutput.preference_json).length > 0) {
    updates.scheduling_preferences_json = agentOutput.preference_json;
  }

  const trainerNameRaw = normalizeOptionalText(
    updates.requested_trainer_name_raw ?? leadRecord.requested_trainer_name_raw,
  );
  const explicitTrainerAttempt =
    Boolean(agentOutput.resolved_fields.requested_trainer_name_raw) ||
    input.lead !== null;
  const trainerMatch = trainerNameRaw
    ? resolveTrainerName(trainerNameRaw, trainers)
    : null;
  const persisted = await mergedDeps.persistValidatedLeadUpdates({
    lead: leadRecord,
    updates,
    validatedTrainer:
      trainerMatch?.kind === "resolved"
        ? {
            id: trainerMatch.trainer.id,
          }
        : null,
  });
  const updatedLead = persisted.lead;

  if (
    trainerNameRaw &&
    explicitTrainerAttempt &&
    !updatedLead.requested_trainer_id &&
    trainerMatch?.kind === "ambiguous"
  ) {
    return {
      messages: [
        {
          body: buildAmbiguousTrainerMessage(trainerMatch.matches),
          toPhone: input.fromPhone,
        },
      ],
    };
  }

  if (
    trainerNameRaw &&
    explicitTrainerAttempt &&
    !updatedLead.requested_trainer_id &&
    trainerMatch?.kind === "unknown"
  ) {
    return {
      messages: [
        {
          body: "I couldn't match that trainer name yet. Which trainer would you like to work with?",
          toPhone: input.fromPhone,
        },
      ],
    };
  }

  if (
    updatedLead.status === "collecting_info" &&
    isLeadReadyForTrainerApproval(updatedLead)
  ) {
    const approval = await mergedDeps.prepareTrainerApprovalRequest({
      lead: updatedLead,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    if (approval.kind === "needs_manual_review") {
      return {
        messages: [
          {
            body: "Thanks. I need to follow up manually before I can finish setup.",
            toPhone: input.fromPhone,
          },
        ],
      };
    }

    return {
      messages: [
        {
          body: approval.summary,
          toPhone: approval.trainerPhone,
          trainerId: approval.request.trainer_id,
        },
        {
          body: "Thanks. I've asked your trainer to approve your setup. Once they reply, I can help with scheduling by text.",
          toPhone: input.fromPhone,
          trainerId: approval.request.trainer_id,
        },
      ],
    };
  }

  if (looksLikeExplicitSchedulingRequest(input.body)) {
    return {
      messages: [
        {
          body: getBlockedSchedulingReply(updatedLead) ?? BLOCKED_SCHEDULING_REPLY,
          toPhone: input.fromPhone,
        },
      ],
    };
  }

  return {
    messages: [
      {
        body: buildFollowUpQuestion(updatedLead, agentOutput.follow_up_question),
        toPhone: input.fromPhone,
      },
    ],
  };
}

export async function buildTrainerApprovalConversation(
  input: {
    body: string;
    fromPhone: string;
    inboundMessageId: string;
  },
  deps?: Partial<TrainerApprovalConversationDeps>,
): Promise<InboundSmsPlan> {
  const mergedDeps = {
    ...createDefaultTrainerApprovalDeps(),
    ...deps,
  } satisfies TrainerApprovalConversationDeps;
  const decision = await mergedDeps.handleTrainerApprovalDecision({
    commandText: input.body,
    senderPhone: input.fromPhone,
    decidedAt: new Date().toISOString(),
    decisionMessageId: input.inboundMessageId,
  });

  switch (decision.kind) {
    case "invalid_command":
      return {
        messages: [
          {
            body: "Please reply APPROVE <code> or REJECT <code> with the approval code from the lead summary.",
            toPhone: input.fromPhone,
          },
        ],
      };
    case "unknown_code":
      return {
        messages: [
          {
            body: `I couldn't find approval code ${decision.requestCode}. Please reply with the exact code from the lead summary.`,
            toPhone: input.fromPhone,
          },
        ],
      };
    case "expired_request":
      return {
        messages: [
          {
            body: `Approval code ${decision.requestCode} has expired. Please follow up with the client directly.`,
            toPhone: input.fromPhone,
          },
        ],
      };
    case "already_decided":
      return {
        messages: [
          {
            body: `Approval code ${decision.requestCode} was already ${decision.status}.`,
            toPhone: input.fromPhone,
          },
        ],
      };
    case "rejected":
      return {
        messages: [
          {
            body: `Rejected ${decision.lead.client_name ?? "this lead"}. I'll let them know.`,
            toPhone: input.fromPhone,
            trainerId: decision.request.trainer_id,
          },
          {
            body: "Your trainer can't take this request by text right now. Please follow up with the gym directly.",
            toPhone: getLeadReplyPhone(decision.lead),
            trainerId: decision.request.trainer_id,
          },
        ],
      };
    case "approved": {
      const promotion = await mergedDeps.promoteApprovedLead({
        lead: decision.lead,
      });

      if (promotion.kind === "needs_manual_review") {
        return {
          messages: [
            {
              body: "Approved. I hit a setup conflict, so I'll follow up manually.",
              toPhone: input.fromPhone,
              trainerId: decision.request.trainer_id,
            },
            {
              body: promotion.clientReply,
              toPhone: getLeadReplyPhone(decision.lead),
              trainerId: decision.request.trainer_id,
            },
          ],
        };
      }

      return {
        messages: [
          {
            body: `Approved ${promotion.user.full_name}. They can now use SMS scheduling.`,
            toPhone: input.fromPhone,
            trainerId: decision.request.trainer_id,
          },
          {
            body: "You're all set. You can now text me for availability and booking.",
            clientId: promotion.client.id,
            toPhone:
              promotion.user.phone_number ??
              getLeadReplyPhone(promotion.lead),
            trainerId: promotion.client.trainer_id,
          },
        ],
      };
    }
  }
}

function createDefaultRouteDeps(): RouteInboundSmsDeps {
  return {
    resolvePhoneActorByPhone: resolvePhoneActorByPhoneDefault,
    findActiveIntakeLeadByPhone: findActiveIntakeLeadByPhoneDefault,
    buildKnownClientReply: buildKnownClientReplyDefault,
    continueIntakeConversation: (input) => continueIntakeConversation(input),
    buildTrainerApprovalConversation: (input) =>
      buildTrainerApprovalConversation(input),
  };
}

function createDefaultContinueIntakeDeps(): ContinueIntakeConversationDeps {
  return {
    async createOrResumeIntakeLead(input) {
      return createOrResumeIntakeLeadHelper(
        {
          async findActiveLeadByNormalizedPhone(normalizedPhone) {
            return findActiveIntakeLeadByPhoneDefault(normalizedPhone);
          },
          async createLead(insert) {
            const supabase = await getSupabaseClient();
            const { data, error } = await supabase
              .from("sms_intake_leads")
              .insert(insert)
              .select("*")
              .single();

            if (error) {
              throw new Error(error.message);
            }

            return data as unknown as IntakeLeadRecord;
          },
        },
        input,
      );
    },
    listTrainerCandidates: listTrainerCandidatesDefault,
    listRecentTranscriptByPhone: listRecentTranscriptByPhoneDefault,
    runReceptionistAgent: (input) => runReceptionistAgentHelper(input),
    async persistValidatedLeadUpdates(input) {
      return persistValidatedLeadUpdatesHelper(
        {
          async updateLead(leadId, patch) {
            return updateIntakeLead(leadId, {
              ...patch,
              last_inbound_message_id:
                patch.last_inbound_message_id ?? input.lead.last_inbound_message_id,
            });
          },
        },
        input,
      );
    },
    async prepareTrainerApprovalRequest(input) {
      return prepareTrainerApprovalRequestHelper(
        {
          getTrainerContact: getTrainerContactById,
          async createApprovalRequestWithLeadUpdate(requestInput) {
            const supabase = await getSupabaseClient();
            const { data: requestData, error: requestError } = await supabase
              .from("sms_trainer_approval_requests")
              .insert({
                lead_id: requestInput.lead_id,
                trainer_id: requestInput.trainer_id,
                request_code: requestInput.request_code,
                expires_at: requestInput.expires_at,
              })
              .select("*")
              .single();

            if (requestError) {
              throw new Error(requestError.message);
            }

            try {
              const lead = await updateIntakeLead(
                requestInput.lead_id,
                createAwaitingTrainerApprovalPatch(requestInput.summary_for_trainer),
              );

              return {
                request: requestData as unknown as {
                  id: string;
                  lead_id: string;
                  trainer_id: string;
                  request_code: string;
                },
                lead,
              };
            } catch (error) {
              await supabase
                .from("sms_trainer_approval_requests")
                .delete()
                .eq("id", requestData.id);

              throw error;
            }
          },
          updateLead: (leadId, patch) => updateIntakeLead(leadId, patch),
        },
        input,
      );
    },
  };
}

function createDefaultTrainerApprovalDeps(): TrainerApprovalConversationDeps {
  return {
    async handleTrainerApprovalDecision(input) {
      return handleTrainerApprovalDecisionHelper(
        {
          findDecisionRequest: findDecisionRequestDefault,
          async applyDecision(decisionInput) {
            const supabase = await getSupabaseClient();
            const { data: existingRequest, error: existingRequestError } =
              await supabase
                .from("sms_trainer_approval_requests")
                .select("*")
                .eq("id", decisionInput.requestId)
                .single();

            if (existingRequestError) {
              throw new Error(existingRequestError.message);
            }

            const { data: requestData, error: requestError } = await supabase
              .from("sms_trainer_approval_requests")
              .update({
                status: decisionInput.decision,
                decided_at: decisionInput.decidedAt,
                decision_message_id: decisionInput.decisionMessageId,
              })
              .eq("id", decisionInput.requestId)
              .select("*")
              .single();

            if (requestError) {
              throw new Error(requestError.message);
            }

            try {
              const lead = await updateIntakeLead(decisionInput.leadId, {
                status: decisionInput.decision,
              });

              return {
                request: requestData as unknown as {
                  id: string;
                  lead_id: string;
                  trainer_id: string;
                  request_code: string;
                },
                lead,
              };
            } catch (error) {
              await supabase
                .from("sms_trainer_approval_requests")
                .update({
                  status: existingRequest.status,
                  decided_at: existingRequest.decided_at,
                  decision_message_id: existingRequest.decision_message_id,
                })
                .eq("id", decisionInput.requestId);

              throw error;
            }
          },
        },
        input,
      ) as Promise<TrainerDecisionResult>;
    },
    async promoteApprovedLead(input) {
      return promoteApprovedLeadHelper(
        {
          async promoteLeadAtomically(promotionInput) {
            const supabase = await getSupabaseClient();
            const { data: clientUsers, error: clientUsersError } = await supabase
              .from("users")
              .select("*")
              .eq("role", "client");

            if (clientUsersError) {
              throw new Error(clientUsersError.message);
            }

            const existingConflict = (clientUsers ?? []).find((candidate) => {
              const emailMatches = candidate.email === promotionInput.user.email;
              const phoneMatches =
                normalizePhoneNumber(candidate.phone_number) ===
                normalizePhoneNumber(promotionInput.user.phone_number);

              return emailMatches || phoneMatches;
            });

            if (existingConflict) {
              return {
                kind: "needs_manual_review" as const,
                reason: "duplicate_identity_conflict" as const,
                lead: await updateIntakeLead(promotionInput.lead_id, {
                  status: "needs_manual_review",
                }),
              };
            }

            const { data: userData, error: userError } = await supabase
              .from("users")
              .insert(promotionInput.user)
              .select("*")
              .single();

            if (userError) {
              throw new Error(userError.message);
            }

            try {
              const { data: clientData, error: clientError } = await supabase
                .from("clients")
                .insert({
                  user_id: userData.id,
                  trainer_id: promotionInput.client.trainer_id,
                })
                .select("*")
                .single();

              if (clientError) {
                throw new Error(clientError.message);
              }

              try {
                const lead = await updateIntakeLead(promotionInput.lead_id, {
                  approved_user_id: userData.id,
                  approved_client_id: clientData.id,
                  status: "approved",
                });

                return {
                  kind: "promoted" as const,
                  user: {
                    id: userData.id,
                    full_name: userData.full_name,
                    phone_number: userData.phone_number,
                  },
                  client: {
                    id: clientData.id,
                    trainer_id: clientData.trainer_id,
                  },
                  lead,
                };
              } catch (error) {
                await supabase.from("clients").delete().eq("id", clientData.id);
                throw error;
              }
            } catch (error) {
              await supabase.from("users").delete().eq("id", userData.id);
              throw error;
            }
          },
        },
        input,
      ) as Promise<PromotionResult>;
    },
  };
}

async function buildKnownClientReplyDefault(input: {
  body: string;
  context: KnownClientContext;
  inboundMessageId: string;
}): Promise<KnownClientReply> {
  const {
    bookRequestedSmsTime,
    bookSmsOfferSelection,
    extractOfferSelection,
    offerAvailabilityBySms,
  } = await import("@/lib/sms/booking-service");
  const { getLatestActiveSmsConversation } = await import(
    "@/lib/sms/conversation-service"
  );
  const { getLatestPendingRescheduleOfferSet } = await import(
    "@/lib/sms/offer-service"
  );
  const {
    handleRequestedRescheduleTime,
    handleSmsCancelIntent,
    handleSmsRescheduleIntent,
    maybeHandleSessionSelectionReply,
  } = await import("@/lib/sms/session-lifecycle");
  const selection = extractOfferSelection(input.body);
  const activeConversation = await getLatestActiveSmsConversation(
    input.context.client.id,
    input.context.trainer.id,
  );

  if (selection && activeConversation) {
    const reply = await maybeHandleSessionSelectionReply(
      input.context,
      selection,
      input.inboundMessageId,
      activeConversation,
    );

    if (reply?.handled) {
      return {
        body: reply.body,
        offerSetId: reply.offerSetId ?? null,
      };
    }
  }

  if (selection) {
    const outcome = await bookSmsOfferSelection(
      input.context,
      input.body,
      input.inboundMessageId,
    );

    return {
      body: outcome.replyBody,
      offerSetId: null,
    };
  }

  if (looksLikeCancellation(input.body)) {
    const outcome = await handleSmsCancelIntent(
      input.context,
      input.inboundMessageId,
    );

    return {
      body: outcome.replyBody,
      offerSetId: null,
    };
  }

  const hasActiveRescheduleTarget = Boolean(
    (
      await getLatestPendingRescheduleOfferSet(
        input.context.client.id,
        input.context.trainer.id,
      )
    )?.[0]?.target_session_id,
  );

  if (looksLikeReschedule(input.body) || hasActiveRescheduleTarget) {
    const requestedRescheduleOutcome = await handleRequestedRescheduleTime(
      input.context,
      {
        body: input.body,
        inboundMessageId: input.inboundMessageId,
      },
    );

    if (requestedRescheduleOutcome.kind !== "not_requested_time") {
      return {
        body: requestedRescheduleOutcome.replyBody,
        offerSetId:
          "offerSetId" in requestedRescheduleOutcome
            ? requestedRescheduleOutcome.offerSetId
            : null,
      };
    }
  }

  if (looksLikeReschedule(input.body)) {
    const outcome = await handleSmsRescheduleIntent(
      input.context,
      input.inboundMessageId,
    );

    return {
      body: outcome.replyBody,
      offerSetId: "offerSetId" in outcome ? outcome.offerSetId : null,
    };
  }

  const requestedTimeOutcome = await bookRequestedSmsTime(
    input.context,
    input.body,
    input.inboundMessageId,
  );

  if (requestedTimeOutcome.kind === "booked") {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: null,
    };
  }

  if (requestedTimeOutcome.kind === "offered_alternatives") {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: requestedTimeOutcome.offerSetId,
    };
  }

  if (
    requestedTimeOutcome.kind === "invalid_requested_time" ||
    requestedTimeOutcome.kind === "invite_email_required" ||
    requestedTimeOutcome.kind === "calendar_unavailable"
  ) {
    return {
      body: requestedTimeOutcome.replyBody,
      offerSetId: null,
    };
  }

  if (looksLikeAvailabilityRequest(input.body)) {
    const outcome = await offerAvailabilityBySms(
      input.context,
      input.inboundMessageId,
    );

    return {
      body: outcome.replyBody,
      offerSetId: outcome.kind === "offered_slots" ? outcome.offerSetId : null,
    };
  }

  return {
    body: "Text availability when you want a few opening times, text a specific time like Monday at 2, or reply with 1, 2, or 3 from your latest options to book one.",
    offerSetId: null,
  };
}

async function resolvePhoneActorByPhoneDefault(rawPhone: string): Promise<PhoneActor> {
  const { resolveSmsPhoneActorByPhone } = await import("./client-directory.ts");
  return resolveSmsPhoneActorByPhone(rawPhone) as Promise<PhoneActor>;
}

async function findActiveIntakeLeadByPhoneDefault(
  normalizedPhone: string,
): Promise<IntakeLeadRecord | null> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("sms_intake_leads")
    .select("*")
    .eq("normalized_phone", normalizedPhone)
    .in("status", ["collecting_info", "awaiting_trainer_approval"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as unknown as IntakeLeadRecord | null) ?? null;
}

async function listTrainerCandidatesDefault(): Promise<TrainerCandidate[]> {
  const { listSmsTrainerCandidates } = await import("./client-directory.ts");
  return listSmsTrainerCandidates() as Promise<TrainerCandidate[]>;
}

async function listRecentTranscriptByPhoneDefault(
  normalizedPhone: string,
): Promise<TranscriptTurn[]> {
  const { listRecentSmsTranscriptByPhone } = await import("./message-log.ts");
  return listRecentSmsTranscriptByPhone(normalizedPhone) as Promise<
    TranscriptTurn[]
  >;
}

async function findDecisionRequestDefault(input: {
  requestCode: string;
  senderPhone: string;
}): Promise<
  | {
      kind: "pending";
      request: {
        id: string;
        lead_id: string;
        trainer_id: string;
        request_code: string;
        status: "pending" | "approved" | "rejected" | "expired";
        decided_at: string | null;
        decision_message_id: string | null;
        expires_at: string | null;
      };
    }
  | { kind: "unknown_code" }
  | {
      kind: "expired_request";
      request: {
        id: string;
        lead_id: string;
        trainer_id: string;
        request_code: string;
        status: "pending" | "approved" | "rejected" | "expired";
        decided_at: string | null;
        decision_message_id: string | null;
        expires_at: string | null;
      };
    }
  | {
      kind: "already_decided";
      request: {
        id: string;
        lead_id: string;
        trainer_id: string;
        request_code: string;
        status: "pending" | "approved" | "rejected" | "expired";
        decided_at: string | null;
        decision_message_id: string | null;
        expires_at: string | null;
      };
    }
> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("sms_trainer_approval_requests")
    .select("*")
    .eq("request_code", input.requestCode)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(error.message);
  }

  for (const request of data ?? []) {
    const trainerContact = await getTrainerContactById(request.trainer_id);

    if (
      !trainerContact ||
      normalizePhoneNumber(trainerContact.phone_number) !== input.senderPhone
    ) {
      continue;
    }

    if (request.status === "approved" || request.status === "rejected") {
      return {
        kind: "already_decided",
        request: request as unknown as {
          id: string;
          lead_id: string;
          trainer_id: string;
          request_code: string;
          status: "pending" | "approved" | "rejected" | "expired";
          decided_at: string | null;
          decision_message_id: string | null;
          expires_at: string | null;
        },
      };
    }

    const isExpired =
      request.status === "expired" ||
      (request.expires_at ? new Date(request.expires_at).getTime() <= Date.now() : false);

    if (isExpired) {
      return {
        kind: "expired_request",
        request: request as unknown as {
          id: string;
          lead_id: string;
          trainer_id: string;
          request_code: string;
          status: "pending" | "approved" | "rejected" | "expired";
          decided_at: string | null;
          decision_message_id: string | null;
          expires_at: string | null;
        },
      };
    }

    return {
      kind: "pending",
      request: request as unknown as {
        id: string;
        lead_id: string;
        trainer_id: string;
        request_code: string;
        status: "pending" | "approved" | "rejected" | "expired";
        decided_at: string | null;
        decision_message_id: string | null;
        expires_at: string | null;
      },
    };
  }

  return {
    kind: "unknown_code",
  };
}

async function getTrainerContactById(trainerId: string): Promise<{
  trainer_id: string;
  trainer_name: string | null;
  phone_number: string | null;
} | null> {
  const supabase = await getSupabaseClient();
  const { data: trainer, error: trainerError } = await supabase
    .from("trainers")
    .select("*")
    .eq("id", trainerId)
    .maybeSingle();

  if (trainerError) {
    throw new Error(trainerError.message);
  }

  if (!trainer) {
    return null;
  }

  const { data: trainerUser, error: trainerUserError } = await supabase
    .from("users")
    .select("*")
    .eq("id", trainer.user_id)
    .maybeSingle();

  if (trainerUserError) {
    throw new Error(trainerUserError.message);
  }

  return {
    trainer_id: trainer.id,
    trainer_name: trainerUser?.full_name ?? null,
    phone_number: trainerUser?.phone_number ?? null,
  };
}

async function updateIntakeLead(
  leadId: string,
  patch: Partial<IntakeLeadRecord>,
): Promise<IntakeLeadRecord> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from("sms_intake_leads")
    .update(patch)
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as unknown as IntakeLeadRecord;
}

async function getSupabaseClient() {
  const { createServerSupabaseClient } = await import("@/lib/supabase/server");
  return createServerSupabaseClient();
}

function buildFollowUpQuestion(
  lead: IntakeLeadRecord,
  fallbackQuestion: string,
): string {
  switch (getNextIntakeConversationState(lead)) {
    case "needs_trainer":
      return "Which trainer would you like to work with?";
    case "needs_name":
      return "What is your full name?";
    case "needs_email":
      return "What is the best email address to reach you at?";
    case "needs_preferences":
      return "When are you usually available to train?";
    case "awaiting_trainer_reply":
      return "I've already reached out to your trainer. Once they reply, I can help with scheduling by text.";
    case "ready_for_approval":
      return fallbackQuestion;
    default:
      return fallbackQuestion;
  }
}

function buildFallbackResolvedFields(
  conversationState: IntakeLeadRecord["conversation_state"],
  body: string,
  preferenceSummary: string,
) {
  switch (conversationState) {
    case "needs_trainer":
      return {
        requested_trainer_name_raw: body,
      };
    case "needs_name":
      return {
        client_name: body,
      };
    case "needs_email":
      return {
        email: body,
      };
    case "needs_preferences":
      return {
        scheduling_preferences_text: preferenceSummary || body,
      };
    default:
      return {};
  }
}

function buildAmbiguousTrainerMessage(matches: TrainerCandidate[]) {
  const names = matches.map((match) => match.name).join(", ");
  return `I found a few trainers that match that name: ${names}. Which trainer would you like to work with?`;
}

function getCollectedFields(lead: IntakeLeadRecord) {
  const fields: string[] = [];

  if (lead.requested_trainer_id) {
    fields.push("requested_trainer_id");
  }

  if (lead.client_name?.trim()) {
    fields.push("client_name");
  }

  if (lead.email?.trim()) {
    fields.push("email");
  }

  if (lead.scheduling_preferences_text?.trim()) {
    fields.push("scheduling_preferences_text");
  }

  return fields;
}

function mapConversationStateToField(
  conversationState: IntakeLeadRecord["conversation_state"],
) {
  switch (conversationState) {
    case "needs_trainer":
      return "requested_trainer_id";
    case "needs_name":
      return "client_name";
    case "needs_email":
      return "email";
    case "needs_preferences":
      return "scheduling_preferences_text";
    default:
      return null;
  }
}

function getLeadReplyPhone(lead: IntakeLeadRecord) {
  return lead.raw_phone || lead.normalized_phone;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getInboundClientId(phoneActor: PhoneActor): string | null {
  if (phoneActor.kind === "known_client") {
    return phoneActor.value.client.id;
  }

  if (phoneActor.kind === "missing_trainer") {
    return phoneActor.client.id;
  }

  return null;
}

function getInboundTrainerId(phoneActor: PhoneActor): string | null {
  if (phoneActor.kind === "known_client") {
    return phoneActor.value.trainer.id;
  }

  if (phoneActor.kind === "trainer") {
    return phoneActor.trainer.id;
  }

  return null;
}

function looksLikeAvailabilityRequest(body: string) {
  const normalized = body.trim().toLowerCase();

  if (normalized.length === 0) {
    return false;
  }

  return /\b(book|booking|schedule|session|appointment|available|availability|slot|open|when|time|day|today|tomorrow|week|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
    normalized,
  );
}

function looksLikeReschedule(body: string) {
  const normalized = body.trim().toLowerCase();
  return /\b(reschedule|move|change|another time|different time|can't make it|cant make it|need to move|later|earlier)\b/.test(
    normalized,
  );
}

function looksLikeCancellation(body: string) {
  const normalized = body.trim().toLowerCase();
  return /\b(cancel|cxl|call it off|skip it|drop it)\b/.test(normalized);
}

function looksLikeExplicitSchedulingRequest(body: string) {
  const normalized = body.trim().toLowerCase();

  if (/^\s*[1-3]\s*$/.test(normalized)) {
    return true;
  }

  return (
    looksLikeAvailabilityRequest(body) ||
    looksLikeReschedule(body) ||
    looksLikeCancellation(body) ||
    /\b(book|booking)\b/.test(normalized)
  );
}

async function markWebhookEvent(
  eventKey: string,
  fromPhone: string,
  status: "processed" | "failed",
  errorMessage?: string,
) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase
    .from("sms_webhook_idempotency")
    .update({
      error_message: errorMessage ?? null,
      from_phone: fromPhone,
      processed_at: new Date().toISOString(),
      status,
    })
    .eq("provider", "twilio")
    .eq("event_key", eventKey);

  if (error) {
    throw new Error(error.message);
  }
}
