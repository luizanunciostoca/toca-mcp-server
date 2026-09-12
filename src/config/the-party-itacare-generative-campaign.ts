export const THE_PARTY_ITACARE_GENERATIVE_CAMPAIGN_ID =
  'TP-ITA-20261011-GENERATIVE-V1' as const;

export const THE_PARTY_ITACARE_EDITION_ID = 'TP-ITA-20261011' as const;

export const THE_PARTY_ITACARE_SOURCES = {
  DAY: {
    assetId: 'TP-ITA-GEN-DAY-001',
    venueAssetId: 'VENUE-TP-ITA-GEN-DAY-001',
    driveFileId: '1OU3ub3jdDzCsSCI37LfE7XfR5dddrMwM',
    sha256: '28da2f953122065c511f59020d10a065720fc4683dfe13e4be71d9b5508165bc',
  },
  SUNSET: {
    assetId: 'TP-ITA-GEN-SUNSET-001',
    venueAssetId: 'VENUE-TP-ITA-GEN-SUNSET-001',
    driveFileId: '1IYr00X98Nq3hIVbwneki0fH1DL3ACIT7',
    sha256: '00a9eaca142cbf1b4b1744ae5c9f2238dc1a4ef9a74068a0265e922c3c11c72d',
  },
} as const;

export type ItacareCampaignSourceKey = keyof typeof THE_PARTY_ITACARE_SOURCES;

export interface ItacareGenerativeSceneSpec {
  readonly contentItemId: string;
  readonly source: ItacareCampaignSourceKey;
  readonly creativeDirection: string;
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

const SOURCE_LOCK =
  'Preserve Praia da Ribeira, coastline, sea, vegetation, event identity, source perspective and source lighting facts. Do not invent architecture, artists, faces, crowds, sponsors, logos, typography, offers or ticket prices. Do not redraw, morph or translate any written text or logo. Do not create synthetic artist likeness or synthetic testimonials. Keep all motion physically plausible, premium and cinematic. This is a review candidate only; publication is not authorized.';

function direction(action: string): string {
  return `${action} ${SOURCE_LOCK}`;
}

export const THE_PARTY_ITACARE_GENERATIVE_VIDEOS = [
  {
    id: 'VID-01',
    title: 'Hero Illusionize + Brisotti',
    targetSeconds: 15,
    intent: 'HIGH_IMPACT_CAMPAIGN',
    finalContentItemId: 'TP-ITA-VID01-HERO-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID01-HERO-GEN-S01',
        source: 'DAY',
        creativeDirection: direction(
          'Create a bold opening hero shot with a slow aerial-style push toward Praia da Ribeira, subtle ocean movement, gentle foliage motion and a restrained premium light sweep that makes the event key visual feel alive.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID01-HERO-GEN-S02',
        source: 'SUNSET',
        creativeDirection: direction(
          'Create the climax of a premium event trailer: a slow cinematic push across the sunset coastline, natural cloud drift, subtle water movement and an elegant rise in luminous atmosphere while the existing campaign information stays visually anchored.',
        ),
      },
    ],
  },
  {
    id: 'VID-02',
    title: 'Manifesto — Não é qualquer festa. É A FESTA!',
    targetSeconds: 24,
    intent: 'IMMERSIVE_ANNOUNCEMENT',
    finalContentItemId: 'TP-ITA-VID02-MANIFESTO-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID02-MANIFESTO-GEN-S01',
        source: 'DAY',
        creativeDirection: direction(
          'Open as a destination manifesto: serene but magnetic movement over the tropical coastline, realistic waves and vegetation, a slow forward camera drift and clean daylight energy that sells nature and place before nightlife.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID02-MANIFESTO-GEN-S02',
        source: 'SUNSET',
        creativeDirection: direction(
          'Continue the manifesto into golden hour with realistic sun rays through clouds, subtle wave motion and a measured cinematic push that increases anticipation without changing any factual venue or campaign element.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID02-MANIFESTO-GEN-S03',
        source: 'SUNSET',
        creativeDirection: direction(
          'Finish the manifesto with an emotionally stronger sunset hero moment: restrained atmospheric depth, natural sea shimmer and a deliberate closing push that makes the existing slogan and event identity feel definitive and premium.',
        ),
      },
    ],
  },
  {
    id: 'VID-03',
    title: 'Illusionize Spotlight',
    targetSeconds: 12,
    intent: 'SOCIAL_PROMOTION',
    finalContentItemId: 'TP-ITA-VID03-ILLUSIONIZE-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID03-ILLUSIONIZE-GEN-S01',
        source: 'DAY',
        creativeDirection: direction(
          'Create an energetic artist-announcement environment without generating the artist: quicker camera push over Praia da Ribeira, controlled light rhythm in the environment and crisp natural motion that supports the existing ILLUSIONIZE name in the source artwork.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID03-ILLUSIONIZE-GEN-S02',
        source: 'SUNSET',
        creativeDirection: direction(
          'Create a second high-impact artist spotlight environment with sunset depth, restrained pulse-like lighting in the sky and water, and a clean final push. Do not create a performer or face; the official artist identity remains only in existing source typography.',
        ),
      },
    ],
  },
  {
    id: 'VID-04',
    title: 'Brisotti Spotlight',
    targetSeconds: 12,
    intent: 'SOCIAL_PROMOTION',
    finalContentItemId: 'TP-ITA-VID04-BRISOTTI-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID04-BRISOTTI-GEN-S01',
        source: 'SUNSET',
        creativeDirection: direction(
          'Create an energetic Brisotti announcement environment without generating the artist: elegant sunset camera movement, realistic water and cloud motion and restrained rhythmic light movement supporting the existing BRISOTTI name in the source artwork.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID04-BRISOTTI-GEN-S02',
        source: 'DAY',
        creativeDirection: direction(
          'Create a bright destination-driven second shot with a confident forward camera drift over Praia da Ribeira and realistic coastal movement. Do not generate a performer or face; preserve official artist identity only through the existing campaign typography.',
        ),
      },
    ],
  },
  {
    id: 'VID-05',
    title: 'Dupla / Line-up',
    targetSeconds: 12,
    intent: 'LINEUP',
    finalContentItemId: 'TP-ITA-VID05-LINEUP-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID05-LINEUP-GEN-S01',
        source: 'DAY',
        creativeDirection: direction(
          'Animate the official line-up key visual with premium destination motion: slow push, subtle ocean parallax and vegetation movement. Keep both artist names, date, venue wording and campaign marks unchanged and readable.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID05-LINEUP-GEN-S02',
        source: 'SUNSET',
        creativeDirection: direction(
          'Create a stronger line-up closing scene using the sunset source: cinematic depth, natural wave movement and a restrained light rise. Keep ILLUSIONIZE and BRISOTTI as source-bound typography; do not synthesize artist faces or performances.',
        ),
      },
    ],
  },
  {
    id: 'VID-06',
    title: 'Praia da Ribeira / Venue',
    targetSeconds: 12,
    intent: 'EVENT',
    finalContentItemId: 'TP-ITA-VID06-VENUE-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID06-VENUE-GEN-S01',
        source: 'DAY',
        creativeDirection: direction(
          'Make Praia da Ribeira the protagonist. Use a slow high-end travel-film push over the exact coastline with realistic water, small wave break, palm and forest movement, and subtle aerial parallax. Do not add buildings, stages or beach-club structures not visible in the source.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID06-VENUE-GEN-S02',
        source: 'SUNSET',
        creativeDirection: direction(
          'Transition the destination feeling into sunset using only source-consistent geometry: natural clouds, golden rays, water shimmer, forest depth and a slow cinematic camera drift. The place must remain recognizably Praia da Ribeira.',
        ),
      },
    ],
  },
  {
    id: 'VID-07',
    title: 'Experience / Prova de lugar',
    targetSeconds: 24,
    intent: 'HIGH_IMPACT_CAMPAIGN',
    finalContentItemId: 'TP-ITA-VID07-EXPERIENCE-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID07-EXPERIENCE-GEN-S01',
        source: 'DAY',
        creativeDirection: direction(
          'Create a high-energy proof-of-place shot from the real campaign source with faster but smooth camera movement, realistic sea motion and tropical depth. Do not fabricate attendance, crowds or prior-event footage.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID07-EXPERIENCE-GEN-S02',
        source: 'SUNSET',
        creativeDirection: direction(
          'Increase emotional energy with a sunset hero movement, natural wave action and controlled light dynamics. Keep the scene factual and do not invent people, crowd density or event infrastructure.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID07-EXPERIENCE-GEN-S03',
        source: 'DAY',
        creativeDirection: direction(
          'Close with a confident destination shot: a restrained aerial-style pull revealing the real beach and forest relationship, subtle water movement and a premium campaign finish. No fabricated social proof or synthetic crowd.',
        ),
      },
    ],
  },
  {
    id: 'VID-08',
    title: 'Convite social — sem depoimento sintético',
    targetSeconds: 16,
    intent: 'INVITATION',
    finalContentItemId: 'TP-ITA-VID08-INVITE-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID08-INVITE-GEN-S01',
        source: 'DAY',
        creativeDirection: direction(
          'Create an intimate invitation-style opening with gentle camera movement, premium tropical atmosphere and realistic Praia da Ribeira motion. Do not generate a talking person, testimonial, presenter or synthetic UGC identity.',
        ),
      },
      {
        contentItemId: 'TP-ITA-VID08-INVITE-GEN-S02',
        source: 'SUNSET',
        creativeDirection: direction(
          'Create the invitation close with warm sunset depth, subtle sea shimmer and an elegant slow push that leaves the official campaign message as the factual call to attend. No synthetic speaker or testimonial.',
        ),
      },
    ],
  },
  {
    id: 'VID-09',
    title: 'Countdown / Reta final',
    targetSeconds: 8,
    intent: 'SOCIAL_PROMOTION',
    finalContentItemId: 'TP-ITA-VID09-COUNTDOWN-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID09-COUNTDOWN-GEN-S01',
        source: 'DAY',
        creativeDirection: direction(
          'Create a compact urgency cut: brisk but controlled push toward the beach, realistic water movement and a short premium light pulse that emphasizes the existing 11 de outubro event date without generating any new countdown number or text.',
        ),
      },
    ],
  },
  {
    id: 'VID-10',
    title: 'Retargeting / Conversão',
    targetSeconds: 8,
    intent: 'PEOPLE_FIRST_CONVERSION',
    finalContentItemId: 'TP-ITA-VID10-RETARGETING-GEN-FINAL',
    scenes: [
      {
        contentItemId: 'TP-ITA-VID10-RETARGETING-GEN-S01',
        source: 'SUNSET',
        creativeDirection: direction(
          'Create a conversion-focused closing video with direct premium camera motion, natural sunset and sea movement and strong visual emphasis on the existing event identity and ticket CTA. Do not invent price, lot status, scarcity claims or new written text.',
        ),
      },
    ],
  },
] as const satisfies readonly ItacareGenerativeVideoSpec[];

export const THE_PARTY_ITACARE_GENERATIVE_SCENE_COUNT = THE_PARTY_ITACARE_GENERATIVE_VIDEOS.reduce(
  (sum, video) => sum + video.scenes.length,
  0,
);
