import type { ToolRegistry } from '../core/tool-registry.js';
import { MEASUREMENT_CAPABILITY_CONTRACTS } from './contracts.js';

/**
 * Registers internal measurement capability metadata in a ToolRegistry used by
 * the existing Audit Ledger. This does not expose MCP tools and does not imply
 * provider connectivity or production validation.
 */
export function registerMeasurementAuditCapabilities(registry: ToolRegistry): void {
  for (const capability of MEASUREMENT_CAPABILITY_CONTRACTS) {
    if (registry.get(capability.capabilityId)) continue;
    registry.register({
      name: capability.capabilityId,
      version: '1.0.0',
      provider:
        capability.providerBoundary === 'PROVIDER_READ_ONLY_ADAPTER'
          ? 'provider-read-only-adapter'
          : 'TOCA_OS+toca-mcp',
      riskClass: capability.riskClass,
      requiredScopes: [],
      capabilityStatus: 'IMPLEMENTED',
      sideEffects: capability.sideEffects,
      idempotent: true,
    });
  }
}
