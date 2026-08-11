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

const mediaAssetsRankTool: ToolDefinition = {
  name: 'media.assets.rank',
  version: '1.0.0',
  provider: 'google-sheets',
  riskClass: 'READ',
  requiredScopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  capabilityStatus: 'IMPLEMENTED',
  sideEffects: false,
  idempotent: true,
};

export interface ToolRegistryOptions {
  readonly mediaAssetsRankEnabled?: boolean;
}

export function createToolRegistry(options: ToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of bootstrapTools) {
    registry.register(tool);
  }
  if (options.mediaAssetsRankEnabled) {
    registry.register(mediaAssetsRankTool);
  }
  return registry;
}
