import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/ops/configure-instagram-engagement-meta-subscriptions.ts',
  'utf8',
);

describe('Instagram engagement Meta subscription boundary', () => {
  it('uses the Facebook Login Page-bound subscription model', () => {
    expect(source).toContain("subscriptionModel: 'FACEBOOK_LOGIN_PAGE_BOUND'");
    expect(source).toContain("object: 'instagram'");
    expect(source).toContain('${graphBaseUrl}/${apiVersion}/${pageId}/subscribed_apps');
    expect(source).toContain("subscribed_fields: 'messages'");
    expect(source).toContain('await assertAssetSubscription(pageId, pageAccessToken, appId);');
  });

  it('does not mix the Instagram Login account subscription into the Page-token flow', () => {
    expect(source).not.toContain("requiredEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID')");
    expect(source).not.toContain(
      '${graphBaseUrl}/${apiVersion}/${instagramAccountId}/subscribed_apps',
    );
    expect(source).not.toContain('assertAssetSubscription(instagramAccountId');
    expect(source).toContain('instagramAccountSubscriptionRequired: false');
    expect(source).toContain('instagramAccountSubscriptionAttempted: false');
  });

  it('preserves backwards-compatible aggregate evidence while making the model explicit', () => {
    expect(source).toContain('appSubscriptionConfigured: true');
    expect(source).toContain('pageSubscriptionConfigured: true');
    expect(source).toContain('instagramSubscriptionConfigured: true');
    expect(source).toContain('pageAccessTokenResolved: true');
    expect(source).toContain('secretsPrinted: false');
  });
});
