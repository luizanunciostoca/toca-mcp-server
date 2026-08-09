import type {
  EngagementAutonomy,
  EngagementChannel,
  EngagementDecision,
  EngagementRisk,
} from '../providers/instagram/instagram-engagement-contracts.js';

export type EngagementIntent =
  | 'FAQ_OPERATIONAL'
  | 'EVENT_INFO'
  | 'TICKET_INFO'
  | 'LOCATION_HOURS'
  | 'GENERAL_SOCIAL'
  | 'COMMERCIAL_LEAD'
  | 'COMPLAINT'
  | 'REFUND'
  | 'LEGAL'
  | 'SAFETY_INCIDENT'
  | 'PRESS'
  | 'PUBLIC_FIGURE'
  | 'HARASSMENT_OR_THREAT'
  | 'UNKNOWN';

export interface EngagementPolicyInput {
  readonly channel: EngagementChannel;
  readonly intent: EngagementIntent;
  readonly factsVerified: boolean;
  readonly containsSensitivePersonalData?: boolean;
}

const HUMAN_REQUIRED = new Set<EngagementIntent>([
  'COMPLAINT',
  'REFUND',
  'LEGAL',
  'SAFETY_INCIDENT',
  'PRESS',
  'PUBLIC_FIGURE',
  'HARASSMENT_OR_THREAT',
]);

const AUTO_ELIGIBLE = new Set<EngagementIntent>([
  'FAQ_OPERATIONAL',
  'EVENT_INFO',
  'TICKET_INFO',
  'LOCATION_HOURS',
  'GENERAL_SOCIAL',
]);

function decision(
  channel: EngagementChannel,
  risk: EngagementRisk,
  autonomy: EngagementAutonomy,
  reason: string,
): EngagementDecision {
  return {
    channel,
    risk,
    autonomy,
    reason,
    requiresHumanReview: autonomy === 'HUMAN_REVIEW_REQUIRED',
  };
}

export function evaluateEngagementPolicy(input: EngagementPolicyInput): EngagementDecision {
  if (input.containsSensitivePersonalData) {
    return decision(input.channel, 'HIGH', 'HUMAN_REVIEW_REQUIRED', 'sensitive_personal_data');
  }

  if (HUMAN_REQUIRED.has(input.intent)) {
    return decision(input.channel, 'HIGH', 'HUMAN_REVIEW_REQUIRED', `intent:${input.intent}`);
  }

  if (input.intent === 'COMMERCIAL_LEAD') {
    return decision(input.channel, 'MEDIUM', 'SUGGEST_ONLY', 'commercial_lead_requires_handoff');
  }

  if (!input.factsVerified) {
    return decision(input.channel, 'MEDIUM', 'SUGGEST_ONLY', 'facts_not_verified');
  }

  if (AUTO_ELIGIBLE.has(input.intent)) {
    return decision(
      input.channel,
      'LOW',
      'AUTO_REPLY_ALLOWED',
      `verified_low_risk:${input.intent}`,
    );
  }

  return decision(input.channel, 'MEDIUM', 'SUGGEST_ONLY', 'unknown_or_unclassified');
}
