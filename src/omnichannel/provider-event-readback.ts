import type pg from 'pg';
import type { CrmScope } from '../crm/crm-records.js';
import type { ProviderMessageReadback } from './contracts.js';

const SENDGRID_PROVIDER_KEY = 'twilio-sendgrid';
const WHATSAPP_PROVIDER_KEY = 'META_WHATSAPP_CLOUD';

export interface OmnichannelProviderEventReadbackInput extends CrmScope {
  readonly providerMessageId: string;
}

export interface OmnichannelProviderEventReadbackService {
  readEmail(input: OmnichannelProviderEventReadbackInput): Promise<ProviderMessageReadback>;
  readWhatsApp(input: OmnichannelProviderEventReadbackInput): Promise<ProviderMessageReadback>;
  /** Existing PostgreSQL composition source used by the outbound Email binding. */
  emailRuntimePool?(): pg.Pool;
}

interface EmailDispatchRow {
  readonly state: string;
  readonly updated_at: Date | string;
}

interface EmailEventRow {
  readonly event_type: string;
  readonly delivery_state: string | null;
  readonly occurred_at: Date | string;
  readonly evidence: unknown;
}

interface WhatsAppDispatchRow {
  readonly state: string;
  readonly updated_at: Date | string;
}

interface WhatsAppEventRow {
  readonly status: string;
  readonly observed_at: Date | string;
  readonly evidence: unknown;
}

/**
 * Read-only, tenant-scoped projection over provider evidence already persisted
 * by the signed SendGrid and Meta WhatsApp webhook boundaries. This creates no
 * second delivery ledger and performs no provider mutation.
 */
export class PostgresOmnichannelProviderEventReadback implements OmnichannelProviderEventReadbackService {
  constructor(private readonly pool: pg.Pool) {}

  emailRuntimePool(): pg.Pool {
    return this.pool;
  }

  async readEmail(input: OmnichannelProviderEventReadbackInput): Promise<ProviderMessageReadback> {
    validateInput(input);
    const dispatch = await this.pool.query<EmailDispatchRow>(
      `select state, updated_at
         from email_dispatches
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and provider=$4 and provider_message_ref=$5
        limit 1`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        SENDGRID_PROVIDER_KEY,
        input.providerMessageId,
      ],
    );
    const dispatchRow = dispatch.rows[0];
    if (!dispatchRow) throw new Error('EMAIL_DELIVERY_READBACK_DISPATCH_NOT_FOUND');

    const events = await this.pool.query<EmailEventRow>(
      `select event_type, delivery_state, occurred_at, evidence
         from email_provider_events
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and provider=$4 and provider_message_ref=$5
        order by occurred_at desc, event_id desc
        limit 1`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        SENDGRID_PROVIDER_KEY,
        input.providerMessageId,
      ],
    );
    const event = events.rows[0];
    const sourceState = event?.delivery_state ?? dispatchRow.state;
    const evidence = event
      ? [
          `sendgrid:event:${requireText(event.event_type, 'EMAIL_DELIVERY_EVENT_TYPE_REQUIRED')}`,
          ...evidenceArray(event.evidence, 'EMAIL_DELIVERY_EVENT_EVIDENCE_INVALID'),
        ]
      : [`sendgrid:dispatch-state:${dispatchRow.state}`];

    return {
      provider: SENDGRID_PROVIDER_KEY,
      providerMessageId: input.providerMessageId,
      state: emailState(sourceState),
      observedAt: iso(event?.occurred_at ?? dispatchRow.updated_at),
      evidence,
    };
  }

  async readWhatsApp(
    input: OmnichannelProviderEventReadbackInput,
  ): Promise<ProviderMessageReadback> {
    validateInput(input);
    const dispatch = await this.pool.query<WhatsAppDispatchRow>(
      `select state, updated_at
         from whatsapp_dispatches
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and provider=$4 and provider_message_ref=$5
        limit 1`,
      [
        input.tenantId,
        input.workspaceId,
        input.organizationId,
        WHATSAPP_PROVIDER_KEY,
        input.providerMessageId,
      ],
    );
    const dispatchRow = dispatch.rows[0];
    if (!dispatchRow) throw new Error('WHATSAPP_MESSAGE_READBACK_DISPATCH_NOT_FOUND');

    const events = await this.pool.query<WhatsAppEventRow>(
      `select status, observed_at, evidence
         from whatsapp_provider_events
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and provider_message_ref=$4
        order by observed_at desc, event_id desc
        limit 1`,
      [input.tenantId, input.workspaceId, input.organizationId, input.providerMessageId],
    );
    const event = events.rows[0];
    const evidence = event
      ? [
          `whatsapp:provider-event:${requireText(event.status, 'WHATSAPP_READBACK_STATUS_REQUIRED')}`,
          ...evidenceArray(event.evidence, 'WHATSAPP_READBACK_EVIDENCE_INVALID'),
        ]
      : [`whatsapp:dispatch-state:${dispatchRow.state}`];

    return {
      provider: WHATSAPP_PROVIDER_KEY,
      providerMessageId: input.providerMessageId,
      state: whatsappState(event?.status ?? dispatchRow.state),
      observedAt: iso(event?.observed_at ?? dispatchRow.updated_at),
      evidence,
    };
  }
}

function validateInput(input: OmnichannelProviderEventReadbackInput): void {
  requireText(input.tenantId, 'OMNICHANNEL_READBACK_TENANT_REQUIRED');
  requireText(input.workspaceId, 'OMNICHANNEL_READBACK_WORKSPACE_REQUIRED');
  requireText(input.organizationId, 'OMNICHANNEL_READBACK_ORGANIZATION_REQUIRED');
  requireText(input.providerMessageId, 'OMNICHANNEL_READBACK_PROVIDER_MESSAGE_REQUIRED');
}

function emailState(value: string): ProviderMessageReadback['state'] {
  switch (value) {
    case 'DELIVERED':
      return 'DELIVERED';
    case 'ACCEPTED':
    case 'PROCESSED':
      return 'SENT';
    case 'BOUNCED':
    case 'FAILED':
      return 'FAILED';
    case 'COMPLAINT':
    case 'UNSUBSCRIBED':
    case 'DROPPED':
      return 'REJECTED';
    case 'PREPARED':
    case 'SUBMITTED':
    case 'DEFERRED':
      return 'QUEUED';
    default:
      return 'UNKNOWN';
  }
}

function whatsappState(value: string): ProviderMessageReadback['state'] {
  switch (value) {
    case 'SENT':
      return 'SENT';
    case 'DELIVERED':
    case 'READ':
      return 'DELIVERED';
    case 'FAILED':
    case 'FAILED_RETRYABLE':
    case 'DEAD_LETTER':
      return 'FAILED';
    case 'PREPARED':
    case 'SUBMITTED':
      return 'QUEUED';
    default:
      return 'UNKNOWN';
  }
}

function evidenceArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(code);
  const evidence = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  if (evidence.length === 0) throw new Error(code);
  return evidence;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('OMNICHANNEL_READBACK_TIMESTAMP_INVALID');
  return date.toISOString();
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
