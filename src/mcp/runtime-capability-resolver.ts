import * as z from 'zod/v4';
import type { InstagramHistoryProvider } from '../providers/instagram/instagram-history-provider.js';
import type { MetaAdsControlledGraphProvider } from '../providers/meta-ads/meta-ads-controlled-graph-provider.js';
import {
  requestSha256,
  type MetaAdsControlledWriteService,
} from '../providers/meta-ads/meta-ads-controlled-write.js';
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

const recordSchema = z.record(z.string(), z.unknown());
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
const rescheduleSchema = z.object({
  jobId: z.string().min(1),
  replacement: tocaManagedInstagramSchedulePayloadSchema,
});
const jobIdSchema = z.object({ jobId: z.string().min(1) });

export interface RuntimeCapabilityServices {
  readonly instagramHistory?: InstagramHistoryProvider;
  readonly metaAdsRead?: MetaAdsReadProvider;
  readonly metaAdsWrite?: MetaAdsControlledWriteService;
  readonly metaAdsWriteProvider?: MetaAdsControlledGraphProvider;
  readonly instagramScheduler?: TocaManagedInstagramScheduler;
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
  switch (capabilityId) {
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
    case 'meta_ads.campaign.prepare_paused':
      return services.metaAdsWrite
        ? binding(planSchema, (input) => Promise.resolve(services.metaAdsWrite!.prepare(input)), {
            targetAccount: (input) => input.account.adAccountId,
          })
        : undefined;
    case 'meta_ads.campaign.create_paused':
      return services.metaAdsWrite && services.metaAdsWriteProvider
        ? binding(
            planSchema,
            (input) => services.metaAdsWrite!.createPaused(input, requestSha256(input)),
            {
              targetAccount: (input) => input.account.adAccountId,
              idempotencyKey: (input) => `meta-ads:create-paused:${requestSha256(input)}`,
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
            },
          )
        : undefined;
    case 'instagram.toca_schedule.reschedule':
      return services.instagramScheduler
        ? binding(
            rescheduleSchema,
            (input) => services.instagramScheduler!.reschedule(input.jobId, input.replacement),
            {
              idempotencyKey: (input) =>
                `instagram:reschedule:${input.jobId}:${scheduleIdempotencyKey(input.replacement)}`,
              providerReadback: (result) =>
                scheduleReadback(services.instagramScheduler!, result.id),
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
