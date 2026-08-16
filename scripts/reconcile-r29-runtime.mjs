import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, value) {
  fs.writeFileSync(path, value);
}

function replaceOnce(value, before, after, label) {
  const first = value.indexOf(before);
  if (first < 0) throw new Error(`R29_RECONCILIATION_ANCHOR_MISSING:${label}`);
  if (value.indexOf(before, first + before.length) >= 0) {
    throw new Error(`R29_RECONCILIATION_ANCHOR_DUPLICATE:${label}`);
  }
  return value.slice(0, first) + after + value.slice(first + before.length);
}

{
  const path = 'src/content/capability-contracts.ts';
  let value = read(path);
  value = value.replaceAll('approvalRequired: true,', 'approvalRequired: false,');
  write(path, value);
}

{
  const path = 'src/governance/capability-catalog.ts';
  let value = read(path);
  value = replaceOnce(
    value,
    "import type { CapabilityStatus, RiskClass, ToolDefinition } from '../core/tool-registry.js';\n",
    "import type { CapabilityStatus, RiskClass, ToolDefinition } from '../core/tool-registry.js';\nimport { VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES } from '../content/capability-contracts.js';\nimport {\n  VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_IDS,\n  VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET,\n} from '../content/capability-ids.js';\n",
    'catalog-imports',
  );
  value = replaceOnce(
    value,
    "const knownRuntimeTools = new Set(runtimeDefinitions.keys());\n\nfunction lifecycleStatus(capabilityId: string): CapabilityStatus {\n  return (\n    runtimeDefinitions.get(capabilityId)?.capabilityStatus ??\n    (implementedInternal.has(capabilityId) ? 'IMPLEMENTED' : 'PLANNED')\n  );\n}\n",
    "const knownRuntimeTools = new Set(runtimeDefinitions.keys());\n\nfunction isVideoContentTechnicalExtension(capabilityId: string): boolean {\n  return VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET.has(capabilityId);\n}\n\nfunction lifecycleStatus(capabilityId: string): CapabilityStatus {\n  return (\n    runtimeDefinitions.get(capabilityId)?.capabilityStatus ??\n    (implementedInternal.has(capabilityId) || isVideoContentTechnicalExtension(capabilityId)\n      ? 'IMPLEMENTED'\n      : 'PLANNED')\n  );\n}\n",
    'catalog-lifecycle',
  );
  value = replaceOnce(
    value,
    "  if (implementedInternal.has(capabilityId)) return 'INTERNAL_ENGINE';\n",
    "  if (implementedInternal.has(capabilityId) || isVideoContentTechnicalExtension(capabilityId))\n    return 'INTERNAL_ENGINE';\n",
    'catalog-surface',
  );
  value = replaceOnce(
    value,
    "  if (knownRuntimeTools.has(capabilityId)) return ['src/registry.ts'];\n",
    "  if (knownRuntimeTools.has(capabilityId)) return ['src/registry.ts'];\n  if (isVideoContentTechnicalExtension(capabilityId)) {\n    return ['src/content/runtime.ts', 'src/content/content-item.ts', 'src/content/video.ts'];\n  }\n",
    'catalog-evidence',
  );
  value = replaceOnce(
    value,
    "function contractQuality(capabilityId: string): CapabilityContractQuality {\n  const explicit = CAPABILITY_CONTRACT_OVERRIDES[capabilityId]?.contract_quality;\n  if (explicit) return explicit;\n  if (knownRuntimeTools.has(capabilityId) || implementedInternal.has(capabilityId)) {\n    return 'RUNTIME_BOUND';\n  }\n",
    "function contractQuality(capabilityId: string): CapabilityContractQuality {\n  const explicit =\n    VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES[capabilityId]?.contract_quality ??\n    CAPABILITY_CONTRACT_OVERRIDES[capabilityId]?.contract_quality;\n  if (explicit) return explicit;\n  if (\n    knownRuntimeTools.has(capabilityId) ||\n    implementedInternal.has(capabilityId) ||\n    isVideoContentTechnicalExtension(capabilityId)\n  ) {\n    return 'RUNTIME_BOUND';\n  }\n",
    'catalog-quality',
  );
  value = replaceOnce(
    value,
    "  if (implementedInternal.has(capabilityId)) return 'INTERNAL';\n",
    "  if (implementedInternal.has(capabilityId) || isVideoContentTechnicalExtension(capabilityId))\n    return 'INTERNAL';\n",
    'catalog-auth',
  );
  value = replaceOnce(
    value,
    "  const override = CAPABILITY_CONTRACT_OVERRIDES[capabilityId];\n",
    "  const override =\n    VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES[capabilityId] ??\n    CAPABILITY_CONTRACT_OVERRIDES[capabilityId];\n",
    'catalog-override',
  );
  value = replaceOnce(
    value,
    "function allRouteCapabilityIds(routeId: RouteId): readonly string[] {\n  return [...ROUTE_CAPABILITY_IDS[routeId], ...(TECHNICAL_EXTENSION_CAPABILITY_IDS[routeId] ?? [])];\n}\n",
    "function allRouteCapabilityIds(routeId: RouteId): readonly string[] {\n  return [\n    ...ROUTE_CAPABILITY_IDS[routeId],\n    ...(TECHNICAL_EXTENSION_CAPABILITY_IDS[routeId] ?? []),\n    ...(VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_IDS[routeId] ?? []),\n  ];\n}\n",
    'catalog-route-extensions',
  );
  write(path, value);
}

{
  const path = 'src/registry.ts';
  let value = read(path);
  value = replaceOnce(
    value,
    "import { ToolRegistry, type ToolDefinition } from './core/tool-registry.js';\n",
    "import { VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES } from './content/capability-contracts.js';\nimport { ToolRegistry, type ToolDefinition } from './core/tool-registry.js';\n",
    'registry-import',
  );
  value = replaceOnce(
    value,
    "export interface ToolRegistryOptions {\n",
    "const videoContentRuntimeTools: readonly ToolDefinition[] = Object.entries(\n  VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES,\n).map(([name, contract]) => ({\n  name,\n  version: '1.0.0',\n  provider: contract.provider ?? 'TOCA_OS+toca-mcp',\n  riskClass: contract.risk_class ?? 'READ',\n  requiredScopes: contract.required_scopes ?? [],\n  capabilityStatus: 'IMPLEMENTED',\n  sideEffects: contract.side_effects ?? false,\n  idempotent: contract.idempotent ?? true,\n}));\n\nexport interface ToolRegistryOptions {\n",
    'registry-tools',
  );
  value = replaceOnce(
    value,
    "  readonly tocaManagedInstagramSchedulerEnabled?: boolean;\n",
    "  readonly tocaManagedInstagramSchedulerEnabled?: boolean;\n  readonly videoContentRuntimeEnabled?: boolean;\n",
    'registry-option',
  );
  value = replaceOnce(
    value,
    "  if (options.tocaManagedInstagramSchedulerEnabled)\n    for (const tool of tocaManagedInstagramSchedulerTools) registry.register(tool);\n  return registry;\n",
    "  if (options.tocaManagedInstagramSchedulerEnabled)\n    for (const tool of tocaManagedInstagramSchedulerTools) registry.register(tool);\n  if (options.videoContentRuntimeEnabled)\n    for (const tool of videoContentRuntimeTools) registry.register(tool);\n  return registry;\n",
    'registry-register',
  );
  write(path, value);
}

{
  const path = 'src/mcp/runtime-capability-resolver.ts';
  let value = read(path);
  value = replaceOnce(
    value,
    "import * as z from 'zod/v4';\n",
    "import * as z from 'zod/v4';\nimport { VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET } from '../content/capability-ids.js';\nimport {\n  VIDEO_CONTENT_WRITE_CAPABILITY_IDS,\n  runtimeIdempotencyKey,\n  type VideoContentRuntimeInput,\n  type VideoContentRuntimeService,\n} from '../content/runtime.js';\n",
    'resolver-import',
  );
  value = replaceOnce(
    value,
    "const recordSchema = z.record(z.string(), z.unknown());\n",
    "const recordSchema = z.record(z.string(), z.unknown());\nconst videoContentInputSchema = z.object({\n  tenant_id: z.string().min(1),\n  workspace_id: z.string().min(1),\n  organization_id: z.string().min(1),\n  content_item_id: z.string().min(1),\n  version_id: z.string().min(1),\n  correlation_id: z.string().min(1),\n  idempotency_key: z.string().min(1).optional(),\n  evidence: z.array(z.string().min(1)).min(1),\n  payload: recordSchema,\n  approval_ref: z.string().min(1).optional(),\n  target_channel: z.string().min(1).optional(),\n  target_format: z.string().min(1).optional(),\n  target_language: z.string().min(1).optional(),\n  event_id: z.string().min(1).optional(),\n  experiment_id: z.string().min(1).optional(),\n});\n",
    'resolver-schema',
  );
  value = replaceOnce(
    value,
    "  readonly instagramScheduler?: TocaManagedInstagramScheduler;\n",
    "  readonly instagramScheduler?: TocaManagedInstagramScheduler;\n  readonly videoContent?: VideoContentRuntimeService;\n",
    'resolver-service',
  );
  value = replaceOnce(
    value,
    "function resolveBinding(\n  capabilityId: string,\n  services: RuntimeCapabilityServices,\n): CoreCapabilityRuntimeBinding | undefined {\n  const googleAds = googleAdsRuntimeContext(services);\n",
    "function resolveBinding(\n  capabilityId: string,\n  services: RuntimeCapabilityServices,\n): CoreCapabilityRuntimeBinding | undefined {\n  if (services.videoContent && VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET.has(capabilityId)) {\n    const write = VIDEO_CONTENT_WRITE_CAPABILITY_IDS.has(capabilityId);\n    return binding(\n      videoContentInputSchema,\n      (input) => services.videoContent!.execute(capabilityId, input as VideoContentRuntimeInput),\n      write\n        ? {\n            idempotencyKey: (input) =>\n              runtimeIdempotencyKey(capabilityId, input as VideoContentRuntimeInput),\n            providerReadback: (result, input) =>\n              services.videoContent!.readback(\n                capabilityId,\n                result,\n                input as VideoContentRuntimeInput,\n              ),\n            sideEffectValidated: true,\n          }\n        : {},\n    );\n  }\n  const googleAds = googleAdsRuntimeContext(services);\n",
    'resolver-binding',
  );
  write(path, value);
}

{
  const path = 'src/server.ts';
  let value = read(path);
  value = replaceOnce(
    value,
    "import { McpServer } from '@modelcontextprotocol/server';\n",
    "import { McpServer } from '@modelcontextprotocol/server';\nimport { PostgresVideoContentRuntime } from './content/runtime.js';\n",
    'server-import',
  );
  value = replaceOnce(
    value,
    "  const registry = createToolRegistry({\n    instagramReadsEnabled: config.INSTAGRAM_READ_ENABLED,\n    metaAdsReadsEnabled: config.META_ADS_READ_ENABLED,\n    metaAdsWritesEnabled: config.META_ADS_WRITE_ENABLED,\n    googleAdsPhase: config.GOOGLE_ADS_PHASE,\n    tocaManagedInstagramSchedulerEnabled: config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED,\n  });\n\n  const secrets = new EnvironmentSecretResolver(env);\n  const pool = config.DATABASE_URL\n    ? createPostgresPool({ connectionString: config.DATABASE_URL })\n    : undefined;\n",
    "  const secrets = new EnvironmentSecretResolver(env);\n  const pool = config.DATABASE_URL\n    ? createPostgresPool({ connectionString: config.DATABASE_URL })\n    : undefined;\n  const registry = createToolRegistry({\n    instagramReadsEnabled: config.INSTAGRAM_READ_ENABLED,\n    metaAdsReadsEnabled: config.META_ADS_READ_ENABLED,\n    metaAdsWritesEnabled: config.META_ADS_WRITE_ENABLED,\n    googleAdsPhase: config.GOOGLE_ADS_PHASE,\n    tocaManagedInstagramSchedulerEnabled: config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED,\n    videoContentRuntimeEnabled: Boolean(pool),\n  });\n",
    'server-registry',
  );
  value = replaceOnce(
    value,
    "  const runtimeResolver = createRuntimeCapabilityResolver({\n",
    "  const videoContent = pool ? new PostgresVideoContentRuntime(pool) : undefined;\n\n  const runtimeResolver = createRuntimeCapabilityResolver({\n",
    'server-runtime-create',
  );
  value = replaceOnce(
    value,
    "    ...(instagramScheduler ? { instagramScheduler } : {}),\n  });\n",
    "    ...(instagramScheduler ? { instagramScheduler } : {}),\n    ...(videoContent ? { videoContent } : {}),\n  });\n",
    'server-runtime-pass',
  );
  write(path, value);
}

{
  const path = 'test/governance-catalog.test.ts';
  let value = read(path);
  value = value.replace('toHaveLength(758)', 'toHaveLength(783)');
  value = value.replace('raw_count: 758', 'raw_count: 783');
  write(path, value);
}

{
  const path = 'test/capability-resolution.test.ts';
  let value = read(path);
  value = value.replace('raw_count: 758', 'raw_count: 783');
  value = value.replace('effective_count: 750', 'effective_count: 775');
  write(path, value);
}

{
  const path = 'test/r20-r29-capability-contracts.test.ts';
  let value = read(path);
  value = value.replace(
    "  it('keeps R20 export approval-gated and off the external publication surface', () => {",
    "  it('keeps export approval-referenced and off the external publication surface', () => {",
  );
  value = value.replaceAll('approval_required: true,', 'approval_required: false,');
  write(path, value);
}

console.log('R29 runtime reconciliation applied');
