export type InstagramCapability =
  | 'instagram.profile.read'
  | 'instagram.media.read'
  | 'instagram.comments.read'
  | 'instagram.insights.read'
  | 'instagram.publish.image'
  | 'instagram.publish.carousel'
  | 'instagram.publish.reel'
  | 'instagram.publish.story'
  | 'instagram.comments.reply';

export interface InstagramCapabilityEvidence {
  readonly scopes: readonly string[];
  readonly accountEligible: boolean;
  readonly providerEvidence: readonly string[];
}

export function discoverInstagramCapabilities(
  evidence: InstagramCapabilityEvidence,
): readonly InstagramCapability[] {
  if (!evidence.accountEligible) return [];
  const capabilities = new Set<InstagramCapability>();
  const has = (scope: string) => evidence.scopes.includes(scope);
  const proved = (capability: InstagramCapability) =>
    evidence.providerEvidence.includes(capability);

  if (has('instagram_basic') && proved('instagram.profile.read'))
    capabilities.add('instagram.profile.read');
  if (has('instagram_basic') && proved('instagram.media.read'))
    capabilities.add('instagram.media.read');
  if (proved('instagram.comments.read')) capabilities.add('instagram.comments.read');
  if (proved('instagram.insights.read')) capabilities.add('instagram.insights.read');

  for (const capability of [
    'instagram.publish.image',
    'instagram.publish.carousel',
    'instagram.publish.reel',
    'instagram.publish.story',
    'instagram.comments.reply',
  ] as const) {
    if (proved(capability)) capabilities.add(capability);
  }

  return [...capabilities].sort();
}
