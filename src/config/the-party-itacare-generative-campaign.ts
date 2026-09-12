import type { PhotoToVideoRouteType } from '../contracts/photo-to-video.js';

export const THE_PARTY_ITACARE_GENERATIVE_CAMPAIGN_ID =
  'TP-ITA-20261011-GENERATIVE-V1' as const;

export const THE_PARTY_ITACARE_EDITION_ID = 'TP-ITA-20261011' as const;

export const THE_PARTY_ITACARE_SOURCES = {
  VENUE_DAY: {
    assetId: 'TP-ITA-GEN-VENUE-DAY-001',
    venueAssetId: 'VENUE-TP-ITA-GEN-VENUE-DAY-001',
    driveFileId: '1Yb0_x2eh-gUDo0S-GrZ2Y9FKv3t6ZDmD',
    sha256: '132a24cc60893abb132232c5a473ae42fb7fe7c5fd8f296b2ea546921c6e7047',
    containsPeople: false,
    approvedRoutes: ['GENERATIVE_SCENE_CONTINUATION_VIDEO'] as const,
  },
  VENUE_SUNSET: {
    assetId: 'TP-ITA-GEN-VENUE-SUNSET-001',
    venueAssetId: 'VENUE-TP-ITA-GEN-VENUE-SUNSET-001',
    driveFileId: '1zLjYNjr3xP4uaBcCLQEY9jKbHOaKlN50',
    sha256: 'a0ed04a0e9168e7f07b4094f3bfecd605707d55c57927e9fd5af6b1493943379',
    containsPeople: false,
    approvedRoutes: ['GENERATIVE_SCENE_CONTINUATION_VIDEO'] as const,
  },
  ILLUSIONIZE: {
    assetId: 'TP-ITA-PHOTO-ILLUSIONIZE-001',
    venueAssetId: 'VENUE-TP-ITA-PHOTO-ILLUSIONIZE-001',
    driveFileId: '1dOP5xiNx3iI9fZStm47BTq737wtA2Wst',
    sha256: '5a8e519354a04d1d4c11547f323a3641c70ae736779538013d9a3d49e1f31ca0',
    containsPeople: true,
    approvedRoutes: ['REAL_PHOTO_TO_MOTION_VIDEO'] as const,
  },
  BRISOTTI: {
    assetId: 'TP-ITA-PHOTO-BRISOTTI-001',
    venueAssetId: 'VENUE-TP-ITA-PHOTO-BRISOTTI-001',
    driveFileId: '1-Pl_A32eLNgbhZDZVb77uUGE0RZz7tfj',
    sha256: '4de8d4b015bc58d425b46b6a689c2245bc9093ac629bc485f967fa8a88f09aa5',
    containsPeople: true,
    approvedRoutes: ['REAL_PHOTO_TO_MOTION_VIDEO'] as const,
  },
  LINEUP_DUO: {
    assetId: 'TP-ITA-PHOTO-LINEUP-DUO-001',
    venueAssetId: 'VENUE-TP-ITA-PHOTO-LINEUP-DUO-001',
    driveFileId: '1SKt19Uu5GNC942aS8lWnrdhsV3QpHYAY',
    sha256: '2f704e3b82cd6ff808a110e344a73472ae3a5f96d769bebb052829f367a0984d',
    containsPeople: true,
    approvedRoutes: ['REAL_PHOTO_TO_MOTION_VIDEO'] as const,
  },
} as const;

export type ItacareCampaignSourceKey = keyof typeof THE_PARTY_ITACARE_SOURCES;

export interface ItacareGenerativeSceneSpec {
  readonly contentItemId: string;
  readonly source: ItacareCampaignSourceKey;
  readonly routeType: PhotoToVideoRouteType;
  readonly creativeDirection?: string;
}

export interface ItacareGenerativeVideoSpec {
  readonly id: string;
  readonly title: string;
  readonly targetSeconds: number;
  readonly intent:
    | 'HIGH_IMPACT_CAMPAIGN'
    | 'LINEUP'
    | 'EVENT'
    | 'SOCIAL_PROMOTION'
    | 'IMMERSIVE_ANNOUNCEMENT'
    | 'INVITATION'
    | 'PEOPLE_FIRST_CONVERSION';
  readonly finalContentItemId: string;
  readonly scenes: readonly ItacareGenerativeSceneSpec[];
}

const VENUE_SOURCE_LOCK =
  'Treat the supplied Praia da Ribeira campaign artwork as the factual visual anchor. Animate only plausible photographic background motion supported by the visible coastline, sea, sky and vegetation. Preserve all existing typography, date, artist names, venue wording, logos, sponsor marks and CTA as source facts; do not redraw, translate, replace or invent them. Do not invent architecture, stages, crowds, people, products, offers, prices or scarcity claims. Keep motion physically plausible, premium and cinematic. This is a review candidate only; publication is not authorized.';

function venueDirection(action: string): string {
  return `${action} ${VENUE_SOURCE_LOCK}`;
}

function realMotionScene(
  contentItemId: string,
  source: 'ILLUSIONIZE' | 'BRISOTTI' | 'LINEUP_DUO',
): ItacareGenerativeSceneSpec {
  return {
    contentItemId,
    source,
    routeType: 'REAL_PHOTO_TO_MOTION_VIDEO',
  };
}

function venueScene(
  contentItemId: string,
  source: 'VENUE_DAY' | 'VENUE_SUNSET',
  action: string,
): ItacareGenerativeSceneSpec {
  return {
    contentItemId,
    source,
    routeType: 'GENERATIVE_SCENE_CONTINUATION_VIDEO',
    creativeDirection: venueDirection(action),
  };
}

export const THE_PARTY_ITACARE_GENERATIVE_VIDEOS = [
  {
    id: 'VID-01',
    title: 'Hero Illusionize + Brisotti',
    targetSeconds: 15,
    intent: 'HIGH_IMPACT_CAMPAIGN',
    finalContentItemId: 'TP-ITA-VID01-HERO-GEN-FINAL',
    scenes: [
      realMotionScene('TP-ITA-VID01-HERO-S01', 'LINEUP_DUO'),
      venueScene(
        'TP-ITA-VID01-HERO-S02',
        'VENUE_SUNSET',
        'Create the climax of a premium event trailer with a restrained slow push into the visible golden-hour coast, subtle natural sea shimmer, cloud drift and vegetation movement.',
      ),
    ],
  },
  {
    id: 'VID-02',
    title: 'Manifesto — Não é qualquer festa. É A FESTA!',
    targetSeconds: 24,
    intent: 'IMMERSIVE_ANNOUNCEMENT',
    finalContentItemId: 'TP-ITA-VID02-MANIFESTO-GEN-FINAL',
    scenes: [
      venueScene(
        'TP-ITA-VID02-MANIFESTO-S01',
        'VENUE_DAY',
        'Open as a destination manifesto with a smooth forward drift over the visible tropical beach and coast, gentle waves and restrained foliage motion.',
      ),
      venueScene(
        'TP-ITA-VID02-MANIFESTO-S02',
        'VENUE_SUNSET',
        'Continue into golden hour with source-consistent sunlight, subtle cloud movement, sea shimmer and a measured cinematic push.',
      ),
      realMotionScene('TP-ITA-VID02-MANIFESTO-S03', 'LINEUP_DUO'),
    ],
  },
  {
    id: 'VID-03',
    title: 'Illusionize Spotlight',
    targetSeconds: 12,
    intent: 'SOCIAL_PROMOTION',
    finalContentItemId: 'TP-ITA-VID03-ILLUSIONIZE-GEN-FINAL',
    scenes: [
      realMotionScene('TP-ITA-VID03-ILLUSIONIZE-S01', 'ILLUSIONIZE'),
      venueScene(
        'TP-ITA-VID03-ILLUSIONIZE-S02',
        'VENUE_SUNSET',
        'Create a high-impact destination support shot using only the visible sunset coastline, with a clean forward camera drift and restrained rhythmic movement in water, clouds and foliage.',
      ),
    ],
  },
  {
    id: 'VID-04',
    title: 'Brisotti Spotlight',
    targetSeconds: 12,
    intent: 'SOCIAL_PROMOTION',
    finalContentItemId: 'TP-ITA-VID04-BRISOTTI-GEN-FINAL',
    scenes: [
      realMotionScene('TP-ITA-VID04-BRISOTTI-S01', 'BRISOTTI'),
      venueScene(
        'TP-ITA-VID04-BRISOTTI-S02',
        'VENUE_DAY',
        'Create a bright destination support shot with a confident but smooth push over the visible Praia da Ribeira coast, realistic water and vegetation movement.',
      ),
    ],
  },
  {
    id: 'VID-05',
    title: 'Dupla / Line-up',
    targetSeconds: 12,
    intent: 'LINEUP',
    finalContentItemId: 'TP-ITA-VID05-LINEUP-GEN-FINAL',
    scenes: [
      realMotionScene('TP-ITA-VID05-LINEUP-S01', 'LINEUP_DUO'),
      venueScene(
        'TP-ITA-VID05-LINEUP-S02',
        'VENUE_SUNSET',
        'Create a strong line-up closing environment from the visible golden-hour coast with cinematic depth, natural wave movement and a restrained light rise.',
      ),
    ],
  },
  {
    id: 'VID-06',
    title: 'Praia da Ribeira / Venue',
    targetSeconds: 12,
    intent: 'EVENT',
    finalContentItemId: 'TP-ITA-VID06-VENUE-GEN-FINAL',
    scenes: [
      venueScene(
        'TP-ITA-VID06-VENUE-S01',
        'VENUE_DAY',
        'Make the visible Praia da Ribeira coastline the protagonist with a slow high-end travel-film push, realistic sea movement, small wave action, tropical foliage movement and subtle aerial-style parallax.',
      ),
      venueScene(
        'TP-ITA-VID06-VENUE-S02',
        'VENUE_SUNSET',
        'Transition the visible coast into an emotional golden-hour hero moment using only source-consistent clouds, sunlight, water shimmer, forest depth and slow camera drift.',
      ),
    ],
  },
  {
    id: 'VID-07',
    title: 'Experience / Prova de lugar',
    targetSeconds: 24,
    intent: 'HIGH_IMPACT_CAMPAIGN',
    finalContentItemId: 'TP-ITA-VID07-EXPERIENCE-GEN-FINAL',
    scenes: [
      venueScene(
        'TP-ITA-VID07-EXPERIENCE-S01',
        'VENUE_DAY',
        'Create a more energetic proof-of-place movement from the visible beach source with smooth forward motion, realistic sea action and tropical depth.',
      ),
      venueScene(
        'TP-ITA-VID07-EXPERIENCE-S02',
        'VENUE_SUNSET',
        'Increase emotional energy with a sunset hero movement, natural wave action, cloud drift and restrained light dynamics while keeping the place factual.',
      ),
      realMotionScene('TP-ITA-VID07-EXPERIENCE-S03', 'LINEUP_DUO'),
    ],
  },
  {
    id: 'VID-08',
    title: 'Convite social — sem depoimento sintético',
    targetSeconds: 16,
    intent: 'INVITATION',
    finalContentItemId: 'TP-ITA-VID08-INVITE-GEN-FINAL',
    scenes: [
      venueScene(
        'TP-ITA-VID08-INVITE-S01',
        'VENUE_DAY',
        'Create an intimate invitation-style opening with gentle camera movement, premium tropical atmosphere and realistic motion limited to the visible beach, sea, sky and vegetation.',
      ),
      realMotionScene('TP-ITA-VID08-INVITE-S02', 'LINEUP_DUO'),
    ],
  },
  {
    id: 'VID-09',
    title: 'Countdown / Reta final',
    targetSeconds: 8,
    intent: 'SOCIAL_PROMOTION',
    finalContentItemId: 'TP-ITA-VID09-COUNTDOWN-GEN-FINAL',
    scenes: [
      venueScene(
        'TP-ITA-VID09-COUNTDOWN-S01',
        'VENUE_DAY',
        'Create a compact urgency cut with a brisk but controlled push toward the visible coast, realistic water motion and a restrained premium light pulse. Do not create any new countdown number or text.',
      ),
    ],
  },
  {
    id: 'VID-10',
    title: 'Retargeting / Conversão',
    targetSeconds: 8,
    intent: 'PEOPLE_FIRST_CONVERSION',
    finalContentItemId: 'TP-ITA-VID10-RETARGETING-GEN-FINAL',
    scenes: [
      venueScene(
        'TP-ITA-VID10-RETARGETING-S01',
        'VENUE_SUNSET',
        'Create a conversion-focused closing shot with direct premium camera motion and natural golden-hour sea, cloud and vegetation movement. Do not invent price, lot status, scarcity claims or new written text.',
      ),
    ],
  },
] as const satisfies readonly ItacareGenerativeVideoSpec[];

export const THE_PARTY_ITACARE_GENERATIVE_SCENE_COUNT = THE_PARTY_ITACARE_GENERATIVE_VIDEOS.reduce(
  (sum, video) => sum + video.scenes.length,
  0,
);
