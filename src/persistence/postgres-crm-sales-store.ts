import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  assertCrmVersion,
  normalizeCrmChannelProvider,
  normalizeCrmChannelValue,
  normalizeCrmTimestamp,
  nullableCrmText,
  requireCrmEvidence,
  requireCrmText,
  validateCrmScope,
  type CrmMutationMetadata,
  type CrmScope,
} from '../crm/crm-records.js';
import {
  assertSalesPipelineTransition,
  calculateInitialSla,
  type AppendMessageInput,
  type AppendSalesActivityInput,
  type ContactResolutionResult,
  type ConversationRecord,
  type CreateConversationInput,
  type CrmSalesStore,
  type LeadScoreObservation,
  type MessageRecord,
  type NextActionRecord,
  type PipelineQueryInput,
  type PipelineQueryRow,
  type PipelineStageHistoryRecord,
  type QualificationDecision,
  type QualifyLeadInput,
  type SalesActivityRecord,
  type SalesPipelineStage,
  type ScheduleNextActionInput,
  type UpdateSalesOpportunityInput,
} from '../crm/sales-engine.js';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import { appendInternalAuditLedgerEvent } from './postgres-internal-audit-ledger.js';

type CrmSalesMutationMetadata = Required<Omit<CrmMutationMetadata, 'now'>>;

interface ContactCandidateRow {
  readonly contact_id: string;
  readonly channel_id: string;
  readonly verified_at: Date | string | null;
  readonly canonical_contact_id: string | null;
}

interface ConversationRow {
  readonly conversation_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly channel: ConversationRecord['channel'];
  readonly language: string;
  readonly status: ConversationRecord['status'];
  readonly started_at: Date | string;
  readonly last_message_at: Date | string | null;
  readonly closed_at: Date | string | null;
  readonly attributes: unknown;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface MessageRow {
  readonly message_id: string;
  readonly conversation_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly direction: MessageRecord['direction'];
  readonly channel: MessageRecord['channel'];
  readonly language: string;
  readonly content_ref: string | null;
  readonly content_sha256: string;
  readonly provider_message_ref: string | null;
  readonly intent: string | null;
  readonly urgency: MessageRecord['urgency'];
  readonly occurred_at: Date | string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface ActivityRow {
  readonly activity_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly opportunity_id: string | null;
  readonly conversation_id: string | null;
  readonly activity_type: SalesActivityRecord['activityType'];
  readonly channel: SalesActivityRecord['channel'];
  readonly summary: string;
  readonly outcome: string | null;
  readonly actor_principal_id: string;
  readonly occurred_at: Date | string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface NextActionRow {
  readonly next_action_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly opportunity_id: string | null;
  readonly action_type: NextActionRecord['actionType'];
  readonly title: string;
  readonly rationale: string;
  readonly priority: NextActionRecord['priority'];
  readonly status: NextActionRecord['status'];
  readonly owner_principal_id: string | null;
  readonly playbook_key: string | null;
  readonly due_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface QualificationRow {
  readonly qualification_decision_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly lead_id: string;
  readonly decision: QualificationDecision['decision'];
  readonly authority: QualificationDecision['authority'];
  readonly rule_version: string;
  readonly deterministic_score: number | string;
  readonly ai_score: number | string | null;
  readonly rationale: string;
  readonly factors: unknown;
  readonly evidence: unknown;
  readonly decided_by_principal_id: string;
  readonly decided_at: Date | string;
  readonly created_at: Date | string;
}

interface StageRow {
  readonly stage_history_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly opportunity_id: string | null;
  readonly pipeline_key: string;
  readonly from_stage: SalesPipelineStage | null;
  readonly to_stage: SalesPipelineStage;
  readonly reason: string;
  readonly changed_by_principal_id: string;
  readonly changed_at: Date | string;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface IdempotencyRow {
  readonly request_hash: string;
  readonly response_snapshot: Readonly<Record<string, unknown>> | null;
  readonly completed_at: Date | string | null;
}

interface LeadLockRow {
  readonly lead_id: string;
  readonly contact_id: string;
  readonly status: string;
  readonly qualification: string;
  readonly owner_principal_id: string | null;
  readonly version: number;
  readonly attributes: unknown;
  readonly captured_at: Date | string;
}

interface OpportunityLockRow {
  readonly opportunity_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly pipeline_key: string;
  readonly stage_key: string;
  readonly status: string;
  readonly currency: string | null;
  readonly value_minor: number | string | null;
  readonly next_action: string | null;
  readonly next_action_at: Date | string | null;
  readonly owner_principal_id: string | null;
  readonly expected_close_at: Date | string | null;
  readonly event_id: string | null;
  readonly name: string;
  readonly closed_at: Date | string | null;
  readonly loss_reason: string | null;
  readonly attributes: unknown;
  readonly version: number;
  readonly created_at: Date | string;
}

export interface PostgresCrmSalesStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresCrmSalesStore implements CrmSalesStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresCrmSalesStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async resolveContact(
    input: CrmScope & {
      readonly channels: readonly {
        readonly channelType: 'EMAIL' | 'PHONE' | 'SOCIAL' | 'OTHER';
        readonly provider?: string | null;
        readonly value: string;
      }[];
    },
  ): Promise<ContactResolutionResult> {
    validateCrmScope(input);
    if (input.channels.length === 0 || input.channels.length > 20) {
      throw new Error('CRM_SALES_CONTACT_RESOLUTION_CHANNELS_INVALID');
    }
    const candidateMap = new Map<
      string,
      { matchedChannels: Set<string>; mergedIntoContactId: string | null; verified: boolean }
    >();
    for (const channel of input.channels) {
      const provider = normalizeCrmChannelProvider(channel.channelType, channel.provider);
      const normalized = normalizeCrmChannelValue(channel.channelType, channel.value);
      const result = await this.pool.query<ContactCandidateRow>(
        `select c.contact_id, c.channel_id, c.verified_at, m.canonical_contact_id
           from crm_contact_channels c
           left join crm_contact_merge_history m
             on m.tenant_id=c.tenant_id and m.workspace_id=c.workspace_id
            and m.organization_id=c.organization_id and m.source_contact_id=c.contact_id
          where c.tenant_id=$1 and c.workspace_id=$2 and c.organization_id=$3
            and c.channel_type=$4 and c.provider_key=coalesce($5,'') and c.normalized_value=$6
          order by c.contact_id, c.channel_id`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          channel.channelType,
          provider,
          normalized,
        ],
      );
      for (const row of result.rows) {
        const canonical = row.canonical_contact_id ?? row.contact_id;
        const existing = candidateMap.get(canonical) ?? {
          matchedChannels: new Set<string>(),
          mergedIntoContactId: row.canonical_contact_id,
          verified: false,
        };
        existing.matchedChannels.add(`${channel.channelType}:${provider ?? ''}:${normalized}`);
        existing.verified ||= row.verified_at !== null;
        candidateMap.set(canonical, existing);
      }
    }

    const candidates = [...candidateMap.entries()]
      .map(([contactId, value]) => ({
        contactId,
        matchedChannels: [...value.matchedChannels].sort(),
        mergedIntoContactId: value.mergedIntoContactId,
        verified: value.verified,
      }))
      .sort((left, right) => left.contactId.localeCompare(right.contactId));
    const evidence = candidates.map(
      (candidate) =>
        `crm:contact-match:${candidate.contactId}:${candidate.matchedChannels.length}:${candidate.verified ? 'verified' : 'unverified'}`,
    );
    if (candidates.length === 0) {
      return {
        state: 'NOT_FOUND',
        canonicalContactId: null,
        candidates: [],
        evidence: ['crm:contact-match:none'],
      };
    }
    if (candidates.length > 1) {
      return {
        state: 'AMBIGUOUS',
        canonicalContactId: null,
        candidates: candidates.map((candidate) => ({
          contactId: candidate.contactId,
          matchedChannels: candidate.matchedChannels,
          mergedIntoContactId: candidate.mergedIntoContactId,
        })),
        evidence,
      };
    }
    const only = candidates[0]!;
    return {
      state: 'RESOLVED',
      canonicalContactId: only.contactId,
      candidates: [
        {
          contactId: only.contactId,
          matchedChannels: only.matchedChannels,
          mergedIntoContactId: only.mergedIntoContactId,
        },
      ],
      evidence,
    };
  }

  async createConversation(input: CreateConversationInput): Promise<ConversationRecord> {
    validateCrmScope(input);
    const metadata = mutationMetadata(input);
    const now = normalizeNow(input.now);
    const conversationId = requireCrmText(input.conversationId, 'CRM_CONVERSATION_ID_REQUIRED');
    const contactId = requireCrmText(input.contactId, 'CRM_CONTACT_ID_REQUIRED');
    const leadId = nullableCrmText(input.leadId);
    const language = normalizeLanguage(input.language);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'sales.conversation.create',
        'CONTACT',
        contactId,
      );
      if (replay) return conversationFromSnapshot(replay);
      await assertContactExists(client, input, contactId);
      if (leadId) await assertLeadLineage(client, input, leadId, contactId);
      const inserted = await client.query<ConversationRow>(
        `insert into crm_conversations (
           conversation_id, tenant_id, workspace_id, organization_id, contact_id, lead_id,
           channel, language, status, started_at, last_message_at, closed_at, attributes,
           version, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9::timestamptz,null,null,$10::jsonb,1,$9::timestamptz,$9::timestamptz)
         returning *`,
        [
          conversationId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          contactId,
          leadId,
          input.channel,
          language,
          now,
          json(input.attributes ?? {}),
        ],
      );
      const record = conversationFromRow(
        requiredRow(inserted.rows[0], 'CRM_CONVERSATION_INSERT_FAILED'),
      );
      await recordMutation(
        client,
        this.#outbox,
        input,
        metadata,
        'CONTACT',
        contactId,
        'sales.conversation.created',
        conversationId,
        1,
        record,
        now,
      );
      await completeIdempotency(client, input, 'sales.conversation.create', contactId, record, now);
      return record;
    });
  }

  async appendMessage(input: AppendMessageInput): Promise<MessageRecord> {
    validateCrmScope(input);
    const metadata = mutationMetadata(input);
    const now = normalizeNow(input.now);
    const occurredAt = normalizeCrmTimestamp(
      input.occurredAt ?? now,
      'CRM_MESSAGE_OCCURRED_AT_INVALID',
    );
    const messageId = requireCrmText(input.messageId, 'CRM_MESSAGE_ID_REQUIRED');
    const conversationId = requireCrmText(input.conversationId, 'CRM_CONVERSATION_ID_REQUIRED');
    const contactId = requireCrmText(input.contactId, 'CRM_CONTACT_ID_REQUIRED');
    const leadId = nullableCrmText(input.leadId);
    assertSha256(input.contentSha256);
    return this.#transaction(async (client) => {
      const recordType = leadId ? 'LEAD' : 'CONTACT';
      const recordId = leadId ?? contactId;
      const replay = await beginIdempotency(
        client,
        input,
        'sales.message.append',
        recordType,
        recordId,
      );
      if (replay) return messageFromSnapshot(replay);
      await lockConversationLineage(client, input, conversationId, contactId, leadId);
      const inserted = await client.query<MessageRow>(
        `insert into crm_messages (
           message_id, conversation_id, tenant_id, workspace_id, organization_id,
           contact_id, lead_id, direction, channel, language, content_ref, content_sha256,
           provider_message_ref, intent, urgency, occurred_at, evidence, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17::jsonb,$18::timestamptz)
         returning *`,
        [
          messageId,
          conversationId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          contactId,
          leadId,
          input.direction,
          input.channel,
          normalizeLanguage(input.language),
          nullableCrmText(input.contentRef),
          input.contentSha256,
          nullableCrmText(input.providerMessageRef),
          nullableCrmText(input.intent),
          input.urgency ?? null,
          occurredAt,
          json(metadata.evidence),
          now,
        ],
      );
      const record = messageFromRow(requiredRow(inserted.rows[0], 'CRM_MESSAGE_INSERT_FAILED'));
      await client.query(
        `update crm_conversations
            set last_message_at=$5::timestamptz,
                status=case when $6='INBOUND' then 'OPEN' else 'WAITING_CUSTOMER' end,
                version=version+1, updated_at=$7::timestamptz
          where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and conversation_id=$4`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          conversationId,
          occurredAt,
          input.direction,
          now,
        ],
      );
      await recordMutation(
        client,
        this.#outbox,
        input,
        metadata,
        recordType,
        recordId,
        'sales.message.appended',
        messageId,
        1,
        record,
        now,
      );
      await completeIdempotency(client, input, 'sales.message.append', recordId, record, now);
      return record;
    });
  }

  async appendActivity(input: AppendSalesActivityInput): Promise<SalesActivityRecord> {
    validateCrmScope(input);
    const metadata = mutationMetadata(input);
    const now = normalizeNow(input.now);
    const occurredAt = normalizeCrmTimestamp(
      input.occurredAt ?? now,
      'CRM_ACTIVITY_OCCURRED_AT_INVALID',
    );
    const activityId = requireCrmText(input.activityId, 'CRM_ACTIVITY_ID_REQUIRED');
    const contactId = requireCrmText(input.contactId, 'CRM_CONTACT_ID_REQUIRED');
    const leadId = nullableCrmText(input.leadId);
    const opportunityId = nullableCrmText(input.opportunityId);
    if (!leadId && !opportunityId) throw new Error('CRM_ACTIVITY_LEAD_OR_OPPORTUNITY_REQUIRED');
    if (input.stageTransition) {
      assertSalesPipelineTransition(input.stageTransition.fromStage, input.stageTransition.toStage);
    }
    return this.#transaction(async (client) => {
      const recordType = opportunityId ? 'OPPORTUNITY' : 'LEAD';
      const recordId = opportunityId ?? leadId!;
      const replay = await beginIdempotency(
        client,
        input,
        'sales.activity.append',
        recordType,
        recordId,
      );
      if (replay) return activityFromSnapshot(replay);
      await assertContactExists(client, input, contactId);
      if (leadId) await assertLeadLineage(client, input, leadId, contactId);
      if (opportunityId)
        await assertOpportunityLineage(client, input, opportunityId, contactId, leadId);
      if (input.conversationId) {
        await lockConversationLineage(client, input, input.conversationId, contactId, leadId);
      }
      const inserted = await client.query<ActivityRow>(
        `insert into crm_sales_activities (
           activity_id, tenant_id, workspace_id, organization_id, contact_id, lead_id,
           opportunity_id, conversation_id, activity_type, channel, summary, outcome,
           actor_principal_id, occurred_at, evidence, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::jsonb,$16::timestamptz)
         returning *`,
        [
          activityId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          contactId,
          leadId,
          opportunityId,
          nullableCrmText(input.conversationId),
          input.activityType,
          input.channel ?? null,
          requireCrmText(input.summary, 'CRM_ACTIVITY_SUMMARY_REQUIRED'),
          nullableCrmText(input.outcome),
          metadata.actorPrincipalId,
          occurredAt,
          json(metadata.evidence),
          now,
        ],
      );
      const record = activityFromRow(requiredRow(inserted.rows[0], 'CRM_ACTIVITY_INSERT_FAILED'));
      if (input.stageTransition) {
        await insertStageHistory(client, input, {
          stageHistoryId: deterministicChildId('stage', activityId),
          contactId,
          leadId,
          opportunityId,
          pipelineKey: input.stageTransition.pipelineKey,
          fromStage: input.stageTransition.fromStage,
          toStage: input.stageTransition.toStage,
          reason: input.stageTransition.reason,
          metadata,
          now,
        });
      }
      if (leadId)
        await updateSlaFromActivity(client, input, leadId, input.activityType, occurredAt, now);
      await recordMutation(
        client,
        this.#outbox,
        input,
        metadata,
        recordType,
        recordId,
        'sales.activity.appended',
        activityId,
        1,
        record,
        now,
      );
      await completeIdempotency(client, input, 'sales.activity.append', recordId, record, now);
      return record;
    });
  }

  async scheduleNextAction(input: ScheduleNextActionInput): Promise<NextActionRecord> {
    validateCrmScope(input);
    const metadata = mutationMetadata(input);
    const now = normalizeNow(input.now);
    const nextActionId = requireCrmText(input.nextActionId, 'CRM_NEXT_ACTION_ID_REQUIRED');
    const contactId = requireCrmText(input.contactId, 'CRM_CONTACT_ID_REQUIRED');
    const leadId = nullableCrmText(input.leadId);
    const opportunityId = nullableCrmText(input.opportunityId);
    if (!leadId && !opportunityId) throw new Error('CRM_NEXT_ACTION_LEAD_OR_OPPORTUNITY_REQUIRED');
    const dueAt = input.dueAt
      ? normalizeCrmTimestamp(input.dueAt, 'CRM_NEXT_ACTION_DUE_AT_INVALID')
      : null;
    return this.#transaction(async (client) => {
      const recordType = opportunityId ? 'OPPORTUNITY' : 'LEAD';
      const recordId = opportunityId ?? leadId!;
      const replay = await beginIdempotency(
        client,
        input,
        'sales.next_action.schedule',
        recordType,
        recordId,
      );
      if (replay) return nextActionFromSnapshot(replay);
      await assertContactExists(client, input, contactId);
      if (leadId) await assertLeadLineage(client, input, leadId, contactId);
      if (opportunityId)
        await assertOpportunityLineage(client, input, opportunityId, contactId, leadId);
      const inserted = await client.query<NextActionRow>(
        `insert into crm_next_actions (
           next_action_id, tenant_id, workspace_id, organization_id, contact_id, lead_id,
           opportunity_id, action_type, title, rationale, priority, status,
           owner_principal_id, playbook_key, due_at, completed_at, version, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING',$12,$13,$14::timestamptz,null,1,$15::timestamptz,$15::timestamptz)
         returning *`,
        [
          nextActionId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          contactId,
          leadId,
          opportunityId,
          input.actionType,
          requireCrmText(input.title, 'CRM_NEXT_ACTION_TITLE_REQUIRED'),
          requireCrmText(input.rationale, 'CRM_NEXT_ACTION_RATIONALE_REQUIRED'),
          input.priority,
          nullableCrmText(input.ownerPrincipalId),
          nullableCrmText(input.playbookKey),
          dueAt,
          now,
        ],
      );
      const record = nextActionFromRow(
        requiredRow(inserted.rows[0], 'CRM_NEXT_ACTION_INSERT_FAILED'),
      );
      await recordMutation(
        client,
        this.#outbox,
        input,
        metadata,
        recordType,
        recordId,
        'sales.next_action.scheduled',
        nextActionId,
        1,
        record,
        now,
      );
      await completeIdempotency(client, input, 'sales.next_action.schedule', recordId, record, now);
      return record;
    });
  }

  async qualifyLead(input: QualifyLeadInput): Promise<QualificationDecision> {
    validateCrmScope(input);
    const metadata = mutationMetadata(input);
    const now = normalizeNow(input.now);
    requireCrmText(input.qualificationDecisionId, 'CRM_QUALIFICATION_DECISION_ID_REQUIRED');
    requireCrmText(input.leadScoreObservationId, 'CRM_LEAD_SCORE_OBSERVATION_ID_REQUIRED');
    requireCrmText(input.leadId, 'CRM_LEAD_ID_REQUIRED');
    requireCrmText(input.rationale, 'CRM_QUALIFICATION_RATIONALE_REQUIRED');
    requireCrmText(input.pipelineKey, 'CRM_PIPELINE_KEY_REQUIRED');
    if (input.scoring.ruleVersion.length === 0)
      throw new Error('CRM_SCORING_RULE_VERSION_REQUIRED');
    if (
      input.authority !== 'DETERMINISTIC' &&
      input.authority !== 'HUMAN' &&
      input.authority !== 'HYBRID'
    ) {
      throw new Error('CRM_QUALIFICATION_AUTHORITY_INVALID');
    }
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'sales.lead.qualify',
        'LEAD',
        input.leadId,
      );
      if (replay) return qualificationFromSnapshot(replay);
      const lead = await lockLead(client, input, input.leadId);
      const toStage = qualificationStage(input.outcome, input.fromStage);
      assertSalesPipelineTransition(input.fromStage, toStage);
      const nextVersion = lead.version + 1;
      const leadState = qualificationLeadState(input.outcome);
      const updated = await client.query(
        `update crm_leads set
           status=$5, qualification=$6, score=$7,
           qualified_at=$8::timestamptz,
           disqualified_reason=$9,
           version=$10, updated_at=$11::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4 and version=$12`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.leadId,
          leadState.status,
          leadState.qualification,
          input.scoring.effectiveScore,
          input.outcome === 'QUALIFIED' ? now : null,
          input.outcome === 'DISQUALIFIED' ? input.rationale : null,
          nextVersion,
          now,
          lead.version,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('CRM_LEAD_CONCURRENT_UPDATE');

      const observation = await insertScoreObservation(client, input, lead.contact_id, now);
      const decisionResult = await client.query<QualificationRow>(
        `insert into crm_qualification_decisions (
           qualification_decision_id, tenant_id, workspace_id, organization_id, lead_id,
           decision, authority, rule_version, deterministic_score, ai_score, rationale,
           factors, evidence, decided_by_principal_id, decided_at, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::timestamptz,$15::timestamptz)
         returning *`,
        [
          input.qualificationDecisionId,
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.leadId,
          input.outcome,
          input.authority,
          input.scoring.ruleVersion,
          input.scoring.deterministicScore,
          input.scoring.aiScore,
          input.rationale,
          json(input.scoring.factors),
          json(metadata.evidence),
          metadata.actorPrincipalId,
          now,
        ],
      );
      const decision = qualificationFromRow(
        requiredRow(decisionResult.rows[0], 'CRM_QUALIFICATION_INSERT_FAILED'),
      );
      await insertStageHistory(client, input, {
        stageHistoryId: deterministicChildId('stage', input.qualificationDecisionId),
        contactId: lead.contact_id,
        leadId: input.leadId,
        opportunityId: null,
        pipelineKey: input.pipelineKey,
        fromStage: input.fromStage,
        toStage,
        reason: input.rationale,
        metadata,
        now,
      });
      await ensureLeadSla(client, input, lead, observation, now);
      await insertCoreRevision(
        client,
        input,
        metadata,
        'LEAD',
        input.leadId,
        nextVersion,
        'QUALIFIED',
        {
          leadId: input.leadId,
          contactId: lead.contact_id,
          status: leadState.status,
          qualification: leadState.qualification,
          score: input.scoring.effectiveScore,
          version: nextVersion,
          updatedAt: now,
        },
        {
          qualificationDecisionId: input.qualificationDecisionId,
          leadScoreObservationId: input.leadScoreObservationId,
        },
        now,
      );
      await recordMutation(
        client,
        this.#outbox,
        input,
        metadata,
        'LEAD',
        input.leadId,
        'sales.lead.qualified',
        input.qualificationDecisionId,
        nextVersion,
        decision,
        now,
      );
      await completeIdempotency(client, input, 'sales.lead.qualify', input.leadId, decision, now);
      return decision;
    });
  }

  async updateOpportunity(input: UpdateSalesOpportunityInput): Promise<PipelineStageHistoryRecord> {
    validateCrmScope(input);
    const metadata = mutationMetadata(input);
    const now = normalizeNow(input.now);
    assertCrmVersion(input.expectedVersion);
    assertSalesPipelineTransition(input.fromStage, input.toStage);
    if (input.status === 'LOST' && !nullableCrmText(input.lossReason)) {
      throw new Error('CRM_OPPORTUNITY_LOSS_REASON_REQUIRED');
    }
    if (input.status !== 'LOST' && input.lossReason)
      throw new Error('CRM_OPPORTUNITY_LOSS_REASON_NOT_ALLOWED');
    const valueMinor = input.valueMinor ?? null;
    const currency = input.currency?.trim().toUpperCase() ?? null;
    if ((valueMinor === null) !== (currency === null))
      throw new Error('CRM_OPPORTUNITY_MONEY_PAIR_REQUIRED');
    if (valueMinor !== null && (!Number.isInteger(valueMinor) || valueMinor < 0))
      throw new Error('CRM_OPPORTUNITY_VALUE_INVALID');
    if (currency !== null && !/^[A-Z]{3}$/.test(currency))
      throw new Error('CRM_OPPORTUNITY_CURRENCY_INVALID');
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'sales.opportunity.update',
        'OPPORTUNITY',
        input.opportunityId,
      );
      if (replay) return stageFromSnapshot(replay);
      const current = await lockOpportunity(client, input, input.opportunityId);
      if (current.version !== input.expectedVersion)
        throw new Error('CRM_OPPORTUNITY_VERSION_CONFLICT');
      if (current.pipeline_key !== input.pipelineKey)
        throw new Error('CRM_OPPORTUNITY_PIPELINE_MISMATCH');
      const nextVersion = current.version + 1;
      const closedAt = input.status === 'OPEN' ? null : now;
      const updated = await client.query(
        `update crm_opportunities set
           stage_key=$5,status=$6,currency=$7,value_minor=$8,next_action=$9,
           next_action_at=$10::timestamptz,owner_principal_id=$11,closed_at=$12::timestamptz,
           loss_reason=$13,version=$14,updated_at=$15::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and opportunity_id=$4 and version=$16`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.opportunityId,
          requireCrmText(input.stageKey, 'CRM_OPPORTUNITY_STAGE_KEY_REQUIRED'),
          input.status,
          currency ?? current.currency,
          valueMinor ?? numberOrNull(current.value_minor),
          input.nextAction === undefined ? current.next_action : nullableCrmText(input.nextAction),
          input.nextActionAt === undefined
            ? isoOrNull(current.next_action_at)
            : input.nextActionAt
              ? normalizeCrmTimestamp(input.nextActionAt, 'CRM_OPPORTUNITY_NEXT_ACTION_AT_INVALID')
              : null,
          input.ownerPrincipalId === undefined
            ? current.owner_principal_id
            : nullableCrmText(input.ownerPrincipalId),
          closedAt,
          input.status === 'LOST' ? input.lossReason : null,
          nextVersion,
          now,
          current.version,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('CRM_OPPORTUNITY_CONCURRENT_UPDATE');
      const stage = await insertStageHistory(client, input, {
        stageHistoryId: deterministicChildId('stage', `${input.opportunityId}:${nextVersion}`),
        contactId: current.contact_id,
        leadId: current.lead_id,
        opportunityId: input.opportunityId,
        pipelineKey: input.pipelineKey,
        fromStage: input.fromStage,
        toStage: input.toStage,
        reason: input.reason,
        metadata,
        now,
      });
      await insertCoreRevision(
        client,
        input,
        metadata,
        'OPPORTUNITY',
        input.opportunityId,
        nextVersion,
        'UPDATED',
        {
          opportunityId: input.opportunityId,
          contactId: current.contact_id,
          leadId: current.lead_id,
          pipelineKey: current.pipeline_key,
          stageKey: input.stageKey,
          status: input.status,
          currency: currency ?? current.currency,
          valueMinor: valueMinor ?? numberOrNull(current.value_minor),
          ownerPrincipalId:
            input.ownerPrincipalId === undefined
              ? current.owner_principal_id
              : (input.ownerPrincipalId ?? null),
          closedAt,
          lossReason: input.status === 'LOST' ? (input.lossReason ?? null) : null,
          version: nextVersion,
          updatedAt: now,
        },
        { fromStage: input.fromStage, toStage: input.toStage, reason: input.reason },
        now,
      );
      await recordMutation(
        client,
        this.#outbox,
        input,
        metadata,
        'OPPORTUNITY',
        input.opportunityId,
        'sales.opportunity.updated',
        stage.stageHistoryId,
        nextVersion,
        stage,
        now,
      );
      await completeIdempotency(
        client,
        input,
        'sales.opportunity.update',
        input.opportunityId,
        stage,
        now,
      );
      return stage;
    });
  }

  async queryPipeline(input: PipelineQueryInput): Promise<readonly PipelineQueryRow[]> {
    validateCrmScope(input);
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      throw new Error('CRM_PIPELINE_QUERY_LIMIT_INVALID');
    const stages = input.stages ?? [];
    const result = await this.pool.query<{
      contact_id: string;
      lead_id: string | null;
      opportunity_id: string | null;
      pipeline_key: string;
      stage: SalesPipelineStage;
      owner_principal_id: string | null;
      value_minor: number | string | null;
      currency: string | null;
      next_action_at: Date | string | null;
      last_changed_at: Date | string;
    }>(
      `with latest as (
         select distinct on (coalesce(opportunity_id, lead_id), pipeline_key)
           contact_id, lead_id, opportunity_id, pipeline_key, to_stage as stage, changed_at
         from crm_pipeline_stage_history
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3
           and ($4::text is null or pipeline_key=$4)
           and (cardinality($5::text[]) = 0 or to_stage = any($5::text[]))
         order by coalesce(opportunity_id, lead_id), pipeline_key, changed_at desc, stage_history_id desc
       )
       select l.contact_id,l.lead_id,l.opportunity_id,l.pipeline_key,l.stage,
              coalesce(o.owner_principal_id, d.owner_principal_id) as owner_principal_id,
              o.value_minor,o.currency,o.next_action_at,l.changed_at as last_changed_at
         from latest l
         left join crm_opportunities o
           on o.tenant_id=$1 and o.workspace_id=$2 and o.organization_id=$3 and o.opportunity_id=l.opportunity_id
         left join crm_leads d
           on d.tenant_id=$1 and d.workspace_id=$2 and d.organization_id=$3 and d.lead_id=l.lead_id
        where ($6::text is null or coalesce(o.owner_principal_id, d.owner_principal_id)=$6)
        order by l.changed_at desc, l.pipeline_key, l.contact_id
        limit $7`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        input.pipelineKey ?? null,
        stages,
        input.ownerPrincipalId ?? null,
        limit,
      ],
    );
    return result.rows.map((row) => ({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      contactId: row.contact_id,
      leadId: row.lead_id,
      opportunityId: row.opportunity_id,
      pipelineKey: row.pipeline_key,
      stage: row.stage,
      ownerPrincipalId: row.owner_principal_id,
      valueMinor: numberOrNull(row.value_minor),
      currency: row.currency,
      nextActionAt: isoOrNull(row.next_action_at),
      lastChangedAt: iso(row.last_changed_at),
    }));
  }

  async getQualificationDecision(
    input: CrmScope & { readonly qualificationDecisionId: string },
  ): Promise<QualificationDecision | undefined> {
    validateCrmScope(input);
    const result = await this.pool.query<QualificationRow>(
      `select * from crm_qualification_decisions
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and qualification_decision_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, input.qualificationDecisionId],
    );
    return result.rows[0] ? qualificationFromRow(result.rows[0]) : undefined;
  }

  async getNextAction(
    input: CrmScope & { readonly nextActionId: string },
  ): Promise<NextActionRecord | undefined> {
    validateCrmScope(input);
    const result = await this.pool.query<NextActionRow>(
      `select * from crm_next_actions
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and next_action_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, input.nextActionId],
    );
    return result.rows[0] ? nextActionFromRow(result.rows[0]) : undefined;
  }

  async #transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function beginIdempotency(
  client: pg.PoolClient,
  input: CrmScope & CrmMutationMetadata,
  operation: string,
  recordType: 'CONTACT' | 'LEAD' | 'OPPORTUNITY',
  recordId: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  mutationMetadata(input);
  const requestHash = requestSha256(input);
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [
    `${input.tenantId}:${input.workspaceId}:${input.organizationId}:${operation}:${input.idempotencyKey}`,
  ]);
  const existing = await client.query<IdempotencyRow>(
    `select request_hash,response_snapshot,completed_at from crm_idempotency_keys
      where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and operation=$4 and idempotency_key=$5 for update`,
    [input.tenantId, input.workspaceId, input.organizationId, operation, input.idempotencyKey],
  );
  const row = existing.rows[0];
  if (row) {
    if (row.request_hash !== requestHash) throw new Error('CRM_IDEMPOTENCY_PAYLOAD_CONFLICT');
    if (!row.completed_at || !row.response_snapshot) throw new Error('CRM_IDEMPOTENCY_IN_PROGRESS');
    return row.response_snapshot;
  }
  await client.query(
    `insert into crm_idempotency_keys (
       tenant_id,workspace_id,organization_id,operation,idempotency_key,request_hash,
       record_type,record_id,response_snapshot,created_at,completed_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9::timestamptz,null)`,
    [
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      operation,
      input.idempotencyKey,
      requestHash,
      recordType,
      recordId,
      new Date().toISOString(),
    ],
  );
  return undefined;
}

async function completeIdempotency(
  client: pg.PoolClient,
  input: CrmScope & CrmMutationMetadata,
  operation: string,
  recordId: string,
  response: object,
  now: string,
): Promise<void> {
  const updated = await client.query(
    `update crm_idempotency_keys set record_id=$6,response_snapshot=$7::jsonb,completed_at=$8::timestamptz
      where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and operation=$4 and idempotency_key=$5 and completed_at is null`,
    [
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      operation,
      input.idempotencyKey,
      recordId,
      json(response),
      now,
    ],
  );
  if (updated.rowCount !== 1) throw new Error('CRM_IDEMPOTENCY_COMPLETE_FAILED');
}

async function recordMutation(
  client: pg.PoolClient,
  outbox: TransactionalOutboxWriter,
  input: CrmScope,
  metadata: CrmSalesMutationMetadata,
  recordType: 'CONTACT' | 'LEAD' | 'OPPORTUNITY',
  recordId: string,
  eventType: string,
  eventKey: string,
  aggregateVersion: number,
  payload: object,
  now: string,
): Promise<void> {
  await outbox.enqueue(
    client,
    createDomainEvent({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      eventKey: `${eventType}:${eventKey}:${metadata.idempotencyKey}`,
      eventType,
      aggregateType: `CRM_${recordType}`,
      aggregateId: recordId,
      aggregateVersion,
      correlationId: metadata.correlationId,
      causationId: metadata.executionId,
      occurredAt: now,
      payload,
      evidence: metadata.evidence,
    }),
  );
  await appendInternalAuditLedgerEvent(client, {
    operation: eventType,
    recordType,
    recordId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    executionId: metadata.executionId,
    correlationId: metadata.correlationId,
    actorPrincipalId: metadata.actorPrincipalId,
    evidence: metadata.evidence,
    createdAt: now,
  });
}

async function insertCoreRevision(
  client: pg.PoolClient,
  input: CrmScope,
  metadata: CrmSalesMutationMetadata,
  recordType: 'LEAD' | 'OPPORTUNITY',
  recordId: string,
  revision: number,
  changeType: string,
  snapshot: object,
  details: object,
  now: string,
): Promise<void> {
  await client.query(
    `insert into crm_record_revisions (
       tenant_id,workspace_id,organization_id,record_type,record_id,revision,change_type,
       snapshot,details,evidence,execution_id,correlation_id,actor_principal_id,idempotency_key,created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15::timestamptz)`,
    [
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      recordType,
      recordId,
      revision,
      changeType,
      json(snapshot),
      json(details),
      json(metadata.evidence),
      metadata.executionId,
      metadata.correlationId,
      metadata.actorPrincipalId,
      metadata.idempotencyKey,
      now,
    ],
  );
}

async function insertScoreObservation(
  client: pg.PoolClient,
  input: QualifyLeadInput,
  _contactId: string,
  now: string,
): Promise<LeadScoreObservation> {
  const currency = input.currency?.trim().toUpperCase() ?? null;
  if ((input.estimatedValueMinor ?? null) !== null && !currency)
    throw new Error('CRM_SCORE_CURRENCY_REQUIRED');
  const result = await client.query<{
    lead_score_observation_id: string;
    tenant_id: string;
    workspace_id: string;
    organization_id: string;
    lead_id: string;
    rule_version: string;
    deterministic_score: number | string;
    ai_score: number | string | null;
    effective_score: number | string;
    temperature: LeadScoreObservation['temperature'];
    intent: string | null;
    urgency: LeadScoreObservation['urgency'];
    propensity: number | string;
    estimated_value_minor: number | string | null;
    currency: string | null;
    visit_event_at: Date | string | null;
    campaign_ref: string | null;
    source_ref: string | null;
    factors: unknown;
    observed_at: Date | string;
    evidence: unknown;
    created_at: Date | string;
  }>(
    `insert into crm_lead_score_observations (
       lead_score_observation_id,tenant_id,workspace_id,organization_id,lead_id,rule_version,
       deterministic_score,ai_score,effective_score,temperature,intent,urgency,propensity,
       estimated_value_minor,currency,visit_event_at,campaign_ref,source_ref,factors,
       observed_at,evidence,created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::timestamptz,$17,$18,$19::jsonb,$20::timestamptz,$21::jsonb,$20::timestamptz)
     returning *`,
    [
      input.leadScoreObservationId,
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      input.leadId,
      input.scoring.ruleVersion,
      input.scoring.deterministicScore,
      input.scoring.aiScore,
      input.scoring.effectiveScore,
      input.scoring.temperature,
      nullableCrmText(input.intent),
      input.urgency,
      input.propensity,
      input.estimatedValueMinor ?? null,
      currency,
      input.visitEventAt ?? null,
      nullableCrmText(input.campaignRef),
      nullableCrmText(input.sourceRef),
      json(input.scoring.factors),
      now,
      json(requireCrmEvidence(input.evidence)),
    ],
  );
  const row = requiredRow(result.rows[0], 'CRM_SCORE_OBSERVATION_INSERT_FAILED');
  return {
    leadScoreObservationId: row.lead_score_observation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    leadId: row.lead_id,
    ruleVersion: row.rule_version,
    deterministicScore: Number(row.deterministic_score),
    aiScore: row.ai_score === null ? null : Number(row.ai_score),
    effectiveScore: Number(row.effective_score),
    temperature: row.temperature,
    intent: row.intent,
    urgency: row.urgency,
    propensity: Number(row.propensity),
    estimatedValueMinor: numberOrNull(row.estimated_value_minor),
    currency: row.currency,
    visitEventAt: isoOrNull(row.visit_event_at),
    campaignRef: row.campaign_ref,
    sourceRef: row.source_ref,
    factors: record(row.factors),
    observedAt: iso(row.observed_at),
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}

async function insertStageHistory(
  client: pg.PoolClient,
  input: CrmScope,
  value: {
    readonly stageHistoryId: string;
    readonly contactId: string;
    readonly leadId: string | null;
    readonly opportunityId: string | null;
    readonly pipelineKey: string;
    readonly fromStage: SalesPipelineStage | null;
    readonly toStage: SalesPipelineStage;
    readonly reason: string;
    readonly metadata: CrmSalesMutationMetadata;
    readonly now: string;
  },
): Promise<PipelineStageHistoryRecord> {
  const result = await client.query<StageRow>(
    `insert into crm_pipeline_stage_history (
       stage_history_id,tenant_id,workspace_id,organization_id,contact_id,lead_id,
       opportunity_id,pipeline_key,from_stage,to_stage,reason,changed_by_principal_id,
       changed_at,evidence,created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::jsonb,$13::timestamptz)
     returning *`,
    [
      value.stageHistoryId,
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      value.contactId,
      value.leadId,
      value.opportunityId,
      requireCrmText(value.pipelineKey, 'CRM_PIPELINE_KEY_REQUIRED'),
      value.fromStage,
      value.toStage,
      requireCrmText(value.reason, 'CRM_PIPELINE_REASON_REQUIRED'),
      value.metadata.actorPrincipalId,
      value.now,
      json(value.metadata.evidence),
    ],
  );
  return stageFromRow(requiredRow(result.rows[0], 'CRM_PIPELINE_STAGE_INSERT_FAILED'));
}

async function ensureLeadSla(
  client: pg.PoolClient,
  input: QualifyLeadInput,
  lead: LeadLockRow,
  observation: LeadScoreObservation,
  now: string,
): Promise<void> {
  const initial = calculateInitialSla(iso(lead.captured_at), observation.temperature);
  await client.query(
    `insert into crm_sla_states (
       lead_id,tenant_id,workspace_id,organization_id,first_response_due_at,first_response_at,
       follow_up_due_at,last_follow_up_at,no_response_count,state,breach_reason,
       reactivation_due_at,version,updated_at
     ) values ($1,$2,$3,$4,$5::timestamptz,null,null,null,0,$6,null,$7::timestamptz,1,$8::timestamptz)
     on conflict (lead_id) do update set updated_at=excluded.updated_at`,
    [
      input.leadId,
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      initial.firstResponseDueAt,
      initial.state,
      initial.reactivationDueAt,
      now,
    ],
  );
}

async function updateSlaFromActivity(
  client: pg.PoolClient,
  input: CrmScope,
  leadId: string,
  activityType: SalesActivityRecord['activityType'],
  occurredAt: string,
  now: string,
): Promise<void> {
  if (activityType === 'RESPONSE') {
    await client.query(
      `update crm_sla_states set first_response_at=coalesce(first_response_at,$5::timestamptz),
              state='SATISFIED',version=version+1,updated_at=$6::timestamptz
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, leadId, occurredAt, now],
    );
  } else if (activityType === 'CONTACT_ATTEMPT' || activityType === 'FOLLOW_UP') {
    await client.query(
      `update crm_sla_states set last_follow_up_at=$5::timestamptz,no_response_count=no_response_count+1,
              version=version+1,updated_at=$6::timestamptz
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, leadId, occurredAt, now],
    );
  }
}

async function assertContactExists(
  client: pg.PoolClient,
  input: CrmScope,
  contactId: string,
): Promise<void> {
  const result = await client.query(
    `select 1 from crm_contacts where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4`,
    [input.tenantId, input.workspaceId, input.organizationId, contactId],
  );
  if (result.rowCount !== 1) throw new Error('CRM_CONTACT_NOT_FOUND');
}

async function assertLeadLineage(
  client: pg.PoolClient,
  input: CrmScope,
  leadId: string,
  contactId: string,
): Promise<void> {
  const result = await client.query(
    `select 1 from crm_leads where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4 and contact_id=$5`,
    [input.tenantId, input.workspaceId, input.organizationId, leadId, contactId],
  );
  if (result.rowCount !== 1) throw new Error('CRM_LEAD_LINEAGE_MISMATCH');
}

async function assertOpportunityLineage(
  client: pg.PoolClient,
  input: CrmScope,
  opportunityId: string,
  contactId: string,
  leadId: string | null,
): Promise<void> {
  const result = await client.query<{ lead_id: string | null }>(
    `select lead_id from crm_opportunities where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and opportunity_id=$4 and contact_id=$5`,
    [input.tenantId, input.workspaceId, input.organizationId, opportunityId, contactId],
  );
  const row = result.rows[0];
  if (!row || (leadId && row.lead_id !== leadId))
    throw new Error('CRM_OPPORTUNITY_LINEAGE_MISMATCH');
}

async function lockConversationLineage(
  client: pg.PoolClient,
  input: CrmScope,
  conversationId: string,
  contactId: string,
  leadId: string | null,
): Promise<void> {
  const result = await client.query<{ contact_id: string; lead_id: string | null }>(
    `select contact_id,lead_id from crm_conversations where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and conversation_id=$4 for update`,
    [input.tenantId, input.workspaceId, input.organizationId, conversationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('CRM_CONVERSATION_NOT_FOUND');
  if (row.contact_id !== contactId || (leadId && row.lead_id && row.lead_id !== leadId)) {
    throw new Error('CRM_CONVERSATION_LINEAGE_MISMATCH');
  }
}

async function lockLead(
  client: pg.PoolClient,
  input: CrmScope,
  leadId: string,
): Promise<LeadLockRow> {
  const result = await client.query<LeadLockRow>(
    `select lead_id,contact_id,status,qualification,owner_principal_id,version,attributes,captured_at
       from crm_leads where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4 for update`,
    [input.tenantId, input.workspaceId, input.organizationId, leadId],
  );
  return requiredRow(result.rows[0], 'CRM_LEAD_NOT_FOUND');
}

async function lockOpportunity(
  client: pg.PoolClient,
  input: CrmScope,
  opportunityId: string,
): Promise<OpportunityLockRow> {
  const result = await client.query<OpportunityLockRow>(
    `select * from crm_opportunities where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and opportunity_id=$4 for update`,
    [input.tenantId, input.workspaceId, input.organizationId, opportunityId],
  );
  return requiredRow(result.rows[0], 'CRM_OPPORTUNITY_NOT_FOUND');
}

function qualificationLeadState(outcome: QualifyLeadInput['outcome']): {
  readonly status: string;
  readonly qualification: string;
} {
  switch (outcome) {
    case 'QUALIFIED':
      return { status: 'QUALIFIED', qualification: 'SALES_QUALIFIED' };
    case 'NURTURE':
      return { status: 'NURTURING', qualification: 'MARKETING_QUALIFIED' };
    case 'DISQUALIFIED':
      return { status: 'DISQUALIFIED', qualification: 'DISQUALIFIED' };
    case 'REVIEW':
      return { status: 'WORKING', qualification: 'UNQUALIFIED' };
  }
}

function qualificationStage(
  outcome: QualifyLeadInput['outcome'],
  current: SalesPipelineStage,
): SalesPipelineStage {
  switch (outcome) {
    case 'QUALIFIED':
      return 'QUALIFIED';
    case 'NURTURE':
      return 'NURTURE';
    case 'DISQUALIFIED':
      return 'LOST';
    case 'REVIEW':
      return current;
  }
}

function mutationMetadata(input: CrmMutationMetadata): CrmSalesMutationMetadata {
  return {
    idempotencyKey: requireCrmText(input.idempotencyKey, 'CRM_IDEMPOTENCY_KEY_REQUIRED'),
    executionId: requireCrmText(input.executionId, 'CRM_EXECUTION_ID_REQUIRED'),
    correlationId: requireCrmText(input.correlationId, 'CRM_CORRELATION_ID_REQUIRED'),
    actorPrincipalId: requireCrmText(input.actorPrincipalId, 'CRM_ACTOR_PRINCIPAL_ID_REQUIRED'),
    evidence: requireCrmEvidence(input.evidence),
  };
}

function conversationFromRow(row: ConversationRow): ConversationRecord {
  return {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    channel: row.channel,
    language: row.language,
    status: row.status,
    startedAt: iso(row.started_at),
    lastMessageAt: isoOrNull(row.last_message_at),
    closedAt: isoOrNull(row.closed_at),
    attributes: record(row.attributes),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function messageFromRow(row: MessageRow): MessageRecord {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    direction: row.direction,
    channel: row.channel,
    language: row.language,
    contentRef: row.content_ref,
    contentSha256: row.content_sha256,
    providerMessageRef: row.provider_message_ref,
    intent: row.intent,
    urgency: row.urgency,
    occurredAt: iso(row.occurred_at),
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}

function activityFromRow(row: ActivityRow): SalesActivityRecord {
  return {
    activityId: row.activity_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    opportunityId: row.opportunity_id,
    conversationId: row.conversation_id,
    activityType: row.activity_type,
    channel: row.channel,
    summary: row.summary,
    outcome: row.outcome,
    actorPrincipalId: row.actor_principal_id,
    occurredAt: iso(row.occurred_at),
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}

function nextActionFromRow(row: NextActionRow): NextActionRecord {
  return {
    nextActionId: row.next_action_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    opportunityId: row.opportunity_id,
    actionType: row.action_type,
    title: row.title,
    rationale: row.rationale,
    priority: row.priority,
    status: row.status,
    ownerPrincipalId: row.owner_principal_id,
    playbookKey: row.playbook_key,
    dueAt: isoOrNull(row.due_at),
    completedAt: isoOrNull(row.completed_at),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function qualificationFromRow(row: QualificationRow): QualificationDecision {
  return {
    qualificationDecisionId: row.qualification_decision_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    leadId: row.lead_id,
    decision: row.decision,
    authority: row.authority,
    ruleVersion: row.rule_version,
    deterministicScore: Number(row.deterministic_score),
    aiScore: row.ai_score === null ? null : Number(row.ai_score),
    rationale: row.rationale,
    factors: record(row.factors),
    evidence: strings(row.evidence),
    decidedByPrincipalId: row.decided_by_principal_id,
    decidedAt: iso(row.decided_at),
    createdAt: iso(row.created_at),
  };
}

function stageFromRow(row: StageRow): PipelineStageHistoryRecord {
  return {
    stageHistoryId: row.stage_history_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    opportunityId: row.opportunity_id,
    pipelineKey: row.pipeline_key,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    reason: row.reason,
    changedByPrincipalId: row.changed_by_principal_id,
    changedAt: iso(row.changed_at),
    evidence: strings(row.evidence),
    createdAt: iso(row.created_at),
  };
}

function conversationFromSnapshot(value: Readonly<Record<string, unknown>>): ConversationRecord {
  return value as unknown as ConversationRecord;
}
function messageFromSnapshot(value: Readonly<Record<string, unknown>>): MessageRecord {
  return value as unknown as MessageRecord;
}
function activityFromSnapshot(value: Readonly<Record<string, unknown>>): SalesActivityRecord {
  return value as unknown as SalesActivityRecord;
}
function nextActionFromSnapshot(value: Readonly<Record<string, unknown>>): NextActionRecord {
  return value as unknown as NextActionRecord;
}
function qualificationFromSnapshot(
  value: Readonly<Record<string, unknown>>,
): QualificationDecision {
  return value as unknown as QualificationDecision;
}
function stageFromSnapshot(value: Readonly<Record<string, unknown>>): PipelineStageHistoryRecord {
  return value as unknown as PipelineStageHistoryRecord;
}

function normalizeNow(value: string | undefined): string {
  return normalizeCrmTimestamp(value ?? new Date().toISOString(), 'CRM_SALES_NOW_INVALID');
}

function normalizeLanguage(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() || 'und';
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$|^und$/.test(normalized)) {
    throw new Error('CRM_SALES_LANGUAGE_INVALID');
  }
  return normalized;
}

function assertSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('CRM_MESSAGE_CONTENT_SHA256_INVALID');
}

function requestSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

function deterministicChildId(prefix: string, seed: string): string {
  return `${prefix}_${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function numberOrNull(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function requiredRow<T>(value: T | undefined, code: string): T {
  if (!value) throw new Error(code);
  return value;
}
