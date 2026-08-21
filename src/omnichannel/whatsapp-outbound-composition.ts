import type pg from 'pg';
import type { CrmScope } from '../crm/crm-records.js';
import { ToolRegistry } from '../core/tool-registry.js';
import type { ApprovalStore } from '../governance/approval-governance.js';
import type { CoreCapabilityRuntimeResolver } from '../mcp/core-execution.js';
import {
  createWhatsAppOutboundRuntimeResolver,
  type WhatsAppOutboundRuntimeBindingDependencies,
} from '../mcp/omnichannel-outbound-runtime.js';
import { PostgresAuditSink } from '../persistence/postgres-audit-sink.js';
import { PostgresCrmCoreStore } from '../persistence/postgres-crm-core-store.js';
import { PostgresCrmMessageRecordReader } from '../persistence/postgres-crm-message-record-reader.js';
import { PostgresOmnichannelPreparedContentStore } from '../persistence/postgres-omnichannel-prepared-content-store.js';
import { PostgresPrivacyLedgerStore } from '../persistence/postgres-privacy-ledger-store.js';
import { PostgresWhatsAppRuntimeStore } from '../persistence/postgres-whatsapp-runtime-store.js';
import { registerPrivacyAuditCapabilities } from '../privacy/capability-registry.js';
import type {
  PrivacyDataGateway,
  PrivacyPurposeDefinition,
  PrivacyPurposeRegistry,
  PrivacyScope,
} from '../privacy/contracts.js';
import { PrivacyGovernanceService } from '../privacy/privacy-governance.js';
import type { MetaApiClient } from '../providers/meta/meta-api-client.js';
import {
  WhatsAppCloudAdapter,
  type WhatsAppProviderReadbackStore,
} from '../providers/whatsapp/whatsapp-cloud-adapter.js';
import type { ProviderBindingRef } from './contracts.js';
import type { OmnichannelProviderEventReadbackService } from './provider-event-readback.js';
import { StoredWhatsAppPreparedPayloadResolver } from './prepared-content-resolvers.js';
import { CanonicalOutboundPrivacyRevalidationPort } from './privacy-runtime-gate.js';
import { WhatsAppOutboundRuntime } from './whatsapp-runtime.js';

const DEFAULT_PURPOSE_ID = 'customer-service';
const DEFAULT_POLICY_REF = 'toca-os:privacy:customer-service';

export interface WhatsAppOutboundCompositionOptions {
  readonly pool: pg.Pool;
  readonly scope: CrmScope;
  readonly approvalStore: ApprovalStore;
  readonly providerEventReadback: OmnichannelProviderEventReadbackService;
  readonly metaApi: MetaApiClient;
  readonly metaAppId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly binding: ProviderBindingRef;
  readonly purposeId?: string;
  readonly policyRef?: string;
}

/** Composes whatsapp.message.send exclusively from existing canonical domains. */
export function createWhatsAppOutboundComposition(
  options: WhatsAppOutboundCompositionOptions,
): CoreCapabilityRuntimeResolver {
  const preparedStore = new PostgresOmnichannelPreparedContentStore(options.pool);
  const preparedPayloads = new StoredWhatsAppPreparedPayloadResolver(preparedStore, options.scope);
  const transport = new PostgresWhatsAppRuntimeStore(options.pool);
  const provider = new WhatsAppCloudAdapter(
    options.metaApi,
    {
      metaAppId: required(options.metaAppId, 'WHATSAPP_META_APP_ID_REQUIRED'),
      wabaId: required(options.wabaId, 'WHATSAPP_WABA_ID_REQUIRED'),
      phoneNumberId: required(options.phoneNumberId, 'WHATSAPP_PHONE_NUMBER_ID_REQUIRED'),
      binding: options.binding,
    },
    preparedPayloads,
    new ScopedProviderEventReadback(options.scope, options.providerEventReadback),
  );
  const purposeId = options.purposeId?.trim() || DEFAULT_PURPOSE_ID;
  const policyRef = options.policyRef?.trim() || DEFAULT_POLICY_REF;
  const privacyAuditRegistry = new ToolRegistry();
  registerPrivacyAuditCapabilities(privacyAuditRegistry);
  const privacy = new PrivacyGovernanceService({
    store: new PostgresPrivacyLedgerStore(options.pool),
    purposeRegistry: new BoundWhatsAppPurposeRegistry(options.scope, purposeId, policyRef),
    auditSink: new PostgresAuditSink(options.pool, privacyAuditRegistry),
    approvalStore: options.approvalStore,
    dataGateway: FAIL_CLOSED_PRIVACY_DATA_GATEWAY,
  });

  const dependencies: WhatsAppOutboundRuntimeBindingDependencies = {
    runtime: new WhatsAppOutboundRuntime(
      {
        crm: new PostgresCrmCoreStore(options.pool),
        transport,
        provider,
        preparedPayloads,
        privacyRevalidation: new CanonicalOutboundPrivacyRevalidationPort(privacy),
      },
      {
        throttleLimit: 10,
        throttleWindowSeconds: 60,
        maxAttempts: 3,
        retryDelaySeconds: 10,
      },
    ),
    messages: new PostgresCrmMessageRecordReader(options.pool),
    approvalStore: options.approvalStore,
    providerEventReadback: options.providerEventReadback,
    targetAccount: options.phoneNumberId,
  };
  return createWhatsAppOutboundRuntimeResolver(dependencies);
}

class ScopedProviderEventReadback implements WhatsAppProviderReadbackStore {
  constructor(
    private readonly scope: CrmScope,
    private readonly service: Pick<OmnichannelProviderEventReadbackService, 'readWhatsApp'>,
  ) {}

  latest(providerMessageId: string) {
    return this.service.readWhatsApp({ ...this.scope, providerMessageId });
  }
}

class BoundWhatsAppPurposeRegistry implements PrivacyPurposeRegistry {
  constructor(
    private readonly scope: CrmScope,
    private readonly purposeId: string,
    private readonly policyRef: string,
  ) {}

  resolve(scope: PrivacyScope, purposeId: string): Promise<PrivacyPurposeDefinition | undefined> {
    if (
      scope.tenantId !== this.scope.tenantId ||
      scope.workspaceId !== this.scope.workspaceId ||
      scope.organizationId !== this.scope.organizationId ||
      purposeId !== this.purposeId
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      ...scope,
      purposeId,
      description: 'Canonical WhatsApp customer-service purpose bound by the TOCA OS runtime.',
      policyRef: this.policyRef,
      active: true,
      evidence: [
        `runtime:whatsapp:purpose:${purposeId}`,
        `runtime:privacy-policy:${this.policyRef}`,
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

const FAIL_CLOSED_PRIVACY_DATA_GATEWAY: PrivacyDataGateway = {
  prepareExport() {
    return Promise.reject(new Error('WHATSAPP_RUNTIME_PRIVACY_DATA_EXPORT_NOT_BOUND'));
  },
  deleteSubjectData() {
    return Promise.reject(new Error('WHATSAPP_RUNTIME_PRIVACY_DATA_DELETE_NOT_BOUND'));
  },
};

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
