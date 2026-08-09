export type InstagramCapability =
  | 'instagram.profile.read'
  | 'instagram.media.read'
  | 'instagram.comments.read'
  | 'instagram.insights.read'
  | 'instagram.publish.image'
  | 'instagram.publish.carousel'
  | 'instagram.publish.reel'
  | 'instagram.publish.story'
  | 'instagram.comments.reply'
  | 'instagram.messaging.conversations.read'
  | 'instagram.messaging.messages.read'
  | 'instagram.messaging.reply'
  | 'instagram.messaging.private_reply'
  | 'instagram.engagement.webhook.receive';

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

  if (
    (has('instagram_basic') || has('instagram_business_basic')) &&
    proved('instagram.profile.read')
  )
    capabilities.add('instagram.profile.read');
  if ((has('instagram_basic') || has('instagram_business_basic')) && proved('instagram.media.read'))
    capabilities.add('instagram.media.read');

  const canManageComments =
    has('instagram_manage_comments') || has('instagram_business_manage_comments');
  const canManageMessages =
    has('instagram_manage_messages') || has('instagram_business_manage_messages');

  if (proved('instagram.comments.read')) capabilities.add('instagram.comments.read');
  if (proved('instagram.insights.read')) capabilities.add('instagram.insights.read');

  for (const capability of [
    'instagram.publish.image',
    'instagram.publish.carousel',
    'instagram.publish.reel',
    'instagram.publish.story',
  ] as const) {
    if (proved(capability)) capabilities.add(capability);
  }

  if (canManageComments && proved('instagram.comments.reply'))
    capabilities.add('instagram.comments.reply');

  if (canManageMessages) {
    for (const capability of [
      'instagram.messaging.conversations.read',
      'instagram.messaging.messages.read',
      'instagram.messaging.reply',
      'instagram.messaging.private_reply',
    ] as const) {
      if (proved(capability)) capabilities.add(capability);
    }
  }

  if (proved('instagram.engagement.webhook.receive'))
    capabilities.add('instagram.engagement.webhook.receive');

  return [...capabilities].sort();
}
