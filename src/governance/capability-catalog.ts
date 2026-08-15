import type { CapabilityStatus, RiskClass, ToolDefinition } from '../core/tool-registry.js';
import { createToolRegistry } from '../registry.js';
import {
  CAPABILITY_CONTRACT_OVERRIDES,
  permissionRequirementsForCapability,
} from './capability-contract-overrides.js';
import {
  ROUTE_CAPABILITY_IDS,
  TECHNICAL_EXTENSION_CAPABILITY_IDS,
  TRANSVERSAL_CAPABILITY_IDS,
} from './capability-ids.js';
import {
  ROUTE_IDS,
  assertCapabilityNamespace,
  type AuthenticationMode,
  type CapabilityContractQuality,
  type CapabilityDefinition,
  type ExecutionSurface,
  type ProviderAccessLevel,
  type ProviderPermissionRequirement,
  type RouteId,
} from './types.js';

const OWNER = 'LUIZ + CHATGPT (COPILOTO DE GOVERNANCA)';
const REVIEWER_ROLE = 'TOCA_OS_GOVERNANCE_REVIEWER';
const APPROVER_ROLE = 'TOCA_OS_ACCOUNTABLE_OWNER';
export const CAPABILITY_CATALOG_VERSION = '1.1.0';

const implementedInternal = new Set([
  'video.brief.create',
  'video.storyboard.generate',
  'video.script.generate',
  'video.asset.select',
  'video.timeline.compose',
  'video.subtitle.generate',
  'video.caption.embed',
  'video.audio.normalize',
  'video.music_rights.validate',
  'video.safe_area.validate',
  'video.duration.validate',
  'video.thumbnail.generate',
  'video.export.reel',
  'video.export.story',
  'video.quality.validate',
  'content_item.version.create',
  'content_item.variant.create',
  'content_item.channel.adapt',
  'content_item.language.localize',
  'content_item.fact.validate',
  'content_item.rights.validate',
  'content_item.accessibility.validate',
  'content_item.event.link',
  'content_item.experiment.link',
  'content.repurpose.plan',
  'governance.scan',
  'governance.drive_vs_registry.diff',
  'governance.registry_vs_runtime.diff',
  'governance.runtime_vs_provider.diff',
  'governance.manual_version.diff',
  'governance.route_registry.diff',
  'governance.capability_registry.diff',
  'governance.policy.diff',
  'governance.status.detect_conflict',
  'governance.canonical.detect_conflict',
  'governance.reconciliation.plan',
  'governance.evidence.record',
  'governance.drift.close',
  'capability.discover',
  'capability.inspect',
  'capability.code_presence.verify',
  'capability.runtime_presence.verify',
  'capability.feature_flag.verify',
  'capability.credentials.verify',
  'capability.permissions.verify',
  'capability.provider_support.verify',
  'capability.smoke_test',
  'capability.readback.verify',
  'capability.promote',
  'capability.demote',
  'capability.suspend',
  'capability.resume',
  'capability.deprecate',
  'capability.remove',
  'capability.last_validated.update',
  'capability.evidence.attach',
  'release.change.prepare',
  'release.evidence.record',
  'release.close',
  'approval.request',
  'approval.descriptor.generate',
  'approval.descriptor.hash',
  'approval.scope.validate',
  'approval.requester.validate',
  'approval.approver.validate',
  'approval.financial_ceiling.validate',
  'approval.target.validate',
  'approval.issue',
  'approval.consume',
  'approval.verify',
  'approval.expire',
  'approval.revoke',
  'approval.status',
  'approval.evidence.attach',
  'approval.audit',
  'approval.history',
  'policy.evaluate',
  'policy.scope.validate',
  'policy.financial.validate',
  'policy.side_effect.validate',
  'policy.provider.validate',
  'policy.deny',
  'policy.allow',
  'audit.event.record',
  'audit.execution.start',
  'audit.execution.success',
  'audit.execution.failure',
  'state.transition',
  'state.transition.validate',
  'state.history',
  'state.reconcile',
  'state.block',
  'evidence.hash',
  'evidence.validate',
]);

const runtimeDefinitions = new Map<string, ToolDefinition>(
  createToolRegistry({
    instagramReadsEnabled: true,
    metaAdsReadsEnabled: true,
    metaAdsWritesEnabled: true,
    tocaManagedInstagramSchedulerEnabled: true,
  })
    .list()
    .map((definition) => [definition.name, definition] as const),
);

const knownRuntimeTools = new Set(runtimeDefinitions.keys());

function lifecycleStatus(capabilityId: string): CapabilityStatus {
  return (
    runtimeDefinitions.get(capabilityId)?.capabilityStatus ??
    (implementedInternal.has(capabilityId) ? 'IMPLEMENTED' : 'PLANNED')
  );
}

function action(capabilityId: string): string {
  return capabilityId.split('.').at(-1) ?? capabilityId;
}

const mutationActions = new Set([
  'activate',
  'add',
  'adjust',
  'apply',
  'approve',
  'archive',
  'assign',
  'block',
  'cancel',
  'claim',
  'close',
  'complete',
  'configure',
  'consume',
  'create',
  'create_paused',
  'decrease',
  'delete',
  'demote',
  'deploy',
  'deprecate',
  'disable',
  'edit',
  'enable',
  'escalate',
  'execute',
  'expire',
  'export',
  'import',
  'increase',
  'inject',
  'issue',
  'merge',
  'move',
  'pause',
  'promote',
  'publish',
  'record',
  'reconcile',
  'reject',
  'remove',
  'rename',
  'replace',
  'request',
  'reschedule',
  'resolve',
  'resume',
  'retry',
  'revoke',
  'rollback',
  'run',
  'schedule',
  'send',
  'set',
  'suspend',
  'supersede',
  'tag',
  'test',
  'transition',
  'update',
  'writeback',
]);

function isMutationAction(capabilityId: string): boolean {
  const value = action(capabilityId);
  return (
    mutationActions.has(value) || /^(activate|assign|create|move|replace|update|write)_/.test(value)
  );
}

function isProviderWrite(capabilityId: string): boolean {
  if (/^meta_ads\./.test(capabilityId)) return isMutationAction(capabilityId);
  if (/^(instagram|social|engagement)\./.test(capabilityId)) {
    return /\.(publish|send|reply|activate|pause|resume|create_paused|update_budget|update_status|replace_creative|replace|archive|cancel)$/.test(
      capabilityId,
    );
  }
  if (/^(drive|release|security|restore|dr)\./.test(capabilityId)) {
    return isMutationAction(capabilityId);
  }
  return false;
}

function isFinancial(capabilityId: string): boolean {
  return (
    /^meta_ads\./.test(capabilityId) &&
    /\.(activate|resume|update_budget|increase|decrease|budget_adjust)$/.test(capabilityId)
  );
}

function isMutation(capabilityId: string): boolean {
  return isMutationAction(capabilityId) || isProviderWrite(capabilityId);
}

function inferredRiskClass(capabilityId: string): RiskClass {
  if (isFinancial(capabilityId)) return 'FINANCIAL_IMPACT';
  if (
    /\.(delete|remove)$/.test(capabilityId) &&
    /^(drive|registry|capability)\./.test(capabilityId)
  ) {
    return 'DESTRUCTIVE';
  }
  if (isProviderWrite(capabilityId)) return 'WRITE_EXTERNAL';
  if (isMutation(capabilityId)) return 'WRITE_REVERSIBLE';
  return 'READ';
}

function inferredProvider(capabilityId: string): string {
  if (/^meta_ads\./.test(capabilityId)) return 'Meta Marketing API';
  if (/^(instagram|social|engagement)\./.test(capabilityId)) return 'Meta/Instagram';
  if (/^drive\./.test(capabilityId)) return 'Google Drive';
  if (/^(release|security)\./.test(capabilityId)) return 'GitHub+GCP';
  if (/^(backup|restore|dr)\./.test(capabilityId)) return 'GCP+PostgreSQL';
  if (/^(observability|incident)\./.test(capabilityId)) return 'TOCA MCP+GCP';
  if (/^(design|image|copy|presentation|story|video)\./.test(capabilityId))
    return 'ChatGPT+TOCA_OS';
  return 'TOCA_OS+toca-mcp';
}

/**
 * Legacy flat scopes are retained for runtime compatibility. Planned social
 * capabilities intentionally do not receive guessed scopes; their provider/login
 * alternatives live in permission_requirements instead.
 */
function inferredScopes(capabilityId: string, risk: RiskClass): readonly string[] {
  if (/^meta_ads\./.test(capabilityId)) return risk === 'READ' ? ['ads_read'] : ['ads_management'];
  if (/^(instagram|social|engagement)\./.test(capabilityId)) return [];
  if (/^drive\./.test(capabilityId)) return ['drive.file'];
  return [];
}

function config(capabilityId: string): readonly string[] {
  if (/^meta_ads\./.test(capabilityId)) return ['META_GRAPH_API_VERSION', 'META_ACCESS_TOKEN_REF'];
  if (/^(instagram|social|engagement)\./.test(capabilityId)) {
    return ['INSTAGRAM_BUSINESS_ACCOUNT_ID', 'META_ACCESS_TOKEN_REF'];
  }
  if (/^(backup|restore|dr)\./.test(capabilityId)) return ['DATABASE_URL', 'GCP_PROJECT_ID'];
  return [];
}

function executionSurface(capabilityId: string, status: CapabilityStatus): ExecutionSurface {
  if (knownRuntimeTools.has(capabilityId)) return 'MCP_TOOL';
  if (implementedInternal.has(capabilityId)) return 'INTERNAL_ENGINE';
  if (/^(drive|design|presentation)\./.test(capabilityId)) return 'CONNECTOR';
  if (
    /^(copy|editorial|campaign|analytics|performance|context|quality_gate|people|legal)\./.test(
      capabilityId,
    )
  ) {
    return 'COGNITIVE';
  }
  return status === 'PLANNED' ? 'CATALOG_ONLY' : 'INTERNAL_ENGINE';
}

function humanDescription(capabilityId: string): string {
  const words = capabilityId.replaceAll('_', ' ').split('.').join(' / ');
  return `Capability canônica para ${words}.`;
}

function evidence(capabilityId: string, status: CapabilityStatus): readonly string[] {
  if (status === 'PLANNED' || status === 'SPECIFIED') return [];
  if (knownRuntimeTools.has(capabilityId)) return ['src/registry.ts'];
  if (capabilityId.startsWith('video.'))
    return ['src/content/video.ts', 'src/content/capability-contracts.ts'];
  if (capabilityId.startsWith('content_item.') || capabilityId === 'content.repurpose.plan')
    return ['src/content/content-item.ts', 'src/content/capability-contracts.ts'];
  if (capabilityId.startsWith('approval.')) return ['src/governance/approval-governance.ts'];
  if (capabilityId.startsWith('capability.')) return ['src/governance/capability-lifecycle.ts'];
  if (capabilityId.startsWith('governance.')) return ['src/governance/governance-drift.ts'];
  if (capabilityId.startsWith('release.')) return ['src/governance/release-lifecycle.ts'];
  return ['src/governance/state-machine.ts'];
}

function contractQuality(capabilityId: string): CapabilityContractQuality {
  const explicit = CAPABILITY_CONTRACT_OVERRIDES[capabilityId]?.contract_quality;
  if (explicit) return explicit;
  if (knownRuntimeTools.has(capabilityId) || implementedInternal.has(capabilityId)) {
    return 'RUNTIME_BOUND';
  }
  return 'LEGACY_INFERRED';
}

function authenticationMode(capabilityId: string): AuthenticationMode {
  if (capabilityId.startsWith('system.')) return 'NONE';
  if (implementedInternal.has(capabilityId)) return 'INTERNAL';
  if (capabilityId.startsWith('drive.')) return 'OAUTH2';
  if (/^(instagram|social|engagement|meta_ads)\./.test(capabilityId)) return 'UNKNOWN';
  return 'INTERNAL';
}

function accessLevel(risk: RiskClass): ProviderAccessLevel {
  if (risk === 'READ') return 'READ';
  return 'MANAGE';
}

function runtimePermissionRequirements(
  capabilityId: string,
  runtime: ToolDefinition | undefined,
  operation: string,
): readonly ProviderPermissionRequirement[] {
  if (!runtime || runtime.requiredScopes.length === 0) return [];
  return [
    {
      provider: runtime.provider,
      authentication_mode: 'UNKNOWN',
      operation,
      scopes: runtime.requiredScopes,
      access_level: accessLevel(runtime.riskClass),
      validated_at: null,
      evidence: ['src/registry.ts'],
    },
  ];
}

function genericInputSchema(capabilityId: string) {
  return {
    $id: `toca://capabilities/${capabilityId}/input/v1.1`,
    type: 'object' as const,
    additionalProperties: true,
  };
}

function genericOutputSchema(capabilityId: string) {
  return {
    $id: `toca://capabilities/${capabilityId}/output/v1.1`,
    type: 'object' as const,
    additionalProperties: true,
  };
}

function createDefinition(
  capabilityId: string,
  routeId: RouteId | 'TRANSVERSAL',
): CapabilityDefinition {
  assertCapabilityNamespace(capabilityId);
  const runtimeDefinition = runtimeDefinitions.get(capabilityId);
  const override = CAPABILITY_CONTRACT_OVERRIDES[capabilityId];
  const inferredRisk = runtimeDefinition?.riskClass ?? inferredRiskClass(capabilityId);
  const risk = override?.risk_class ?? inferredRisk;
  const status = lifecycleStatus(capabilityId);
  const sideEffects = override?.side_effects ?? runtimeDefinition?.sideEffects ?? risk !== 'READ';
  const idempotent =
    override?.idempotent ??
    runtimeDefinition?.idempotent ??
    (!sideEffects || !isProviderWrite(capabilityId));
  const external = /^(instagram|meta_ads|social|engagement|drive|release|security)\./.test(
    capabilityId,
  );
  const operation = override?.operation ?? capabilityId;
  const providerPermissions = permissionRequirementsForCapability(capabilityId);
  const defaultApprovalRequired =
    risk === 'WRITE_EXTERNAL' || risk === 'FINANCIAL_IMPACT' || risk === 'DESTRUCTIVE';

  return {
    capability_id: capabilityId,
    route_id: routeId,
    primary_route_id: routeId,
    consumer_route_ids: [],
    aliases: [],
    version: CAPABILITY_CATALOG_VERSION,
    description: override?.description ?? humanDescription(capabilityId),
    contract_quality: contractQuality(capabilityId),
    lifecycle_status: status,
    risk_class: risk,
    side_effects: sideEffects,
    approval_required: override?.approval_required ?? defaultApprovalRequired,
    idempotent,
    provider: override?.provider ?? runtimeDefinition?.provider ?? inferredProvider(capabilityId),
    operation,
    authentication_mode: override?.authentication_mode ?? authenticationMode(capabilityId),
    required_scopes:
      override?.required_scopes ??
      runtimeDefinition?.requiredScopes ??
      inferredScopes(capabilityId, risk),
    permission_requirements:
      override?.permission_requirements ??
      (providerPermissions.length > 0
        ? providerPermissions
        : runtimePermissionRequirements(capabilityId, runtimeDefinition, operation)),
    required_config: config(capabilityId),
    input_schema: override?.input_schema ?? genericInputSchema(capabilityId),
    output_schema: override?.output_schema ?? genericOutputSchema(capabilityId),
    timeout_ms: external ? 60_000 : 30_000,
    retry_policy: {
      max_attempts: idempotent ? 3 : 1,
      strategy: idempotent ? 'EXPONENTIAL_BACKOFF' : 'NONE',
      retryable_errors: idempotent
        ? ['PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT']
        : [],
    },
    verification_method:
      override?.verification_method ??
      (external
        ? 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON'
        : 'SCHEMA_VALIDATION_AND_AUDIT_EVIDENCE'),
    rollback_method:
      override?.rollback_method ??
      (risk === 'READ'
        ? 'NOT_APPLICABLE'
        : risk === 'WRITE_REVERSIBLE'
          ? 'COMPENSATING_STATE_TRANSITION'
          : 'EXPLICIT_PROVIDER_COMPENSATION_OR_MANUAL_RECOVERY'),
    owner: OWNER,
    reviewer_role: REVIEWER_ROLE,
    approver_role: APPROVER_ROLE,
    last_validated_at: status === 'PRODUCTION_VALIDATED' ? '2026-08-14T00:00:00Z' : null,
    evidence: evidence(capabilityId, status),
    execution_surface: executionSurface(capabilityId, status),
  };
}

function allRouteCapabilityIds(routeId: RouteId): readonly string[] {
  return [...ROUTE_CAPABILITY_IDS[routeId], ...(TECHNICAL_EXTENSION_CAPABILITY_IDS[routeId] ?? [])];
}

export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
  ...ROUTE_IDS.flatMap((routeId) =>
    allRouteCapabilityIds(routeId).map((capabilityId) => createDefinition(capabilityId, routeId)),
  ),
  ...TRANSVERSAL_CAPABILITY_IDS.map((capabilityId) =>
    createDefinition(capabilityId, 'TRANSVERSAL'),
  ),
].sort((left, right) => left.capability_id.localeCompare(right.capability_id));

const capabilityMap = new Map<string, CapabilityDefinition>(
  CAPABILITY_CATALOG.map((definition) => [definition.capability_id, definition] as const),
);

export function getCapabilityDefinition(capabilityId: string): CapabilityDefinition | undefined {
  return capabilityMap.get(capabilityId);
}

export function validateCapabilityCatalog(): void {
  if (capabilityMap.size !== CAPABILITY_CATALOG.length) {
    throw new Error('CAPABILITY_CATALOG_DUPLICATE_ID');
  }

  for (const definition of CAPABILITY_CATALOG) {
    assertCapabilityNamespace(definition.capability_id);

    if (definition.route_id !== definition.primary_route_id) {
      throw new Error(`CAPABILITY_PRIMARY_ROUTE_MISMATCH:${definition.capability_id}`);
    }
    if (definition.side_effects !== (definition.risk_class !== 'READ')) {
      throw new Error(`CAPABILITY_RISK_SIDE_EFFECT_MISMATCH:${definition.capability_id}`);
    }
    if (definition.lifecycle_status === 'PRODUCTION_VALIDATED') {
      if (!definition.last_validated_at || definition.evidence.length === 0) {
        throw new Error(`CAPABILITY_PRODUCTION_EVIDENCE_REQUIRED:${definition.capability_id}`);
      }
    }
    if (definition.approval_required && definition.risk_class === 'READ') {
      throw new Error(`CAPABILITY_READ_APPROVAL_INVALID:${definition.capability_id}`);
    }
    if (
      definition.execution_surface === 'MCP_TOOL' &&
      definition.lifecycle_status !== 'PLANNED' &&
      definition.contract_quality === 'LEGACY_INFERRED'
    ) {
      throw new Error(`CAPABILITY_RUNTIME_CONTRACT_SOURCE_REQUIRED:${definition.capability_id}`);
    }
    if (
      definition.contract_quality === 'EXPLICIT' &&
      definition.output_schema.$id.endsWith('/output/v1')
    ) {
      throw new Error(`CAPABILITY_EXPLICIT_SCHEMA_VERSION_INVALID:${definition.capability_id}`);
    }
  }
}
