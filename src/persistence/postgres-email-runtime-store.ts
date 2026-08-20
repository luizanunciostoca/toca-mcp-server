import type pg from 'pg';
import type { CrmScope } from '../crm/crm-records.js';
import type { EmailDispatchOrchestrationStore } from '../omnichannel/email-orchestrator.js';
import type {
  EmailDeliveryState,
  EmailDispatchRecord,
  EmailProviderEventRecord,
  EmailRateLimitDecision,
  EmailRateLimitPolicy,
  EmailThreadBinding,
} from '../omnichannel/email-runtime.js';

interface EmailDispatchRow {
  readonly dispatch_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly message_id: string;
  readonly idempotency_key: string;
  readonly provider: string;
  readonly provider_message_ref: string | null;
  readonly state: EmailDeliveryState;
  readonly attempt_count: number;
  readonly next_retry_at: Date | string | null;
  readonly last_error: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface EmailThreadRow {
  readonly binding_id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly conversation_id: string;
  readonly contact_id: string;
  readonly provider: string;
  readonly provider_message_ref: string | null;
  readonly internet_message_id: string;
  readonly in_reply_to: string | null;
  readonly reference_message_ids: unknown;
  readonly created_at: Date | string;
}

interface RateLimitRow {
  readonly window_started_at: Date | string;
  readonly window_seconds: number;
  readonly capacity: number;
  readonly consumed: number;
}

export class PostgresEmailRuntimeStore implements EmailDispatchOrchestrationStore {
  constructor(private readonly pool: pg.Pool) {}

  async findDispatchByIdempotencyKey(
    scope: CrmScope,
    idempotencyKey: string,
  ): Promise<EmailDispatchRecord | undefined> {
    validateScope(scope);
    const key = requireText(idempotencyKey, 'EMAIL_IDEMPOTENCY_KEY_REQUIRED');
    const result = await this.pool.query<EmailDispatchRow>(
      `select * from email_dispatches
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and idempotency_key=$4
        limit 1`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, key],
    );
    return result.rows[0] ? mapDispatch(result.rows[0]) : undefined;
  }

  async findDispatchByProviderMessageRef(
    scope: CrmScope,
    provider: string,
    providerMessageRef: string,
  ): Promise<EmailDispatchRecord | undefined> {
    validateScope(scope);
    const providerKey = requireText(provider, 'EMAIL_PROVIDER_REQUIRED');
    const ref = requireText(providerMessageRef, 'EMAIL_PROVIDER_MESSAGE_REF_REQUIRED');
    const result = await this.pool.query<EmailDispatchRow>(
      `select * from email_dispatches
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and provider=$4 and provider_message_ref=$5
        limit 1`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, providerKey, ref],
    );
    return result.rows[0] ? mapDispatch(result.rows[0]) : undefined;
  }

  async saveDispatch(record: EmailDispatchRecord): Promise<void> {
    validateScope(record);
    await this.pool.query(
      `insert into email_dispatches (
         dispatch_id, tenant_id, workspace_id, organization_id, message_id,
         idempotency_key, provider, provider_message_ref, state, attempt_count,
         next_retry_at, last_error, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (tenant_id, workspace_id, organization_id, idempotency_key)
       do update set
         provider_message_ref=excluded.provider_message_ref,
         state=excluded.state,
         attempt_count=excluded.attempt_count,
         next_retry_at=excluded.next_retry_at,
         last_error=excluded.last_error,
         updated_at=excluded.updated_at
       where email_dispatches.dispatch_id=excluded.dispatch_id
         and email_dispatches.message_id=excluded.message_id
         and email_dispatches.provider=excluded.provider`,
      [
        record.dispatchId,
        record.tenantId,
        record.workspaceId,
        record.organizationId,
        record.messageId,
        record.idempotencyKey,
        record.provider,
        record.providerMessageRef,
        record.state,
        record.attemptCount,
        record.nextRetryAt,
        record.lastError,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async findThreadBindingByInternetMessageIds(
    scope: CrmScope,
    messageIds: readonly string[],
  ): Promise<EmailThreadBinding | undefined> {
    validateScope(scope);
    if (messageIds.length === 0) return undefined;
    const ids = [
      ...new Set(messageIds.map((value) => requireText(value, 'EMAIL_MESSAGE_ID_REQUIRED'))),
    ];
    const result = await this.pool.query<EmailThreadRow>(
      `select * from email_thread_bindings
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and internet_message_id = any($4::text[])
        order by created_at desc, binding_id desc
        limit 1`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, ids],
    );
    return result.rows[0] ? mapThread(result.rows[0]) : undefined;
  }

  async persistThreadBinding(binding: EmailThreadBinding): Promise<void> {
    validateScope(binding);
    await this.pool.query(
      `insert into email_thread_bindings (
         binding_id, tenant_id, workspace_id, organization_id, conversation_id, contact_id,
         provider, provider_message_ref, internet_message_id, in_reply_to, reference_message_ids, created_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
       on conflict (tenant_id, workspace_id, organization_id, provider, internet_message_id)
       do update set
         provider_message_ref=coalesce(email_thread_bindings.provider_message_ref, excluded.provider_message_ref),
         in_reply_to=coalesce(email_thread_bindings.in_reply_to, excluded.in_reply_to),
         reference_message_ids=excluded.reference_message_ids
       where email_thread_bindings.conversation_id=excluded.conversation_id
         and email_thread_bindings.contact_id=excluded.contact_id`,
      [
        binding.bindingId,
        binding.tenantId,
        binding.workspaceId,
        binding.organizationId,
        binding.conversationId,
        binding.contactId,
        binding.provider,
        binding.providerMessageRef,
        binding.internetMessageId,
        binding.inReplyTo,
        JSON.stringify(binding.references),
        binding.createdAt,
      ],
    );
  }

  async hasProviderEvent(scope: CrmScope, providerEventId: string): Promise<boolean> {
    validateScope(scope);
    const id = requireText(providerEventId, 'EMAIL_PROVIDER_EVENT_ID_REQUIRED');
    const result = await this.pool.query<{ readonly exists: boolean }>(
      `select exists(
         select 1 from email_provider_events
          where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and provider_event_id=$4
       ) as exists`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, id],
    );
    return result.rows[0]?.exists === true;
  }

  async appendProviderEvent(event: EmailProviderEventRecord): Promise<void> {
    validateScope(event);
    const result = await this.pool.query(
      `insert into email_provider_events (
         event_id, tenant_id, workspace_id, organization_id, provider_event_id,
         provider, provider_message_ref, message_id, event_type, delivery_state,
         occurred_at, payload_sha256, evidence
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
       on conflict (tenant_id, workspace_id, organization_id, provider, provider_event_id)
       do nothing`,
      [
        event.eventId,
        event.tenantId,
        event.workspaceId,
        event.organizationId,
        event.providerEventId,
        event.provider,
        event.providerMessageRef,
        event.messageId,
        event.eventType,
        event.deliveryState,
        event.occurredAt,
        event.payloadSha256,
        JSON.stringify(event.evidence),
      ],
    );
    if (result.rowCount !== 1 && result.rowCount !== 0) {
      throw new Error('EMAIL_PROVIDER_EVENT_INSERT_RESULT_INVALID');
    }
  }

  async consumeRateLimit(
    scope: CrmScope,
    bucketKey: string,
    policy: EmailRateLimitPolicy,
    now: string,
  ): Promise<EmailRateLimitDecision> {
    validateScope(scope);
    const bucket = requireText(bucketKey, 'EMAIL_RATE_LIMIT_BUCKET_REQUIRED');
    validateRateLimitPolicy(policy);
    const nowMs = timestampMs(now, 'EMAIL_RATE_LIMIT_NOW_INVALID');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<RateLimitRow>(
        `select window_started_at, window_seconds, capacity, consumed
           from email_rate_limit_buckets
          where tenant_id=$1 and workspace_id=$2 and organization_id=$3
            and provider=$4 and bucket_key=$5
          for update`,
        [scope.tenantId, scope.workspaceId, scope.organizationId, 'twilio-sendgrid', bucket],
      );
      const row = result.rows[0];
      if (!row) {
        await client.query(
          `insert into email_rate_limit_buckets (
             tenant_id, workspace_id, organization_id, provider, bucket_key,
             window_started_at, window_seconds, capacity, consumed, updated_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,1,$6)`,
          [
            scope.tenantId,
            scope.workspaceId,
            scope.organizationId,
            'twilio-sendgrid',
            bucket,
            now,
            policy.windowSeconds,
            policy.capacity,
          ],
        );
        await client.query('commit');
        return { allowed: true, remaining: policy.capacity - 1, retryAt: null };
      }

      const startedMs = timestampMs(
        toIso(row.window_started_at),
        'EMAIL_RATE_LIMIT_WINDOW_INVALID',
      );
      const configuredWindowMs = policy.windowSeconds * 1000;
      if (nowMs >= startedMs + configuredWindowMs) {
        await client.query(
          `update email_rate_limit_buckets
              set window_started_at=$6, window_seconds=$7, capacity=$8, consumed=1, updated_at=$6
            where tenant_id=$1 and workspace_id=$2 and organization_id=$3
              and provider=$4 and bucket_key=$5`,
          [
            scope.tenantId,
            scope.workspaceId,
            scope.organizationId,
            'twilio-sendgrid',
            bucket,
            now,
            policy.windowSeconds,
            policy.capacity,
          ],
        );
        await client.query('commit');
        return { allowed: true, remaining: policy.capacity - 1, retryAt: null };
      }

      if (row.consumed >= policy.capacity) {
        const retryAt = new Date(startedMs + configuredWindowMs).toISOString();
        await client.query('commit');
        return { allowed: false, remaining: 0, retryAt };
      }

      const consumed = row.consumed + 1;
      await client.query(
        `update email_rate_limit_buckets
            set window_seconds=$6, capacity=$7, consumed=$8, updated_at=$9
          where tenant_id=$1 and workspace_id=$2 and organization_id=$3
            and provider=$4 and bucket_key=$5`,
        [
          scope.tenantId,
          scope.workspaceId,
          scope.organizationId,
          'twilio-sendgrid',
          bucket,
          policy.windowSeconds,
          policy.capacity,
          consumed,
          now,
        ],
      );
      await client.query('commit');
      return { allowed: true, remaining: Math.max(0, policy.capacity - consumed), retryAt: null };
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // Preserve the original failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapDispatch(row: EmailDispatchRow): EmailDispatchRecord {
  return {
    dispatchId: row.dispatch_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    messageId: row.message_id,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    providerMessageRef: row.provider_message_ref,
    state: row.state,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at ? toIso(row.next_retry_at) : null,
    lastError: row.last_error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapThread(row: EmailThreadRow): EmailThreadBinding {
  return {
    bindingId: row.binding_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    provider: row.provider,
    providerMessageRef: row.provider_message_ref,
    internetMessageId: row.internet_message_id,
    inReplyTo: row.in_reply_to,
    references: parseStringArray(row.reference_message_ids, 'EMAIL_THREAD_REFERENCES_INVALID'),
    createdAt: toIso(row.created_at),
  };
}

function parseStringArray(value: unknown, code: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new Error(code);
  return value as readonly string[];
}

function validateRateLimitPolicy(policy: EmailRateLimitPolicy): void {
  if (!Number.isInteger(policy.capacity) || policy.capacity < 1) {
    throw new Error('EMAIL_RATE_LIMIT_CAPACITY_INVALID');
  }
  if (!Number.isInteger(policy.windowSeconds) || policy.windowSeconds < 1) {
    throw new Error('EMAIL_RATE_LIMIT_WINDOW_INVALID');
  }
}

function validateScope(scope: CrmScope): void {
  requireText(scope.tenantId, 'EMAIL_TENANT_ID_REQUIRED');
  requireText(scope.workspaceId, 'EMAIL_WORKSPACE_ID_REQUIRED');
  requireText(scope.organizationId, 'EMAIL_ORGANIZATION_ID_REQUIRED');
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('EMAIL_TIMESTAMP_INVALID');
  return date.toISOString();
}

function timestampMs(value: string, code: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(code);
  return ms;
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
