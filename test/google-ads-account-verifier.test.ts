import { describe, expect, it } from 'vitest';
import type { GoogleAdsApiClient } from '../src/providers/google-ads/google-ads-api-client.js';
import { GoogleAdsAccountVerifier } from '../src/providers/google-ads/google-ads-account-verifier.js';

class FakeGoogleAdsAccountApi implements GoogleAdsApiClient {
  constructor(
    private readonly accountStatus: string,
    private readonly billingStatus: string,
    private readonly currencyCode = 'BRL',
  ) {}

  async listAccessibleCustomers() {
    await Promise.resolve();
    return {
      body: { resourceNames: ['customers/9998887777'] },
      requestId: 'req-discovery',
    };
  }

  async search(query: string) {
    await Promise.resolve();
    if (query.includes('FROM billing_setup')) {
      return {
        body: { results: [{ billingSetup: { id: '1', status: this.billingStatus } }] },
        requestId: 'req-billing',
      };
    }
    return {
      body: {
        results: [
          {
            customer: {
              id: '1234567890',
              status: this.accountStatus,
              currencyCode: this.currencyCode,
              manager: false,
              testAccount: false,
            },
          },
        ],
      },
      requestId: 'req-account',
    };
  }

  async mutate() {
    await Promise.resolve();
    return { body: {} };
  }
}

describe('Google Ads account verifier', () => {
  it('verifies the configured target using real read semantics even when it is reached through a manager', async () => {
    const verifier = new GoogleAdsAccountVerifier(
      new FakeGoogleAdsAccountApi('ENABLED', 'APPROVED'),
      { customerId: '123-456-7890', allowedCurrency: 'BRL' },
    );

    const result = await verifier.verifyAccount();

    expect(result.verified).toBe(true);
    expect(result.permissions.oauthCustomerDiscovery).toBe(true);
    expect(result.permissions.targetRead).toBe(true);
    expect(result.evidence).toContain('google_ads:oauth_direct_customer=false');
    expect(result.billingStatuses).toEqual(['APPROVED']);
  });

  it('fails closed for suspended, unbilled or wrong-currency accounts', async () => {
    const verifier = new GoogleAdsAccountVerifier(
      new FakeGoogleAdsAccountApi('SUSPENDED', 'PENDING', 'USD'),
      { customerId: '1234567890', allowedCurrency: 'BRL' },
    );

    const result = await verifier.verifyAccount();

    expect(result.verified).toBe(false);
    expect(result.blockers).toEqual([
      'GOOGLE_ADS_ACCOUNT_NOT_ENABLED',
      'GOOGLE_ADS_CURRENCY_MISMATCH',
      'GOOGLE_ADS_BILLING_NOT_APPROVED',
    ]);
  });

  it('discovers OAuth-direct customers without treating discovery as activation authority', async () => {
    const verifier = new GoogleAdsAccountVerifier(
      new FakeGoogleAdsAccountApi('ENABLED', 'APPROVED'),
      { customerId: '1234567890', allowedCurrency: 'BRL' },
    );

    const discovery = await verifier.discoverCustomers();

    expect(discovery.resourceNames).toEqual(['customers/9998887777']);
    expect(discovery.requestId).toBe('req-discovery');
  });
});
