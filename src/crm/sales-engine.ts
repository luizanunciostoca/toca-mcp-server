import { createHash } from 'node:crypto';
import type { CrmMutationMetadata, CrmScope } from './crm-records.js';

export const CRM_SALES_ENGINE_VERSION = '1.0.0';
export const CRM_SALES_SCORING_RULE_VERSION = 'crm-sales-score-v1';

export const SALES_PIPELINE_STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'OPPORTUNITY',
  'WON',
  'LOST',
  'NURTURE',
] as const;
export type SalesPipelineStage = (typeof SALES_PIPELINE_STAGES)[number];

export const SALES_ACTIVITY_TYPES = [
  'CONTACT_ATTEMPT',
  'RESPONSE',
  'QUALIFICATION',
  'NOTE',
  'CALL',
  'MEETING',
  'PROPOSAL',
  'FOLLOW_UP',
  'HUMAN_HANDOFF',
  'ESCALATION',
  'REACTIVATION',
  'POST_SALE',
] as const;
export type SalesActivityType = (typeof SALES_ACTIVITY_TYPES)[number];

export const SALES_CHANNELS = [
  'WHATSAPP',
  'EMAIL',
  'INSTAGRAM',
  'PHONE',
  'WEB',
  'IN_PERSON',
  'OTHER',
] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export type SalesUrgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE';
export type LeadTemperature = 'COLD' | 'COOL' | 'WARM' | 'HOT';
export type QualificationOutcome = 'QUALIFIED' | 'NURTURE' | 'DISQUALIFIED' | 'REVIEW';
export type QualificationAuthority = 'DETERMINISTIC' | 'HUMAN' | 'HYBRID';
export type SalesSlaState = 'ON_TRACK' | 'DUE' | 'BREACHED' | 'PAUSED' | 'SATISFIED';
export type NextActionType =
  | 'CONTACT'
  | 'FOLLOW_UP'
  | 'QUALIFY'
  | 'CREATE_OPPORTUNITY'
  | 'PROPOSAL'
  | 'REACTIVATE'
  | 'HUMAN_HANDOFF'
  | 'ESCALATE'
  | 'POST_SALE'
  | 'CLOSE_LOST';

export interface ConversationRecord extends CrmScope {
  readonly conversationId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly channel: SalesChannel;
  readonly language: string;
  readonly status:
    | 'OPEN'
    | 'WAITING_CUSTOMER'
    | 'WAITING_HUMAN'
    | 'ABANDONED'
    | 'HANDED_OFF'
    | 'CLOSED';
  readonly startedAt: string;
  readonly lastMessageAt: string | null;
  readonly closedAt: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Provider-neutral message ledger. Raw message content is intentionally not
 * required; callers may store an opaque privacy-governed contentRef plus an
 * immutable digest. This keeps Omnichannel providers outside the CRM boundary.
 */
export interface MessageRecord extends CrmScope {
  readonly messageId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly direction: 'INBOUND' | 'OUTBOUND' | 'INTERNAL';
  readonly channel: SalesChannel;
  readonly language: string;
  readonly contentRef: string | null;
  readonly contentSha256: string;
  readonly providerMessageRef: string | null;
  readonly intent: string | null;
  readonly urgency: SalesUrgency | null;
  readonly occurredAt: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface SalesActivityRecord extends CrmScope {
  readonly activityId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly conversationId: string | null;
  readonly activityType: SalesActivityType;
  readonly channel: SalesChannel | null;
  readonly summary: string;
  readonly outcome: string | null;
  readonly actorPrincipalId: string;
  readonly occurredAt: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface NextActionRecord extends CrmScope {
  readonly nextActionId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly actionType: NextActionType;
  readonly title: string;
  readonly rationale: string;
  readonly priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  readonly status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED';
  readonly ownerPrincipalId: string | null;
  readonly playbookKey: string | null;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QualificationDecision extends CrmScope {
  readonly qualificationDecisionId: string;
  readonly leadId: string;
  readonly decision: QualificationOutcome;
  readonly authority: QualificationAuthority;
  readonly ruleVersion: string;
  readonly deterministicScore: number;
  readonly aiScore: number | null;
  readonly rationale: string;
  readonly factors: Readonly<Record<string, unknown>>;
  readonly evidence: readonly string[];
  readonly decidedByPrincipalId: string;
  readonly decidedAt: string;
  readonly createdAt: string;
}

export interface LeadScoreObservation extends CrmScope {
  readonly leadScoreObservationId: string;
  readonly leadId: string;
  readonly ruleVersion: string;
  readonly deterministicScore: number;
  readonly aiScore: number | null;
  readonly effectiveScore: number;
  readonly temperature: LeadTemperature;
  readonly intent: string | null;
  readonly urgency: SalesUrgency;
  readonly propensity: number;
  readonly estimatedValueMinor: number | null;
  readonly currency: string | null;
  readonly visitEventAt: string | null;
  readonly campaignRef: string | null;
  readonly sourceRef: string | null;
  readonly factors: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface AttributionTouchpoint extends CrmScope {
  readonly attributionTouchpointId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly source: string;
  readonly medium: string | null;
  readonly campaignRef: string | null;
  readonly contentRef: string | null;
  readonly termRef: string | null;
  readonly providerRef: string | null;
  readonly touchpointType: 'FIRST_TOUCH' | 'ASSIST' | 'LAST_TOUCH' | 'CONVERSION' | 'POST_SALE';
  readonly occurredAt: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface SalesAssignmentRecord extends CrmScope {
  readonly assignmentId: string;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly ownerPrincipalId: string;
  readonly previousOwnerPrincipalId: string | null;
  readonly routingRule: string;
  readonly reason: string;
  readonly assignedByPrincipalId: string;
  readonly assignedAt: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface PipelineStageHistoryRecord extends CrmScope {
  readonly stageHistoryId: string;
  readonly contactId: string;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly pipelineKey: string;
  readonly fromStage: SalesPipelineStage | null;
  readonly toStage: SalesPipelineStage;
  readonly reason: string;
  readonly changedByPrincipalId: string;
  readonly changedAt: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface LeadSlaRecord extends CrmScope {
  readonly leadId: string;
  readonly firstResponseDueAt: string;
  readonly firstResponseAt: string | null;
  readonly followUpDueAt: string | null;
  readonly lastFollowUpAt: string | null;
  readonly noResponseCount: number;
  readonly state: SalesSlaState;
  readonly breachReason: string | null;
  readonly reactivationDueAt: string | null;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ContactResolutionCandidate {
  readonly contactId: string;
  readonly matchedChannels: readonly string[];
  readonly mergedIntoContactId: string | null;
}

export interface ContactResolutionResult {
  readonly state: 'NOT_FOUND' | 'RESOLVED' | 'AMBIGUOUS';
  readonly canonicalContactId: string | null;
  readonly candidates: readonly ContactResolutionCandidate[];
  readonly evidence: readonly string[];
}

export interface LeadScoringInput {
  readonly intentStrength: 0 | 1 | 2 | 3 | 4;
  readonly urgency: SalesUrgency;
  readonly propensity: number;
  readonly estimatedValueMinor?: number | null;
  readonly visitEventAt?: string | null;
  readonly now: string;
  readonly engagementSignals?: number;
  readonly aiScore?: number | null;
}

export interface LeadScoringResult {
  readonly ruleVersion: string;
  readonly deterministicScore: number;
  readonly aiScore: number | null;
  readonly effectiveScore: number;
  readonly temperature: LeadTemperature;
  readonly factors: Readonly<Record<string, number | string | null>>;
}

export function scoreLeadDeterministically(input: LeadScoringInput): LeadScoringResult {
  const nowMs = timestampMs(input.now, 'CRM_SALES_SCORE_NOW_INVALID');
  assertRange(input.propensity, 0, 1, 'CRM_SALES_PROPENSITY_INVALID');
  if (!Number.isInteger(input.intentStrength) || input.intentStrength < 0 || input.intentStrength > 4) {
    throw new Error('CRM_SALES_INTENT_STRENGTH_INVALID');
  }
  const engagementSignals = input.engagementSignals ?? 0;
  if (!Number.isInteger(engagementSignals) || engagementSignals < 0) {
    throw new Error('CRM_SALES_ENGAGEMENT_SIGNALS_INVALID');
  }
  if (input.aiScore !== undefined && input.aiScore !== null) {
    assertRange(input.aiScore, 0, 100, 'CRM_SALES_AI_SCORE_INVALID');
  }

  const intentPoints = input.intentStrength * 6.25;
  const urgencyPoints = urgencyWeight(input.urgency);
  const propensityPoints = input.propensity * 25;
  const valuePoints = estimatedValuePoints(input.estimatedValueMinor ?? null);
  const visitPoints = visitProximityPoints(input.visitEventAt ?? null, nowMs);
  const engagementPoints = Math.min(5, engagementSignals);
  const deterministicScore = roundScore(
    intentPoints + urgencyPoints + propensityPoints + valuePoints + visitPoints + engagementPoints,
  );

  // AI is deliberately complementary. It may contribute at most 15% of the
  // effective score and can never qualify a lead by itself.
  const aiScore = input.aiScore ?? null;
  const effectiveScore =
    aiScore === null ? deterministicScore : roundScore(deterministicScore * 0.85 + aiScore * 0.15);

  return {
    ruleVersion: CRM_SALES_SCORING_RULE_VERSION,
    deterministicScore,
    aiScore,
    effectiveScore,
    temperature: temperatureForScore(effectiveScore),
    factors: {
      intent_points: roundScore(intentPoints),
      urgency_points: urgencyPoints,
      propensity_points: roundScore(propensityPoints),
      estimated_value_points: valuePoints,
      visit_proximity_points: visitPoints,
      engagement_points: engagementPoints,
      ai_weight: aiScore === null ? 0 : 0.15,
    },
  };
}

export interface QualificationRecommendationInput {
  readonly scoring: LeadScoringResult;
  readonly hasVerifiedContactPath: boolean;
  readonly explicitOptOut: boolean;
  readonly humanOverride?: 'QUALIFIED' | 'NURTURE' | 'DISQUALIFIED' | null;
}

export interface QualificationRecommendation {
  readonly outcome: QualificationOutcome;
  readonly authority: QualificationAuthority;
  readonly rationale: string;
}

export function recommendQualification(
  input: QualificationRecommendationInput,
): QualificationRecommendation {
  if (input.explicitOptOut) {
    return {
      outcome: 'DISQUALIFIED',
      authority: input.humanOverride ? 'HYBRID' : 'DETERMINISTIC',
      rationale: 'Explicit opt-out or do-not-contact signal blocks sales qualification.',
    };
  }
  if (input.humanOverride) {
    return {
      outcome: input.humanOverride,
      authority: 'HYBRID',
      rationale: 'Human decision overrides the deterministic recommendation with full history.',
    };
  }
  if (!input.hasVerifiedContactPath) {
    return {
      outcome: 'REVIEW',
      authority: 'DETERMINISTIC',
      rationale: 'No verified contact path is available; human review is required.',
    };
  }
  if (input.scoring.deterministicScore >= 70) {
    return {
      outcome: 'QUALIFIED',
      authority: 'DETERMINISTIC',
      rationale: 'Deterministic score meets the qualification threshold.',
    };
  }
  if (input.scoring.deterministicScore >= 35) {
    return {
      outcome: 'NURTURE',
      authority: 'DETERMINISTIC',
      rationale: 'Deterministic score is viable but below the direct qualification threshold.',
    };
  }
  return {
    outcome: 'NURTURE',
    authority: 'DETERMINISTIC',
    rationale: 'Low deterministic score is retained for governed nurture/reactivation rather than discarded.',
  };
}

export function temperatureForScore(score: number): LeadTemperature {
  assertRange(score, 0, 100, 'CRM_SALES_SCORE_INVALID');
  if (score >= 75) return 'HOT';
  if (score >= 50) return 'WARM';
  if (score >= 25) return 'COOL';
  return 'COLD';
}

export interface SalesSlaPolicy {
  readonly firstResponseMinutes: Readonly<Record<LeadTemperature, number>>;
  readonly followUpMinutes: Readonly<Record<LeadTemperature, number>>;
  readonly reactivationDays: number;
}

export const DEFAULT_SALES_SLA_POLICY: SalesSlaPolicy = {
  firstResponseMinutes: { HOT: 15, WARM: 30, COOL: 120, COLD: 240 },
  followUpMinutes: { HOT: 240, WARM: 1440, COOL: 2880, COLD: 4320 },
  reactivationDays: 7,
};

export function calculateInitialSla(
  capturedAt: string,
  temperature: LeadTemperature,
  policy: SalesSlaPolicy = DEFAULT_SALES_SLA_POLICY,
): Pick<LeadSlaRecord, 'firstResponseDueAt' | 'followUpDueAt' | 'reactivationDueAt' | 'state'> {
  const capturedMs = timestampMs(capturedAt, 'CRM_SALES_CAPTURED_AT_INVALID');
  return {
    firstResponseDueAt: new Date(
      capturedMs + policy.firstResponseMinutes[temperature] * 60_000,
    ).toISOString(),
    followUpDueAt: null,
    reactivationDueAt: new Date(
      capturedMs + policy.reactivationDays * 24 * 60 * 60_000,
    ).toISOString(),
    state: 'ON_TRACK',
  };
}

export function calculateSlaState(
  input: Pick<LeadSlaRecord, 'firstResponseDueAt' | 'firstResponseAt' | 'followUpDueAt' | 'state'> & {
    readonly now: string;
  },
): SalesSlaState {
  if (input.state === 'PAUSED' || input.state === 'SATISFIED') return input.state;
  const nowMs = timestampMs(input.now, 'CRM_SALES_SLA_NOW_INVALID');
  if (!input.firstResponseAt && nowMs > timestampMs(input.firstResponseDueAt, 'CRM_SALES_SLA_DUE_INVALID')) {
    return 'BREACHED';
  }
  if (input.followUpDueAt) {
    const dueMs = timestampMs(input.followUpDueAt, 'CRM_SALES_FOLLOWUP_DUE_INVALID');
    if (nowMs > dueMs) return 'BREACHED';
    if (dueMs - nowMs <= 15 * 60_000) return 'DUE';
  }
  return 'ON_TRACK';
}

const PIPELINE_TRANSITIONS: Readonly<Record<SalesPipelineStage, readonly SalesPipelineStage[]>> = {
  NEW: ['CONTACTED', 'NURTURE', 'LOST'],
  CONTACTED: ['QUALIFIED', 'NURTURE', 'LOST'],
  QUALIFIED: ['OPPORTUNITY', 'NURTURE', 'LOST'],
  OPPORTUNITY: ['WON', 'LOST', 'NURTURE'],
  WON: [],
  LOST: ['NURTURE'],
  NURTURE: ['CONTACTED', 'QUALIFIED', 'LOST'],
};

export function assertSalesPipelineTransition(
  from: SalesPipelineStage,
  to: SalesPipelineStage,
): void {
  if (from === to) return;
  if (!PIPELINE_TRANSITIONS[from].includes(to)) {
    throw new Error(`CRM_SALES_STAGE_TRANSITION_INVALID:${from}->${to}`);
  }
}

export interface NextBestActionInput {
  readonly stage: SalesPipelineStage;
  readonly temperature: LeadTemperature;
  readonly noResponseCount: number;
  readonly hasOpenOpportunity: boolean;
  readonly conversationAbandoned: boolean;
  readonly humanHandoffRequested: boolean;
  readonly wonAt?: string | null;
}

export interface NextBestActionRecommendation {
  readonly actionType: NextActionType;
  readonly priority: NextActionRecord['priority'];
  readonly playbookKey: string;
  readonly rationale: string;
}

export function resolveNextBestAction(input: NextBestActionInput): NextBestActionRecommendation {
  if (input.humanHandoffRequested) {
    return {
      actionType: 'HUMAN_HANDOFF',
      priority: 'URGENT',
      playbookKey: 'human-handoff-v1',
      rationale: 'A human handoff was explicitly requested.',
    };
  }
  if (input.conversationAbandoned || input.noResponseCount >= 3) {
    return {
      actionType: 'REACTIVATE',
      priority: input.temperature === 'HOT' ? 'HIGH' : 'MEDIUM',
      playbookKey: 'reactivation-no-response-v1',
      rationale: 'Conversation abandonment or repeated no-response requires governed reactivation.',
    };
  }
  if (input.stage === 'WON') {
    return {
      actionType: 'POST_SALE',
      priority: 'MEDIUM',
      playbookKey: 'post-sale-v1',
      rationale: 'Won opportunities enter the post-sale relationship playbook.',
    };
  }
  if (input.stage === 'OPPORTUNITY' || input.hasOpenOpportunity) {
    return {
      actionType: 'PROPOSAL',
      priority: input.temperature === 'HOT' ? 'URGENT' : 'HIGH',
      playbookKey: 'opportunity-progress-v1',
      rationale: 'An active opportunity should progress toward proposal/decision.',
    };
  }
  if (input.stage === 'QUALIFIED') {
    return {
      actionType: 'CREATE_OPPORTUNITY',
      priority: input.temperature === 'HOT' ? 'URGENT' : 'HIGH',
      playbookKey: 'qualified-to-opportunity-v1',
      rationale: 'Qualified lead should become an opportunity.',
    };
  }
  if (input.stage === 'NEW') {
    return {
      actionType: 'CONTACT',
      priority: input.temperature === 'HOT' ? 'URGENT' : 'HIGH',
      playbookKey: 'first-response-v1',
      rationale: 'New lead requires first response within SLA.',
    };
  }
  return {
    actionType: 'FOLLOW_UP',
    priority: input.temperature === 'HOT' ? 'HIGH' : 'MEDIUM',
    playbookKey: 'follow-up-v1',
    rationale: 'Continue the current commercial conversation with a governed follow-up.',
  };
}

export interface LeadRoutingInput {
  readonly leadId: string;
  readonly eligibleOwnerPrincipalIds: readonly string[];
  readonly preferredOwnerPrincipalId?: string | null;
}

export interface LeadRoutingDecision {
  readonly ownerPrincipalId: string;
  readonly routingRule: string;
  readonly evidence: readonly string[];
}

export function routeLeadDeterministically(input: LeadRoutingInput): LeadRoutingDecision {
  const owners = [...new Set(input.eligibleOwnerPrincipalIds.map((value) => value.trim()).filter(Boolean))].sort();
  if (owners.length === 0) throw new Error('CRM_SALES_ROUTING_OWNER_REQUIRED');
  const preferred = input.preferredOwnerPrincipalId?.trim();
  if (preferred && owners.includes(preferred)) {
    return {
      ownerPrincipalId: preferred,
      routingRule: 'preferred-owner-v1',
      evidence: [`routing:preferred:${preferred}`],
    };
  }
  const digest = createHash('sha256').update(input.leadId).digest();
  const index = digest.readUInt32BE(0) % owners.length;
  return {
    ownerPrincipalId: owners[index]!,
    routingRule: 'stable-hash-v1',
    evidence: [`routing:stable-hash:index:${index}`, `routing:eligible:${owners.join(',')}`],
  };
}

export interface ContactMergeEvidence {
  readonly exactNormalizedChannelMatch: boolean;
  readonly verifiedChannelMatch: boolean;
  readonly sameScope: boolean;
  readonly explicitHumanApproval: boolean;
}

export interface ContactMergeDecision {
  readonly allowed: boolean;
  readonly confidence: number;
  readonly rule: string;
  readonly reason: string;
}

export function evaluateContactMerge(input: ContactMergeEvidence): ContactMergeDecision {
  if (!input.sameScope) {
    return { allowed: false, confidence: 0, rule: 'scope-boundary-v1', reason: 'Cross-scope merge is forbidden.' };
  }
  if (input.explicitHumanApproval && input.exactNormalizedChannelMatch) {
    return {
      allowed: true,
      confidence: input.verifiedChannelMatch ? 1 : 0.95,
      rule: 'human-approved-exact-channel-v1',
      reason: 'Human-approved merge backed by an exact normalized channel match.',
    };
  }
  if (input.verifiedChannelMatch) {
    return {
      allowed: true,
      confidence: 1,
      rule: 'verified-channel-exact-v1',
      reason: 'Verified exact channel identity is deterministic merge evidence.',
    };
  }
  return {
    allowed: false,
    confidence: input.exactNormalizedChannelMatch ? 0.8 : 0,
    rule: 'human-review-required-v1',
    reason: 'Unverified or fuzzy identity evidence cannot auto-merge contacts.',
  };
}

export interface CreateConversationInput extends CrmScope, CrmMutationMetadata {
  readonly conversationId: string;
  readonly contactId: string;
  readonly leadId?: string | null;
  readonly channel: SalesChannel;
  readonly language?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly now?: string;
}

export interface AppendMessageInput extends CrmScope, CrmMutationMetadata {
  readonly messageId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly leadId?: string | null;
  readonly direction: MessageRecord['direction'];
  readonly channel: SalesChannel;
  readonly language?: string;
  readonly contentRef?: string | null;
  readonly contentSha256: string;
  readonly providerMessageRef?: string | null;
  readonly intent?: string | null;
  readonly urgency?: SalesUrgency | null;
  readonly occurredAt?: string;
  readonly now?: string;
}

export interface AppendSalesActivityInput extends CrmScope, CrmMutationMetadata {
  readonly activityId: string;
  readonly contactId: string;
  readonly leadId?: string | null;
  readonly opportunityId?: string | null;
  readonly conversationId?: string | null;
  readonly activityType: SalesActivityType;
  readonly channel?: SalesChannel | null;
  readonly summary: string;
  readonly outcome?: string | null;
  readonly occurredAt?: string;
  readonly stageTransition?: {
    readonly pipelineKey: string;
    readonly fromStage: SalesPipelineStage;
    readonly toStage: SalesPipelineStage;
    readonly reason: string;
  };
  readonly now?: string;
}

export interface ScheduleNextActionInput extends CrmScope, CrmMutationMetadata {
  readonly nextActionId: string;
  readonly contactId: string;
  readonly leadId?: string | null;
  readonly opportunityId?: string | null;
  readonly actionType: NextActionType;
  readonly title: string;
  readonly rationale: string;
  readonly priority: NextActionRecord['priority'];
  readonly ownerPrincipalId?: string | null;
  readonly playbookKey?: string | null;
  readonly dueAt?: string | null;
  readonly now?: string;
}

export interface QualifyLeadInput extends CrmScope, CrmMutationMetadata {
  readonly qualificationDecisionId: string;
  readonly leadScoreObservationId: string;
  readonly leadId: string;
  readonly outcome: QualificationOutcome;
  readonly authority: QualificationAuthority;
  readonly scoring: LeadScoringResult;
  readonly intent?: string | null;
  readonly urgency: SalesUrgency;
  readonly propensity: number;
  readonly estimatedValueMinor?: number | null;
  readonly currency?: string | null;
  readonly visitEventAt?: string | null;
  readonly campaignRef?: string | null;
  readonly sourceRef?: string | null;
  readonly rationale: string;
  readonly pipelineKey: string;
  readonly fromStage: SalesPipelineStage;
  readonly now?: string;
}

export interface UpdateSalesOpportunityInput extends CrmScope, CrmMutationMetadata {
  readonly opportunityId: string;
  readonly expectedVersion: number;
  readonly pipelineKey: string;
  readonly fromStage: SalesPipelineStage;
  readonly toStage: Extract<SalesPipelineStage, 'OPPORTUNITY' | 'WON' | 'LOST' | 'NURTURE'>;
  readonly stageKey: string;
  readonly status: 'OPEN' | 'WON' | 'LOST';
  readonly lossReason?: string | null;
  readonly valueMinor?: number | null;
  readonly currency?: string | null;
  readonly ownerPrincipalId?: string | null;
  readonly nextAction?: string | null;
  readonly nextActionAt?: string | null;
  readonly reason: string;
  readonly now?: string;
}

export interface PipelineQueryInput extends CrmScope {
  readonly pipelineKey?: string;
  readonly stages?: readonly SalesPipelineStage[];
  readonly ownerPrincipalId?: string;
  readonly limit?: number;
}

export interface PipelineQueryRow extends CrmScope {
  readonly contactId: string;
  readonly leadId: string | null;
  readonly opportunityId: string | null;
  readonly pipelineKey: string;
  readonly stage: SalesPipelineStage;
  readonly ownerPrincipalId: string | null;
  readonly valueMinor: number | null;
  readonly currency: string | null;
  readonly nextActionAt: string | null;
  readonly lastChangedAt: string;
}

export interface CrmSalesStore {
  resolveContact(input: CrmScope & {
    readonly channels: readonly {
      readonly channelType: 'EMAIL' | 'PHONE' | 'SOCIAL' | 'OTHER';
      readonly provider?: string | null;
      readonly value: string;
    }[];
  }): Promise<ContactResolutionResult>;
  createConversation(input: CreateConversationInput): Promise<ConversationRecord>;
  appendMessage(input: AppendMessageInput): Promise<MessageRecord>;
  appendActivity(input: AppendSalesActivityInput): Promise<SalesActivityRecord>;
  scheduleNextAction(input: ScheduleNextActionInput): Promise<NextActionRecord>;
  qualifyLead(input: QualifyLeadInput): Promise<QualificationDecision>;
  updateOpportunity(input: UpdateSalesOpportunityInput): Promise<PipelineStageHistoryRecord>;
  queryPipeline(input: PipelineQueryInput): Promise<readonly PipelineQueryRow[]>;
  getQualificationDecision(input: CrmScope & { readonly qualificationDecisionId: string }): Promise<QualificationDecision | undefined>;
  getNextAction(input: CrmScope & { readonly nextActionId: string }): Promise<NextActionRecord | undefined>;
}

function urgencyWeight(urgency: SalesUrgency): number {
  switch (urgency) {
    case 'IMMEDIATE':
      return 20;
    case 'HIGH':
      return 15;
    case 'MEDIUM':
      return 8;
    case 'LOW':
      return 2;
  }
}

function estimatedValuePoints(valueMinor: number | null): number {
  if (valueMinor === null) return 0;
  if (!Number.isInteger(valueMinor) || valueMinor < 0) throw new Error('CRM_SALES_ESTIMATED_VALUE_INVALID');
  if (valueMinor >= 500_000) return 15;
  if (valueMinor >= 200_000) return 12;
  if (valueMinor >= 100_000) return 9;
  if (valueMinor >= 50_000) return 6;
  if (valueMinor > 0) return 3;
  return 0;
}

function visitProximityPoints(value: string | null, nowMs: number): number {
  if (!value) return 0;
  const visitMs = timestampMs(value, 'CRM_SALES_VISIT_EVENT_AT_INVALID');
  const deltaDays = (visitMs - nowMs) / (24 * 60 * 60_000);
  if (deltaDays < -1) return 0;
  if (deltaDays <= 2) return 10;
  if (deltaDays <= 7) return 8;
  if (deltaDays <= 30) return 5;
  return 2;
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function timestampMs(value: string, code: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(code);
  return ms;
}

function assertRange(value: number, minimum: number, maximum: number, code: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(code);
}
