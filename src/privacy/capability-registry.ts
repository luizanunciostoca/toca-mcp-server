import type { RiskClass, ToolRegistry } from '../core/tool-registry.js';
import type { PrivacyCapabilityId } from './contracts.js';

export interface PrivacyCapabilityContract {
  readonly capabilityId: PrivacyCapabilityId;
  readonly routeId: 'R16';
  readonly lifecycleStatus: 'IMPLEMENTED';
  readonly riskClass: RiskClass;
  readonly sideEffects: boolean;
  readonly approvalRequired: boolean;
}

const contract = (
  capabilityId: PrivacyCapabilityId,
  riskClass: RiskClass,
  approvalRequired = false,
): PrivacyCapabilityContract => ({
  capabilityId,
  routeId: 'R16',
  lifecycleStatus: 'IMPLEMENTED',
  riskClass,
  sideEffects: riskClass !== 'READ',
  approvalRequired,
});

export const PRIVACY_CAPABILITY_CONTRACTS: readonly PrivacyCapabilityContract[] = [
  contract('privacy.purpose.resolve', 'READ'),
  contract('privacy.communication.resolve', 'READ'),
  contract('privacy.legal_basis.record', 'WRITE_REVERSIBLE'),
  contract('privacy.consent.record', 'WRITE_REVERSIBLE'),
  contract('privacy.consent.revoke', 'WRITE_REVERSIBLE'),
  contract('privacy.opt_out.record', 'WRITE_REVERSIBLE'),
  contract('privacy.suppression.check', 'READ'),
  contract('privacy.suppression.record', 'WRITE_REVERSIBLE'),
  contract('privacy.preference.update', 'WRITE_REVERSIBLE'),
  contract('privacy.provider_consent.reconcile', 'WRITE_REVERSIBLE'),
  contract('privacy.pii.access.evaluate', 'READ'),
  contract('privacy.retention.apply', 'WRITE_REVERSIBLE'),
  contract('privacy.subject_request.create', 'WRITE_REVERSIBLE'),
  contract('privacy.subject_request.status', 'READ'),
  contract('privacy.data_export.prepare', 'WRITE_REVERSIBLE', true),
  contract('privacy.data_delete.execute', 'DESTRUCTIVE', true),
  contract('privacy.automated_decision.explain', 'WRITE_REVERSIBLE'),
  contract('privacy.profiling.review', 'WRITE_REVERSIBLE'),
];

/**
 * Registers Privacy/LGPD internal capability metadata for audit/runtime
 * introspection. This does not expose public MCP tools, provider connectivity or
 * PRODUCTION_VALIDATED status.
 */
export function registerPrivacyAuditCapabilities(registry: ToolRegistry): void {
  for (const capability of PRIVACY_CAPABILITY_CONTRACTS) {
    if (registry.get(capability.capabilityId)) continue;
    registry.register({
      name: capability.capabilityId,
      version: '1.0.0',
      provider: 'TOCA_OS+toca-mcp',
      riskClass: capability.riskClass,
      requiredScopes: [],
      capabilityStatus: capability.lifecycleStatus,
      sideEffects: capability.sideEffects,
      idempotent:
        capability.capabilityId !== 'privacy.data_export.prepare' &&
        capability.capabilityId !== 'privacy.data_delete.execute',
    });
  }
}
