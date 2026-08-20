export const MARKETING_AUTOPILOT_CLOSED_LOOP = [
  'OBSERVE',
  'DIAGNOSE',
  'DECIDE',
  'PLAN',
  'CREATIVE_TRUTH',
  'ASSET',
  'GATES',
  'APPROVAL',
  'SCHEDULE_OR_PUBLISH',
  'READBACK',
  'MEASURE',
  'LEARN',
  'NEXT_RECOMMENDATION',
] as const;

export type MarketingAutopilotClosedLoopStage = (typeof MARKETING_AUTOPILOT_CLOSED_LOOP)[number];

export interface MarketingAutopilotCycleEvidence {
  readonly creativeTruthRefs: readonly string[];
  readonly assetRefs: readonly string[];
  readonly gateRefs: readonly string[];
  readonly approvalRefs: readonly string[];
  readonly scheduleOrPublishRefs: readonly string[];
  readonly providerReadbackRefs: readonly string[];
  readonly measurementRefs: readonly string[];
}

export function assertLearningBoundary(evidence: MarketingAutopilotCycleEvidence): void {
  requireEvidence(evidence.creativeTruthRefs, 'R31_CREATIVE_TRUTH_EVIDENCE_REQUIRED');
  requireEvidence(evidence.assetRefs, 'R31_ASSET_EVIDENCE_REQUIRED');
  requireEvidence(evidence.gateRefs, 'R31_GATE_EVIDENCE_REQUIRED');
  requireEvidence(evidence.approvalRefs, 'R31_APPROVAL_EVIDENCE_REQUIRED');
  requireEvidence(evidence.scheduleOrPublishRefs, 'R31_PUBLISH_EVIDENCE_REQUIRED');
  requireEvidence(evidence.providerReadbackRefs, 'R31_PROVIDER_READBACK_EVIDENCE_REQUIRED');
  requireEvidence(evidence.measurementRefs, 'R31_MEASUREMENT_EVIDENCE_REQUIRED');
}

function requireEvidence(values: readonly string[], code: string): void {
  if (!values.some((value) => value.trim().length > 0)) throw new Error(code);
}
