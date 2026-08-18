import { ExecutionError } from '../core/errors.js';

export const THE_PARTY_HYBRID_NETWORKS_STANDARD_ID = 'THE_PARTY_HYBRID_NETWORKS_V1' as const;
export const THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID =
  'THE_PARTY_HYBRID_MINIMALIST_V1' as const;

export const THE_PARTY_GOLDEN_VENUE_ASSET_IDS = {
  CROWD_HIGH_IMPACT: 'VENUE-TP-0130',
  PEOPLE_FIRST_MINIMALIST: 'VENUE-TP-0087',
  DJ_INTERNATIONAL: 'VENUE-TP-0071',
  INSTITUTIONAL_SPACE: 'VENUE-TP-0048',
  WARM_NATIONAL: 'VENUE-TP-0113',
} as const;

export type ThePartyVisualStandardId =
  | typeof THE_PARTY_HYBRID_NETWORKS_STANDARD_ID
  | typeof THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID;

export type ThePartyGoldenVenueAssetId =
  (typeof THE_PARTY_GOLDEN_VENUE_ASSET_IDS)[keyof typeof THE_PARTY_GOLDEN_VENUE_ASSET_IDS];

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

export function resolveThePartyVenueAssetPreferences(
  request: ThePartyVisualFamilyRequest,
): readonly ThePartyGoldenVenueAssetId[] {
  const resolution = resolveThePartyVisualFamily(request);

  if (resolution.family === 'HYBRID_MINIMALIST') {
    if (
      request.intent === 'ELEGANT_AD' ||
      request.intent === 'INVITATION' ||
      request.intent === 'HIGHLIGHT_COVER' ||
      request.intent === 'PEOPLE_FIRST_CONVERSION'
    ) {
      return [
        THE_PARTY_GOLDEN_VENUE_ASSET_IDS.PEOPLE_FIRST_MINIMALIST,
        THE_PARTY_GOLDEN_VENUE_ASSET_IDS.INSTITUTIONAL_SPACE,
      ];
    }

    return [
      THE_PARTY_GOLDEN_VENUE_ASSET_IDS.INSTITUTIONAL_SPACE,
      THE_PARTY_GOLDEN_VENUE_ASSET_IDS.PEOPLE_FIRST_MINIMALIST,
    ];
  }

  const environment = resolution.environment;
  if (!environment) {
    throw new ExecutionError('POLICY_DENIED', 'THE_PARTY_ENVIRONMENT_REQUIRED', false);
  }

  const environmentAsset =
    environment === 'INTERNATIONAL'
      ? THE_PARTY_GOLDEN_VENUE_ASSET_IDS.DJ_INTERNATIONAL
      : THE_PARTY_GOLDEN_VENUE_ASSET_IDS.WARM_NATIONAL;

  if (request.intent === 'LINEUP') {
    return [environmentAsset, THE_PARTY_GOLDEN_VENUE_ASSET_IDS.CROWD_HIGH_IMPACT];
  }

  return [THE_PARTY_GOLDEN_VENUE_ASSET_IDS.CROWD_HIGH_IMPACT, environmentAsset];
}

export function isThePartyVisualStandardId(value: string): value is ThePartyVisualStandardId {
  return (
    value === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID ||
    value === THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID
  );
}
