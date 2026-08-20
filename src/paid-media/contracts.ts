export type PaidMediaProvider = 'META_ADS' | 'GOOGLE_ADS';

export type PaidMediaDecisionAction =
  'NO_CHANGE' | 'ROTATE_CREATIVE' | 'PAUSE_RECOMMENDED' | 'SCALE_RECOMMENDED';

export type PaidMediaConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PaidMediaEvidenceInput {
  readonly providerBacked: boolean;
  readonly evidence: readonly string[];
}

export interface DemandInput extends PaidMediaEvidenceInput {
  readonly demandScore: number;
  readonly trend?: 'DECLINING' | 'STABLE' | 'RISING' | undefined;
}

export interface RevenueAttributionInput extends PaidMediaEvidenceInput {
  readonly attributedRevenueMinor?: number | undefined;
  readonly attributedConversions?: number | undefined;
  readonly attributedLeads?: number | undefined;
}

export interface CapacityInput extends PaidMediaEvidenceInput {
  readonly capacity?: number | undefined;
  readonly sold?: number | undefined;
  readonly available?: number | undefined;
  readonly minimumHeadroomRatio?: number | undefined;
}

export interface PaidMediaPerformanceSnapshot {
  readonly window: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly spendMinor: number;
  readonly reach?: number | undefined;
  readonly leads?: number | undefined;
  readonly conversions?: number | undefined;
  readonly revenueMinor?: number | undefined;
  readonly frequency?: number | undefined;
}

export interface PaidMediaPerformanceTargets {
  readonly maxCpaMinor?: number | undefined;
  readonly maxCplMinor?: number | undefined;
  readonly minRoas?: number | undefined;
  readonly maxFrequency?: number | undefined;
  readonly maxCtrDropRatio?: number | undefined;
  readonly maxCpaIncreaseRatio?: number | undefined;
  readonly minimumImpressions?: number | undefined;
  readonly scaleStepPercent?: number | undefined;
}

export interface PaidMediaMetricSet {
  readonly ctr: number | null;
  readonly cpaMinor: number | null;
  readonly cplMinor: number | null;
  readonly roas: number | null;
  readonly frequency: number | null;
}

export interface PaidMediaAnomaly {
  readonly metric: 'CTR' | 'CPA' | 'CPL' | 'ROAS' | 'FREQUENCY';
  readonly severity: 'WARNING' | 'CRITICAL';
  readonly observed: number;
  readonly baseline: number;
  readonly deltaRatio: number;
  readonly evidence: readonly string[];
}

export interface PaidMediaFatigueAssessment {
  readonly fatigued: boolean;
  readonly comparableEvidence: boolean;
  readonly reasons: readonly string[];
}

export interface CapacityGuardAssessment {
  readonly canScale: boolean;
  readonly headroomRatio: number | null;
  readonly blockers: readonly string[];
}

export interface PaidMediaPerformanceAssessment {
  readonly metrics: PaidMediaMetricSet;
  readonly baselineMetrics: PaidMediaMetricSet | null;
  readonly anomalies: readonly PaidMediaAnomaly[];
  readonly fatigue: PaidMediaFatigueAssessment;
  readonly capacityGuard: CapacityGuardAssessment;
  readonly recommendation: PaidMediaDecisionAction;
  readonly confidence: PaidMediaConfidence;
  readonly reasons: readonly string[];
  readonly evidence: readonly string[];
}

export interface ExperimentPlanningInput {
  readonly experimentId: string;
  readonly hypothesisId: string;
  readonly hypothesis: string;
  readonly primaryMetric: 'CPA' | 'CPL' | 'ROAS' | 'CTR';
  readonly controlId: string;
  readonly variantIds: readonly string[];
  readonly totalBudgetMinor: number;
  readonly minimumBudgetPerArmMinor: number;
  readonly immutableDimension: 'CREATIVE' | 'AUDIENCE' | 'PLACEMENT' | 'BIDDING' | 'LANDING_PAGE';
}

export interface ExperimentPlanArm {
  readonly armId: string;
  readonly role: 'CONTROL' | 'VARIANT';
  readonly allocationMinor: number;
}

export interface ExperimentPlan {
  readonly experimentId: string;
  readonly hypothesisId: string;
  readonly hypothesis: string;
  readonly primaryMetric: ExperimentPlanningInput['primaryMetric'];
  readonly immutableDimension: ExperimentPlanningInput['immutableDimension'];
  readonly arms: readonly ExperimentPlanArm[];
  readonly sideEffects: false;
  readonly approvalRequiredForActivation: true;
}

export interface NamingInput {
  readonly provider: PaidMediaProvider;
  readonly brand: string;
  readonly objective: string;
  readonly audience: string;
  readonly geo: string;
  readonly dateKey: string;
  readonly experimentId?: string | undefined;
  readonly variant?: string | undefined;
}

export interface BudgetAllocationCandidate {
  readonly id: string;
  readonly weight: number;
  readonly demand?: DemandInput | undefined;
  readonly capacity?: CapacityInput | undefined;
}

export interface BudgetAllocationInput {
  readonly totalBudgetMinor: number;
  readonly minimumAllocationMinor: number;
  readonly candidates: readonly BudgetAllocationCandidate[];
}

export interface BudgetAllocation {
  readonly id: string;
  readonly allocationMinor: number;
  readonly effectiveWeight: number;
  readonly blockers: readonly string[];
}

export interface AudiencePlanningInput {
  readonly audienceId: string;
  readonly geoKeys: readonly string[];
  readonly interests?: readonly string[] | undefined;
  readonly exclusions?: readonly string[] | undefined;
  readonly demand?: DemandInput | undefined;
  readonly evidence: readonly string[];
}

export interface AudiencePlan {
  readonly audienceId: string;
  readonly geoKeys: readonly string[];
  readonly interests: readonly string[];
  readonly exclusions: readonly string[];
  readonly provenance: readonly string[];
  readonly providerBackedDemand: boolean;
}

export interface CreativeRotationCandidate {
  readonly creativeId: string;
  readonly fatigue: PaidMediaFatigueAssessment;
  readonly hypothesisId?: string | undefined;
}

export interface CreativeRotationPlan {
  readonly keep: readonly string[];
  readonly rotate: readonly { readonly creativeId: string; readonly hypothesisId: string }[];
  readonly blocked: readonly string[];
}

export interface GoogleAdsAutopilotReadinessInput {
  readonly accountVerified: boolean;
  readonly crmProviderBacked: boolean;
  readonly attributionProviderBacked: boolean;
  readonly demandProviderBacked?: boolean | undefined;
  readonly evidence: readonly string[];
}

export interface GoogleAdsAutopilotReadiness {
  readonly eligible: boolean;
  readonly blockers: readonly string[];
  readonly evidence: readonly string[];
}
