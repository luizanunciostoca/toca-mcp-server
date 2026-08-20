import type { GoogleAdsApiClient, GoogleAdsApiResponse } from './google-ads-api-client.js';
import { normalizeCustomerId } from './google-ads-api-client.js';

export interface GoogleAdsAccountVerifierConfig {
  readonly customerId: string;
  readonly allowedCurrency: string;
}

export interface GoogleAdsCustomerDiscovery {
  readonly resourceNames: readonly string[];
  readonly requestId?: string;
}

export interface GoogleAdsAccountVerification {
  readonly verified: boolean;
  readonly customerId: string;
  readonly accountStatus: string | null;
  readonly currencyCode: string | null;
  readonly billingStatuses: readonly string[];
  readonly permissions: {
    readonly oauthCustomerDiscovery: boolean;
    readonly targetRead: boolean;
  };
  readonly blockers: readonly string[];
  readonly evidence: readonly string[];
}

function rows(
  response: GoogleAdsApiResponse<Record<string, unknown>>,
): readonly Record<string, unknown>[] {
  const rawResults = response.body.results;
  if (!Array.isArray(rawResults)) return [];
  return rawResults.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

function recordField(
  row: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = row?.[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

export class GoogleAdsAccountVerifier {
  readonly #customerId: string;
  readonly #allowedCurrency: string;

  constructor(
    private readonly api: GoogleAdsApiClient,
    config: GoogleAdsAccountVerifierConfig,
  ) {
    this.#customerId = normalizeCustomerId(config.customerId);
    this.#allowedCurrency = config.allowedCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(this.#allowedCurrency)) throw new Error('GOOGLE_ADS_CURRENCY_INVALID');
  }

  async discoverCustomers(): Promise<GoogleAdsCustomerDiscovery> {
    const response = await this.api.listAccessibleCustomers();
    const resourceNames = (response.body.resourceNames ?? []).filter((name) =>
      /^customers\/\d{10}$/.test(name),
    );
    return { resourceNames, ...(response.requestId ? { requestId: response.requestId } : {}) };
  }

  async verifyAccount(): Promise<GoogleAdsAccountVerification> {
    const discovery = await this.discoverCustomers();
    const accountResponse = await this.api.search(
      'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account, customer.status FROM customer LIMIT 1',
    );
    const account = recordField(rows(accountResponse)[0], 'customer');
    const readCustomerId = stringField(account, 'id');
    const accountStatus = stringField(account, 'status');
    const currencyCode = stringField(account, 'currencyCode');
    const blockers: string[] = [];

    if (readCustomerId === null || normalizeCustomerId(readCustomerId) !== this.#customerId) {
      blockers.push('GOOGLE_ADS_TARGET_CUSTOMER_MISMATCH');
    }
    if (accountStatus !== 'ENABLED') blockers.push('GOOGLE_ADS_ACCOUNT_NOT_ENABLED');
    if (currencyCode?.toUpperCase() !== this.#allowedCurrency)
      blockers.push('GOOGLE_ADS_CURRENCY_MISMATCH');

    const billingResponse = await this.api.search(
      "SELECT billing_setup.id, billing_setup.status, billing_setup.start_date_time, billing_setup.end_date_time FROM billing_setup WHERE billing_setup.status != 'CANCELLED' ORDER BY billing_setup.start_date_time DESC LIMIT 20",
    );
    const billingStatuses = rows(billingResponse)
      .map((row) => stringField(recordField(row, 'billingSetup'), 'status'))
      .filter((status): status is string => status !== null);
    if (!billingStatuses.includes('APPROVED')) blockers.push('GOOGLE_ADS_BILLING_NOT_APPROVED');

    const targetResource = `customers/${this.#customerId}`;
    const evidence = [
      ...(discovery.requestId
        ? [`google_ads:customer_discovery:request_id=${discovery.requestId}`]
        : []),
      ...(accountResponse.requestId
        ? [`google_ads:account_read:request_id=${accountResponse.requestId}`]
        : []),
      ...(billingResponse.requestId
        ? [`google_ads:billing_read:request_id=${billingResponse.requestId}`]
        : []),
      `google_ads:oauth_direct_customer=${discovery.resourceNames.includes(targetResource)}`,
      `google_ads:account_status=${accountStatus ?? 'UNRESOLVED'}`,
      `google_ads:billing_statuses=${billingStatuses.join(',') || 'UNRESOLVED'}`,
    ];

    return {
      verified: blockers.length === 0,
      customerId: this.#customerId,
      accountStatus,
      currencyCode,
      billingStatuses,
      permissions: {
        oauthCustomerDiscovery: discovery.resourceNames.length > 0,
        targetRead: readCustomerId !== null,
      },
      blockers,
      evidence,
    };
  }
}
