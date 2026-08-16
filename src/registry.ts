import { VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES } from './content/capability-contracts.js';
import { ToolRegistry, type ToolDefinition } from './core/tool-registry.js';
import {
  googleAdsPhaseAtLeast,
  type GoogleAdsPhase,
} from './providers/google-ads/google-ads-phase.js';

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

const metaAdsReadTools: readonly ToolDefinition[] = [
  {
    name: 'meta_ads.accounts.list',
    version: '1.0.0',
    provider: 'Meta Marketing API',
    riskClass: 'READ',
    requiredScopes: ['ads_read'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'meta_ads.campaigns.list',
    version: '1.0.0',
    provider: 'Meta Marketing API',
    riskClass: 'READ',
    requiredScopes: ['ads_read'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'meta_ads.adsets.list',
    version: '1.0.0',
    provider: 'Meta Marketing API',
    riskClass: 'READ',
    requiredScopes: ['ads_read'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'meta_ads.ads.list',
    version: '1.0.0',
    provider: 'Meta Marketing API',
    riskClass: 'READ',
    requiredScopes: ['ads_read'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'meta_ads.insights.get',
    version: '1.0.0',
    provider: 'Meta Marketing API',
    riskClass: 'READ',
    requiredScopes: ['ads_read'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
];

const metaAdsWriteTools: readonly ToolDefinition[] = [
  {
    name: 'meta_ads.campaign.prepare_paused',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'READ',
    requiredScopes: ['ads_management'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'meta_ads.campaign.create_paused',
    version: '1.0.0',
    provider: 'Meta Marketing API',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['ads_management'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: false,
  },
];

const googleAdsTools: readonly (ToolDefinition & { readonly minimumPhase: GoogleAdsPhase })[] = [
  ...[
    'google_ads.account.inspect',
    'google_ads.campaigns.list',
    'google_ads.insights.get',
    'google_ads.conversion_actions.list',
    'google_ads.spend.monitor',
    'google_ads.conversions.monitor',
  ].map((name) => ({
    name,
    version: '1.0.0',
    provider: 'Google Ads API',
    riskClass: 'READ' as const,
    requiredScopes: ['https://www.googleapis.com/auth/adwords'],
    capabilityStatus: 'IMPLEMENTED' as const,
    sideEffects: false,
    idempotent: true,
    minimumPhase: 'READ_ONLY' as const,
  })),
  ...['google_ads.campaign.prepare', 'google_ads.targeting.validate'].map((name) => ({
    name,
    version: '1.0.0',
    provider: 'Google Ads API',
    riskClass: 'READ' as const,
    requiredScopes: ['https://www.googleapis.com/auth/adwords'],
    capabilityStatus: 'IMPLEMENTED' as const,
    sideEffects: false,
    idempotent: true,
    minimumPhase: 'PREPARE' as const,
  })),
  {
    name: 'google_ads.campaign.create_paused',
    version: '1.0.0',
    provider: 'Google Ads API',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['https://www.googleapis.com/auth/adwords'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: false,
    minimumPhase: 'CREATE_PAUSED',
  },
  {
    name: 'google_ads.campaign.readback',
    version: '1.0.0',
    provider: 'Google Ads API',
    riskClass: 'READ',
    requiredScopes: ['https://www.googleapis.com/auth/adwords'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
    minimumPhase: 'READBACK',
  },
  {
    name: 'google_ads.campaign.activate',
    version: '1.0.0',
    provider: 'Google Ads API',
    riskClass: 'FINANCIAL_IMPACT',
    requiredScopes: ['https://www.googleapis.com/auth/adwords'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: true,
    minimumPhase: 'MANAGE',
  },
  {
    name: 'google_ads.campaign.pause',
    version: '1.0.0',
    provider: 'Google Ads API',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: ['https://www.googleapis.com/auth/adwords'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: true,
    minimumPhase: 'MANAGE',
  },
  {
    name: 'google_ads.campaign.update_budget',
    version: '1.0.0',
    provider: 'Google Ads API',
    riskClass: 'FINANCIAL_IMPACT',
    requiredScopes: ['https://www.googleapis.com/auth/adwords'],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: true,
    minimumPhase: 'MANAGE',
  },
];

const tocaManagedInstagramSchedulerTools: readonly ToolDefinition[] = [
  {
    name: 'instagram.toca_schedule.prepare',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'PRODUCTION_VALIDATED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'instagram.toca_schedule.create',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'WRITE_REVERSIBLE',
    requiredScopes: [],
    capabilityStatus: 'PRODUCTION_VALIDATED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.toca_schedule.reschedule',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'WRITE_REVERSIBLE',
    requiredScopes: [],
    capabilityStatus: 'PRODUCTION_VALIDATED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.toca_schedule.cancel',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'WRITE_REVERSIBLE',
    requiredScopes: [],
    capabilityStatus: 'PRODUCTION_VALIDATED',
    sideEffects: true,
    idempotent: true,
  },
  {
    name: 'instagram.toca_schedule.status',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'PRODUCTION_VALIDATED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'instagram.toca_schedule.list',
    version: '1.0.0',
    provider: 'toca-mcp',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'PRODUCTION_VALIDATED',
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

const directInstagramPublicationToolNames = new Set([
  'instagram.publish.image',
  'instagram.publish.carousel',
  'instagram.publish.reel',
  'instagram.publish.story',
]);

function publicationTools(options: ToolRegistryOptions): readonly ToolDefinition[] {
  const promoteDirectPublication =
    options.instagramPublicationWritesEnabled === true ||
    options.tocaManagedInstagramSchedulerEnabled === true;
  if (!promoteDirectPublication) return plannedInstagramPublicationTools;
  return plannedInstagramPublicationTools.map((tool) =>
    directInstagramPublicationToolNames.has(tool.name)
      ? { ...tool, capabilityStatus: 'PRODUCTION_VALIDATED' as const }
      : tool,
  );
}

const videoContentRuntimeTools: readonly ToolDefinition[] = Object.entries(
  VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES,
).map(([name, contract]) => ({
  name,
  version: '1.0.0',
  provider: contract.provider ?? 'TOCA_OS+toca-mcp',
  riskClass: contract.risk_class ?? 'READ',
  requiredScopes: contract.required_scopes ?? [],
  capabilityStatus: 'PRODUCTION_VALIDATED',
  sideEffects: contract.side_effects ?? false,
  idempotent: contract.idempotent ?? true,
}));

export interface ToolRegistryOptions {
  readonly instagramReadsEnabled?: boolean;
  readonly instagramPublicationWritesEnabled?: boolean;
  readonly metaAdsReadsEnabled?: boolean;
  readonly metaAdsWritesEnabled?: boolean;
  readonly googleAdsPhase?: GoogleAdsPhase;
  readonly tocaManagedInstagramSchedulerEnabled?: boolean;
  readonly videoContentRuntimeEnabled?: boolean;
}

export function createToolRegistry(options: ToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [...bootstrapTools, ...publicationTools(options)]) registry.register(tool);
  if (options.instagramReadsEnabled) for (const tool of instagramReadTools) registry.register(tool);
  if (options.metaAdsReadsEnabled) for (const tool of metaAdsReadTools) registry.register(tool);
  if (options.metaAdsWritesEnabled) for (const tool of metaAdsWriteTools) registry.register(tool);
  if (options.googleAdsPhase) {
    for (const { minimumPhase, ...tool } of googleAdsTools) {
      if (googleAdsPhaseAtLeast(options.googleAdsPhase, minimumPhase)) registry.register(tool);
    }
  }
  if (options.tocaManagedInstagramSchedulerEnabled)
    for (const tool of tocaManagedInstagramSchedulerTools) registry.register(tool);
  if (options.videoContentRuntimeEnabled)
    for (const tool of videoContentRuntimeTools) registry.register(tool);
  return registry;
}
