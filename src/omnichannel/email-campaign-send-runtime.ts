import type pg from 'pg';
import { EnvironmentSecretResolver, type SecretResolver } from '../core/secrets.js';
import { ToolRegistry } from '../core/tool-registry.js';
import type { CrmScope } from '../crm/crm-records.js';
import type { MessageRecord } from '../crm/sales-engine.js';
import type { ApprovalRecord, ApprovalStore } from '../governance/approval-governance.js';
import { PostgresApprovalStore } from '../persistence/postgres-approval-store.js';
import { PostgresAuditSink } from '../persistence/postgres-audit-sink.js';
import {
  PostgresCrmMessageRecordReader,
  type CrmMessageRecordReader,
} from '../persistence/postgres-crm-message-record-reader.js';
import { PostgresEmailRuntimeStore } from '../persistence/postgres-email-runtime-store.js';
import { PostgresOmnichannelPreparedContentStore } from '../persistence/postgres-omnichannel-prepared-content-store.js';
import { PostgresPrivacyLedgerStore } from '../persistence/postgres-privacy-ledger-store.js';
import { registerPrivacyAuditCapabilities } from '../privacy/capability-registry.js';
import type {
  PrivacyDataGateway,
  PrivacyPurposeDefinition,
  PrivacyPurposeRegistry,
  PrivacyScope,
} from '../privacy/contracts.js';
import { PrivacyGovernanceService } from '../privacy/privacy-governance.js';
import {
  SendGridEmailProvider,
  type SendGridPreparedCampaignResolver,
} from '../providers/sendgrid/email-provider.js';
import { loadSendGridRuntimeConfig } from '../providers/sendgrid/runtime-config.js';
import {
  assertAudienceEligibilitySnapshot,
  type AudienceEligibilitySnapshot,
  type EmailProviderAdapter,
  type ProviderMessageReadback,
} from './contracts.js';
import {
  EmailDispatchCoordinator,
  type EmailDispatchOrchestrationStore,
} from './email-orchestrator.js';
import { assertCanonicalEmailMessage } from './email-runtime.js';
import {
  assertOmnichannelPreparedContentIntegrity,
  assertPreparedContentScope,
  type OmnichannelPreparedContentStore,
} from './prepared-content.js';
import { StoredSendGridPreparedCampaignResolver } from './prepared-content-resolvers.js';
import {
  CanonicalOutboundPrivacyRevalidationPort,
  type OutboundPrivacyRevalidationInput,
  type OutboundPrivacyRevalidationPort,
} from './privacy-runtime-gate.js';

const CAPABILITY_ID = 'email.campaign.send' as const;
const DEFAULT_RATE_LIMIT = { capacity: 10, windowSeconds: 60 } as const;

export interface EmailCampaignSendInput extends CrmScope {
  readonly correlationId: string;
  readonly audienceSnapshotId: string;
  readonly privacyPurposeId: string;
  readonly resolvedContactCount: number;
  readonly ambiguousContactCount: number;
  readonly unresolvedContactCount: number;
  readonly privacyUnknownBlockedCount: number;
  readonly privacySuppressedCount: number;
  readonly policyDeniedCount: number;
  readonly approvalId: string;
  readonly messageId: string;
  readonly preparedCampaignRef: string;
  readonly idempotencyKey: string;
}

export interface EmailCampaignSendExecutionContext {
  readonly actorPrincipalId: string;
  readonly executionId: string;
  readonly correlationId: string;
}

export interface EmailCampaignSendResult {
  readonly providerDispatchId: string;
  readonly provider: string;
  readonly state: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN' | 'SUBMITTED';
  readonly acceptedAt: string;
}

export interface EmailCampaignReadbackResult {
  readonly verified: boolean;
  readonly evidence: readonly string[];
  readonly externalResourceId?: string;
  readonly reason?: string;
}

export interface EmailCampaignSendRuntime {
  targetAccount(): string | undefined;
  send(
    input: EmailCampaignSendInput,
    context: EmailCampaignSendExecutionContext,
  ): Promise<EmailCampaignSendResult>;
  readback(
    result: EmailCampaignSendResult,
    input: EmailCampaignSendInput,
  ): Promise<EmailCampaignReadbackResult>;
}

export interface EmailCampaignSendServiceDependencies {
  readonly provider: EmailProviderAdapter;
  readonly preparedResolver: SendGridPreparedCampaignResolver;
  readonly dispatchStore: EmailDispatchOrchestrationStore;
  readonly privacy: OutboundPrivacyRevalidationPort;
  readonly messages: CrmMessageRecordReader;
  readonly preparedContent: OmnichannelPreparedContentStore;
  readonly approvals: Pick<ApprovalStore, 'get'>;
}

/**
 * Narrow composition over canonical CRM, Privacy, Approval, prepared-content,
 * Transactional Outbox and SendGrid authorities. It owns no parallel state.
 */
export class EmailCampaignSendService implements EmailCampaignSendRuntime {
  private readonly coordinator: EmailDispatchCoordinator;

  constructor(private readonly deps: EmailCampaignSendServiceDependencies) {
    this.coordinator = new EmailDispatchCoordinator(
      deps.provider,
      deps.dispatchStore,
      deps.privacy,
    );
  }

  targetAccount(): string | undefined {
    return this.deps.provider.binding.bindingId.trim() || undefined;
  }

  async send(
    input: EmailCampaignSendInput,
    context: EmailCampaignSendExecutionContext,
  ): Promise<EmailCampaignSendResult> {
    assertScope(input, context);
    const message = await this.deps.messages.getMessage({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      messageId: required(input.messageId, 'EMAIL_MESSAGE_ID_REQUIRED'),
    });
    if (!message) throw new Error('EMAIL_CAMPAIGN_CANONICAL_MESSAGE_NOT_FOUND');
    assertCanonicalEmailMessage(message);
    if (message.direction !== 'OUTBOUND') {
      throw new Error('EMAIL_CANONICAL_MESSAGE_DIRECTION_MISMATCH');
    }
    assertMessageScope(message, input);

    const prepared = await this.deps.preparedContent.get({
      ...input,
      preparedContentRef: required(
        input.preparedCampaignRef,
        'EMAIL_PREPARED_CAMPAIGN_REF_REQUIRED',
      ),
      contentKind: 'EMAIL_CAMPAIGN',
    });
    if (!prepared) throw new Error('EMAIL_PREPARED_CAMPAIGN_NOT_FOUND');
    assertPreparedContentScope(prepared, input);
    assertOmnichannelPreparedContentIntegrity(prepared);
    if (message.contentRef !== prepared.preparedContentRef) {
      throw new Error('EMAIL_PREPARED_CAMPAIGN_MESSAGE_REF_MISMATCH');
    }
    if (message.contentSha256 !== prepared.contentSha256) {
      throw new Error('EMAIL_PREPARED_CAMPAIGN_MESSAGE_HASH_MISMATCH');
    }

    const preparedEmail = await this.deps.preparedResolver.resolve(prepared.preparedContentRef);
    const approval = await this.deps.approvals.get(
      required(input.approvalId, 'EMAIL_APPROVAL_ID_REQUIRED'),
    );
    assertCoreReservedApproval(approval, input, context, this.deps.provider.binding.bindingId);

    const eligibilitySnapshot: AudienceEligibilitySnapshot = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      snapshotId: required(input.audienceSnapshotId, 'EMAIL_AUDIENCE_SNAPSHOT_ID_REQUIRED'),
      purposeId: required(input.privacyPurposeId, 'EMAIL_PRIVACY_PURPOSE_REQUIRED'),
      resolvedContactCount: input.resolvedContactCount,
      ambiguousContactCount: input.ambiguousContactCount,
      unresolvedContactCount: input.unresolvedContactCount,
      privacyUnknownBlockedCount: input.privacyUnknownBlockedCount,
      privacySuppressedCount: input.privacySuppressedCount,
      policyDeniedCount: input.policyDeniedCount,
    };
    assertAudienceEligibilitySnapshot(eligibilitySnapshot);

    const result = await this.coordinator.send({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
      message,
      preparedCampaignRef: prepared.preparedContentRef,
      eligibilitySnapshot,
      approval: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        approvalId: approval.approvalId,
        status: 'APPROVED',
      },
      privacySubjectRef: message.contactId,
      privacyChannel: 'EMAIL',
      executionId: context.executionId,
      actorPrincipalId: context.actorPrincipalId,
      idempotencyKey: required(input.idempotencyKey, 'EMAIL_IDEMPOTENCY_KEY_REQUIRED'),
      internetMessageId: preparedEmail.internetMessageId,
      inReplyTo: preparedEmail.inReplyTo ?? null,
      references: preparedEmail.references ?? [],
      rateLimitBucketKey: `email.campaign.send:${input.privacyPurposeId}`,
      rateLimitPolicy: DEFAULT_RATE_LIMIT,
      now: new Date().toISOString(),
    });

    const dispatch = result.dispatch;
    if (!result.accepted || !dispatch.providerMessageRef) {
      if (dispatch.lastError === 'EMAIL_PROVIDER_REJECTED' && dispatch.providerMessageRef) {
        return {
          providerDispatchId: dispatch.providerMessageRef,
          provider: dispatch.provider,
          state: 'REJECTED',
          acceptedAt: dispatch.updatedAt,
        };
      }
      throw new Error(`EMAIL_CAMPAIGN_SEND_NOT_ACCEPTED:${dispatch.lastError ?? dispatch.state}`);
    }

    return {
      providerDispatchId: dispatch.providerMessageRef,
      provider: dispatch.provider,
      state: 'ACCEPTED',
      acceptedAt: dispatch.updatedAt,
    };
  }

  async readback(
    result: EmailCampaignSendResult,
    input: EmailCampaignSendInput,
  ): Promise<EmailCampaignReadbackResult> {
    validateScope(input);
    const providerDispatchId = required(
      result.providerDispatchId,
      'EMAIL_PROVIDER_MESSAGE_REF_REQUIRED',
    );
    if (result.provider !== this.deps.provider.binding.providerKey) {
      return {
        verified: false,
        evidence: ['email:readback:provider-mismatch'],
        externalResourceId: providerDispatchId,
        reason: 'EMAIL_READBACK_PROVIDER_MISMATCH',
      };
    }
    try {
      const readback = await this.deps.provider.readback(providerDispatchId);
      return verifiedReadback(readback);
    } catch (error) {
      const reason = safeErrorCode(error);
      return {
        verified: false,
        evidence: [`email:readback:unavailable:${reason}`],
        externalResourceId: providerDispatchId,
        reason,
      };
    }
  }
}

export interface PostgresEmailCampaignSendRuntimeOptions {
  readonly pool: pg.Pool;
  readonly env?: NodeJS.ProcessEnv;
  readonly secretResolver?: SecretResolver;
}

/**
 * Lazy provider composition keeps server construction synchronous while secret
 * resolution remains at execution time. The provider-disabled path exits before
 * any secret lookup, database read, or external request.
 */
export class PostgresEmailCampaignSendRuntime implements EmailCampaignSendRuntime {
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly options: PostgresEmailCampaignSendRuntimeOptions) {
    this.env = options.env ?? process.env;
  }

  targetAccount(): string | undefined {
    const value = this.env.EMAIL_SENDGRID_BINDING_ID?.trim();
    return value || undefined;
  }

  async send(
    input: EmailCampaignSendInput,
    context: EmailCampaignSendExecutionContext,
  ): Promise<EmailCampaignSendResult> {
    const service = await this.service(input, context);
    return service.send(input, context);
  }

  async readback(
    result: EmailCampaignSendResult,
    input: EmailCampaignSendInput,
  ): Promise<EmailCampaignReadbackResult> {
    const service = await this.service(input);
    return service.readback(result, input);
  }

  private async service(
    scope: CrmScope,
    context?: EmailCampaignSendExecutionContext,
  ): Promise<EmailCampaignSendService> {
    const loaded = await loadSendGridRuntimeConfig({
      env: this.env,
      secretResolver: this.options.secretResolver ?? new EnvironmentSecretResolver(this.env),
      discoverEventWebhookPublicKey: false,
    });
    if (!loaded.enabled || !loaded.config) throw new Error('EMAIL_SENDGRID_RUNTIME_DISABLED');

    const preparedContent = new PostgresOmnichannelPreparedContentStore(this.options.pool);
    const preparedResolver = new StoredSendGridPreparedCampaignResolver(preparedContent, scope);
    const provider = new SendGridEmailProvider(loaded.config, preparedResolver);
    const approvals = new PostgresApprovalStore(this.options.pool);
    const dispatchStore = new PostgresEmailRuntimeStore(this.options.pool, {
      ...(context
        ? {
            mutationContext: {
              executionId: context.executionId,
              correlationId: context.correlationId,
              actorPrincipalId: context.actorPrincipalId,
              evidence: [
                `core:execution:${context.executionId}`,
                `email:capability:${CAPABILITY_ID}`,
              ],
            },
          }
        : {}),
    });
    return new EmailCampaignSendService({
      provider,
      preparedResolver,
      dispatchStore,
      privacy: new PostgresCanonicalEmailOutboundPrivacy(this.options.pool, approvals),
      messages: new PostgresCrmMessageRecordReader(this.options.pool),
      preparedContent,
      approvals,
    });
  }
}

class PostgresCanonicalEmailOutboundPrivacy implements OutboundPrivacyRevalidationPort {
  private readonly auditRegistry = new ToolRegistry();

  constructor(
    private readonly pool: pg.Pool,
    private readonly approvals: ApprovalStore,
  ) {
    registerPrivacyAuditCapabilities(this.auditRegistry);
  }

  revalidate(input: OutboundPrivacyRevalidationInput) {
    const privacy = new PrivacyGovernanceService({
      store: new PostgresPrivacyLedgerStore(this.pool),
      purposeRegistry: new LedgerBackedEmailOutboundPurposeRegistry(
        this.pool,
        input.subjectRef,
        input.purposeId,
      ),
      auditSink: new PostgresAuditSink(this.pool, this.auditRegistry),
      approvalStore: this.approvals,
      dataGateway: FAIL_CLOSED_PRIVACY_DATA_GATEWAY,
    });
    return new CanonicalOutboundPrivacyRevalidationPort(privacy).revalidate(input);
  }
}

class LedgerBackedEmailOutboundPurposeRegistry implements PrivacyPurposeRegistry {
  constructor(
    private readonly pool: pg.Pool,
    private readonly subjectRef: string,
    private readonly expectedPurposeId: string,
  ) {}

  async resolve(
    scope: PrivacyScope,
    purposeId: string,
  ): Promise<PrivacyPurposeDefinition | undefined> {
    if (purposeId !== this.expectedPurposeId) return undefined;
    const result = await this.pool.query<{ policy_ref: string; ledger_sequence: string | number }>(
      `select policy_ref,ledger_sequence
         from privacy_ledger_events
        where tenant_id=$1 and workspace_id=$2 and organization_id=$3
          and subject_ref=$4 and purpose_id=$5 and policy_ref is not null
        order by ledger_sequence desc
        limit 1`,
      [scope.tenantId, scope.workspaceId, scope.organizationId, this.subjectRef, purposeId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      ...scope,
      purposeId,
      description: 'Email outbound purpose recovered from canonical Privacy ledger evidence.',
      policyRef: row.policy_ref,
      active: true,
      evidence: [`privacy:ledger-purpose:${row.ledger_sequence}`],
      communication: {
        channels: ['EMAIL'],
        consentRequired: true,
        preferenceRequired: true,
        prohibited: false,
        validUntil: null,
      },
    };
  }
}

const FAIL_CLOSED_PRIVACY_DATA_GATEWAY: PrivacyDataGateway = {
  prepareExport() {
    return Promise.reject(new Error('EMAIL_RUNTIME_PRIVACY_DATA_EXPORT_NOT_BOUND'));
  },
  deleteSubjectData() {
    return Promise.reject(new Error('EMAIL_RUNTIME_PRIVACY_DATA_DELETE_NOT_BOUND'));
  },
};

function assertCoreReservedApproval(
  approval: ApprovalRecord | undefined,
  input: EmailCampaignSendInput,
  context: EmailCampaignSendExecutionContext,
  targetAccount: string,
): asserts approval is ApprovalRecord {
  if (!approval) throw new Error('EMAIL_APPROVAL_NOT_FOUND');
  if (approval.approvalId !== input.approvalId) throw new Error('EMAIL_APPROVAL_ID_MISMATCH');
  if (approval.capabilityId !== CAPABILITY_ID)
    throw new Error('EMAIL_APPROVAL_CAPABILITY_MISMATCH');
  if (approval.status !== 'EXECUTING') throw new Error('EMAIL_APPROVAL_NOT_RESERVED_BY_CORE');
  if (approval.reservationExecutionId !== context.executionId) {
    throw new Error('EMAIL_APPROVAL_EXECUTION_MISMATCH');
  }
  if (approval.reservationPrincipalId !== context.actorPrincipalId) {
    throw new Error('EMAIL_APPROVAL_PRINCIPAL_MISMATCH');
  }
  if (approval.reservationCorrelationId !== context.correlationId) {
    throw new Error('EMAIL_APPROVAL_CORRELATION_MISMATCH');
  }
  if (approval.targetAccount !== targetAccount) throw new Error('EMAIL_APPROVAL_TARGET_MISMATCH');
}

function verifiedReadback(readback: ProviderMessageReadback): EmailCampaignReadbackResult {
  const evidence = readback.evidence.map((item) => item.trim()).filter(Boolean);
  const verified = ['QUEUED', 'SENT', 'DELIVERED'].includes(readback.state) && evidence.length > 0;
  return {
    verified,
    evidence: evidence.length > 0 ? evidence : ['email:readback:evidence-missing'],
    externalResourceId: readback.providerMessageId,
    ...(!verified ? { reason: `EMAIL_READBACK_STATE_${readback.state}` } : {}),
  };
}

function assertScope(
  input: EmailCampaignSendInput,
  context: EmailCampaignSendExecutionContext,
): void {
  validateScope(input);
  if (input.correlationId !== context.correlationId) throw new Error('EMAIL_CORRELATION_MISMATCH');
}

function validateScope(scope: CrmScope): void {
  required(scope.tenantId, 'EMAIL_TENANT_ID_REQUIRED');
  required(scope.workspaceId, 'EMAIL_WORKSPACE_ID_REQUIRED');
  required(scope.organizationId, 'EMAIL_ORGANIZATION_ID_REQUIRED');
}

function assertMessageScope(message: MessageRecord, scope: CrmScope): void {
  if (
    message.tenantId !== scope.tenantId ||
    message.workspaceId !== scope.workspaceId ||
    message.organizationId !== scope.organizationId
  ) {
    throw new Error('EMAIL_CANONICAL_MESSAGE_SCOPE_MISMATCH');
  }
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'EMAIL_READBACK_FAILED';
  const code = error.message.split(':', 1)[0]?.trim();
  return code && /^[A-Z0-9_]+$/.test(code) ? code : 'EMAIL_READBACK_FAILED';
}
