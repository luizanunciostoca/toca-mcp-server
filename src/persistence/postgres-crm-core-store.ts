import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  assertCrmLeadStatusTransition,
  assertCrmLimit,
  assertCrmOpportunityStatusTransition,
  assertCrmVersion,
  normalizeCrmChannelProvider,
  normalizeCrmChannelValue,
  normalizeCrmCurrency,
  normalizeCrmTimestamp,
  normalizeNullableTimestamp,
  nullableCrmText,
  requireCrmEvidence,
  requireCrmText,
  validateContactRecord,
  validateCrmAttributes,
  validateCrmMoney,
  validateCrmScore,
  validateCrmScope,
  validateLeadRecord,
  validateOpportunityRecord,
  type AttachContactChannelInput,
  type ContactChannelRecord,
  type ContactRecord,
  type CreateContactRecordInput,
  type CreateLeadRecordInput,
  type CreateOpportunityRecordInput,
  type CrmCoreStore,
  type CrmMutationMetadata,
  type CrmRecordRevision,
  type CrmRecordType,
  type CrmScope,
  type LeadRecord,
  type OpportunityRecord,
  type TransitionOpportunityRecordInput,
  type UpdateContactRecordInput,
  type UpdateLeadRecordInput,
  type UpdateOpportunityRecordInput,
} from '../crm/crm-records.js';
import { createDomainEvent } from '../events/domain-events.js';
import { PostgresTransactionalOutbox } from '../events/postgres-transactional-outbox.js';
import type { TransactionalOutboxWriter } from '../events/transactional-outbox.js';
import { appendInternalAuditLedgerEvent } from './postgres-internal-audit-ledger.js';

interface ContactRow {
  readonly contact_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_type: ContactRecord['contactType'];
  readonly display_name: string;
  readonly status: ContactRecord['status'];
  readonly attributes: unknown;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ChannelRow {
  readonly channel_id: string;
  readonly contact_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly channel_type: ContactChannelRecord['channelType'];
  readonly provider: string | null;
  readonly value: string;
  readonly normalized_value: string;
  readonly is_primary: boolean;
  readonly verified_at: Date | string | null;
  readonly evidence: unknown;
  readonly created_at: Date | string;
}

interface LeadRow {
  readonly lead_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly event_id: string | null;
  readonly source_type: string;
  readonly source_ref: string | null;
  readonly status: LeadRecord['status'];
  readonly qualification: LeadRecord['qualification'];
  readonly score: number | string | null;
  readonly owner_principal_id: string | null;
  readonly sla_due_at: Date | string | null;
  readonly captured_at: Date | string;
  readonly qualified_at: Date | string | null;
  readonly converted_at: Date | string | null;
  readonly disqualified_reason: string | null;
  readonly attributes: unknown;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface OpportunityRow {
  readonly opportunity_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly contact_id: string;
  readonly lead_id: string | null;
  readonly event_id: string | null;
  readonly name: string;
  readonly pipeline_key: string;
  readonly stage_key: string;
  readonly status: OpportunityRecord['status'];
  readonly currency: string | null;
  readonly value_minor: number | string | null;
  readonly next_action: string | null;
  readonly next_action_at: Date | string | null;
  readonly owner_principal_id: string | null;
  readonly expected_close_at: Date | string | null;
  readonly closed_at: Date | string | null;
  readonly loss_reason: string | null;
  readonly attributes: unknown;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface RevisionRow {
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly record_type: CrmRecordType;
  readonly record_id: string;
  readonly revision: number;
  readonly change_type: string;
  readonly snapshot: unknown;
  readonly details: unknown;
  readonly evidence: unknown;
  readonly execution_id: string;
  readonly correlation_id: string;
  readonly actor_principal_id: string;
  readonly idempotency_key: string;
  readonly created_at: Date | string;
}

interface IdempotencyRow {
  readonly request_hash: string;
  readonly record_type: CrmRecordType;
  readonly record_id: string;
  readonly response_snapshot: Readonly<Record<string, unknown>> | null;
  readonly completed_at: Date | string | null;
}

export interface PostgresCrmCoreStoreOptions {
  readonly outbox?: TransactionalOutboxWriter;
}

export class PostgresCrmCoreStore implements CrmCoreStore {
  readonly #outbox: TransactionalOutboxWriter;

  constructor(
    private readonly pool: pg.Pool,
    options: PostgresCrmCoreStoreOptions = {},
  ) {
    this.#outbox = options.outbox ?? new PostgresTransactionalOutbox(pool);
  }

  async createContact(input: CreateContactRecordInput): Promise<ContactRecord> {
    const now = normalizeNow(input.now);
    const metadata = normalizeMetadata(input);
    validateCrmScope(input);
    const record: ContactRecord = {
      contactId: requireCrmText(input.contactId, 'CRM_CONTACT_ID_REQUIRED'),
      tenantId: requireCrmText(input.tenantId, 'CRM_TENANT_ID_REQUIRED'),
      workspaceId: requireCrmText(input.workspaceId, 'CRM_WORKSPACE_ID_REQUIRED'),
      organizationId: requireCrmText(input.organizationId, 'CRM_ORGANIZATION_ID_REQUIRED'),
      contactType: input.contactType,
      displayName: requireCrmText(input.displayName, 'CRM_CONTACT_DISPLAY_NAME_REQUIRED'),
      status: 'ACTIVE',
      attributes: input.attributes ?? {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    validateContactRecord(record);
    const channels = (input.channels ?? []).map((channel) => ({
      channelId: requireCrmText(channel.channelId, 'CRM_CONTACT_CHANNEL_ID_REQUIRED'),
      channelType: channel.channelType,
      provider: normalizeCrmChannelProvider(channel.channelType, channel.provider),
      value: requireCrmText(channel.value, 'CRM_CONTACT_CHANNEL_VALUE_REQUIRED'),
      normalizedValue: normalizeCrmChannelValue(channel.channelType, channel.value),
      primary: channel.primary ?? false,
      verifiedAt: normalizeNullableTimestamp(
        channel.verifiedAt,
        'CRM_CONTACT_CHANNEL_VERIFIED_AT_INVALID',
      ),
    }));
    assertDistinctChannels(channels);

    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'contact.create',
        'CONTACT',
        record.contactId,
      );
      if (replay) return contactFromSnapshot(replay);

      const inserted = await client.query<ContactRow>(
        `insert into crm_contacts (
           contact_id, tenant_id, workspace_id, organization_id, contact_type,
           display_name, status, attributes, version, created_at, updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,$9::timestamptz,$9::timestamptz)
         returning *`,
        [
          record.contactId,
          record.tenantId,
          record.workspaceId,
          record.organizationId,
          record.contactType,
          record.displayName,
          record.status,
          json(record.attributes),
          now,
        ],
      );
      const created = contactFromRow(requiredRow(inserted.rows[0], 'CRM_CONTACT_INSERT_FAILED'));
      for (const channel of channels) {
        await insertChannel(client, created, channel, metadata.evidence, now);
      }
      await this.#recordMutation(
        client,
        'CONTACT',
        created,
        'CREATED',
        {
          channelIds: channels.map((channel) => channel.channelId).sort(),
        },
        metadata,
        'contact.created',
      );
      await completeIdempotency(client, input, 'contact.create', created.contactId, created, now);
      return created;
    });
  }

  async getContact(
    input: CrmScope & { readonly contactId: string },
  ): Promise<ContactRecord | undefined> {
    validateCrmScope(input);
    const result = await this.pool.query<ContactRow>(
      `select * from crm_contacts where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, input.contactId],
    );
    return result.rows[0] ? contactFromRow(result.rows[0]) : undefined;
  }

  async updateContact(input: UpdateContactRecordInput): Promise<ContactRecord> {
    const now = normalizeNow(input.now);
    const metadata = normalizeMetadata(input);
    assertCrmVersion(input.expectedVersion);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'contact.update',
        'CONTACT',
        input.contactId,
      );
      if (replay) return contactFromSnapshot(replay);
      const current = await lockContact(client, input);
      assertExpectedVersion(current.version, input.expectedVersion);
      const next: ContactRecord = {
        ...current,
        displayName:
          input.displayName === undefined
            ? current.displayName
            : requireCrmText(input.displayName, 'CRM_CONTACT_DISPLAY_NAME_REQUIRED'),
        status: input.status ?? current.status,
        attributes: input.attributes ?? current.attributes,
        version: current.version + 1,
        updatedAt: now,
      };
      validateContactRecord(next);
      const updated = await client.query<ContactRow>(
        `update crm_contacts set display_name=$5,status=$6,attributes=$7::jsonb,version=$8,updated_at=$9::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4 and version=$10 returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.contactId,
          next.displayName,
          next.status,
          json(next.attributes),
          next.version,
          now,
          current.version,
        ],
      );
      const record = contactFromRow(requiredRow(updated.rows[0], 'CRM_CONTACT_CONCURRENT_UPDATE'));
      await this.#recordMutation(
        client,
        'CONTACT',
        record,
        'UPDATED',
        {},
        metadata,
        'contact.updated',
      );
      await completeIdempotency(client, input, 'contact.update', record.contactId, record, now);
      return record;
    });
  }

  async attachContactChannel(input: AttachContactChannelInput): Promise<ContactChannelRecord> {
    const now = normalizeNow(input.now);
    const metadata = normalizeMetadata(input);
    assertCrmVersion(input.expectedVersion);
    const provider = normalizeCrmChannelProvider(input.channelType, input.provider);
    const normalizedValue = normalizeCrmChannelValue(input.channelType, input.value);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'contact.channel.attach',
        'CONTACT',
        input.contactId,
      );
      if (replay) return channelFromSnapshot(replay);
      const current = await lockContact(client, input);
      assertExpectedVersion(current.version, input.expectedVersion);
      const channel = await insertChannel(
        client,
        current,
        {
          channelId: requireCrmText(input.channelId, 'CRM_CONTACT_CHANNEL_ID_REQUIRED'),
          channelType: input.channelType,
          provider,
          value: requireCrmText(input.value, 'CRM_CONTACT_CHANNEL_VALUE_REQUIRED'),
          normalizedValue,
          primary: input.primary ?? false,
          verifiedAt: normalizeNullableTimestamp(
            input.verifiedAt,
            'CRM_CONTACT_CHANNEL_VERIFIED_AT_INVALID',
          ),
        },
        metadata.evidence,
        now,
      );
      const updated = await client.query<ContactRow>(
        `update crm_contacts set version=version+1,updated_at=$5::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4 and version=$6 returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.contactId,
          now,
          current.version,
        ],
      );
      const aggregate = contactFromRow(
        requiredRow(updated.rows[0], 'CRM_CONTACT_CONCURRENT_UPDATE'),
      );
      await this.#recordMutation(
        client,
        'CONTACT',
        aggregate,
        'CHANNEL_ATTACHED',
        {
          channelId: channel.channelId,
          channelType: channel.channelType,
          provider: channel.provider,
          normalizedValue: channel.normalizedValue,
        },
        metadata,
        'contact.channel_attached',
      );
      await completeIdempotency(
        client,
        input,
        'contact.channel.attach',
        aggregate.contactId,
        channel,
        now,
      );
      return channel;
    });
  }

  async findContactByChannel(
    input: CrmScope & {
      readonly channelType: ContactChannelRecord['channelType'];
      readonly provider?: string | null;
      readonly value: string;
    },
  ): Promise<ContactRecord | undefined> {
    validateCrmScope(input);
    const provider = normalizeCrmChannelProvider(input.channelType, input.provider);
    const normalized = normalizeCrmChannelValue(input.channelType, input.value);
    const result = await this.pool.query<ContactRow>(
      `select c.* from crm_contact_channels ch join crm_contacts c
         on c.tenant_id=ch.tenant_id and c.workspace_id=ch.workspace_id
        and c.organization_id=ch.organization_id and c.contact_id=ch.contact_id
       where ch.tenant_id=$1 and ch.workspace_id=$2 and ch.organization_id=$3
         and ch.channel_type=$4 and ch.provider_key=$5 and ch.normalized_value=$6
       order by c.contact_id asc limit 1`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        input.channelType,
        provider ?? '',
        normalized,
      ],
    );
    return result.rows[0] ? contactFromRow(result.rows[0]) : undefined;
  }

  async listContactChannels(
    input: CrmScope & { readonly contactId: string },
  ): Promise<readonly ContactChannelRecord[]> {
    validateCrmScope(input);
    const result = await this.pool.query<ChannelRow>(
      `select * from crm_contact_channels where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4
       order by channel_type asc, provider_key asc, normalized_value asc, channel_id asc`,
      [input.tenantId, input.workspaceId, input.organizationId, input.contactId],
    );
    return result.rows.map(channelFromRow);
  }

  async createLead(input: CreateLeadRecordInput): Promise<LeadRecord> {
    const now = normalizeNow(input.now);
    const metadata = normalizeMetadata(input);
    const status = input.status ?? 'NEW';
    const qualification = input.qualification ?? 'UNQUALIFIED';
    const record: LeadRecord = {
      leadId: requireCrmText(input.leadId, 'CRM_LEAD_ID_REQUIRED'),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      contactId: requireCrmText(input.contactId, 'CRM_CONTACT_ID_REQUIRED'),
      eventId: nullableCrmText(input.eventId),
      sourceType: requireCrmText(input.sourceType, 'CRM_LEAD_SOURCE_TYPE_REQUIRED'),
      sourceRef: nullableCrmText(input.sourceRef),
      status,
      qualification,
      score: input.score ?? null,
      ownerPrincipalId: nullableCrmText(input.ownerPrincipalId),
      slaDueAt: normalizeNullableTimestamp(input.slaDueAt, 'CRM_LEAD_SLA_DUE_AT_INVALID'),
      capturedAt:
        input.capturedAt === undefined
          ? now
          : normalizeCrmTimestamp(input.capturedAt, 'CRM_LEAD_CAPTURED_AT_INVALID'),
      qualifiedAt:
        qualification === 'MARKETING_QUALIFIED' || qualification === 'SALES_QUALIFIED' ? now : null,
      convertedAt: status === 'CONVERTED' ? now : null,
      disqualifiedReason: null,
      attributes: input.attributes ?? {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    validateLeadRecord(record);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(client, input, 'lead.create', 'LEAD', record.leadId);
      if (replay) return leadFromSnapshot(replay);
      await assertContactExists(client, input, record.contactId);
      if (record.eventId) await assertEventScope(client, input, record.eventId);
      const inserted = await client.query<LeadRow>(
        `insert into crm_leads (
          lead_id,tenant_id,workspace_id,organization_id,contact_id,event_id,source_type,source_ref,status,
          qualification,score,owner_principal_id,sla_due_at,captured_at,qualified_at,converted_at,
          disqualified_reason,attributes,version,created_at,updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz,
          $15::timestamptz,$16::timestamptz,$17,$18::jsonb,1,$19::timestamptz,$19::timestamptz) returning *`,
        [
          record.leadId,
          record.tenantId,
          record.workspaceId,
          record.organizationId,
          record.contactId,
          record.eventId,
          record.sourceType,
          record.sourceRef,
          record.status,
          record.qualification,
          record.score,
          record.ownerPrincipalId,
          record.slaDueAt,
          record.capturedAt,
          record.qualifiedAt,
          record.convertedAt,
          record.disqualifiedReason,
          json(record.attributes),
          now,
        ],
      );
      const created = leadFromRow(requiredRow(inserted.rows[0], 'CRM_LEAD_INSERT_FAILED'));
      await this.#recordMutation(client, 'LEAD', created, 'CREATED', {}, metadata, 'lead.created');
      await completeIdempotency(client, input, 'lead.create', created.leadId, created, now);
      return created;
    });
  }

  async getLead(input: CrmScope & { readonly leadId: string }): Promise<LeadRecord | undefined> {
    validateCrmScope(input);
    const result = await this.pool.query<LeadRow>(
      `select * from crm_leads where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, input.leadId],
    );
    return result.rows[0] ? leadFromRow(result.rows[0]) : undefined;
  }

  async updateLead(input: UpdateLeadRecordInput): Promise<LeadRecord> {
    const now = normalizeNow(input.now);
    const metadata = normalizeMetadata(input);
    assertCrmVersion(input.expectedVersion);
    if (input.score !== undefined) validateCrmScore(input.score);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(client, input, 'lead.update', 'LEAD', input.leadId);
      if (replay) return leadFromSnapshot(replay);
      const current = await lockLead(client, input);
      assertExpectedVersion(current.version, input.expectedVersion);
      const status = input.status ?? current.status;
      if (status !== current.status) assertCrmLeadStatusTransition(current.status, status);
      const qualification = input.qualification ?? current.qualification;
      const next: LeadRecord = {
        ...current,
        status,
        qualification,
        score: input.score === undefined ? current.score : input.score,
        ownerPrincipalId:
          input.ownerPrincipalId === undefined
            ? current.ownerPrincipalId
            : nullableCrmText(input.ownerPrincipalId),
        slaDueAt:
          input.slaDueAt === undefined
            ? current.slaDueAt
            : normalizeNullableTimestamp(input.slaDueAt, 'CRM_LEAD_SLA_DUE_AT_INVALID'),
        qualifiedAt:
          current.qualifiedAt ??
          (qualification === 'MARKETING_QUALIFIED' || qualification === 'SALES_QUALIFIED'
            ? now
            : null),
        convertedAt: status === 'CONVERTED' ? (current.convertedAt ?? now) : current.convertedAt,
        disqualifiedReason:
          status === 'DISQUALIFIED'
            ? nullableCrmText(input.disqualifiedReason)
            : status === 'ARCHIVED'
              ? current.disqualifiedReason
              : null,
        attributes: input.attributes ?? current.attributes,
        version: current.version + 1,
        updatedAt: now,
      };
      validateLeadRecord(next);
      const updated = await client.query<LeadRow>(
        `update crm_leads set status=$5,qualification=$6,score=$7,owner_principal_id=$8,sla_due_at=$9::timestamptz,
           qualified_at=$10::timestamptz,converted_at=$11::timestamptz,disqualified_reason=$12,attributes=$13::jsonb,
           version=$14,updated_at=$15::timestamptz
         where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4 and version=$16 returning *`,
        [
          input.tenantId,
          input.workspaceId,
          input.organizationId,
          input.leadId,
          next.status,
          next.qualification,
          next.score,
          next.ownerPrincipalId,
          next.slaDueAt,
          next.qualifiedAt,
          next.convertedAt,
          next.disqualifiedReason,
          json(next.attributes),
          next.version,
          now,
          current.version,
        ],
      );
      const record = leadFromRow(requiredRow(updated.rows[0], 'CRM_LEAD_CONCURRENT_UPDATE'));
      await this.#recordMutation(
        client,
        'LEAD',
        record,
        status === current.status ? 'UPDATED' : 'STATUS_CHANGED',
        {},
        metadata,
        'lead.updated',
      );
      await completeIdempotency(client, input, 'lead.update', record.leadId, record, now);
      return record;
    });
  }

  async listLeadsForContact(
    input: CrmScope & { readonly contactId: string; readonly limit?: number },
  ): Promise<readonly LeadRecord[]> {
    validateCrmScope(input);
    const limit = input.limit ?? 200;
    assertCrmLimit(limit);
    const result = await this.pool.query<LeadRow>(
      `select * from crm_leads where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4
       order by captured_at desc, lead_id asc limit $5`,
      [input.tenantId, input.workspaceId, input.organizationId, input.contactId, limit],
    );
    return result.rows.map(leadFromRow);
  }

  async createOpportunity(input: CreateOpportunityRecordInput): Promise<OpportunityRecord> {
    const now = normalizeNow(input.now);
    const metadata = normalizeMetadata(input);
    const currency = normalizeCrmCurrency(input.currency);
    const valueMinor = input.valueMinor ?? null;
    validateCrmMoney(currency, valueMinor);
    const record: OpportunityRecord = {
      opportunityId: requireCrmText(input.opportunityId, 'CRM_OPPORTUNITY_ID_REQUIRED'),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      contactId: requireCrmText(input.contactId, 'CRM_CONTACT_ID_REQUIRED'),
      leadId: nullableCrmText(input.leadId),
      eventId: nullableCrmText(input.eventId),
      name: requireCrmText(input.name, 'CRM_OPPORTUNITY_NAME_REQUIRED'),
      pipelineKey: requireCrmText(input.pipelineKey, 'CRM_OPPORTUNITY_PIPELINE_REQUIRED'),
      stageKey: requireCrmText(input.stageKey, 'CRM_OPPORTUNITY_STAGE_REQUIRED'),
      status: 'OPEN',
      currency,
      valueMinor,
      nextAction: nullableCrmText(input.nextAction),
      nextActionAt: normalizeNullableTimestamp(
        input.nextActionAt,
        'CRM_OPPORTUNITY_NEXT_ACTION_AT_INVALID',
      ),
      ownerPrincipalId: nullableCrmText(input.ownerPrincipalId),
      expectedCloseAt: normalizeNullableTimestamp(
        input.expectedCloseAt,
        'CRM_OPPORTUNITY_EXPECTED_CLOSE_AT_INVALID',
      ),
      closedAt: null,
      lossReason: null,
      attributes: input.attributes ?? {},
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    validateOpportunityRecord(record);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'opportunity.create',
        'OPPORTUNITY',
        record.opportunityId,
      );
      if (replay) return opportunityFromSnapshot(replay);
      await assertContactExists(client, input, record.contactId);
      if (record.leadId) {
        const lead = await getLeadForLink(client, input, record.leadId);
        if (lead.contactId !== record.contactId)
          throw new Error('CRM_OPPORTUNITY_LEAD_CONTACT_CONFLICT');
        if (record.eventId && lead.eventId && record.eventId !== lead.eventId)
          throw new Error('CRM_OPPORTUNITY_EVENT_LINK_CONFLICT');
      }
      if (record.eventId) await assertEventScope(client, input, record.eventId);
      const inserted = await client.query<OpportunityRow>(
        `insert into crm_opportunities (
          opportunity_id,tenant_id,workspace_id,organization_id,contact_id,lead_id,event_id,name,pipeline_key,stage_key,
          status,currency,value_minor,next_action,next_action_at,owner_principal_id,expected_close_at,closed_at,loss_reason,
          attributes,version,created_at,updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16,$17::timestamptz,
          null,null,$18::jsonb,1,$19::timestamptz,$19::timestamptz) returning *`,
        [
          record.opportunityId,
          record.tenantId,
          record.workspaceId,
          record.organizationId,
          record.contactId,
          record.leadId,
          record.eventId,
          record.name,
          record.pipelineKey,
          record.stageKey,
          record.status,
          record.currency,
          record.valueMinor,
          record.nextAction,
          record.nextActionAt,
          record.ownerPrincipalId,
          record.expectedCloseAt,
          json(record.attributes),
          now,
        ],
      );
      const created = opportunityFromRow(
        requiredRow(inserted.rows[0], 'CRM_OPPORTUNITY_INSERT_FAILED'),
      );
      await this.#recordMutation(
        client,
        'OPPORTUNITY',
        created,
        'CREATED',
        {},
        metadata,
        'opportunity.created',
      );
      await completeIdempotency(
        client,
        input,
        'opportunity.create',
        created.opportunityId,
        created,
        now,
      );
      return created;
    });
  }

  async getOpportunity(
    input: CrmScope & { readonly opportunityId: string },
  ): Promise<OpportunityRecord | undefined> {
    validateCrmScope(input);
    const result = await this.pool.query<OpportunityRow>(
      `select * from crm_opportunities where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and opportunity_id=$4`,
      [input.tenantId, input.workspaceId, input.organizationId, input.opportunityId],
    );
    return result.rows[0] ? opportunityFromRow(result.rows[0]) : undefined;
  }

  async updateOpportunity(input: UpdateOpportunityRecordInput): Promise<OpportunityRecord> {
    const now = normalizeNow(input.now);
    const metadata = normalizeMetadata(input);
    assertCrmVersion(input.expectedVersion);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'opportunity.update',
        'OPPORTUNITY',
        input.opportunityId,
      );
      if (replay) return opportunityFromSnapshot(replay);
      const current = await lockOpportunity(client, input);
      assertExpectedVersion(current.version, input.expectedVersion);
      if (current.status !== 'OPEN') throw new Error('CRM_OPPORTUNITY_CLOSED_UPDATE_FORBIDDEN');
      const currency =
        input.currency === undefined ? current.currency : normalizeCrmCurrency(input.currency);
      const valueMinor = input.valueMinor === undefined ? current.valueMinor : input.valueMinor;
      validateCrmMoney(currency, valueMinor);
      const next: OpportunityRecord = {
        ...current,
        name:
          input.name === undefined
            ? current.name
            : requireCrmText(input.name, 'CRM_OPPORTUNITY_NAME_REQUIRED'),
        pipelineKey:
          input.pipelineKey === undefined
            ? current.pipelineKey
            : requireCrmText(input.pipelineKey, 'CRM_OPPORTUNITY_PIPELINE_REQUIRED'),
        stageKey:
          input.stageKey === undefined
            ? current.stageKey
            : requireCrmText(input.stageKey, 'CRM_OPPORTUNITY_STAGE_REQUIRED'),
        currency,
        valueMinor,
        nextAction:
          input.nextAction === undefined ? current.nextAction : nullableCrmText(input.nextAction),
        nextActionAt:
          input.nextActionAt === undefined
            ? current.nextActionAt
            : normalizeNullableTimestamp(
                input.nextActionAt,
                'CRM_OPPORTUNITY_NEXT_ACTION_AT_INVALID',
              ),
        ownerPrincipalId:
          input.ownerPrincipalId === undefined
            ? current.ownerPrincipalId
            : nullableCrmText(input.ownerPrincipalId),
        expectedCloseAt:
          input.expectedCloseAt === undefined
            ? current.expectedCloseAt
            : normalizeNullableTimestamp(
                input.expectedCloseAt,
                'CRM_OPPORTUNITY_EXPECTED_CLOSE_AT_INVALID',
              ),
        attributes: input.attributes ?? current.attributes,
        version: current.version + 1,
        updatedAt: now,
      };
      validateOpportunityRecord(next);
      const record = await updateOpportunityRow(client, current, next);
      await this.#recordMutation(
        client,
        'OPPORTUNITY',
        record,
        'UPDATED',
        {},
        metadata,
        'opportunity.updated',
      );
      await completeIdempotency(
        client,
        input,
        'opportunity.update',
        record.opportunityId,
        record,
        now,
      );
      return record;
    });
  }

  async transitionOpportunity(input: TransitionOpportunityRecordInput): Promise<OpportunityRecord> {
    const now = normalizeNow(input.now);
    const metadata = normalizeMetadata(input);
    assertCrmVersion(input.expectedVersion);
    return this.#transaction(async (client) => {
      const replay = await beginIdempotency(
        client,
        input,
        'opportunity.transition',
        'OPPORTUNITY',
        input.opportunityId,
      );
      if (replay) return opportunityFromSnapshot(replay);
      const current = await lockOpportunity(client, input);
      assertExpectedVersion(current.version, input.expectedVersion);
      assertCrmOpportunityStatusTransition(current.status, input.status);
      if (current.status === input.status) {
        await completeIdempotency(
          client,
          input,
          'opportunity.transition',
          current.opportunityId,
          current,
          now,
        );
        return current;
      }
      const closing = ['WON', 'LOST', 'CANCELED'].includes(input.status);
      const next: OpportunityRecord = {
        ...current,
        status: input.status,
        closedAt: closing ? now : current.closedAt,
        lossReason:
          input.status === 'LOST'
            ? nullableCrmText(input.lossReason)
            : input.status === 'ARCHIVED'
              ? current.lossReason
              : null,
        version: current.version + 1,
        updatedAt: now,
      };
      validateOpportunityRecord(next);
      const record = await updateOpportunityRow(client, current, next);
      await this.#recordMutation(
        client,
        'OPPORTUNITY',
        record,
        'STATUS_CHANGED',
        { from: current.status, to: record.status },
        metadata,
        'opportunity.status_changed',
      );
      await completeIdempotency(
        client,
        input,
        'opportunity.transition',
        record.opportunityId,
        record,
        now,
      );
      return record;
    });
  }

  async listOpportunitiesForContact(
    input: CrmScope & { readonly contactId: string; readonly limit?: number },
  ): Promise<readonly OpportunityRecord[]> {
    validateCrmScope(input);
    const limit = input.limit ?? 200;
    assertCrmLimit(limit);
    const result = await this.pool.query<OpportunityRow>(
      `select * from crm_opportunities where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4
       order by created_at desc, opportunity_id asc limit $5`,
      [input.tenantId, input.workspaceId, input.organizationId, input.contactId, limit],
    );
    return result.rows.map(opportunityFromRow);
  }

  async listRevisions(
    input: CrmScope & { readonly recordType: CrmRecordType; readonly recordId: string },
  ): Promise<readonly CrmRecordRevision[]> {
    validateCrmScope(input);
    const result = await this.pool.query<RevisionRow>(
      `select * from crm_record_revisions where tenant_id=$1 and workspace_id=$2 and organization_id=$3
         and record_type=$4 and record_id=$5 order by revision asc`,
      [input.tenantId, input.workspaceId, input.organizationId, input.recordType, input.recordId],
    );
    return result.rows.map(revisionFromRow);
  }

  async #recordMutation(
    client: pg.PoolClient,
    recordType: CrmRecordType,
    record: ContactRecord | LeadRecord | OpportunityRecord,
    changeType: string,
    details: Readonly<Record<string, unknown>>,
    metadata: NormalizedMetadata,
    eventTypeSuffix: string,
  ): Promise<void> {
    const recordId = getRecordId(recordType, record);
    await client.query(
      `insert into crm_record_revisions (
         tenant_id,workspace_id,organization_id,record_type,record_id,revision,change_type,snapshot,details,
         evidence,execution_id,correlation_id,actor_principal_id,idempotency_key,created_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15::timestamptz)`,
      [
        record.tenantId,
        record.workspaceId,
        record.organizationId,
        recordType,
        recordId,
        record.version,
        changeType,
        json(record),
        json(details),
        json(metadata.evidence),
        metadata.executionId,
        metadata.correlationId,
        metadata.actorPrincipalId,
        metadata.idempotencyKey,
        metadata.now,
      ],
    );
    await this.#outbox.enqueue(
      client,
      createDomainEvent({
        eventKey: `${metadata.idempotencyKey}:${changeType.toLowerCase()}`,
        eventType: `crm.${eventTypeSuffix}`,
        aggregateType: `crm_${recordType.toLowerCase()}`,
        aggregateId: recordId,
        aggregateVersion: record.version,
        tenantId: record.tenantId,
        workspaceId: record.workspaceId,
        organizationId: record.organizationId,
        correlationId: metadata.correlationId,
        occurredAt: metadata.now,
        payload: { recordType, recordId, revision: record.version, snapshot: record, details },
        evidence: metadata.evidence,
      }),
    );
    await appendInternalAuditLedgerEvent(client, {
      operation: eventTypeSuffix,
      recordType,
      recordId,
      tenantId: record.tenantId,
      workspaceId: record.workspaceId,
      organizationId: record.organizationId,
      executionId: metadata.executionId,
      correlationId: metadata.correlationId,
      actorPrincipalId: metadata.actorPrincipalId,
      evidence: metadata.evidence,
      createdAt: metadata.now,
    });
  }

  async #transaction<T>(action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await action(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      if (isUniqueViolation(error)) throw mapUniqueViolation(error);
      throw error;
    } finally {
      client.release();
    }
  }
}

interface NormalizedMetadata {
  readonly idempotencyKey: string;
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly evidence: readonly string[];
  readonly now: string;
}

function normalizeMetadata(input: CrmMutationMetadata): NormalizedMetadata {
  return {
    idempotencyKey: requireCrmText(input.idempotencyKey, 'CRM_IDEMPOTENCY_KEY_REQUIRED'),
    executionId: requireCrmText(input.executionId, 'CRM_EXECUTION_ID_REQUIRED'),
    correlationId: requireCrmText(input.correlationId, 'CRM_CORRELATION_ID_REQUIRED'),
    actorPrincipalId: requireCrmText(input.actorPrincipalId, 'CRM_ACTOR_PRINCIPAL_ID_REQUIRED'),
    evidence: requireCrmEvidence(input.evidence),
    now: normalizeNow(input.now),
  };
}

async function beginIdempotency(
  client: pg.PoolClient,
  input: CrmScope & CrmMutationMetadata,
  operation: string,
  recordType: CrmRecordType,
  recordId: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  validateCrmScope(input);
  const key = requireCrmText(input.idempotencyKey, 'CRM_IDEMPOTENCY_KEY_REQUIRED');
  const requestHash = hashIntent(input);
  const now = normalizeNow(input.now);
  const inserted = await client.query(
    `insert into crm_idempotency_keys (
       tenant_id,workspace_id,organization_id,operation,idempotency_key,request_hash,record_type,record_id,created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)
     on conflict (tenant_id,workspace_id,organization_id,operation,idempotency_key) do nothing returning idempotency_key`,
    [
      input.tenantId,
      input.workspaceId,
      input.organizationId,
      operation,
      key,
      requestHash,
      recordType,
      recordId,
      now,
    ],
  );
  if (inserted.rowCount === 1) return undefined;
  const existing = await client.query<IdempotencyRow>(
    `select request_hash,record_type,record_id,response_snapshot,completed_at from crm_idempotency_keys
     where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and operation=$4 and idempotency_key=$5 for update`,
    [input.tenantId, input.workspaceId, input.organizationId, operation, key],
  );
  const row = requiredRow(existing.rows[0], 'CRM_IDEMPOTENCY_LOOKUP_FAILED');
  if (row.request_hash !== requestHash || row.record_type !== recordType)
    throw new Error('CRM_IDEMPOTENCY_CONFLICT');
  if (row.completed_at === null || row.response_snapshot === null)
    throw new Error('CRM_IDEMPOTENCY_INCOMPLETE');
  return row.response_snapshot;
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

async function insertChannel(
  client: pg.PoolClient,
  contact: ContactRecord,
  channel: {
    readonly channelId: string;
    readonly channelType: ContactChannelRecord['channelType'];
    readonly provider: string | null;
    readonly value: string;
    readonly normalizedValue: string;
    readonly primary: boolean;
    readonly verifiedAt: string | null;
  },
  evidence: readonly string[],
  now: string,
): Promise<ContactChannelRecord> {
  const result = await client.query<ChannelRow>(
    `insert into crm_contact_channels (
       channel_id,contact_id,tenant_id,workspace_id,organization_id,channel_type,provider,value,normalized_value,
       is_primary,verified_at,evidence,created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::jsonb,$13::timestamptz) returning *`,
    [
      channel.channelId,
      contact.contactId,
      contact.tenantId,
      contact.workspaceId,
      contact.organizationId,
      channel.channelType,
      channel.provider,
      channel.value,
      channel.normalizedValue,
      channel.primary,
      channel.verifiedAt,
      json(evidence),
      now,
    ],
  );
  return channelFromRow(requiredRow(result.rows[0], 'CRM_CONTACT_CHANNEL_INSERT_FAILED'));
}

async function lockContact(
  client: pg.PoolClient,
  input: CrmScope & { readonly contactId: string },
): Promise<ContactRecord> {
  const result = await client.query<ContactRow>(
    `select * from crm_contacts where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4 for update`,
    [input.tenantId, input.workspaceId, input.organizationId, input.contactId],
  );
  return contactFromRow(requiredRow(result.rows[0], 'CRM_CONTACT_NOT_FOUND'));
}

async function lockLead(
  client: pg.PoolClient,
  input: CrmScope & { readonly leadId: string },
): Promise<LeadRecord> {
  const result = await client.query<LeadRow>(
    `select * from crm_leads where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4 for update`,
    [input.tenantId, input.workspaceId, input.organizationId, input.leadId],
  );
  return leadFromRow(requiredRow(result.rows[0], 'CRM_LEAD_NOT_FOUND'));
}

async function lockOpportunity(
  client: pg.PoolClient,
  input: CrmScope & { readonly opportunityId: string },
): Promise<OpportunityRecord> {
  const result = await client.query<OpportunityRow>(
    `select * from crm_opportunities where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and opportunity_id=$4 for update`,
    [input.tenantId, input.workspaceId, input.organizationId, input.opportunityId],
  );
  return opportunityFromRow(requiredRow(result.rows[0], 'CRM_OPPORTUNITY_NOT_FOUND'));
}

async function assertContactExists(
  client: pg.PoolClient,
  scope: CrmScope,
  contactId: string,
): Promise<void> {
  const result = await client.query(
    `select contact_id from crm_contacts where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and contact_id=$4`,
    [scope.tenantId, scope.workspaceId, scope.organizationId, contactId],
  );
  if (result.rowCount !== 1) throw new Error('CRM_CONTACT_NOT_FOUND');
}

async function getLeadForLink(
  client: pg.PoolClient,
  scope: CrmScope,
  leadId: string,
): Promise<LeadRecord> {
  const result = await client.query<LeadRow>(
    `select * from crm_leads where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and lead_id=$4`,
    [scope.tenantId, scope.workspaceId, scope.organizationId, leadId],
  );
  return leadFromRow(requiredRow(result.rows[0], 'CRM_LEAD_NOT_FOUND'));
}

async function assertEventScope(
  client: pg.PoolClient,
  scope: CrmScope,
  eventId: string,
): Promise<void> {
  const result = await client.query<{
    tenant_id: string;
    workspace_id: string;
    organization_id: string;
  }>('select tenant_id,workspace_id,organization_id from event_records where event_id=$1', [
    eventId,
  ]);
  const row = requiredRow(result.rows[0], 'CRM_EVENT_RECORD_NOT_FOUND');
  if (
    row.tenant_id !== scope.tenantId ||
    row.workspace_id !== scope.workspaceId ||
    row.organization_id !== scope.organizationId
  ) {
    throw new Error('CRM_EVENT_RECORD_SCOPE_CONFLICT');
  }
}

async function updateOpportunityRow(
  client: pg.PoolClient,
  current: OpportunityRecord,
  next: OpportunityRecord,
): Promise<OpportunityRecord> {
  const result = await client.query<OpportunityRow>(
    `update crm_opportunities set name=$5,pipeline_key=$6,stage_key=$7,status=$8,currency=$9,value_minor=$10,
       next_action=$11,next_action_at=$12::timestamptz,owner_principal_id=$13,expected_close_at=$14::timestamptz,
       closed_at=$15::timestamptz,loss_reason=$16,attributes=$17::jsonb,version=$18,updated_at=$19::timestamptz
     where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and opportunity_id=$4 and version=$20 returning *`,
    [
      current.tenantId,
      current.workspaceId,
      current.organizationId,
      current.opportunityId,
      next.name,
      next.pipelineKey,
      next.stageKey,
      next.status,
      next.currency,
      next.valueMinor,
      next.nextAction,
      next.nextActionAt,
      next.ownerPrincipalId,
      next.expectedCloseAt,
      next.closedAt,
      next.lossReason,
      json(next.attributes),
      next.version,
      next.updatedAt,
      current.version,
    ],
  );
  return opportunityFromRow(requiredRow(result.rows[0], 'CRM_OPPORTUNITY_CONCURRENT_UPDATE'));
}

function contactFromRow(row: ContactRow): ContactRecord {
  const record: ContactRecord = {
    contactId: row.contact_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactType: row.contact_type,
    displayName: row.display_name,
    status: row.status,
    attributes: asAttributes(row.attributes),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  validateContactRecord(record);
  return record;
}

function channelFromRow(row: ChannelRow): ContactChannelRecord {
  return {
    channelId: row.channel_id,
    contactId: row.contact_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    channelType: row.channel_type,
    provider: row.provider,
    value: row.value,
    normalizedValue: row.normalized_value,
    primary: row.is_primary,
    verifiedAt: isoNullable(row.verified_at),
    evidence: asEvidence(row.evidence),
    createdAt: iso(row.created_at),
  };
}

function leadFromRow(row: LeadRow): LeadRecord {
  const score = row.score === null ? null : Number(row.score);
  const record: LeadRecord = {
    leadId: row.lead_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    eventId: row.event_id,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    status: row.status,
    qualification: row.qualification,
    score,
    ownerPrincipalId: row.owner_principal_id,
    slaDueAt: isoNullable(row.sla_due_at),
    capturedAt: iso(row.captured_at),
    qualifiedAt: isoNullable(row.qualified_at),
    convertedAt: isoNullable(row.converted_at),
    disqualifiedReason: row.disqualified_reason,
    attributes: asAttributes(row.attributes),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  validateLeadRecord(record);
  return record;
}

function opportunityFromRow(row: OpportunityRow): OpportunityRecord {
  const valueMinor = row.value_minor === null ? null : Number(row.value_minor);
  if (valueMinor !== null && !Number.isSafeInteger(valueMinor))
    throw new Error('CRM_VALUE_MINOR_UNSAFE');
  const record: OpportunityRecord = {
    opportunityId: row.opportunity_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    leadId: row.lead_id,
    eventId: row.event_id,
    name: row.name,
    pipelineKey: row.pipeline_key,
    stageKey: row.stage_key,
    status: row.status,
    currency: row.currency,
    valueMinor,
    nextAction: row.next_action,
    nextActionAt: isoNullable(row.next_action_at),
    ownerPrincipalId: row.owner_principal_id,
    expectedCloseAt: isoNullable(row.expected_close_at),
    closedAt: isoNullable(row.closed_at),
    lossReason: row.loss_reason,
    attributes: asAttributes(row.attributes),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  validateOpportunityRecord(record);
  return record;
}

function revisionFromRow(row: RevisionRow): CrmRecordRevision {
  return {
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    recordType: row.record_type,
    recordId: row.record_id,
    revision: row.revision,
    changeType: row.change_type,
    snapshot: snapshotForType(row.record_type, row.snapshot),
    details: asObject(row.details),
    evidence: asEvidence(row.evidence),
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    actorPrincipalId: row.actor_principal_id,
    idempotencyKey: row.idempotency_key,
    createdAt: iso(row.created_at),
  };
}

function contactFromSnapshot(value: unknown): ContactRecord {
  const record = value as ContactRecord;
  validateContactRecord(record);
  return record;
}
function channelFromSnapshot(value: unknown): ContactChannelRecord {
  const channel = value as ContactChannelRecord;
  requireCrmText(channel.channelId, 'CRM_CONTACT_CHANNEL_ID_REQUIRED');
  return channel;
}
function leadFromSnapshot(value: unknown): LeadRecord {
  const record = value as LeadRecord;
  validateLeadRecord(record);
  return record;
}
function opportunityFromSnapshot(value: unknown): OpportunityRecord {
  const record = value as OpportunityRecord;
  validateOpportunityRecord(record);
  return record;
}
function snapshotForType(
  type: CrmRecordType,
  value: unknown,
): ContactRecord | LeadRecord | OpportunityRecord {
  if (type === 'CONTACT') return contactFromSnapshot(value);
  if (type === 'LEAD') return leadFromSnapshot(value);
  return opportunityFromSnapshot(value);
}

function getRecordId(
  type: CrmRecordType,
  record: ContactRecord | LeadRecord | OpportunityRecord,
): string {
  if (type === 'CONTACT') return (record as ContactRecord).contactId;
  if (type === 'LEAD') return (record as LeadRecord).leadId;
  return (record as OpportunityRecord).opportunityId;
}

function assertDistinctChannels(
  channels: readonly { channelType: string; provider: string | null; normalizedValue: string }[],
): void {
  const keys = new Set<string>();
  for (const channel of channels) {
    const key = `${channel.channelType}|${channel.provider ?? ''}|${channel.normalizedValue}`;
    if (keys.has(key)) throw new Error('CRM_CONTACT_CHANNEL_DUPLICATE_INPUT');
    keys.add(key);
  }
}

function hashIntent(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
function assertExpectedVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`CRM_VERSION_CONFLICT:${expected}:${actual}`);
}
function normalizeNow(value: string | undefined): string {
  return value === undefined
    ? new Date().toISOString()
    : normalizeCrmTimestamp(value, 'CRM_NOW_INVALID');
}
function json(value: unknown): string {
  return JSON.stringify(value);
}
function iso(value: Date | string): string {
  return new Date(value).toISOString();
}
function isoNullable(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}
function asAttributes(value: unknown): ContactRecord['attributes'] {
  const object = asObject(value) as Record<string, string | number | boolean | null>;
  validateCrmAttributes(object);
  return object;
}
function asObject(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('CRM_JSON_OBJECT_INVALID');
  return value as Readonly<Record<string, unknown>>;
}
function asEvidence(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
    throw new Error('CRM_EVIDENCE_INVALID');
  return requireCrmEvidence(value);
}
function requiredRow<T>(row: T | undefined, errorCode: string): T {
  if (row === undefined) throw new Error(errorCode);
  return row;
}
function isUniqueViolation(error: unknown): error is { code: string; constraint?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
function mapUniqueViolation(error: { code: string; constraint?: string }): Error {
  const constraint = error.constraint ?? '';
  if (constraint.includes('crm_contact_channels') && constraint.includes('normalized'))
    return new Error('CRM_CONTACT_DUPLICATE_CHANNEL');
  if (constraint.includes('primary')) return new Error('CRM_CONTACT_PRIMARY_CHANNEL_CONFLICT');
  return new Error('CRM_RECORD_ID_CONFLICT');
}
