export const SUNSET_STORY_ZONES = [
  'TOP_LEFT',
  'TOP_CENTER',
  'TOP_RIGHT',
  'CENTER_LEFT',
  'CENTER',
  'CENTER_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_CENTER',
  'BOTTOM_RIGHT',
] as const;

export type SunsetStoryZone = (typeof SUNSET_STORY_ZONES)[number];

export type SunsetStorySubjectKind =
  'PERSON' | 'COUPLE' | 'GROUP' | 'DRINK' | 'SCENERY' | 'ARCHITECTURE' | 'OTHER';

export type SunsetStorySceneClass =
  | 'PEOPLE_GOLDEN_HOUR'
  | 'SOCIAL_EXPERIENCE'
  | 'SEA_VIEW'
  | 'DRINKS'
  | 'LIFESTYLE'
  | 'SCENERY'
  | 'ARCHITECTURE'
  | 'UNKNOWN';

export type SunsetStoryBrightness = 'DARK' | 'MEDIUM' | 'BRIGHT';

export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SunsetStoryObservedSubject {
  readonly kind: SunsetStorySubjectKind;
  readonly box: NormalizedRect;
  readonly salience: number;
}

export interface SunsetStoryImageObservation {
  readonly width: number;
  readonly height: number;
  readonly subjects: readonly SunsetStoryObservedSubject[];
  readonly negativeSpaceZones: readonly SunsetStoryZone[];
  readonly regionLuma: Readonly<Partial<Record<SunsetStoryZone, number>>>;
  readonly warmth: number;
  readonly crop9x16Fitness: number;
  readonly horizonY: number | null;
  readonly sceneHints: readonly SunsetStorySceneClass[];
}

export interface SunsetStoryImageProfile {
  readonly width: number;
  readonly height: number;
  readonly sourceAspectRatio: number;
  readonly primarySubject: SunsetStoryObservedSubject | null;
  readonly primarySubjectZone: SunsetStoryZone | null;
  readonly negativeSpaceZones: readonly SunsetStoryZone[];
  readonly regionLuma: Readonly<Partial<Record<SunsetStoryZone, number>>>;
  readonly warmth: number;
  readonly crop9x16Fitness: number;
  readonly horizonY: number | null;
  readonly sceneClass: SunsetStorySceneClass;
  readonly brightness: SunsetStoryBrightness;
}

function assertFinitePositive(value: number, code: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
}

function assertUnit(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(code);
}

function assertScore(value: number, code: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(code);
}

function assertRect(rect: NormalizedRect): void {
  assertUnit(rect.x, 'SUNSET_IMAGE_RECT_X_INVALID');
  assertUnit(rect.y, 'SUNSET_IMAGE_RECT_Y_INVALID');
  assertUnit(rect.width, 'SUNSET_IMAGE_RECT_WIDTH_INVALID');
  assertUnit(rect.height, 'SUNSET_IMAGE_RECT_HEIGHT_INVALID');
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    rect.x + rect.width > 1 ||
    rect.y + rect.height > 1
  ) {
    throw new Error('SUNSET_IMAGE_RECT_OUT_OF_BOUNDS');
  }
}

export function zoneForPoint(x: number, y: number): SunsetStoryZone {
  assertUnit(x, 'SUNSET_IMAGE_POINT_X_INVALID');
  assertUnit(y, 'SUNSET_IMAGE_POINT_Y_INVALID');
  const horizontal = x < 1 / 3 ? 'LEFT' : x < 2 / 3 ? 'CENTER' : 'RIGHT';
  const vertical = y < 1 / 3 ? 'TOP' : y < 2 / 3 ? 'CENTER' : 'BOTTOM';
  if (vertical === 'CENTER' && horizontal === 'CENTER') return 'CENTER';
  return `${vertical}_${horizontal}` as SunsetStoryZone;
}

function resolveSceneClass(
  observation: SunsetStoryImageObservation,
  primarySubject: SunsetStoryObservedSubject | null,
): SunsetStorySceneClass {
  const explicit = observation.sceneHints[0];
  if (explicit) return explicit;
  if (primarySubject?.kind === 'DRINK') return 'DRINKS';
  if (primarySubject?.kind === 'COUPLE' || primarySubject?.kind === 'GROUP') {
    return 'SOCIAL_EXPERIENCE';
  }
  if (primarySubject?.kind === 'PERSON') {
    return observation.warmth >= 0.55 ? 'PEOPLE_GOLDEN_HOUR' : 'LIFESTYLE';
  }
  if (primarySubject?.kind === 'ARCHITECTURE') return 'ARCHITECTURE';
  if (primarySubject?.kind === 'SCENERY')
    return observation.horizonY === null ? 'SCENERY' : 'SEA_VIEW';
  if (observation.horizonY !== null) return 'SEA_VIEW';
  return 'UNKNOWN';
}

function resolveBrightness(
  regionLuma: Readonly<Partial<Record<SunsetStoryZone, number>>>,
): SunsetStoryBrightness {
  const values = Object.values(regionLuma);
  if (values.length === 0) return 'MEDIUM';
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (average <= 0.35) return 'DARK';
  if (average >= 0.68) return 'BRIGHT';
  return 'MEDIUM';
}

export function buildSunsetStoryImageProfile(
  observation: SunsetStoryImageObservation,
): SunsetStoryImageProfile {
  assertFinitePositive(observation.width, 'SUNSET_IMAGE_WIDTH_INVALID');
  assertFinitePositive(observation.height, 'SUNSET_IMAGE_HEIGHT_INVALID');
  assertUnit(observation.warmth, 'SUNSET_IMAGE_WARMTH_INVALID');
  assertScore(observation.crop9x16Fitness, 'SUNSET_IMAGE_CROP_FITNESS_INVALID');
  if (observation.horizonY !== null)
    assertUnit(observation.horizonY, 'SUNSET_IMAGE_HORIZON_INVALID');

  for (const subject of observation.subjects) {
    assertRect(subject.box);
    assertUnit(subject.salience, 'SUNSET_IMAGE_SUBJECT_SALIENCE_INVALID');
  }
  for (const value of Object.values(observation.regionLuma)) {
    assertUnit(value, 'SUNSET_IMAGE_LUMA_INVALID');
  }

  const primarySubject = observation.subjects.reduce<SunsetStoryObservedSubject | null>(
    (best, subject) => (best === null || subject.salience > best.salience ? subject : best),
    null,
  );
  const primarySubjectZone =
    primarySubject === null
      ? null
      : zoneForPoint(
          primarySubject.box.x + primarySubject.box.width / 2,
          primarySubject.box.y + primarySubject.box.height / 2,
        );

  return {
    width: observation.width,
    height: observation.height,
    sourceAspectRatio: observation.width / observation.height,
    primarySubject,
    primarySubjectZone,
    negativeSpaceZones: [...new Set(observation.negativeSpaceZones)],
    regionLuma: observation.regionLuma,
    warmth: observation.warmth,
    crop9x16Fitness: observation.crop9x16Fitness,
    horizonY: observation.horizonY,
    sceneClass: resolveSceneClass(observation, primarySubject),
    brightness: resolveBrightness(observation.regionLuma),
  };
}
