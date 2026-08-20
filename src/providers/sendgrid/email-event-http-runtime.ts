import { createHash } from 'node:crypto';
import type pg from 'pg';
import { EnvironmentSecretResolver } from '../../core/environment-secret-resolver.js';
import type { SecretResolver } from '../../core/secrets.js';
import { ToolRegistry } from '../../core/tool-registry.js';
import {
  EmailProviderEventProcessor,
  type EmailEngagementAuthorizationPort,
  type EmailProviderEventContextPort,
  type EmailProviderEventProcessResult,
} from '../../omnichannel/email-orchestrator.js';
import type {
  EmailDispatchRecord,
  EmailPrivacyReconciliationPort,
} from '../../omnichannel/email-runtime.js';
import { PostgresApprovalStore } from '../../persistence/postgres-approval-store.js';
import { PostgresAuditSink } from '../../persistence/postgres-audit-sink.js';
import { PostgresEmailRuntimeStore } from '../../persistence/postgres-email-runtime-store.js';
import { PostgresPrivacyLedgerStore } from '../../persistence/postgres-privacy-ledger-store.js';
import { registerPrivacyAuditCapabilities } from '../../privacy/capability-registry.js';
import type {
  PrivacyDataGateway,
  PrivacyPurposeDefinition,
  PrivacyPurposeRegistry,
  PrivacyScope,
  SuppressionReason,
} from '../../privacy/contracts.js';
import { PrivacyGovernanceService } from '../../privacy/privacy-governance.js';
import {
  SENDGRID_PROVIDER_KEY,
  SendGridEmailProvider,
  type SendGridPreparedCampaignResolver,
  type SendGridWebhookEvent,
} from './email-provider.js';
import { loadSendGridRuntimeConfig } from './runtime-config.js';

const EVENT_TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';
const EVENT_SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';

export interface SendGridEventWebhookHeaders {
  readonly [EVENT_TIMESTAMP_HEADER]: string | readonly string[] | undefined;
  readonly [EVENT_SIGNATURE_HEADER]: string | readonly string[] | undefined;
}

export interface SendGridEventWebhookResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly ignored: number;
  readonly privacyReconciled: number;
  readonly eventIds: readonly string[];
}

export interface SendGridEventHttpRuntimeOptions {
  readonly pool: pg.Pool;
  readonly env?: NodeJS.ProcessEnv;
  readonly secretResolver?: SecretResolver;
  readonly engagementAuthorization?: EmailEngagementAuthorizationPort;
}

interface DispatchScopeRow {
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly organization_id: string;
  readonly idempotency_key: string;
}

interface PrivacyPurposeRow {
  readonly purpose_id: string;
  readonly policy_ref: string;
  readonly ledger_sequence: string | number;
}

interface MessageContextRow {
  readonly contact_id: string;
}

interface PrivacyReconciliationStateRow {
  readonly capability_id: string;
}

/**
 * Signed production boundary for Twilio SendGrid Event Webhook. Provider
 * transport metadata is correlated back into canonical CRM/Privacy records;
 * this module deliberately owns no Message, Conversation or suppression model.
 */
export class SendGridEventHttpRuntime {
  constructor(
    private readonly provider: SendGridEmailProvider,
    private readonly dispatchResolver: PostgresSendGridWebhookDispatchResolver,
    private readonly processor: EmailProviderEventProcessor,
    private readonly privacy: PostgresEmailPrivacyReconciliationPort,
    private readonly context: EmailProviderEventContextPort,
  ) {}

  async handleEventWebhook(
    rawBody: Buffer,
    headers: SendGridEventWebhookHeaders,
  ): Promise<SendGridEventWebhookResult> {
    const timestamp = singleHeader(headers[EVENT_TIMESTAMP_HEADER]);
    const signature = singleHeader(headers[EVENT_SIGNATURE_HEADER]);
    if (!timestamp) throw new Error('SENDGRID_EVENT_WEBHOOK_TIMESTAMP_REQUIRED');
    if (!signature) throw new Error('SENDGRID_EVENT_WEBHOOK_SIGNATURE_REQUIRED');
    if (!this.provider.verifySignedEventWebhook(rawBody, timestamp, signature)) {
      throw new Error('SENDGRID_EVENT_WEBHOOK_SIGNATURE_INVALID');
    }

    const payloadSha256 = createHash('sha256').update(rawBody).digest('hex');
    const events = this.provider.normalizeEventWebhook(rawBody);
    const results: EmailProviderEventProcessResult[] = [];
    const eventIds: string[] = [];
    let ignoredWithoutDispatch = 0;

    for (const event of events) {
      eventIds.push(event.providerEventId);
      const dispatch = await this.dispatchResolver.resolve({
        providerMessageRef: event.providerMessageId,
        idempotencyKey: extractTocaIdempotencyKey(event.raw),
        observedAt: event.occurredAt,
      });
      if (!dispatch) {
        ignoredWithoutDispatch += 1;
        continue;
      }

      const executionId = `sendgrid-event:${stableOpaqueId(event.providerEventId)}`;
      const correlationId = executionId;

      // Reconcile suppressing provider signals before provider-event dedupe. The
      // adapter itself is idempotent, so a retry cannot lose a suppression if a
      // previous attempt failed between Privacy and provider-event persistence.
      if (event.privacySignal) {
        const privacyContext = await this.context.resolvePrivacyContext({
          tenantId: dispatch.tenantId,
          workspaceId: dispatch.workspaceId,
          organizationId: dispatch.organizationId,
          messageId: dispatch.messageId,
          provider: SENDGRID_PROVIDER_KEY,
          providerMessageRef: event.providerMessageId,
        });
        await this.privacy.reconcileProviderSignal({
          tenantId: dispatch.tenantId,
          workspaceId: dispatch.workspaceId,
          organizationId: dispatch.organizationId,
          capabilityId: 'privacy.provider_consent.reconcile',
          subjectRef: privacyContext.subjectRef,
          provider: SENDGRID_PROVIDER_KEY,
          providerSubjectRef: privacyContext.providerSubjectRef,
          providerState: event.privacySignal,
          observedAt: event.occurredAt,
          providerEvidenceRef: `sendgrid-event:${stableOpaqueId(event.providerEventId)}`,
          executionId,
          correlationId,
        });
      }

      const result = await this.processor.process({
        tenantId: dispatch.tenantId,
        workspaceId: dispatch.workspaceId,
        organizationId: dispatch.organizationId,
        provider: SENDGRID_PROVIDER_KEY,
        event: normalizedProcessorEvent(event),
        rawPayloadSha256: payloadSha256,
        signatureEvidence: [
          'sendgrid:event-webhook:ecdsa-valid',
          `sendgrid:payload-sha256:${payloadSha256}`,
        ],
        executionId,
        correlationId,
      });
      results.push(result);
    }

    return {
      accepted: results.filter((result) => !result.duplicate && !result.ignored).length,
      duplicates: results.filter((result) => result.duplicate).length,
      ignored: ignoredWithoutDispatch + results.filter((result) => result.ignored).length,
      privacyReconciled: results.filter((result) => result.privacyReconciled).length,
      eventIds,
    };
  }
}

export async function createSendGridEventHttpRuntime(
  options: SendGridEventHttpRuntimeOptions,
): Promise<SendGridEventHttpRuntime | undefined> {
  const env = options.env ?? process.env;
  const loaded = await loadSendGridRuntimeConfig({
    env,
    secretResolver: options.secretResolver ?? new EnvironmentSecretResolver(),
  });
  if (!loaded.enabled || !loaded.config) return undefined;
  if (!loaded.config.eventWebhookPublicKeyPem?.trim()) {
    throw new Error('SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY_REQUIRED');
  }

  const dispatchStore = new PostgresEmailRuntimeStore(options.pool);
  const privacyStore = new PostgresPrivacyLedgerStore(options.pool);
  const privacyRegistry = new ToolRegistry();
  registerPrivacyAuditCapabilities(privacyRegistry);
  const privacy = new PrivacyGovernanceService({
    store: privacyStore,
    purposeRegistry: new LedgerBackedPrivacyPurposeRegistry(options.pool),
    auditSink: new PostgresAuditSink(options.pool, privacyRegistry),
    approvalStore: new PostgresApprovalStore(options.pool),
    dataGateway: FAIL_CLOSED_PRIVACY_DATA_GATEWAY,
  });
  const privacyPort = new PostgresEmailPrivacyReconciliationPort(options.pool, privacy);
  const contextPort = new PostgresEmailProviderEventContextPort(options.pool);
  const processor = new EmailProviderEventProcessor(
    dispatchStore,
    privacyPort,
    contextPort,
    options.engagementAuthorization ?? FAIL_CLOSED_ENGAGEMENT_AUTHORIZATION,
  );
  const provider = new SendGridEmailProvider(loaded.config, EVENT_ONLY_PREPARED_RESOLVER);
  const dispatchResolver = new PostgresSendGridWebhookDispatchResolver(options.pool, dispatchStore);
  return new SendGridEventHttpRuntime(
    provider,
    dispatchResolver,
    processor,
    privacyPort,
    contextPort,
  );
}

export class PostgresSendGridWebhookDispatchResolver {
  constructor(
    private readonly pool: pg.Pool,
    private readonly store: PostgresEmailRuntimeStore,
  ) {}

  async resolve(input: {
    readonly providerMessageRef: string;
    readonly idempotencyKey: string | null;
    readonly observedAt: string;
  }): Promise<EmailDispatchRecord | undefined> {
    const providerMessageRef = requiredText(
      input.providerMessageRef,
      'SENDGRID_EVENT_MESSAGE_ID_REQUIRED',
    );
    const clauses = ['provider_message_ref = $2'];
    const parameters: unknown[] = [SENDGRID_PROVIDER_KEY, providerMessageRef];
    if (input.idempotencyKey) {
      clauses.push(`idempotency_key = $${parameters.length + 1}`);
      parameters.push(input.idempotencyKey);
    }

    const result = await this.pool.query<DispatchScopeRow>(
      `select tenant_id, workspace_id, organization_id, idempotency_key
         from email_dispatches
        where provider = $1
          and (${clauses.join(' or ')})
        order by updated_at desc
        limit 2`,
      parameters,
    );
    if (result.rows.length === 0) return undefined;
    if (result.rows.length > 1) throw new Error('SENDGRID_EVENT_DISPATCH_AMBIGUOUS');

    const row = result.rows[0]!;
    const scope = {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      organizationId: row.organization_id,
    };
    let dispatch = await this.store.findDispatchByProviderMessageRef(
      scope,
      SENDGRID_PROVIDER_KEY,
      providerMessageRef,
    );
    dispatch ??= await this.store.findDispatchByIdempotencyKey(scope, row.idempotency_key);
    if (!dispatch) throw new Error('SENDGRID_EVENT_DISPATCH_CORRELATION_LOST');

    if (dispatch.providerMessageRef !== providerMessageRef) {
      dispatch = { ...dispatch, providerMessageRef, updatedAt: input.observedAt };
      await this.store.saveDispatch(dispatch);
    }
    return dispatch;
  }
}

class PostgresEmailProviderEventContextPort implements EmailProviderEventContextPort {
  constructor(private readonly pool: pg.Pool) {}

  async resolvePrivacyContext(
    input: Parameters<EmailProviderEventContextPort['resolvePrivacyContext']>[0],
  ) {
    const result = await this.pool.query<MessageContextRow>(
      `select contact_id
         from crm_messages
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3 and message_id=$4
        limit 1`,
      [input.tenantId, input.workspaceId, input.organizationId, input.messageId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('EMAIL_PROVIDER_EVENT_CANONICAL_MESSAGE_NOT_FOUND');
    return {
      subjectRef: row.contact_id,
      providerSubjectRef: `sha256:${createHash('sha256')
        .update(`${input.provider}\u001f${row.contact_id}`)
        .digest('hex')}`,
    };
  }
}

class PostgresEmailPrivacyReconciliationPort implements EmailPrivacyReconciliationPort {
  constructor(
    private readonly pool: pg.Pool,
    private readonly privacy: PrivacyGovernanceService,
  ) {}

  async reconcileProviderSignal(
    input: Parameters<EmailPrivacyReconciliationPort['reconcileProviderSignal']>[0],
  ): Promise<void> {
    const purposes = await this.pool.query<PrivacyPurposeRow>(
      `select distinct on (purpose_id)
              purpose_id, policy_ref, ledger_sequence
         from privacy_ledger_events
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and subject_ref=$4 and channel='EMAIL'
          and purpose_id is not null and policy_ref is not null
          and event_type in ('COMMUNICATION_POLICY_RESOLVED','CONSENT_RECORDED','SUPPRESSION_CHECKED')
        order by purpose_id, ledger_sequence desc`,
      [input.tenantId, input.workspaceId, input.organizationId, input.subjectRef],
    );
    if (purposes.rows.length === 0) {
      throw new Error('EMAIL_PRIVACY_PURPOSE_CONTEXT_NOT_FOUND');
    }

    for (const row of purposes.rows) {
      const executionId = `sendgrid-privacy:${stableOpaqueId(
        `${input.executionId}:${row.purpose_id}`,
      )}`;
      const state = await this.reconciliationState(input, executionId);
      const evidence = [
        `sendgrid:provider-event:${input.providerEvidenceRef}`,
        `privacy:source-ledger-sequence:${row.ledger_sequence}`,
      ];
      const context = {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        requester: 'service:sendgrid-event-webhook',
        executionId,
        correlationId: input.correlationId,
        evidence,
      } as const;

      if (!state.providerConsent) {
        await this.privacy.reconcileProviderConsent({
          context,
          subjectRef: input.subjectRef,
          purposeId: row.purpose_id,
          channel: 'EMAIL',
          policyRef: row.policy_ref,
          observation: {
            provider: input.provider,
            providerSubjectRef: input.providerSubjectRef,
            state: input.providerState,
            observedAt: input.observedAt,
            providerEvidenceRef: input.providerEvidenceRef,
          },
          sourceEvidence: evidence,
        });
        continue;
      }

      if (!state.suppression) {
        await this.privacy.suppress({
          context,
          subjectRef: input.subjectRef,
          purposeId: row.purpose_id,
          channel: 'EMAIL',
          reason: suppressionReason(input.providerState),
          policyRef: row.policy_ref,
          sourceRef: input.providerEvidenceRef,
          recordedAt: input.observedAt,
          sourceEvidence: evidence,
        });
      }
    }
  }

  private async reconciliationState(
    input: PrivacyScope,
    executionId: string,
  ): Promise<{ readonly providerConsent: boolean; readonly suppression: boolean }> {
    const result = await this.pool.query<PrivacyReconciliationStateRow>(
      `select capability_id
         from privacy_ledger_events
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and execution_id=$4
          and capability_id in ('privacy.provider_consent.reconcile','privacy.suppression.record')`,
      [input.tenantId, input.workspaceId, input.organizationId, executionId],
    );
    const capabilities = new Set(result.rows.map((row) => row.capability_id));
    return {
      providerConsent: capabilities.has('privacy.provider_consent.reconcile'),
      suppression: capabilities.has('privacy.suppression.record'),
    };
  }
}

class LedgerBackedPrivacyPurposeRegistry implements PrivacyPurposeRegistry {
  constructor(private readonly pool: pg.Pool) {}

  async resolve(
    scope: PrivacyScope,
    purposeId: string,
  ): Promise<PrivacyPurposeDefinition | undefined> {
    const result = await this.pool.query<PrivacyPurposeRow>(
      `select purpose_id, policy_ref, ledger_sequence
         from privacy_ledger_events
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and purpose_id=$4 and policy_ref is not null
        order by ledger_sequence desc
        limit 1`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, purposeId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      ...scope,
      purposeId: row.purpose_id,
      description: 'Purpose recovered from canonical Privacy ledger evidence.',
      policyRef: row.policy_ref,
      active: true,
      evidence: [`privacy:ledger-purpose:${row.ledger_sequence}`],
    };
  }
}

const FAIL_CLOSED_ENGAGEMENT_AUTHORIZATION: EmailEngagementAuthorizationPort = {
  authorize() {
    return Promise.resolve({
      privacyAllowed: false,
      policyAllowed: false,
      evidence: ['email:engagement:default-deny'],
    });
  },
};

const FAIL_CLOSED_PRIVACY_DATA_GATEWAY: PrivacyDataGateway = {
  prepareExport() {
    return Promise.reject(new Error('EMAIL_RUNTIME_PRIVACY_DATA_EXPORT_NOT_BOUND'));
  },
  deleteSubjectData() {
    return Promise.reject(new Error('EMAIL_RUNTIME_PRIVACY_DATA_DELETE_NOT_BOUND'));
  },
};

const EVENT_ONLY_PREPARED_RESOLVER: SendGridPreparedCampaignResolver = {
  resolve() {
    return Promise.reject(new Error('EMAIL_SENDGRID_OUTBOUND_PREPARED_RESOLVER_NOT_BOUND'));
  },
};

function normalizedProcessorEvent(event: SendGridWebhookEvent) {
  return {
    providerEventId: event.providerEventId,
    providerMessageRef: event.providerMessageId,
    eventType: event.eventType,
    deliveryState: event.deliveryState,
    privacySignal: event.privacySignal,
    occurredAt: event.occurredAt,
  };
}

export function extractTocaIdempotencyKey(raw: Readonly<Record<string, unknown>>): string | null {
  const direct = raw.toca_idempotency_key;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const customArgs = raw.custom_args;
  if (customArgs && typeof customArgs === 'object' && !Array.isArray(customArgs)) {
    const nested = (customArgs as Record<string, unknown>).toca_idempotency_key;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return null;
}

function suppressionReason(state: 'BOUNCED' | 'COMPLAINT' | 'UNSUBSCRIBED'): SuppressionReason {
  switch (state) {
    case 'BOUNCED':
      return 'PROVIDER_BOUNCED';
    case 'COMPLAINT':
      return 'PROVIDER_COMPLAINT';
    case 'UNSUBSCRIBED':
      return 'PROVIDER_UNSUBSCRIBED';
  }
}

function singleHeader(value: string | readonly string[] | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value) && value.length === 1) return value[0]?.trim() || null;
  return null;
}

function stableOpaqueId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
