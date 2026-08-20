import * as z from 'zod/v4';
import type {
  AudiencePlanningInput,
  BudgetAllocationInput,
  CapacityInput,
  CreativeRotationCandidate,
  DemandInput,
  GoogleAdsAutopilotReadinessInput,
  NamingInput,
  PaidMediaPerformanceSnapshot,
  PaidMediaPerformanceTargets,
  RevenueAttributionInput,
} from '../paid-media/contracts.js';
import {
  allocateBudget,
  assessPaidMediaPerformance,
  buildPaidMediaName,
  googleAdsAutopilotReadiness,
  planAudience,
  planCreativeRotation,
  planExperiment,
} from '../paid-media/decision-engine.js';
import type { GoogleAdsAccountVerifier } from '../providers/google-ads/google-ads-account-verifier.js';
import type { CoreCapabilityRuntimeBinding } from './core-execution.js';

const evidenceSchema = z.object({
  providerBacked: z.boolean(),
  evidence: z.array(z.string().min(1)),
});

const demandSchema = evidenceSchema.extend({
  demandScore: z.number().min(0).max(1),
  trend: z.enum(['DECLINING', 'STABLE', 'RISING']).optional(),
});

const attributionSchema = evidenceSchema.extend({
  attributedRevenueMinor: z.number().int().nonnegative().optional(),
  attributedConversions: z.number().int().nonnegative().optional(),
  attributedLeads: z.number().int().nonnegative().optional(),
});

const capacitySchema = evidenceSchema.extend({
  capacity: z.number().int().nonnegative().optional(),
  sold: z.number().int().nonnegative().optional(),
  available: z.number().int().nonnegative().optional(),
  minimumHeadroomRatio: z.number().min(0).max(1).optional(),
});

const snapshotSchema = z.object({
  window: z.string().min(1),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  spendMinor: z.number().int().nonnegative(),
  reach: z.number().int().positive().optional(),
  leads: z.number().int().nonnegative().optional(),
  conversions: z.number().int().nonnegative().optional(),
  revenueMinor: z.number().int().nonnegative().optional(),
  frequency: z.number().nonnegative().optional(),
});

const targetSchema = z.object({
  maxCpaMinor: z.number().positive().optional(),
  maxCplMinor: z.number().positive().optional(),
  minRoas: z.number().nonnegative().optional(),
  maxFrequency: z.number().positive().optional(),
  maxCtrDropRatio: z.number().min(0).max(1).optional(),
  maxCpaIncreaseRatio: z.number().min(0).optional(),
  minimumImpressions: z.number().int().positive().optional(),
  scaleStepPercent: z.number().positive().max(100).optional(),
});

const performanceSchema = z.object({
  current: snapshotSchema,
  baseline: snapshotSchema.optional(),
  targets: targetSchema,
  demand: demandSchema.optional(),
  attribution: attributionSchema.optional(),
  capacity: capacitySchema.optional(),
});

const experimentSchema = z.object({
  experimentId: z.string().min(1),
  hypothesisId: z.string().min(1),
  hypothesis: z.string().min(1),
  primaryMetric: z.enum(['CPA', 'CPL', 'ROAS', 'CTR']),
  controlId: z.string().min(1),
  variantIds: z.array(z.string().min(1)).min(1),
  totalBudgetMinor: z.number().int().positive(),
  minimumBudgetPerArmMinor: z.number().int().nonnegative(),
  immutableDimension: z.enum(['CREATIVE', 'AUDIENCE', 'PLACEMENT', 'BIDDING', 'LANDING_PAGE']),
});

const namingSchema = z.object({
  provider: z.enum(['META_ADS', 'GOOGLE_ADS']),
  brand: z.string().min(1),
  objective: z.string().min(1),
  audience: z.string().min(1),
  geo: z.string().min(1),
  dateKey: z.string().min(1),
  experimentId: z.string().min(1).optional(),
  variant: z.string().min(1).optional(),
});

const budgetSchema = z.object({
  totalBudgetMinor: z.number().int().positive(),
  minimumAllocationMinor: z.number().int().nonnegative(),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1),
        weight: z.number().nonnegative(),
        demand: demandSchema.optional(),
        capacity: capacitySchema.optional(),
      }),
    )
    .min(1),
});

const audienceSchema = z.object({
  audienceId: z.string().min(1),
  geoKeys: z.array(z.string().min(1)).min(1),
  interests: z.array(z.string().min(1)).optional(),
  exclusions: z.array(z.string().min(1)).optional(),
  demand: demandSchema.optional(),
  evidence: z.array(z.string().min(1)),
});

const creativeRotationSchema = z.object({
  candidates: z.array(
    z.object({
      creativeId: z.string().min(1),
      fatigue: z.object({
        fatigued: z.boolean(),
        comparableEvidence: z.boolean(),
        reasons: z.array(z.string().min(1)),
      }),
      hypothesisId: z.string().min(1).optional(),
    }),
  ),
});

const autopilotReadinessSchema = z.object({
  accountVerified: z.boolean(),
  crmProviderBacked: z.boolean(),
  attributionProviderBacked: z.boolean(),
  demandProviderBacked: z.boolean().optional(),
  evidence: z.array(z.string().min(1)),
});

export interface PaidMediaRuntimeServices {
  readonly googleAdsAccountVerifier?: GoogleAdsAccountVerifier;
  readonly googleAdsTargetAccount?: string;
}

function readBinding<TSchema extends z.ZodType>(
  schema: TSchema,
  execute: (input: z.infer<TSchema>) => unknown,
  targetAccount?: string,
): CoreCapabilityRuntimeBinding {
  return {
    inputSchema: schema,
    execute: (input) => Promise.resolve(execute(schema.parse(input))),
    ...(targetAccount ? { targetAccount: () => targetAccount } : {}),
  };
}

function toDemandInput(input: z.infer<typeof demandSchema>): DemandInput {
  return {
    providerBacked: input.providerBacked,
    evidence: input.evidence,
    demandScore: input.demandScore,
    ...(input.trend !== undefined ? { trend: input.trend } : {}),
  };
}

function toAttributionInput(input: z.infer<typeof attributionSchema>): RevenueAttributionInput {
  return {
    providerBacked: input.providerBacked,
    evidence: input.evidence,
    ...(input.attributedRevenueMinor !== undefined
      ? { attributedRevenueMinor: input.attributedRevenueMinor }
      : {}),
    ...(input.attributedConversions !== undefined
      ? { attributedConversions: input.attributedConversions }
      : {}),
    ...(input.attributedLeads !== undefined ? { attributedLeads: input.attributedLeads } : {}),
  };
}

function toCapacityInput(input: z.infer<typeof capacitySchema>): CapacityInput {
  return {
    providerBacked: input.providerBacked,
    evidence: input.evidence,
    ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
    ...(input.sold !== undefined ? { sold: input.sold } : {}),
    ...(input.available !== undefined ? { available: input.available } : {}),
    ...(input.minimumHeadroomRatio !== undefined
      ? { minimumHeadroomRatio: input.minimumHeadroomRatio }
      : {}),
  };
}

function toSnapshot(input: z.infer<typeof snapshotSchema>): PaidMediaPerformanceSnapshot {
  return {
    window: input.window,
    impressions: input.impressions,
    clicks: input.clicks,
    spendMinor: input.spendMinor,
    ...(input.reach !== undefined ? { reach: input.reach } : {}),
    ...(input.leads !== undefined ? { leads: input.leads } : {}),
    ...(input.conversions !== undefined ? { conversions: input.conversions } : {}),
    ...(input.revenueMinor !== undefined ? { revenueMinor: input.revenueMinor } : {}),
    ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
  };
}

function toTargets(input: z.infer<typeof targetSchema>): PaidMediaPerformanceTargets {
  return {
    ...(input.maxCpaMinor !== undefined ? { maxCpaMinor: input.maxCpaMinor } : {}),
    ...(input.maxCplMinor !== undefined ? { maxCplMinor: input.maxCplMinor } : {}),
    ...(input.minRoas !== undefined ? { minRoas: input.minRoas } : {}),
    ...(input.maxFrequency !== undefined ? { maxFrequency: input.maxFrequency } : {}),
    ...(input.maxCtrDropRatio !== undefined ? { maxCtrDropRatio: input.maxCtrDropRatio } : {}),
    ...(input.maxCpaIncreaseRatio !== undefined
      ? { maxCpaIncreaseRatio: input.maxCpaIncreaseRatio }
      : {}),
    ...(input.minimumImpressions !== undefined
      ? { minimumImpressions: input.minimumImpressions }
      : {}),
    ...(input.scaleStepPercent !== undefined ? { scaleStepPercent: input.scaleStepPercent } : {}),
  };
}

function toNamingInput(input: z.infer<typeof namingSchema>): NamingInput {
  return {
    provider: input.provider,
    brand: input.brand,
    objective: input.objective,
    audience: input.audience,
    geo: input.geo,
    dateKey: input.dateKey,
    ...(input.experimentId !== undefined ? { experimentId: input.experimentId } : {}),
    ...(input.variant !== undefined ? { variant: input.variant } : {}),
  };
}

function toBudgetInput(input: z.infer<typeof budgetSchema>): BudgetAllocationInput {
  return {
    totalBudgetMinor: input.totalBudgetMinor,
    minimumAllocationMinor: input.minimumAllocationMinor,
    candidates: input.candidates.map((candidate) => ({
      id: candidate.id,
      weight: candidate.weight,
      ...(candidate.demand !== undefined ? { demand: toDemandInput(candidate.demand) } : {}),
      ...(candidate.capacity !== undefined
        ? { capacity: toCapacityInput(candidate.capacity) }
        : {}),
    })),
  };
}

function toAudienceInput(input: z.infer<typeof audienceSchema>): AudiencePlanningInput {
  return {
    audienceId: input.audienceId,
    geoKeys: input.geoKeys,
    evidence: input.evidence,
    ...(input.interests !== undefined ? { interests: input.interests } : {}),
    ...(input.exclusions !== undefined ? { exclusions: input.exclusions } : {}),
    ...(input.demand !== undefined ? { demand: toDemandInput(input.demand) } : {}),
  };
}

function toCreativeCandidates(
  input: z.infer<typeof creativeRotationSchema>,
): readonly CreativeRotationCandidate[] {
  return input.candidates.map((candidate) => ({
    creativeId: candidate.creativeId,
    fatigue: {
      fatigued: candidate.fatigue.fatigued,
      comparableEvidence: candidate.fatigue.comparableEvidence,
      reasons: candidate.fatigue.reasons,
    },
    ...(candidate.hypothesisId !== undefined ? { hypothesisId: candidate.hypothesisId } : {}),
  }));
}

type PerformanceInput = Parameters<typeof assessPaidMediaPerformance>[0];

function toPerformanceInput(input: z.infer<typeof performanceSchema>): PerformanceInput {
  return {
    current: toSnapshot(input.current),
    targets: toTargets(input.targets),
    ...(input.baseline !== undefined ? { baseline: toSnapshot(input.baseline) } : {}),
    ...(input.demand !== undefined ? { demand: toDemandInput(input.demand) } : {}),
    ...(input.attribution !== undefined
      ? { attribution: toAttributionInput(input.attribution) }
      : {}),
    ...(input.capacity !== undefined ? { capacity: toCapacityInput(input.capacity) } : {}),
  };
}

function toAutopilotInput(
  input: z.infer<typeof autopilotReadinessSchema>,
): GoogleAdsAutopilotReadinessInput {
  return {
    accountVerified: input.accountVerified,
    crmProviderBacked: input.crmProviderBacked,
    attributionProviderBacked: input.attributionProviderBacked,
    evidence: input.evidence,
    ...(input.demandProviderBacked !== undefined
      ? { demandProviderBacked: input.demandProviderBacked }
      : {}),
  };
}

export function resolvePaidMediaRuntimeBinding(
  capabilityId: string,
  services: PaidMediaRuntimeServices = {},
): CoreCapabilityRuntimeBinding | undefined {
  const googleAdsAccountVerifier = services.googleAdsAccountVerifier;
  switch (capabilityId) {
    case 'paid_media.experiment.plan':
      return readBinding(experimentSchema, planExperiment);
    case 'paid_media.naming.build':
      return readBinding(namingSchema, (input) => buildPaidMediaName(toNamingInput(input)));
    case 'paid_media.budget.allocate':
      return readBinding(budgetSchema, (input) => allocateBudget(toBudgetInput(input)));
    case 'paid_media.audience.plan':
      return readBinding(audienceSchema, (input) => planAudience(toAudienceInput(input)));
    case 'paid_media.creative_rotation.plan':
      return readBinding(creativeRotationSchema, (input) =>
        planCreativeRotation(toCreativeCandidates(input)),
      );
    case 'paid_media.performance.assess':
      return readBinding(performanceSchema, (input) =>
        assessPaidMediaPerformance(toPerformanceInput(input)),
      );
    case 'paid_media.google_ads.autopilot_readiness':
      return readBinding(autopilotReadinessSchema, (input) =>
        googleAdsAutopilotReadiness(toAutopilotInput(input)),
      );
    case 'google_ads.customers.discover':
      return googleAdsAccountVerifier
        ? readBinding(
            z.object({}),
            () => googleAdsAccountVerifier.discoverCustomers(),
            services.googleAdsTargetAccount,
          )
        : undefined;
    case 'google_ads.account.verify':
      return googleAdsAccountVerifier
        ? readBinding(
            z.object({}),
            () => googleAdsAccountVerifier.verifyAccount(),
            services.googleAdsTargetAccount,
          )
        : undefined;
    default:
      return undefined;
  }
}
