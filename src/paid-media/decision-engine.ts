import type {
  AudiencePlan,
  AudiencePlanningInput,
  BudgetAllocation,
  BudgetAllocationInput,
  CapacityGuardAssessment,
  CapacityInput,
  CreativeRotationCandidate,
  CreativeRotationPlan,
  ExperimentPlan,
  ExperimentPlanningInput,
  GoogleAdsAutopilotReadiness,
  GoogleAdsAutopilotReadinessInput,
  NamingInput,
  PaidMediaAnomaly,
  PaidMediaConfidence,
  PaidMediaMetricSet,
  PaidMediaPerformanceAssessment,
  PaidMediaPerformanceSnapshot,
  PaidMediaPerformanceTargets,
  RevenueAttributionInput,
  DemandInput,
} from './contracts.js';

function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator === undefined || denominator === undefined || denominator <= 0) return null;
  return numerator / denominator;
}

function costPer(spendMinor: number, outcomes: number | undefined): number | null {
  return outcomes === undefined || outcomes <= 0 ? null : spendMinor / outcomes;
}

export function paidMediaMetrics(snapshot: PaidMediaPerformanceSnapshot): PaidMediaMetricSet {
  return {
    ctr: ratio(snapshot.clicks, snapshot.impressions),
    cpaMinor: costPer(snapshot.spendMinor, snapshot.conversions),
    cplMinor: costPer(snapshot.spendMinor, snapshot.leads),
    roas: ratio(snapshot.revenueMinor, snapshot.spendMinor),
    frequency:
      snapshot.frequency ??
      (snapshot.reach !== undefined ? ratio(snapshot.impressions, snapshot.reach) : null),
  };
}

function deltaRatio(observed: number, baseline: number): number {
  if (baseline === 0) return observed === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (observed - baseline) / Math.abs(baseline);
}

function anomaly(
  metric: PaidMediaAnomaly['metric'],
  observed: number | null,
  baseline: number | null,
  warningRatio: number,
  criticalRatio: number,
  direction: 'HIGH_IS_BAD' | 'LOW_IS_BAD',
): PaidMediaAnomaly | null {
  if (observed === null || baseline === null) return null;
  const rawDelta = deltaRatio(observed, baseline);
  const badDelta = direction === 'HIGH_IS_BAD' ? rawDelta : -rawDelta;
  if (badDelta < warningRatio) return null;
  return {
    metric,
    severity: badDelta >= criticalRatio ? 'CRITICAL' : 'WARNING',
    observed,
    baseline,
    deltaRatio: rawDelta,
    evidence: [`${metric}:observed=${observed}`, `${metric}:baseline=${baseline}`],
  };
}

export function assessCapacityGuard(capacity: CapacityInput | undefined): CapacityGuardAssessment {
  if (!capacity) {
    return {
      canScale: false,
      headroomRatio: null,
      blockers: ['CAPACITY_INPUT_REQUIRED_FOR_SCALE'],
    };
  }
  if (!capacity.providerBacked) {
    return { canScale: false, headroomRatio: null, blockers: ['CAPACITY_NOT_PROVIDER_BACKED'] };
  }

  const minimumHeadroom = capacity.minimumHeadroomRatio ?? 0.1;
  const derivedAvailable =
    capacity.available ??
    (capacity.capacity !== undefined && capacity.sold !== undefined
      ? Math.max(0, capacity.capacity - capacity.sold)
      : undefined);
  const headroom =
    capacity.capacity !== undefined && capacity.capacity > 0 && derivedAvailable !== undefined
      ? derivedAvailable / capacity.capacity
      : null;
  const blockers: string[] = [];
  if (derivedAvailable !== undefined && derivedAvailable <= 0) blockers.push('CAPACITY_EXHAUSTED');
  if (headroom === null) blockers.push('CAPACITY_HEADROOM_UNRESOLVED');
  else if (headroom < minimumHeadroom) blockers.push('CAPACITY_HEADROOM_BELOW_GUARD');
  return { canScale: blockers.length === 0, headroomRatio: headroom, blockers };
}

function targetReasons(
  metrics: PaidMediaMetricSet,
  targets: PaidMediaPerformanceTargets,
): string[] {
  const reasons: string[] = [];
  if (targets.maxCpaMinor !== undefined && metrics.cpaMinor !== null) {
    reasons.push(
      metrics.cpaMinor <= targets.maxCpaMinor ? 'CPA_WITHIN_TARGET' : 'CPA_ABOVE_TARGET',
    );
  }
  if (targets.maxCplMinor !== undefined && metrics.cplMinor !== null) {
    reasons.push(
      metrics.cplMinor <= targets.maxCplMinor ? 'CPL_WITHIN_TARGET' : 'CPL_ABOVE_TARGET',
    );
  }
  if (targets.minRoas !== undefined && metrics.roas !== null) {
    reasons.push(metrics.roas >= targets.minRoas ? 'ROAS_WITHIN_TARGET' : 'ROAS_BELOW_TARGET');
  }
  return reasons;
}

function confidenceFor(
  snapshot: PaidMediaPerformanceSnapshot,
  evidenceSignals: number,
): PaidMediaConfidence {
  if (snapshot.impressions >= 5_000 && evidenceSignals >= 3) return 'HIGH';
  if (snapshot.impressions >= 1_000 && evidenceSignals >= 2) return 'MEDIUM';
  return 'LOW';
}

export function assessPaidMediaPerformance(input: {
  readonly current: PaidMediaPerformanceSnapshot;
  readonly baseline?: PaidMediaPerformanceSnapshot;
  readonly targets: PaidMediaPerformanceTargets;
  readonly demand?: DemandInput;
  readonly attribution?: RevenueAttributionInput;
  readonly capacity?: CapacityInput;
}): PaidMediaPerformanceAssessment {
  const metrics = paidMediaMetrics(input.current);
  const baselineMetrics = input.baseline ? paidMediaMetrics(input.baseline) : null;
  const anomalies: PaidMediaAnomaly[] = [];
  const minimumImpressions = input.targets.minimumImpressions ?? 1_000;

  if (input.baseline && input.current.impressions >= minimumImpressions) {
    const ctr = anomaly(
      'CTR',
      metrics.ctr,
      baselineMetrics?.ctr ?? null,
      input.targets.maxCtrDropRatio ?? 0.2,
      (input.targets.maxCtrDropRatio ?? 0.2) * 2,
      'LOW_IS_BAD',
    );
    const cpa = anomaly(
      'CPA',
      metrics.cpaMinor,
      baselineMetrics?.cpaMinor ?? null,
      input.targets.maxCpaIncreaseRatio ?? 0.25,
      (input.targets.maxCpaIncreaseRatio ?? 0.25) * 2,
      'HIGH_IS_BAD',
    );
    const cpl = anomaly(
      'CPL',
      metrics.cplMinor,
      baselineMetrics?.cplMinor ?? null,
      0.25,
      0.5,
      'HIGH_IS_BAD',
    );
    const roas = anomaly(
      'ROAS',
      metrics.roas,
      baselineMetrics?.roas ?? null,
      0.2,
      0.4,
      'LOW_IS_BAD',
    );
    const frequency = anomaly(
      'FREQUENCY',
      metrics.frequency,
      baselineMetrics?.frequency ?? null,
      0.2,
      0.5,
      'HIGH_IS_BAD',
    );
    for (const item of [ctr, cpa, cpl, roas, frequency]) if (item) anomalies.push(item);
  }

  const frequencyHigh =
    input.targets.maxFrequency !== undefined &&
    metrics.frequency !== null &&
    metrics.frequency > input.targets.maxFrequency;
  const ctrDeteriorated = anomalies.some((item) => item.metric === 'CTR');
  const costDeteriorated = anomalies.some((item) => item.metric === 'CPA' || item.metric === 'CPL');
  const comparableEvidence =
    Boolean(input.baseline) && input.current.impressions >= minimumImpressions;
  const fatigueReasons = [
    ...(frequencyHigh ? ['FREQUENCY_ABOVE_GUARD'] : []),
    ...(ctrDeteriorated ? ['CTR_DETERIORATION'] : []),
    ...(costDeteriorated ? ['COST_DETERIORATION'] : []),
  ];
  const fatigue = {
    fatigued: comparableEvidence && frequencyHigh && (ctrDeteriorated || costDeteriorated),
    comparableEvidence,
    reasons: fatigueReasons,
  };
  const capacityGuard = assessCapacityGuard(input.capacity);
  const reasons = targetReasons(metrics, input.targets);

  if (input.demand) {
    if (!input.demand.providerBacked) reasons.push('DEMAND_NOT_PROVIDER_BACKED');
    else if (input.demand.demandScore < 0.35) reasons.push('DEMAND_LOW');
    else if (input.demand.demandScore >= 0.7) reasons.push('DEMAND_STRONG');
  }
  if (input.attribution && !input.attribution.providerBacked)
    reasons.push('ATTRIBUTION_NOT_PROVIDER_BACKED');
  reasons.push(...capacityGuard.blockers);

  const criticalNegativeSignals = anomalies.filter((item) => item.severity === 'CRITICAL').length;
  const targetFailures = reasons.filter(
    (reason) => reason.endsWith('_ABOVE_TARGET') || reason.endsWith('_BELOW_TARGET'),
  ).length;
  const favorableTargets = reasons.filter((reason) => reason.endsWith('_WITHIN_TARGET')).length;
  let recommendation: PaidMediaPerformanceAssessment['recommendation'] = 'NO_CHANGE';

  if (fatigue.fatigued) recommendation = 'ROTATE_CREATIVE';
  else if (criticalNegativeSignals >= 2 || targetFailures >= 2)
    recommendation = 'PAUSE_RECOMMENDED';
  else if (
    favorableTargets >= 2 &&
    anomalies.length === 0 &&
    capacityGuard.canScale &&
    input.attribution?.providerBacked === true &&
    (input.demand === undefined || (input.demand.providerBacked && input.demand.demandScore >= 0.5))
  ) {
    recommendation = 'SCALE_RECOMMENDED';
  }

  const evidence = [
    `performance:window=${input.current.window}`,
    ...anomalies.flatMap((item) => item.evidence),
    ...(input.demand?.evidence ?? []),
    ...(input.attribution?.evidence ?? []),
    ...(input.capacity?.evidence ?? []),
  ];
  const signalCount = anomalies.length + favorableTargets + targetFailures + fatigueReasons.length;
  return {
    metrics,
    baselineMetrics,
    anomalies,
    fatigue,
    capacityGuard,
    recommendation,
    confidence: confidenceFor(input.current, signalCount),
    reasons,
    evidence,
  };
}

export function planExperiment(input: ExperimentPlanningInput): ExperimentPlan {
  const armIds = [input.controlId, ...input.variantIds];
  if (input.variantIds.length === 0) throw new Error('EXPERIMENT_VARIANT_REQUIRED');
  if (new Set(armIds).size !== armIds.length) throw new Error('EXPERIMENT_ARM_IDS_MUST_BE_UNIQUE');
  if (input.totalBudgetMinor < input.minimumBudgetPerArmMinor * armIds.length) {
    throw new Error('EXPERIMENT_BUDGET_BELOW_MINIMUM_PER_ARM');
  }
  const base = Math.floor(input.totalBudgetMinor / armIds.length);
  let remainder = input.totalBudgetMinor - base * armIds.length;
  const arms = armIds.map((armId, index) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return {
      armId,
      role: index === 0 ? ('CONTROL' as const) : ('VARIANT' as const),
      allocationMinor: base + extra,
    };
  });
  return {
    experimentId: input.experimentId,
    hypothesisId: input.hypothesisId,
    hypothesis: input.hypothesis,
    primaryMetric: input.primaryMetric,
    immutableDimension: input.immutableDimension,
    arms,
    sideEffects: false,
    approvalRequiredForActivation: true,
  };
}

function slug(value: string): string {
  const normalized = value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const compact = normalized
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!compact) throw new Error('PAID_MEDIA_NAMING_TOKEN_EMPTY');
  return compact.slice(0, 48);
}

export function buildPaidMediaName(input: NamingInput): string {
  const tokens = [
    input.provider === 'META_ADS' ? 'META' : 'GADS',
    slug(input.brand),
    slug(input.objective),
    slug(input.audience),
    slug(input.geo),
    slug(input.dateKey),
    ...(input.experimentId ? [`EXP-${slug(input.experimentId)}`] : []),
    ...(input.variant ? [`VAR-${slug(input.variant)}`] : []),
  ];
  return tokens.join('__');
}

function candidateBlockers(candidate: BudgetAllocationInput['candidates'][number]): string[] {
  const blockers: string[] = [];
  if (candidate.demand && !candidate.demand.providerBacked)
    blockers.push('DEMAND_NOT_PROVIDER_BACKED');
  const capacity = assessCapacityGuard(candidate.capacity);
  if (candidate.capacity && !capacity.canScale) blockers.push(...capacity.blockers);
  return blockers;
}

export function allocateBudget(input: BudgetAllocationInput): readonly BudgetAllocation[] {
  if (input.candidates.length === 0) throw new Error('BUDGET_CANDIDATE_REQUIRED');
  if (input.totalBudgetMinor <= 0 || input.minimumAllocationMinor < 0)
    throw new Error('BUDGET_INPUT_INVALID');
  const prepared = input.candidates.map((candidate) => {
    const blockers = candidateBlockers(candidate);
    const demandMultiplier =
      candidate.demand?.providerBacked === true ? 0.5 + candidate.demand.demandScore : 1;
    const effectiveWeight =
      blockers.length === 0 ? Math.max(0, candidate.weight) * demandMultiplier : 0;
    return { candidate, blockers, effectiveWeight };
  });
  const eligible = prepared.filter((item) => item.effectiveWeight > 0);
  if (eligible.length === 0) {
    return prepared.map((item) => ({
      id: item.candidate.id,
      allocationMinor: 0,
      effectiveWeight: item.effectiveWeight,
      blockers: item.blockers,
    }));
  }
  if (input.totalBudgetMinor < input.minimumAllocationMinor * eligible.length) {
    throw new Error('TOTAL_BUDGET_BELOW_ELIGIBLE_MINIMUMS');
  }

  const totalWeight = eligible.reduce((sum, item) => sum + item.effectiveWeight, 0);
  const distributable = input.totalBudgetMinor - input.minimumAllocationMinor * eligible.length;
  const provisional = eligible.map((item) => {
    const exact = distributable * (item.effectiveWeight / totalWeight);
    const floor = Math.floor(exact);
    return {
      ...item,
      allocationMinor: input.minimumAllocationMinor + floor,
      fractional: exact - floor,
    };
  });
  let remainder =
    input.totalBudgetMinor - provisional.reduce((sum, item) => sum + item.allocationMinor, 0);
  const remainderOrder = [...provisional].sort(
    (left, right) =>
      right.fractional - left.fractional || left.candidate.id.localeCompare(right.candidate.id),
  );
  const extraById = new Map<string, number>();
  for (const item of remainderOrder) {
    if (remainder <= 0) break;
    extraById.set(item.candidate.id, 1);
    remainder -= 1;
  }
  const allocated = new Map(
    provisional.map((item) => [
      item.candidate.id,
      item.allocationMinor + (extraById.get(item.candidate.id) ?? 0),
    ]),
  );
  return prepared.map((item) => ({
    id: item.candidate.id,
    allocationMinor: allocated.get(item.candidate.id) ?? 0,
    effectiveWeight: item.effectiveWeight,
    blockers: item.blockers,
  }));
}

export function planAudience(input: AudiencePlanningInput): AudiencePlan {
  if (input.geoKeys.length === 0) throw new Error('AUDIENCE_GEO_REQUIRED');
  return {
    audienceId: input.audienceId,
    geoKeys: [...new Set(input.geoKeys)],
    interests: [...new Set(input.interests ?? [])],
    exclusions: [...new Set(input.exclusions ?? [])],
    provenance: [...input.evidence, ...(input.demand?.evidence ?? [])],
    providerBackedDemand: input.demand?.providerBacked ?? false,
  };
}

export function planCreativeRotation(
  candidates: readonly CreativeRotationCandidate[],
): CreativeRotationPlan {
  const keep: string[] = [];
  const rotate: { creativeId: string; hypothesisId: string }[] = [];
  const blocked: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.fatigue.fatigued) {
      keep.push(candidate.creativeId);
      continue;
    }
    if (!candidate.fatigue.comparableEvidence) {
      blocked.push(`${candidate.creativeId}:FATIGUE_NOT_COMPARABLE`);
      continue;
    }
    if (!candidate.hypothesisId) {
      blocked.push(`${candidate.creativeId}:HYPOTHESIS_REQUIRED`);
      continue;
    }
    rotate.push({ creativeId: candidate.creativeId, hypothesisId: candidate.hypothesisId });
  }
  return { keep, rotate, blocked };
}

export function googleAdsAutopilotReadiness(
  input: GoogleAdsAutopilotReadinessInput,
): GoogleAdsAutopilotReadiness {
  const blockers: string[] = [];
  if (!input.accountVerified) blockers.push('GOOGLE_ADS_ACCOUNT_NOT_VERIFIED');
  if (!input.crmProviderBacked) blockers.push('CRM_NOT_PROVIDER_BACKED');
  if (!input.attributionProviderBacked) blockers.push('ATTRIBUTION_NOT_PROVIDER_BACKED');
  return { eligible: blockers.length === 0, blockers, evidence: input.evidence };
}
