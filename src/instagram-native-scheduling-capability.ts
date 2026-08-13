export type ProviderNativeSchedulingCapability = {
  platform: 'INSTAGRAM' | 'FACEBOOK';
  surface: 'ORGANIC_FEED' | 'REELS' | 'STORY';
  providerNativeScheduling: 'SUPPORTED' | 'UNAVAILABLE';
  evidence: string;
};

export const PROVIDER_NATIVE_SCHEDULING_MATRIX: readonly ProviderNativeSchedulingCapability[] = [
  {
    platform: 'INSTAGRAM',
    surface: 'ORGANIC_FEED',
    providerNativeScheduling: 'UNAVAILABLE',
    evidence:
      'Official Instagram API publishing flow exposes media container creation followed by media_publish; no provider-native scheduling endpoint is documented.',
  },
  {
    platform: 'INSTAGRAM',
    surface: 'REELS',
    providerNativeScheduling: 'UNAVAILABLE',
    evidence:
      'Official Instagram Reels publishing flow exposes container upload/status followed by media_publish; no provider-native scheduling endpoint is documented.',
  },
  {
    platform: 'INSTAGRAM',
    surface: 'STORY',
    providerNativeScheduling: 'UNAVAILABLE',
    evidence:
      'Instagram Stories publishing is supported for eligible business accounts, but no provider-native scheduling API endpoint is documented.',
  },
  {
    platform: 'FACEBOOK',
    surface: 'REELS',
    providerNativeScheduling: 'SUPPORTED',
    evidence:
      'Official Facebook Reels publishing API documents video_state values including DRAFT, SCHEDULED and PUBLISHED for Facebook Page reels.',
  },
] as const;

export function getProviderNativeSchedulingCapability(input: {
  platform: 'INSTAGRAM' | 'FACEBOOK';
  surface: 'ORGANIC_FEED' | 'REELS' | 'STORY';
}): ProviderNativeSchedulingCapability | undefined {
  return PROVIDER_NATIVE_SCHEDULING_MATRIX.find(
    (entry) => entry.platform === input.platform && entry.surface === input.surface,
  );
}

export function assertInstagramNativeSchedulingAvailable(surface: 'ORGANIC_FEED' | 'REELS' | 'STORY'): void {
  const capability = getProviderNativeSchedulingCapability({ platform: 'INSTAGRAM', surface });
  if (!capability || capability.providerNativeScheduling !== 'SUPPORTED') {
    throw new Error('INSTAGRAM_NATIVE_SCHEDULING_API_UNAVAILABLE');
  }
}
