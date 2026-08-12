import { ToolRegistry, type ToolDefinition } from './core/tool-registry.js';

const bootstrapTools: readonly ToolDefinition[] = [
  {
    name: 'system.capabilities',
    version: '1.0.0',
    provider: 'system',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'system.health',
    version: '1.0.0',
    provider: 'system',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
];

const instagramReadTools: readonly ToolDefinition[] = [
  {
    name: 'instagram.media.list',
    version: '1.0.0',
    provider: 'Meta/Instagram',
    riskClass: 'READ',
    requiredScopes: ['instagram_basic'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'instagram.insights.media',
    version: '1.0.0',
    provider: 'Meta/Instagram',
    riskClass: 'READ',
    requiredScopes: ['instagram_basic', 'instagram_manage_insights'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'instagram.insights.account',
    version: '1.0.0',
    provider: 'Meta/Instagram',
    riskClass: 'READ',
    requiredScopes: ['instagram_basic', 'instagram_manage_insights'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
];

export interface ToolRegistryOptions {
  readonly instagramReadsEnabled?: boolean;
}

export function createToolRegistry(options: ToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of bootstrapTools) registry.register(tool);
  if (options.instagramReadsEnabled) {
    for (const tool of instagramReadTools) registry.register(tool);
  }
  return registry;
}
