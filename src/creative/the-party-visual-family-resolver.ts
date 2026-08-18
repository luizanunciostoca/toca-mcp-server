import { ExecutionError } from '../core/errors.js';

export const THE_PARTY_HYBRID_NETWORKS_STANDARD_ID = 'THE_PARTY_HYBRID_NETWORKS_V1' as const;
export const THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID =
  'THE_PARTY_HYBRID_MINIMALIST_V1' as const;

export type ThePartyVisualStandardId =
  | typeof THE_PARTY_HYBRID_NETWORKS_STANDARD_ID
  | typeof THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID;

export type ThePartyEnvironment = 'INTERNATIONAL' | 'NATIONAL';

export type ThePartyCreativeIntent =
  | 'HIGH_IMPACT_CAMPAIGN'
  | 'LINEUP'
  | 'EVENT'
  | 'ACTIVATION'
  | 'SOCIAL_PROMOTION'
  | 'IMMERSIVE_ANNOUNCEMENT'
  | 'INSTITUTIONAL_COMMUNICATION'
  | 'ELEGANT_AD'
  | 'INVITATION'
  | 'HIGHLIGHT_COVER'
  | 'LANDING_PAGE'
  | 'WEBSITE'
  | 'PEOPLE_FIRST_CONVERSION';

const HYBRID_NETWORKS_INTENTS = new Set<ThePartyCreativeIntent>([
  'HIGH_IMPACT_CAMPAIGN',
  'LINEUP',
  'EVENT',
  'ACTIVATION',
  'SOCIAL_PROMOTION',
  'IMMERSIVE_ANNOUNCEMENT',
]);

const HYBRID_MINIMALIST_INTENTS = new Set<ThePartyCreativeIntent>([
  'INSTITUTIONAL_COMMUNICATION',
  'ELEGANT_AD',
  'INVITATION',
  'HIGHLIGHT_COVER',
  'LANDING_PAGE',
  'WEBSITE',
  'PEOPLE_FIRST_CONVERSION',
]);

export interface ThePartyVisualFamilyRequest {
  readonly intent: ThePartyCreativeIntent;
  readonly environment?: ThePartyEnvironment;
}

export interface ThePartyVisualFamilyResolution {
  readonly standardId: ThePartyVisualStandardId;
  readonly family: 'HYBRID_NETWORKS' | 'HYBRID_MINIMALIST';
  readonly environment?: ThePartyEnvironment;
}

export function resolveThePartyVisualFamily(
  request: ThePartyVisualFamilyRequest,
): ThePartyVisualFamilyResolution {
  if (HYBRID_NETWORKS_INTENTS.has(request.intent)) {
    if (!request.environment) {
      throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_ENVIRONMENT_REQUIRED', false);
    }
    return {
      standardId: THE_PARTY_HYBRID_NETWORKS_STANDARD_ID,
      family: 'HYBRID_NETWORKS',
      environment: request.environment,
    };
  }

  if (HYBRID_MINIMALIST_INTENTS.has(request.intent)) {
    return {
      standardId: THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID,
      family: 'HYBRID_MINIMALIST',
    };
  }

  throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_VISUAL_INTENT_UNSUPPORTED', false);
}

export function isThePartyVisualStandardId(value: string): value is ThePartyVisualStandardId {
  return (
    value === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID ||
    value === THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID
  );
}
