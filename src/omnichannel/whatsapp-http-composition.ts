import type pg from 'pg';
import { ToolRegistry } from '../core/tool-registry.js';
import { registerPrivacyAuditCapabilities } from '../privacy/capability-registry.js';
import type {
  PrivacyDataGateway,
  PrivacyPurposeDefinition,
  PrivacyPurposeRegistry,
  PrivacyScope,
} from '../privacy/contracts.js';
import { PrivacyGovernanceService } from '../privacy/privacy-governance.js';
import { PostgresApprovalStore } from '../persistence/postgres-approval-store.js';
import { PostgresAuditSink } from '../persistence/postgres-audit-sink.js';
import { PostgresCrmCoreStore } from '../persistence/postgres-crm-core-store.js';
import { PostgresCrmSalesStore } from '../persistence/postgres-crm-sales-store.js';
import { PostgresPrivacyLedgerStore } from '../persistence/postgres-privacy-ledger-store.js';
import { PostgresWhatsAppRuntimeStore } from '../persistence/postgres-whatsapp-runtime-store.js';
import { loadAg01ProductionConfig } from '../orchestrator/production-config.js';
import {
  createAg01ProductionRuntime,
  type Ag01ProductionRuntime,
} from '../orchestrator/production-runtime.js';
import type { WhatsAppWebhookEvent } from '../providers/whatsapp/whatsapp-cloud-webhook.js';
import {
  CanonicalWhatsAppPrivacyLifecycle,
  WhatsAppInboundRuntime,
  type WhatsAppCrmWorkflow,
  type WhatsAppPrivacySubjectResolver,
  type WhatsAppScopeBinding,
  type WhatsAppScopeResolver,
} from './whatsapp-runtime.js';

const DEFAULT_PURPOSE_ID = 'customer-service';
const DEFAULT_POLICY_REF = 'toca-os:privacy:customer-service';
const DEFAULT_ACTOR_PRINCIPAL_ID = 'service:whatsapp-webhook';

export interface WhatsAppHttpCompositionOptions {
  readonly pool: pg.Pool;
  readonly env?: NodeJS.ProcessEnv;
}

export interface WhatsAppHttpComposition {
  ingest(events: readonly WhatsAppWebhookEvent[]): Promise<void>;
}

/**
 * Canonical production composition for Meta WhatsApp webhook ingress.
 *
 * The provider webhook is already signature-verified by the shared Meta HTTP
 * boundary before events reach this runtime. This composition owns no second
 * CRM, Privacy or workflow model: it persists into the canonical CRM/WhatsApp
 * transport stores, records Privacy preference changes in the canonical ledger,
 * and forwards non-handoff inbound text to the existing durable AG-01 runtime.
 */
export function createWhatsAppHttpComposition(
  options: WhatsAppHttpCompositionOptions,
): WhatsAppHttpComposition | undefined {
  const env = options.env ?? process.env;
  if (!enabled(env.WHATSAPP_RUNTIME_ENABLED)) return undefined;

  const binding = bindingFromEnv(env);
  const privacyRegistry = new ToolRegistry();
  registerPrivacyAuditCapabilities(privacyRegistry);
  const privacy = new PrivacyGovernanceService({
    store: new PostgresPrivacyLedgerStore(options.pool),
    purposeRegistry: new BoundWhatsAppPurposeRegistry(binding),
    auditSink: new PostgresAuditSink(options.pool, privacyRegistry),
    approvalStore: new PostgresApprovalStore(options.pool),
    dataGateway: FAIL_CLOSED_PRIVACY_DATA_GATEWAY,
  });

  const ag01 = createAg01ProductionRuntime(loadAg01ProductionConfig(env), env);
  assertAg01Scope(binding, ag01);

  const runtime = new WhatsAppInboundRuntime({
    scopes: new BoundWhatsAppScopeResolver(binding),
    crm: new PostgresCrmCoreStore(options.pool),
    sales: new PostgresCrmSalesStore(options.pool),
    transport: new PostgresWhatsAppRuntimeStore(options.pool),
    privacySubjects: CANONICAL_CONTACT_PRIVACY_SUBJECT,
    privacy: new CanonicalWhatsAppPrivacyLifecycle(privacy),
    workflow: new Ag01WhatsAppWorkflow(ag01),
  });

  return {
    async ingest(events) {
      for (const event of events) await runtime.ingest(event);
    },
  };
}

class BoundWhatsAppScopeResolver implements WhatsAppScopeResolver {
  constructor(private readonly binding: WhatsAppScopeBinding) {}

  resolve(input: {
    readonly wabaId: string;
    readonly phoneNumberId: string;
  }): Promise<WhatsAppScopeBinding | undefined> {
    if (input.wabaId !== this.binding.wabaId || input.phoneNumberId !== this.binding.phoneNumberId) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.binding);
  }
}

class BoundWhatsAppPurposeRegistry implements PrivacyPurposeRegistry {
  constructor(private readonly binding: WhatsAppScopeBinding) {}

  resolve(scope: PrivacyScope, purposeId: string): Promise<PrivacyPurposeDefinition | undefined> {
    if (
      scope.tenantId !== this.binding.tenantId ||
      scope.workspaceId !== this.binding.workspaceId ||
      scope.organizationId !== this.binding.organizationId ||
      purposeId !== this.binding.purposeId
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      ...scope,
      purposeId,
      description: 'Canonical WhatsApp customer-service purpose bound by the TOCA OS runtime.',
      policyRef: this.binding.policyRef,
      active: true,
      evidence: [
        `runtime:whatsapp:waba:${this.binding.wabaId}`,
        `runtime:whatsapp:phone-number-id:${this.binding.phoneNumberId}`,
        `runtime:privacy-policy:${this.binding.policyRef}`,
      ],
      communication: {
        channels: ['WHATSAPP'],
        consentRequired: true,
        preferenceRequired: true,
        prohibited: false,
        validUntil: null,
      },
    });
  }
}

class Ag01WhatsAppWorkflow implements WhatsAppCrmWorkflow {
  constructor(private readonly ag01: Ag01ProductionRuntime) {}

  async onInboundMessage(
    input: Parameters<WhatsAppCrmWorkflow['onInboundMessage']>[0],
  ): Promise<void> {
    if (input.humanHandoff) return;
    const text = input.contentText?.trim();
    if (!text) return;
    await this.ag01.execute({
      conversationId: input.conversation.conversationId,
      messageId: input.message.messageId,
      idempotencyKey: `whatsapp-inbound:${input.message.messageId}`,
      message: text,
      correlationId: input.message.messageId,
      causationId: input.message.providerMessageRef,
    });
  }
}

const CANONICAL_CONTACT_PRIVACY_SUBJECT: WhatsAppPrivacySubjectResolver = {
  resolve(contact) {
    return Promise.resolve(contact.contactId);
  },
};

const FAIL_CLOSED_PRIVACY_DATA_GATEWAY: PrivacyDataGateway = {
  prepareExport() {
    return Promise.reject(new Error('WHATSAPP_RUNTIME_PRIVACY_DATA_EXPORT_NOT_BOUND'));
  },
  deleteSubjectData() {
    return Promise.reject(new Error('WHATSAPP_RUNTIME_PRIVACY_DATA_DELETE_NOT_BOUND'));
  },
};

function bindingFromEnv(env: NodeJS.ProcessEnv): WhatsAppScopeBinding {
  const tenantId = required(env.TOCA_DEFAULT_TENANT_ID ?? 'toca', 'WHATSAPP_TENANT_ID_REQUIRED');
  const workspaceId = required(env.TOCA_DEFAULT_WORKSPACE_ID ?? tenantId, 'WHATSAPP_WORKSPACE_ID_REQUIRED');
  const organizationId = required(
    env.TOCA_DEFAULT_ORGANIZATION_ID ?? tenantId,
    'WHATSAPP_ORGANIZATION_ID_REQUIRED',
  );
  return {
    tenantId,
    workspaceId,
    organizationId,
    metaAppId: required(env.META_APP_ID, 'WHATSAPP_META_APP_ID_REQUIRED'),
    wabaId: required(env.WHATSAPP_WABA_ID, 'WHATSAPP_WABA_ID_REQUIRED'),
    phoneNumberId: required(env.WHATSAPP_PHONE_NUMBER_ID, 'WHATSAPP_PHONE_NUMBER_ID_REQUIRED'),
    purposeId: required(env.WHATSAPP_PURPOSE_ID ?? DEFAULT_PURPOSE_ID, 'WHATSAPP_PURPOSE_ID_REQUIRED'),
    policyRef: required(env.WHATSAPP_POLICY_REF ?? DEFAULT_POLICY_REF, 'WHATSAPP_POLICY_REF_REQUIRED'),
    actorPrincipalId: required(
      env.WHATSAPP_ACTOR_PRINCIPAL_ID ?? DEFAULT_ACTOR_PRINCIPAL_ID,
      'WHATSAPP_ACTOR_PRINCIPAL_ID_REQUIRED',
    ),
  };
}

function assertAg01Scope(binding: WhatsAppScopeBinding, ag01: Ag01ProductionRuntime): void {
  const principal = ag01.identity.principal;
  if (
    principal.tenantId !== binding.tenantId ||
    principal.workspaceId !== binding.workspaceId ||
    principal.organizationId !== binding.organizationId
  ) {
    throw new Error('WHATSAPP_AG01_SCOPE_MISMATCH');
  }
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function required(value: string | undefined, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
