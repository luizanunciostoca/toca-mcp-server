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

const plannedInstagramPublicationTools: readonly ToolDefinition[] = [
  {
    name: 'instagram.publish.image',
    version: '1.0.0',
    provider: 'Meta/Instagram',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['instagram_content_publish'],
    capabilityStatus: 'PLANNED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.publish.carousel',
    version: '1.0.0',
    provider: 'Meta/Instagram',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['instagram_content_publish'],
    capabilityStatus: 'PLANNED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.publish.reel',
    version: '1.0.0',
    provider: 'Meta/Instagram',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['instagram_content_publish'],
    capabilityStatus: 'PLANNED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.publish.story',
    version: '1.0.0',
    provider: 'Meta/Instagram',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['instagram_content_publish'],
    capabilityStatus: 'PLANNED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.publication.schedule',
    version: '1.0.0',
    provider: 'toca-mcp+Meta/Instagram',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['instagram_content_publish'],
    capabilityStatus: 'PLANNED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.publication.reschedule',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'WRITE_REVERSIBLE',
    requiredScopes: [],
    capabilityStatus: 'PLANNED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.publication.cancel_scheduled',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'WRITE_REVERSIBLE',
    requiredScopes: [],
    capabilityStatus: 'PLANNED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.publication.list_scheduled',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'PLANNED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'instagram.publication.status',
    version: '1.0.0',
    provider: 'toca-mcp+Meta/Instagram',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'PLANNED',
    sideEffects: false,
    idempotent: true,
  },
];

export interface ToolRegistryOptions {
  readonly instagramReadsEnabled?: boolean;
}

export function createToolRegistry(options: ToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [...bootstrapTools, ...plannedInstagramPublicationTools]) {
    registry.register(tool);
  }
  if (options.instagramReadsEnabled) {
    for (const tool of instagramReadTools) registry.register(tool);
  }
  return registry;
}
