import * as z from 'zod/v4';
import { VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET } from '../content/capability-ids.js';
import {
  VIDEO_CONTENT_WRITE_CAPABILITY_IDS,
  runtimeIdempotencyKey,
  type VideoContentRuntimeInput,
  type VideoContentRuntimeService,
} from '../content/runtime.js';
import type {
  GoogleAdsCampaignPlan,
  GoogleAdsPaidMediaProvider,
} from '../providers/google-ads/google-ads-paid-media.js';
import type { InstagramHistoryProvider } from '../providers/instagram/instagram-history-provider.js';
import type { MetaAdsControlledGraphProvider } from '../providers/meta-ads/meta-ads-controlled-graph-provider.js';
import {
  requestSha256,
  type ControlledCreatePausedPlan,
  type MetaAdsControlledWriteService,
} from '../providers/meta-ads/meta-ads-controlled-write.js';
import type { MetaAdsDemandIntelligenceService } from '../providers/meta-ads/meta-ads-demand-intelligence.js';
import type { MetaAdsReadProvider } from '../providers/meta-ads/meta-ads-read-provider.js';
import {
  hashTocaManagedInstagramApprovalDescriptor,
  tocaManagedInstagramApprovalDescriptorSchema,
  tocaManagedInstagramSchedulePayloadSchema,
  type TocaManagedInstagramSchedulePayload,
  type TocaManagedInstagramScheduler,
} from '../scheduler/toca-managed-instagram-scheduler.js';
import type {
  CoreCapabilityRuntimeBinding,
  CoreCapabilityRuntimeResolver,
} from './core-execution.js';
import {
  resolveInstagramPublicationRuntimeBinding,
  type InstagramCorePublicationRuntime,
} from './instagram-publication-runtime.js';

const recordSchema = z.record(z.string(), z.unknown());
const videoContentInputSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().min(1),
  organization_id: z.string().min(1),
  content_item_id: z.string().min(1),
  version_id: z.string().min(1),
  correlation_id: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
  evidence: z.array(z.string().min(1)).min(1),
  payload: recordSchema,
  approval_ref: z.string().min(1).optional(),
  target_channel: z.string().min(1).optional(),
  target_format: z.string().min(1).optional(),
  target_language: z.string().min(1).optional(),
  event_id: z.string().min(1).optional(),
  experiment_id: z.string().min(1).optional(),
});

function videoContentSchemaFor(capabilityId: string) {
  switch (capabilityId) {
    case 'video.export.reel':
    case 'video.export.story':
      return videoContentInputSchema.extend({ approval_ref: z.string().min(1) });
    case 'content_item.channel.adapt':
      return videoContentInputSchema.extend({
        target_channel: z.string().min(1),
        target_format: z.string().min(1),
      });
    case 'content_item.language.localize':
      return videoContentInputSchema.extend({ target_language: z.string().min(1) });
    case 'content_item.event.link':
      return videoContentInputSchema.extend({ event_id: z.string().min(1) });
    case 'content_item.experiment.link':
      return videoContentInputSchema.extend({ experiment_id: z.string().min(1) });
    default:
      return videoContentInputSchema;
  }
}
const googleAdsPlanSchema = z.object({
  customerId: z.string().min(1),
  currencyCode: z.string().length(3),
  campaignName: z.string().min(1),
  budgetName: z.string().min(1),
  dailyBudgetMicros: z.number().int().positive(),
  advertisingChannelType: z.literal('SEARCH').optional(),
  targeting: z.object({
    locationCriterionIds: z.array(z.string().regex(/^\d+$/)).min(1),
    languageCriterionIds: z.array(z.string().regex(/^\d+$/)).optional(),
    presenceOnly: z.boolean().optional(),
  }),
});
const googleAdsDateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const googleAdsCampaignReferenceSchema = z.object({ campaignIdOrName: z.string().min(1) });
const googleAdsCampaignIdSchema = z.object({ campaignId: z.string().regex(/^\d+$/) });
const googleAdsActivateSchema = googleAdsCampaignIdSchema.extend({
  expectedDailyBudgetMicros: z.number().int().positive(),
});
const googleAdsBudgetUpdateSchema = googleAdsCampaignIdSchema.extend({
  dailyBudgetMicros: z.number().int().positive(),
});

function googleAdsPlanFromInput(input: z.infer<typeof googleAdsPlanSchema>): GoogleAdsCampaignPlan {
  return {
    customerId: input.customerId,
    currencyCode: input.currencyCode,
    campaignName: input.campaignName,
    budgetName: input.budgetName,
    dailyBudgetMicros: input.dailyBudgetMicros,
    advertisingChannelType: input.advertisingChannelType ?? 'SEARCH',
    targeting: {
      locationCriterionIds: input.targeting.locationCriterionIds,
      ...(input.targeting.languageCriterionIds !== undefined
        ? { languageCriterionIds: input.targeting.languageCriterionIds }
        : {}),
      ...(input.targeting.presenceOnly !== undefined
        ? { presenceOnly: input.targeting.presenceOnly }
        : {}),
    },
  };
}

const mediaListSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  after: z.string().min(1).optional(),
  since: z.string().min(1).optional(),
  until: z.string().min(1).optional(),
});
const mediaInsightsSchema = z.object({
  mediaId: z.string().min(1),
  metrics: z.array(z.string().min(1)).min(1).max(50),
});
const accountInsightsSchema = z.object({
  metrics: z.array(z.string().min(1)).min(1).max(50),
  period: z.string().min(1).optional(),
  since: z.string().min(1).optional(),
  until: z.string().min(1).optional(),
  metricType: z.enum(['time_series', 'total_value']).optional(),
});
const adAccountSchema = z.object({
  adAccountId: z.string().min(1),
  currency: z.string().min(3).max(8),
});
const insightsSchema = adAccountSchema.extend({
  level: z.enum(['account', 'campaign', 'adset', 'ad']).default('campaign'),
  fields: z.array(z.string().min(1)).min(1).max(50),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const morroAudienceSchema = adAccountSchema.extend({
  optimizationGoal: z.string().min(1).default('REACH'),
  observedAt: z.string().datetime({ offset: true }).optional(),
});
const morroDemandSchema = morroAudienceSchema.extend({
  performanceScore: z.number().min(0).max(100).optional(),
  calendarEventScore: z.number().min(0).max(100).optional(),
  seasonalityScore: z.number().min(0).max(100).optional(),
  capacityScore: z.number().min(0).max(100).optional(),
});
const morroBudgetSchema = morroDemandSchema.extend({
  currentBudgetMinor: z.number().int().positive(),
});
const planSchema = z.object({
  account: z.object({
    adAccountId: z.string().min(1),
    currency: z.string().length(3),
  }),
  campaign: z.object({
    name: z.string().min(1),
    objective: z.string().min(1),
    specialAdCategories: z.array(z.string()),
  }),
  adSet: z.object({
    name: z.string().min(1),
    dailyBudgetMinor: z.number().int().positive(),
    billingEvent: z.string().min(1),
    optimizationGoal: z.string().min(1),
    targeting: recordSchema,
    promotedObject: recordSchema,
    startTime: z.string().min(1).optional(),
    endTime: z.string().min(1).optional(),
  }),
  creatives: z
    .array(
      z.object({
        name: z.string().min(1),
        pageId: z.string().min(1),
        instagramActorId: z.string().min(1).optional(),
        objectStorySpec: recordSchema,
      }),
    )
    .min(1)
    .max(10),
  ads: z
    .array(
      z.object({
        name: z.string().min(1),
        creativeIndex: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(10),
});
function toControlledCreatePausedPlan(
  input: z.infer<typeof planSchema>,
): ControlledCreatePausedPlan {
  return {
    account: input.account,
    campaign: input.campaign,
    adSet: {
      name: input.adSet.name,
      dailyBudgetMinor: input.adSet.dailyBudgetMinor,
      billingEvent: input.adSet.billingEvent,
      optimizationGoal: input.adSet.optimizationGoal,
      targeting: input.adSet.targeting,
      promotedObject: input.adSet.promotedObject,
      ...(input.adSet.startTime !== undefined ? { startTime: input.adSet.startTime } : {}),
      ...(input.adSet.endTime !== undefined ? { endTime: input.adSet.endTime } : {}),
    },
    creatives: input.creatives.map((creative) => ({
      name: creative.name,
      pageId: creative.pageId,
      objectStorySpec: creative.objectStorySpec,
      ...(creative.instagramActorId !== undefined
        ? { instagramActorId: creative.instagramActorId }
        : {}),
    })),
    ads: input.ads,
  };
}

const rescheduleSchema = z.object({
  jobId: z.string().min(1),
  replacement: tocaManagedInstagramSchedulePayloadSchema,
});
const jobIdSchema = z.object({ jobId: z.string().min(1) });

export interface RuntimeCapabilityServices {
  readonly googleAds?: GoogleAdsPaidMediaProvider;
  readonly googleAdsTargetAccount?: string;
  readonly googleAdsCurrency?: string;
  readonly instagramHistory?: InstagramHistoryProvider;
  readonly instagramPublication?: InstagramCorePublicationRuntime;
  readonly metaAdsRead?: MetaAdsReadProvider;
  readonly metaAdsDemand?: MetaAdsDemandIntelligenceService;
  readonly metaAdsWrite?: MetaAdsControlledWriteService;
  readonly metaAdsWriteProvider?: MetaAdsControlledGraphProvider;
  readonly instagramScheduler?: TocaManagedInstagramScheduler;
  readonly videoContent?: VideoContentRuntimeService;
}

interface GoogleAdsRuntimeContext {
  readonly provider: GoogleAdsPaidMediaProvider;
  readonly targetAccount: string;
  readonly currency: string;
}

export function createRuntimeCapabilityResolver(
  services: RuntimeCapabilityServices,
): CoreCapabilityRuntimeResolver {
  return (capabilityId) => resolveBinding(capabilityId, services);
}

function resolveBinding(
  capabilityId: string,
  services: RuntimeCapabilityServices,
): CoreCapabilityRuntimeBinding | undefined {
  const instagramPublication = resolveInstagramPublicationRuntimeBinding(
    capabilityId,
    services.instagramPublication,
  );
  if (instagramPublication) return instagramPublication;

  if (services.videoContent && VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET.has(capabilityId)) {
    const write = VIDEO_CONTENT_WRITE_CAPABILITY_IDS.has(capabilityId);
    return binding(
      videoContentSchemaFor(capabilityId),
      (input) => services.videoContent!.execute(capabilityId, input as VideoContentRuntimeInput),
      write
        ? {
            idempotencyKey: (input) =>
              runtimeIdempotencyKey(capabilityId, input as VideoContentRuntimeInput),
            providerReadback: (result, input) =>
              services.videoContent!.readback(
                capabilityId,
                result,
                input as VideoContentRuntimeInput,
              ),
            sideEffectValidated: true,
          }
        : {},
    );
  }
  const googleAds = googleAdsRuntimeContext(services);
  switch (capabilityId) {
    case 'google_ads.account.inspect':
      return googleAds
        ? binding(z.object({}), () => googleAds.provider.inspectAccount(), {
            targetAccount: () => googleAds.targetAccount,
          })
        : undefined;
    case 'google_ads.campaigns.list':
      return googleAds
        ? binding(
            z.object({ limit: z.number().int().min(1).max(500).default(100) }),
            (input) => googleAds.provider.listCampaigns(input.limit),
            { targetAccount: () => googleAds.targetAccount },
          )
        : undefined;
    case 'google_ads.insights.get':
      return googleAds
        ? binding(
            googleAdsDateRangeSchema.extend({
              limit: z.number().int().min(1).max(500).default(100),
            }),
            (input) => googleAds.provider.getInsights(input.startDate, input.endDate, input.limit),
            { targetAccount: () => googleAds.targetAccount },
          )
        : undefined;
    case 'google_ads.conversion_actions.list':
      return googleAds
        ? binding(
            z.object({ limit: z.number().int().min(1).max(500).default(100) }),
            (input) => googleAds.provider.listConversionActions(input.limit),
            { targetAccount: () => googleAds.targetAccount },
          )
        : undefined;
    case 'google_ads.spend.monitor':
      return googleAds
        ? binding(
            googleAdsDateRangeSchema,
            (input) => googleAds.provider.spendMonitor(input.startDate, input.endDate),
            { targetAccount: () => googleAds.targetAccount },
          )
        : undefined;
    case 'google_ads.conversions.monitor':
      return googleAds
        ? binding(
            googleAdsDateRangeSchema,
            (input) => googleAds.provider.conversionsMonitor(input.startDate, input.endDate),
            { targetAccount: () => googleAds.targetAccount },
          )
        : undefined;
    case 'google_ads.campaign.prepare':
      return googleAds
        ? binding(
            googleAdsPlanSchema,
            (input) => Promise.resolve(googleAds.provider.prepare(googleAdsPlanFromInput(input))),
            { targetAccount: () => googleAds.targetAccount },
          )
        : undefined;
    case 'google_ads.targeting.validate':
      return googleAds
        ? binding(
            googleAdsPlanSchema,
            (input) => googleAds.provider.validateTargeting(googleAdsPlanFromInput(input)),
            { targetAccount: () => googleAds.targetAccount },
          )
        : undefined;
    case 'google_ads.campaign.create_paused':
      return googleAds
        ? binding(
            googleAdsPlanSchema,
            (input) => googleAds.provider.createPaused(googleAdsPlanFromInput(input)),
            {
              targetAccount: () => googleAds.targetAccount,
              idempotencyKey: (input) =>
                `google-ads:create-paused:${googleAds.provider.prepare(googleAdsPlanFromInput(input)).requestSha256}`,
              financialContext: (input) => ({
                amountMinor: googleAds.provider.minorUnitsForMicros(input.dailyBudgetMicros),
                currency: googleAds.currency,
              }),
              providerReadback: async (result) => {
                const record = result;
                const resourceName =
                  typeof record.campaignResourceName === 'string'
                    ? record.campaignResourceName
                    : undefined;
                if (!resourceName) {
                  return {
                    verified: false,
                    evidence: ['google-ads:create-paused:resource-name-missing'],
                    reason: 'GOOGLE_ADS_CREATED_RESOURCE_NAME_REQUIRED',
                  };
                }
                const readback = await googleAds.provider.verifyPaused(resourceName);
                return {
                  verified: readback.verified,
                  evidence: [JSON.stringify(readback.evidence)],
                  externalResourceId: resourceName,
                  ...(!readback.verified
                    ? { reason: 'GOOGLE_ADS_CAMPAIGN_NOT_READ_BACK_AS_PAUSED' }
                    : {}),
                };
              },
              sideEffectValidated: false,
            },
          )
        : undefined;
    case 'google_ads.campaign.readback':
      return googleAds
        ? binding(
            googleAdsCampaignReferenceSchema,
            (input) => googleAds.provider.readbackCampaign(input.campaignIdOrName),
            { targetAccount: () => googleAds.targetAccount },
          )
        : undefined;
    case 'google_ads.campaign.activate':
      return googleAds
        ? binding(
            googleAdsActivateSchema,
            async (input) => {
              const currentBudgetMicros = await googleAds.provider.readActivationBudgetMicros(
                input.campaignId,
              );
              if (currentBudgetMicros !== input.expectedDailyBudgetMicros) {
                throw new Error('GOOGLE_ADS_ACTIVATION_BUDGET_DRIFT');
              }
              return googleAds.provider.updateStatus(input.campaignId, 'ENABLED');
            },
            {
              targetAccount: () => googleAds.targetAccount,
              idempotencyKey: (input) =>
                `google-ads:activate:${input.campaignId}:${input.expectedDailyBudgetMicros}`,
              financialContext: (input) => ({
                amountMinor: googleAds.provider.minorUnitsForMicros(
                  input.expectedDailyBudgetMicros,
                ),
                currency: googleAds.currency,
              }),
              providerReadback: async (_result, input) => {
                const readback = await googleAds.provider.readbackCampaign(input.campaignId);
                const state = googleAdsCampaignState(readback);
                const verified =
                  state.status === 'ENABLED' &&
                  state.budgetMicros === input.expectedDailyBudgetMicros &&
                  Boolean(state.resourceName);
                return {
                  verified,
                  evidence: [
                    JSON.stringify({
                      campaignId: input.campaignId,
                      status: state.status,
                      budgetMicros: state.budgetMicros,
                      resourceName: state.resourceName,
                    }),
                  ],
                  ...(state.resourceName ? { externalResourceId: state.resourceName } : {}),
                  ...(!verified ? { reason: 'GOOGLE_ADS_ACTIVATION_READBACK_MISMATCH' } : {}),
                };
              },
              sideEffectValidated: false,
            },
          )
        : undefined;
    case 'google_ads.campaign.pause':
      return googleAds
        ? binding(
            googleAdsCampaignIdSchema,
            (input) => googleAds.provider.updateStatus(input.campaignId, 'PAUSED'),
            {
              targetAccount: () => googleAds.targetAccount,
              idempotencyKey: (input) => `google-ads:pause:${input.campaignId}`,
              providerReadback: async (_result, input) => {
                const readback = await googleAds.provider.verifyPaused(input.campaignId);
                return {
                  verified: readback.verified,
                  evidence: [JSON.stringify(readback.evidence)],
                  externalResourceId: `customers/${googleAds.targetAccount}/campaigns/${input.campaignId}`,
                  ...(!readback.verified
                    ? { reason: 'GOOGLE_ADS_CAMPAIGN_NOT_READ_BACK_AS_PAUSED' }
                    : {}),
                };
              },
              sideEffectValidated: false,
            },
          )
        : undefined;
    case 'google_ads.campaign.update_budget':
      return googleAds
        ? binding(
            googleAdsBudgetUpdateSchema,
            (input) => googleAds.provider.updateBudget(input.campaignId, input.dailyBudgetMicros),
            {
              targetAccount: () => googleAds.targetAccount,
              idempotencyKey: (input) =>
                `google-ads:update-budget:${input.campaignId}:${input.dailyBudgetMicros}`,
              financialContext: (input) => ({
                amountMinor: googleAds.provider.minorUnitsForMicros(input.dailyBudgetMicros),
                currency: googleAds.currency,
              }),
              providerReadback: async (result, input) => {
                const amountMicros = await googleAds.provider.readBudgetMicros(input.campaignId);
                const budgetResource =
                  typeof result.budgetResource === 'string' ? result.budgetResource : undefined;
                const verified =
                  amountMicros === input.dailyBudgetMicros && budgetResource !== undefined;
                return {
                  verified,
                  evidence: [
                    JSON.stringify({
                      campaignId: input.campaignId,
                      amountMicros,
                      expectedAmountMicros: input.dailyBudgetMicros,
                      budgetResource,
                    }),
                  ],
                  ...(budgetResource ? { externalResourceId: budgetResource } : {}),
                  ...(!verified ? { reason: 'GOOGLE_ADS_BUDGET_READBACK_MISMATCH' } : {}),
                };
              },
              sideEffectValidated: false,
            },
          )
        : undefined;
    case 'instagram.media.list':
      return services.instagramHistory
        ? binding(mediaListSchema, (input) => services.instagramHistory!.listMedia(input))
        : undefined;
    case 'instagram.insights.media':
      return services.instagramHistory
        ? binding(mediaInsightsSchema, (input) =>
            services.instagramHistory!.getMediaInsights(input),
          )
        : undefined;
    case 'instagram.insights.account':
      return services.instagramHistory
        ? binding(accountInsightsSchema, (input) =>
            services.instagramHistory!.getAccountInsights(input),
          )
        : undefined;
    case 'meta_ads.accounts.list':
      return services.metaAdsRead
        ? binding(z.object({}), () => services.metaAdsRead!.listAccounts())
        : undefined;
    case 'meta_ads.campaigns.list':
      return services.metaAdsRead
        ? metaAccountRead(
            adAccountSchema,
            services.metaAdsRead.listCampaigns.bind(services.metaAdsRead),
          )
        : undefined;
    case 'meta_ads.adsets.list':
      return services.metaAdsRead
        ? metaAccountRead(
            adAccountSchema,
            services.metaAdsRead.listAdSets.bind(services.metaAdsRead),
          )
        : undefined;
    case 'meta_ads.ads.list':
      return services.metaAdsRead
        ? metaAccountRead(adAccountSchema, services.metaAdsRead.listAds.bind(services.metaAdsRead))
        : undefined;
    case 'meta_ads.insights.get':
      return services.metaAdsRead
        ? binding(
            insightsSchema,
            (input) =>
              services.metaAdsRead!.getInsights(
                { adAccountId: input.adAccountId, currency: input.currency },
                {
                  level: input.level,
                  fields: input.fields,
                  since: input.since,
                  until: input.until,
                },
              ),
            {
              targetAccount: (input) => input.adAccountId,
            },
          )
        : undefined;
    case 'meta_ads.audience.inspect':
      return services.metaAdsDemand
        ? binding(
            morroAudienceSchema,
            (input) =>
              services.metaAdsDemand!.inspectMorroAudience({
                account: { adAccountId: input.adAccountId, currency: input.currency },
                optimizationGoal: input.optimizationGoal,
                ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
              }),
            { targetAccount: (input) => input.adAccountId },
          )
        : undefined;
    case 'meta_ads.opportunity.detect':
      return services.metaAdsDemand
        ? binding(
            morroDemandSchema,
            (input) =>
              services.metaAdsDemand!.evaluateMorroDemand({
                account: { adAccountId: input.adAccountId, currency: input.currency },
                optimizationGoal: input.optimizationGoal,
                ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
                ...(input.performanceScore !== undefined
                  ? { performanceScore: input.performanceScore }
                  : {}),
                ...(input.calendarEventScore !== undefined
                  ? { calendarEventScore: input.calendarEventScore }
                  : {}),
                ...(input.seasonalityScore !== undefined
                  ? { seasonalityScore: input.seasonalityScore }
                  : {}),
                ...(input.capacityScore !== undefined
                  ? { capacityScore: input.capacityScore }
                  : {}),
              }),
            { targetAccount: (input) => input.adAccountId },
          )
        : undefined;
    case 'meta_ads.budget.recommend':
      return services.metaAdsDemand
        ? binding(
            morroBudgetSchema,
            (input) =>
              services.metaAdsDemand!.recommendMorroBudget({
                account: { adAccountId: input.adAccountId, currency: input.currency },
                optimizationGoal: input.optimizationGoal,
                currentBudgetMinor: input.currentBudgetMinor,
                ...(input.observedAt !== undefined ? { observedAt: input.observedAt } : {}),
                ...(input.performanceScore !== undefined
                  ? { performanceScore: input.performanceScore }
                  : {}),
                ...(input.calendarEventScore !== undefined
                  ? { calendarEventScore: input.calendarEventScore }
                  : {}),
                ...(input.seasonalityScore !== undefined
                  ? { seasonalityScore: input.seasonalityScore }
                  : {}),
                ...(input.capacityScore !== undefined
                  ? { capacityScore: input.capacityScore }
                  : {}),
              }),
            { targetAccount: (input) => input.adAccountId },
          )
        : undefined;
    case 'meta_ads.campaign.prepare_paused':
      return services.metaAdsWrite
        ? binding(
            planSchema,
            (input) =>
              Promise.resolve(services.metaAdsWrite!.prepare(toControlledCreatePausedPlan(input))),
            {
              targetAccount: (input) => input.account.adAccountId,
            },
          )
        : undefined;
    case 'meta_ads.campaign.create_paused':
      return services.metaAdsWrite && services.metaAdsWriteProvider
        ? binding(
            planSchema,
            (input) => {
              const plan = toControlledCreatePausedPlan(input);
              return services.metaAdsWrite!.createPaused(plan, requestSha256(plan));
            },
            {
              targetAccount: (input) => input.account.adAccountId,
              idempotencyKey: (input) =>
                `meta-ads:create-paused:${requestSha256(toControlledCreatePausedPlan(input))}`,
              financialContext: (input) => ({
                amountMinor: input.adSet.dailyBudgetMinor,
                currency: input.account.currency.toUpperCase(),
              }),
              providerReadback: async (result, input) => {
                const campaigns = await services.metaAdsWriteProvider!.listCampaigns(input.account);
                const campaign = campaigns.find((candidate) => candidate.id === result.campaignId);
                const status = typeof campaign?.status === 'string' ? campaign.status : undefined;
                const effectiveStatus =
                  typeof campaign?.effective_status === 'string'
                    ? campaign.effective_status
                    : undefined;
                const verified =
                  Boolean(campaign) && (status === 'PAUSED' || effectiveStatus === 'PAUSED');
                return {
                  verified,
                  evidence: verified
                    ? [`meta:campaign:${result.campaignId}:paused`]
                    : [`meta:campaign:${result.campaignId}:readback-mismatch`],
                  externalResourceId: result.campaignId,
                  ...(!verified ? { reason: 'META_ADS_CAMPAIGN_NOT_READ_BACK_AS_PAUSED' } : {}),
                };
              },
              sideEffectValidated: false,
            },
          )
        : undefined;
    case 'instagram.toca_schedule.prepare':
      return binding(tocaManagedInstagramApprovalDescriptorSchema, (input) =>
        Promise.resolve({
          descriptorSha256: hashTocaManagedInstagramApprovalDescriptor(input),
        }),
      );
    case 'instagram.toca_schedule.create':
      return services.instagramScheduler
        ? binding(
            tocaManagedInstagramSchedulePayloadSchema,
            (input) => services.instagramScheduler!.schedule(input),
            {
              idempotencyKey: scheduleIdempotencyKey,
              providerReadback: (result) =>
                scheduleReadback(services.instagramScheduler!, result.id),
              sideEffectValidated: true,
            },
          )
        : undefined;
    case 'instagram.toca_schedule.reschedule':
      return services.instagramScheduler
        ? binding(
            rescheduleSchema,
            (input) => executeIdempotentReschedule(services.instagramScheduler!, input),
            {
              idempotencyKey: (input) =>
                `instagram:reschedule:${input.jobId}:${scheduleIdempotencyKey(input.replacement)}`,
              providerReadback: (result) =>
                scheduleReadback(services.instagramScheduler!, result.id),
              sideEffectValidated: true,
            },
          )
        : undefined;
    case 'instagram.toca_schedule.cancel':
      return services.instagramScheduler
        ? binding(jobIdSchema, (input) => services.instagramScheduler!.cancel(input.jobId), {
            idempotencyKey: (input) => `instagram:cancel:${input.jobId}`,
            providerReadback: async (_result, input) => {
              const job = await services.instagramScheduler!.status(input.jobId);
              const verified = job?.status === 'CANCELED';
              return {
                verified,
                evidence: [
                  verified
                    ? `scheduler:job:${input.jobId}:canceled`
                    : `scheduler:job:${input.jobId}:cancel-readback-mismatch`,
                ],
                externalResourceId: input.jobId,
                ...(!verified ? { reason: 'SCHEDULER_CANCEL_NOT_READ_BACK' } : {}),
              };
            },
            sideEffectValidated: true,
          })
        : undefined;
    case 'instagram.toca_schedule.status':
      return services.instagramScheduler
        ? binding(jobIdSchema, async (input) => ({
            job: await services.instagramScheduler!.status(input.jobId),
          }))
        : undefined;
    case 'instagram.toca_schedule.list':
      return services.instagramScheduler
        ? binding(z.object({}), async () => ({ jobs: await services.instagramScheduler!.list() }))
        : undefined;
    default:
      return undefined;
  }
}

function binding<T, TResult>(
  schema: z.ZodType<T>,
  execute: (input: T) => Promise<TResult>,
  options: {
    readonly targetAccount?: (input: T) => string | undefined;
    readonly idempotencyKey?: (input: T) => string | undefined;
    readonly financialContext?: (
      input: T,
    ) => { readonly amountMinor: number; readonly currency: string } | undefined;
    readonly providerReadback?: (
      result: TResult,
      input: T,
    ) => Promise<{
      readonly verified: boolean;
      readonly evidence: readonly string[];
      readonly reason?: string;
      readonly externalResourceId?: string;
    }>;
    readonly sideEffectValidated?: boolean;
  } = {},
): CoreCapabilityRuntimeBinding {
  return {
    inputSchema: schema,
    execute: (input) => execute(input as T),
    ...(options.targetAccount
      ? { targetAccount: (input: unknown) => options.targetAccount!(input as T) }
      : {}),
    ...(options.idempotencyKey
      ? { idempotencyKey: (input: unknown) => options.idempotencyKey!(input as T) }
      : {}),
    ...(options.financialContext
      ? { financialContext: (input: unknown) => options.financialContext!(input as T) }
      : {}),
    ...(options.providerReadback
      ? {
          providerReadback: (result: unknown, input: unknown) =>
            options.providerReadback!(result as TResult, input as T),
        }
      : {}),
    ...(options.sideEffectValidated !== undefined
      ? { sideEffectValidated: options.sideEffectValidated }
      : {}),
  };
}

function googleAdsRuntimeContext(
  services: RuntimeCapabilityServices,
): GoogleAdsRuntimeContext | undefined {
  const targetAccount = services.googleAdsTargetAccount?.trim();
  const currency = services.googleAdsCurrency?.trim().toUpperCase();
  if (!services.googleAds || !targetAccount || !currency) return undefined;
  return { provider: services.googleAds, targetAccount, currency };
}

function googleAdsCampaignState(readback: Record<string, unknown>): {
  readonly status?: string;
  readonly resourceName?: string;
  readonly budgetMicros?: number;
} {
  const rows = Array.isArray(readback.results)
    ? readback.results.filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
  const row = rows[0];
  const campaign = row?.campaign as Record<string, unknown> | undefined;
  const budget = row?.campaignBudget as Record<string, unknown> | undefined;
  const rawBudgetMicros = budget?.amountMicros;
  const parsedBudgetMicros = Number(rawBudgetMicros);
  return {
    ...(typeof campaign?.status === 'string' ? { status: campaign.status } : {}),
    ...(typeof campaign?.resourceName === 'string' ? { resourceName: campaign.resourceName } : {}),
    ...(Number.isSafeInteger(parsedBudgetMicros) && parsedBudgetMicros > 0
      ? { budgetMicros: parsedBudgetMicros }
      : {}),
  };
}

function metaAccountRead<T extends z.infer<typeof adAccountSchema>, TResult>(
  schema: z.ZodType<T>,
  execute: (input: T) => Promise<TResult>,
): CoreCapabilityRuntimeBinding {
  return binding(schema, execute, { targetAccount: (input) => input.adAccountId });
}

function scheduleIdempotencyKey(input: TocaManagedInstagramSchedulePayload): string {
  return `internal:instagram:toca-managed:${input.contentItemId}:${hashTocaManagedInstagramApprovalDescriptor(input)}`;
}

async function executeIdempotentReschedule(
  scheduler: TocaManagedInstagramScheduler,
  input: z.infer<typeof rescheduleSchema>,
) {
  const replacementKey = scheduleIdempotencyKey(input.replacement);
  const recoverReplacement = async () =>
    (await scheduler.list()).find((job) => job.idempotencyKey === replacementKey);

  const source = await scheduler.status(input.jobId);
  if (source?.status === 'CANCELED') {
    const recovered = await recoverReplacement();
    if (recovered) return recovered;
  }

  try {
    return await scheduler.reschedule(input.jobId, input.replacement);
  } catch (error) {
    const sourceAfterFailure = await scheduler.status(input.jobId);
    if (sourceAfterFailure?.status === 'CANCELED') {
      const recovered = await recoverReplacement();
      if (recovered) return recovered;
    }
    throw error;
  }
}

async function scheduleReadback(scheduler: TocaManagedInstagramScheduler, jobId: string) {
  const job = await scheduler.status(jobId);
  const verified = job?.status === 'SCHEDULED';
  return {
    verified,
    evidence: [
      verified ? `scheduler:job:${jobId}:scheduled` : `scheduler:job:${jobId}:readback-mismatch`,
    ],
    externalResourceId: jobId,
    ...(!verified ? { reason: 'SCHEDULER_JOB_NOT_READ_BACK_AS_SCHEDULED' } : {}),
  };
}
