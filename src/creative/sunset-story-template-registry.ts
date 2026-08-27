import type {
  NormalizedRect,
  SunsetStorySceneClass,
  SunsetStorySubjectKind,
  SunsetStoryZone,
} from './sunset-story-image-profile.js';

export const SUNSET_STORY_TEMPLATE_IDS = [
  'SUNSET_TEMPLATE_MASTER_V1',
  'SUNSET_TEMPLATE_MASTER_V2',
  'SUNSET_TEMPLATE_MASTER_V3',
  'SUNSET_TEMPLATE_MASTER_V4',
  'SUNSET_TEMPLATE_MASTER_V5',
  'SUNSET_TEMPLATE_MASTER_V6',
  'SUNSET_TEMPLATE_MASTER_V7',
  'SUNSET_TEMPLATE_MASTER_V8',
  'SUNSET_TEMPLATE_MASTER_V9',
] as const;

export type SunsetStoryTemplateId = (typeof SUNSET_STORY_TEMPLATE_IDS)[number];

export type SunsetStoryTemplateClass =
  | 'SUNSET_HERO_LIFESTYLE'
  | 'SUNSET_VIEW_SCENERY'
  | 'SUNSET_SOCIAL_EXPERIENCE'
  | 'SUNSET_DRINKS_EXPERIENCE'
  | 'SUNSET_INFO_HOURS';

export type SunsetStoryIntent =
  | 'TICKET_CONVERSION'
  | 'EXPERIENCE'
  | 'INFO_HOURS'
  | 'DRINKS'
  | 'SCENERY'
  | 'LIFESTYLE'
  | 'SOCIAL_MEMORY';

export interface SunsetStoryTemplateProfile {
  readonly templateId: SunsetStoryTemplateId;
  readonly templateClass: SunsetStoryTemplateClass;
  readonly preferredScenes: readonly SunsetStorySceneClass[];
  readonly preferredSubjectKinds: readonly SunsetStorySubjectKind[];
  readonly preferredSubjectZones: readonly SunsetStoryZone[];
  readonly preferredTextSpaceZones: readonly SunsetStoryZone[];
  readonly intents: readonly SunsetStoryIntent[];
  readonly protectedRegions: readonly NormalizedRect[];
  readonly maxPrimarySubjectOverlap: number;
  readonly runtimeEligible: false;
}

function rect(x: number, y: number, width: number, height: number): NormalizedRect {
  return { x, y, width, height };
}

export const SUNSET_STORY_TEMPLATE_REGISTRY: readonly SunsetStoryTemplateProfile[] = [
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V1',
    templateClass: 'SUNSET_HERO_LIFESTYLE',
    preferredScenes: ['PEOPLE_GOLDEN_HOUR', 'LIFESTYLE'],
    preferredSubjectKinds: ['PERSON', 'COUPLE'],
    preferredSubjectZones: ['CENTER_RIGHT', 'BOTTOM_RIGHT'],
    preferredTextSpaceZones: ['TOP_CENTER', 'CENTER_LEFT'],
    intents: ['TICKET_CONVERSION', 'LIFESTYLE', 'EXPERIENCE'],
    protectedRegions: [
      rect(0.08, 0.1, 0.84, 0.25),
      rect(0.06, 0.42, 0.5, 0.25),
      rect(0.08, 0.84, 0.84, 0.11),
    ],
    maxPrimarySubjectOverlap: 0.22,
    runtimeEligible: false,
  },
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V2',
    templateClass: 'SUNSET_INFO_HOURS',
    preferredScenes: ['SCENERY', 'SEA_VIEW', 'PEOPLE_GOLDEN_HOUR'],
    preferredSubjectKinds: ['PERSON', 'SCENERY', 'OTHER'],
    preferredSubjectZones: ['BOTTOM_CENTER', 'BOTTOM_RIGHT'],
    preferredTextSpaceZones: ['TOP_CENTER'],
    intents: ['INFO_HOURS', 'SCENERY'],
    protectedRegions: [rect(0.06, 0.12, 0.9, 0.43), rect(0.15, 0.84, 0.7, 0.11)],
    maxPrimarySubjectOverlap: 0.2,
    runtimeEligible: false,
  },
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V3',
    templateClass: 'SUNSET_HERO_LIFESTYLE',
    preferredScenes: ['PEOPLE_GOLDEN_HOUR', 'LIFESTYLE', 'SOCIAL_EXPERIENCE'],
    preferredSubjectKinds: ['PERSON', 'COUPLE', 'GROUP'],
    preferredSubjectZones: ['CENTER', 'CENTER_LEFT', 'CENTER_RIGHT'],
    preferredTextSpaceZones: ['BOTTOM_CENTER'],
    intents: ['LIFESTYLE', 'EXPERIENCE', 'INFO_HOURS'],
    protectedRegions: [
      rect(0.78, 0.04, 0.2, 0.16),
      rect(0.06, 0.66, 0.88, 0.16),
      rect(0.15, 0.85, 0.7, 0.1),
    ],
    maxPrimarySubjectOverlap: 0.18,
    runtimeEligible: false,
  },
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V4',
    templateClass: 'SUNSET_DRINKS_EXPERIENCE',
    preferredScenes: ['DRINKS', 'LIFESTYLE'],
    preferredSubjectKinds: ['DRINK', 'PERSON', 'OTHER'],
    preferredSubjectZones: ['TOP_CENTER', 'TOP_RIGHT', 'CENTER'],
    preferredTextSpaceZones: ['BOTTOM_CENTER'],
    intents: ['DRINKS', 'TICKET_CONVERSION', 'EXPERIENCE'],
    protectedRegions: [rect(0.09, 0.64, 0.82, 0.21), rect(0.13, 0.86, 0.74, 0.1)],
    maxPrimarySubjectOverlap: 0.2,
    runtimeEligible: false,
  },
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V5',
    templateClass: 'SUNSET_HERO_LIFESTYLE',
    preferredScenes: ['PEOPLE_GOLDEN_HOUR', 'LIFESTYLE'],
    preferredSubjectKinds: ['PERSON', 'COUPLE'],
    preferredSubjectZones: ['CENTER_RIGHT', 'BOTTOM_RIGHT'],
    preferredTextSpaceZones: ['TOP_LEFT', 'CENTER_LEFT'],
    intents: ['TICKET_CONVERSION', 'LIFESTYLE', 'EXPERIENCE'],
    protectedRegions: [
      rect(0.07, 0.16, 0.43, 0.1),
      rect(0.14, 0.6, 0.72, 0.2),
      rect(0.16, 0.86, 0.7, 0.09),
    ],
    maxPrimarySubjectOverlap: 0.16,
    runtimeEligible: false,
  },
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V6',
    templateClass: 'SUNSET_SOCIAL_EXPERIENCE',
    preferredScenes: ['SOCIAL_EXPERIENCE', 'PEOPLE_GOLDEN_HOUR', 'LIFESTYLE'],
    preferredSubjectKinds: ['COUPLE', 'GROUP', 'PERSON'],
    preferredSubjectZones: ['CENTER_RIGHT', 'CENTER', 'BOTTOM_RIGHT'],
    preferredTextSpaceZones: ['TOP_LEFT', 'BOTTOM_CENTER'],
    intents: ['SOCIAL_MEMORY', 'EXPERIENCE', 'TICKET_CONVERSION'],
    protectedRegions: [
      rect(0.06, 0.08, 0.52, 0.13),
      rect(0.12, 0.55, 0.76, 0.21),
      rect(0.15, 0.86, 0.7, 0.09),
    ],
    maxPrimarySubjectOverlap: 0.18,
    runtimeEligible: false,
  },
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V7',
    templateClass: 'SUNSET_SOCIAL_EXPERIENCE',
    preferredScenes: ['SOCIAL_EXPERIENCE', 'PEOPLE_GOLDEN_HOUR', 'LIFESTYLE'],
    preferredSubjectKinds: ['COUPLE', 'GROUP', 'PERSON'],
    preferredSubjectZones: ['CENTER_RIGHT', 'CENTER', 'BOTTOM_RIGHT'],
    preferredTextSpaceZones: ['TOP_LEFT'],
    intents: ['SOCIAL_MEMORY', 'EXPERIENCE', 'TICKET_CONVERSION'],
    protectedRegions: [
      rect(0.06, 0.14, 0.5, 0.16),
      rect(0.12, 0.4, 0.76, 0.24),
      rect(0.15, 0.84, 0.7, 0.1),
    ],
    maxPrimarySubjectOverlap: 0.18,
    runtimeEligible: false,
  },
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V8',
    templateClass: 'SUNSET_HERO_LIFESTYLE',
    preferredScenes: ['PEOPLE_GOLDEN_HOUR', 'LIFESTYLE', 'SEA_VIEW'],
    preferredSubjectKinds: ['PERSON', 'COUPLE', 'SCENERY'],
    preferredSubjectZones: ['CENTER_RIGHT', 'BOTTOM_RIGHT'],
    preferredTextSpaceZones: ['TOP_CENTER', 'CENTER_LEFT'],
    intents: ['TICKET_CONVERSION', 'LIFESTYLE', 'SCENERY'],
    protectedRegions: [
      rect(0.1, 0.15, 0.8, 0.2),
      rect(0.07, 0.42, 0.5, 0.13),
      rect(0.15, 0.84, 0.7, 0.1),
    ],
    maxPrimarySubjectOverlap: 0.18,
    runtimeEligible: false,
  },
  {
    templateId: 'SUNSET_TEMPLATE_MASTER_V9',
    templateClass: 'SUNSET_VIEW_SCENERY',
    preferredScenes: ['SEA_VIEW', 'SCENERY', 'SOCIAL_EXPERIENCE'],
    preferredSubjectKinds: ['SCENERY', 'GROUP', 'COUPLE', 'OTHER'],
    preferredSubjectZones: ['TOP_CENTER', 'TOP_RIGHT', 'TOP_LEFT'],
    preferredTextSpaceZones: ['CENTER', 'CENTER_LEFT', 'CENTER_RIGHT'],
    intents: ['SCENERY', 'EXPERIENCE', 'SOCIAL_MEMORY'],
    protectedRegions: [rect(0.1, 0.39, 0.8, 0.28), rect(0.13, 0.82, 0.74, 0.11)],
    maxPrimarySubjectOverlap: 0.16,
    runtimeEligible: false,
  },
];

export function getSunsetStoryTemplateProfile(
  templateId: SunsetStoryTemplateId,
): SunsetStoryTemplateProfile {
  const profile = SUNSET_STORY_TEMPLATE_REGISTRY.find((item) => item.templateId === templateId);
  if (!profile) throw new Error(`SUNSET_TEMPLATE_NOT_REGISTERED:${templateId}`);
  return profile;
}
