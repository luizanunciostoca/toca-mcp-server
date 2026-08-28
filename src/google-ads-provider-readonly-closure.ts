import { EnvSecretResolver, type SecretReference } from './core/secrets.js';
import {
  GoogleAdsRestApiClient,
  normalizeCustomerId,
  type GoogleAdsApiResponse,
} from './providers/google-ads/google-ads-api-client.js';
import { GoogleAdsAccountVerifier } from './providers/google-ads/google-ads-account-verifier.js';
import { GoogleAdsPaidMediaProvider } from './providers/google-ads/google-ads-paid-media.js';

const sourceSha = requiredEnv('SOURCE_SHA');
const verificationId = requiredEnv('GOOGLE_ADS_VERIFICATION_ID');
const runtimeIdentity = requiredEnv('RUNTIME_SERVICE_ACCOUNT');
const configuredCustomerId = normalizeCustomerId(requiredEnv('GOOGLE_ADS_CUSTOMER_ID'));
const configuredLoginCustomerId = optionalEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID');
const allowedCurrency = requiredEnv('GOOGLE_ADS_ALLOWED_CURRENCY').toUpperCase();

const secrets = new EnvSecretResolver(process.env);
const developerTokenRef = envSecretRef(requiredEnv('GOOGLE_ADS_DEVELOPER_TOKEN_ENV_KEY'));
const clientIdRef = envSecretRef(requiredEnv('GOOGLE_ADS_OAUTH_CLIENT_ID_ENV_KEY'));
const clientSecretRef = envSecretRef(requiredEnv('GOOGLE_ADS_OAUTH_CLIENT_SECRET_ENV_KEY'));
const refreshTokenRef = envSecretRef(requiredEnv('GOOGLE_ADS_OAUTH_REFRESH_TOKEN_ENV_KEY'));

const discoveryApi = new GoogleAdsRestApiClient(
  {
    apiVersion: 'v25',
    developerTokenRef,
    oauthRefresh: { clientIdRef, clientSecretRef, refreshTokenRef },
  },
  secrets,
);

const discovery = await discoveryApi.listAccessibleCustomers();
const accessibleCustomers = normalizeAccessibleCustomers(discovery);
if (accessibleCustomers.length === 0) throw new Error('GOOGLE_ADS_READONLY_NO_ACCESSIBLE_CUSTOMERS');

const loginCustomerId = configuredLoginCustomerId
  ? normalizeCustomerId(configuredLoginCustomerId)
  : undefined;

if (!loginCustomerId && !accessibleCustomers.includes(configuredCustomerId)) {
  throw new Error(
    `GOOGLE_ADS_READONLY_LOGIN_CUSTOMER_REQUIRED:target=${configuredCustomerId}:accessible=${accessibleCustomers.join(',')}`,
  );
}

const api = new GoogleAdsRestApiClient(
  {
    apiVersion: 'v25',
    customerId: configuredCustomerId,
    ...(loginCustomerId ? { loginCustomerId } : {}),
    developerTokenRef,
    oauthRefresh: { clientIdRef, clientSecretRef, refreshTokenRef },
  },
  secrets,
);

const accountVerifier = new GoogleAdsAccountVerifier(api, {
  customerId: configuredCustomerId,
  allowedCurrency,
});
const accountVerification = await accountVerifier.verifyAccount();
if (!accountVerification.verified) {
  throw new Error(`GOOGLE_ADS_READONLY_ACCOUNT_BLOCKED:${accountVerification.blockers.join(',')}`);
}

// Deliberately configure a provider with inert write guardrails. No prepare, validate-only,
// create, activate, or spend-producing method is invoked by this closure proof.
const provider = new GoogleAdsPaidMediaProvider(api, {
  allowedCustomerId: configuredCustomerId,
  allowedCurrency,
  maxDailyBudgetMicros: 1_000_000,
  currencyMinorUnitMicros: 1_000_000,
  allowedLocationCriterionIds: ['2076'],
  allowedAdvertisingChannelTypes: ['SEARCH'],
});

const account = await provider.inspectAccount();
const campaigns = await provider.listCampaigns(25);
const dateRange = trailingDateRange(30);
const insights = await provider.getInsights(dateRange.startDate, dateRange.endDate, 100);
const conversionActions = await provider.listConversionActions(100);

const evidence = {
  schemaVersion: 1,
  sourceSha,
  verificationId,
  verifiedAt: new Date().toISOString(),
  provider: 'Google Ads API',
  apiVersion: 'v25',
  runtimeIdentity,
  route: 'R28',
  mode: 'READ_ONLY_PROVIDER_CLOSURE',
  credentials: {
    developerTokenAccepted: true,
    oauthRefreshAccepted: true,
    secretValuesExposed: false,
  },
  discovery: {
    requestId: discovery.requestId ?? null,
    accessibleCustomers,
    selectedCustomerId: configuredCustomerId,
    loginCustomerId: loginCustomerId ?? null,
    selectedCustomerDirectlyAccessible: accessibleCustomers.includes(configuredCustomerId),
  },
  accountVerification,
  reads: {
    account: summarizeResult(account),
    campaigns: summarizeRows(campaigns),
    insights: {
      ...summarizeRows(insights),
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    },
    conversionActions: summarizeRows(conversionActions),
  },
  mutation: {
    prepareExecuted: false,
    validateOnlyExecuted: false,
    createPausedExecuted: false,
    activateExecuted: false,
    spendGeneratedForVerification: false,
  },
  externalSideEffectExecuted: false,
  providerVerifiedEligibleForReadGate: true,
};

console.log(`GOOGLE_ADS_PROVIDER_READONLY_CLOSURE=${JSON.stringify(evidence)}`);

function envSecretRef(key: string): SecretReference {
  return { provider: 'env', key };
}
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`GOOGLE_ADS_READONLY_CONFIG_MISSING:${name}`);
  return value;
}
function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
function normalizeAccessibleCustomers(
  response: GoogleAdsApiResponse<{ resourceNames?: string[] }>,
): string[] {
  return [
    ...new Set(
      (response.body.resourceNames ?? [])
        .filter((name) => /^customers\/\d{10}$/.test(name))
        .map((name) => normalizeCustomerId(name.slice('customers/'.length))),
    ),
  ].sort();
}
function trailingDateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function summarizeResult(value: Record<string, unknown>): Record<string, unknown> {
  return {
    requestId: typeof value.requestId === 'string' ? value.requestId : null,
    resultCount: Array.isArray(value.results) ? value.results.length : null,
  };
}
function summarizeRows(value: Record<string, unknown>): Record<string, unknown> {
  return summarizeResult(value);
}
