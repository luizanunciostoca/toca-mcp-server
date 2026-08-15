export const GOOGLE_ADS_PHASES = [
  'OFF',
  'READ_ONLY',
  'PREPARE',
  'CREATE_PAUSED',
  'READBACK',
  'MANAGE',
] as const;

export type GoogleAdsPhase = (typeof GOOGLE_ADS_PHASES)[number];

const rank = new Map<GoogleAdsPhase, number>(GOOGLE_ADS_PHASES.map((phase, index) => [phase, index]));

export function isGoogleAdsPhase(value: string): value is GoogleAdsPhase {
  return GOOGLE_ADS_PHASES.includes(value as GoogleAdsPhase);
}

export function googleAdsPhaseAtLeast(current: GoogleAdsPhase, required: GoogleAdsPhase): boolean {
  return (rank.get(current) ?? -1) >= (rank.get(required) ?? Number.MAX_SAFE_INTEGER);
}
