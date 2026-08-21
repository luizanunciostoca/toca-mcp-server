import { EnvSecretResolver, type SecretReference } from './core/secrets.js';
import {
  GoogleAdsRestApiClient,
  normalizeCustomerId,
  type GoogleAdsApiResponse,
} from './providers/google-ads/google-ads-api-client.js';
import { GoogleAdsAccountVerifier } from './providers/google-ads/google-ads-account-verifier.js';
import {
  GoogleAdsPaidMediaProvider,
  type GoogleAdsCampaignPlan,
} from './providers/google-ads/google-ads-paid-media.js';

const sourceSha = requiredEnv('SOURCE_SHA');
const verificationId = requiredEnv('GOOGLE_ADS_VERIFICATION_ID');
const runtimeIdentity = requiredEnv('RUNTIME_SERVICE_ACCOUNT');
const allowedCurrency = requiredEnv('GOOGLE_ADS_ALLOWED_CURRENCY').toUpperCase();
const maxDailyBudgetMicros = positiveInt(requiredEnv('GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS'));
const currencyMinorUnitMicros = positiveInt(requiredEnv('GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS'));
const allowedLocations = csv(requiredEnv('GOOGLE_ADS_ALLOWED_LOCATION_CRITERION_IDS'));
const allowedLanguages = csv(optionalEnv('GOOGLE_ADS_ALLOWED_LANGUAGE_CRITERION_IDS'));
const configuredCustomerId = optionalEnv('GOOGLE_ADS_CUSTOMER_ID');
const configuredLoginCustomerId = optionalEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID');

if (!/^[A-Z]{3}$/.test(allowedCurrency)) throw new Error('GOOGLE_ADS_VERIFY_CURRENCY_INVALID');
if (allowedLocations.length === 0) throw new Error('GOOGLE_ADS_VERIFY_LOCATION_ALLOWLIST_REQUIRED');

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
if (accessibleCustomers.length === 0) throw new Error('GOOGLE_ADS_VERIFY_NO_ACCESSIBLE_CUSTOMERS');

const selectedCustomerId = selectCustomer(configuredCustomerId, accessibleCustomers);
const loginCustomerId = configuredLoginCustomerId
  ? normalizeCustomerId(configuredLoginCustomerId)
  : undefined;

if (loginCustomerId && !accessibleCustomers.includes(loginCustomerId)) {
  throw new Error('GOOGLE_ADS_VERIFY_LOGIN_CUSTOMER_NOT_DIRECTLY_ACCESSIBLE');
}
if (!loginCustomerId && !accessibleCustomers.includes(selectedCustomerId)) {
  throw new Error('GOOGLE_ADS_VERIFY_SELECTED_CUSTOMER_REQUIRES_LOGIN_CUSTOMER');
}

const api = new GoogleAdsRestApiClient(
  {
    apiVersion: 'v25',
    customerId: selectedCustomerId,
    ...(loginCustomerId ? { loginCustomerId } : {}),
    developerTokenRef,
    oauthRefresh: { clientIdRef, clientSecretRef, refreshTokenRef },
  },
  secrets,
);

const accountVerifier = new GoogleAdsAccountVerifier(api, {
  customerId: selectedCustomerId,
  allowedCurrency,
});
const accountVerification = await accountVerifier.verifyAccount();
if (!accountVerification.verified) {
  throw new Error(`GOOGLE_ADS_VERIFY_ACCOUNT_BLOCKED:${accountVerification.blockers.join(',')}`);
}

const provider = new GoogleAdsPaidMediaProvider(api, {
  allowedCustomerId: selectedCustomerId,
  allowedCurrency,
  maxDailyBudgetMicros,
  currencyMinorUnitMicros,
  allowedLocationCriterionIds: allowedLocations,
  ...(allowedLanguages.length > 0 ? { allowedLanguageCriterionIds: allowedLanguages } : {}),
  allowedAdvertisingChannelTypes: ['SEARCH'],
});

const account = await provider.inspectAccount();
const campaigns = await provider.listCampaigns(25);
const dateRange = trailingDateRange(30);
const insights = await provider.getInsights(dateRange.startDate, dateRange.endDate, 100);
const conversionActions = await provider.listConversionActions(100);

const validationPlan: GoogleAdsCampaignPlan = {
  customerId: selectedCustomerId,
  currencyCode: allowedCurrency,
  campaignName: `TOCA | Provider Verify | ${verificationId}`,
  budgetName: `TOCA | Provider Verify Budget | ${verificationId}`,
  dailyBudgetMicros: Math.min(maxDailyBudgetMicros, Math.max(currencyMinorUnitMicros, 1_000_000)),
  advertisingChannelType: 'SEARCH',
  targeting: {
    locationCriterionIds: allowedLocations,
    ...(allowedLanguages.length > 0 ? { languageCriterionIds: allowedLanguages } : {}),
    presenceOnly: true,
  },
};
const prepared = provider.prepare(validationPlan);
const targetingValidation = await provider.validateTargeting(validationPlan);
if (targetingValidation.valid !== true || targetingValidation.sideEffects !== false) {
  throw new Error('GOOGLE_ADS_VERIFY_TARGETING_VALIDATE_ONLY_NOT_PROVEN');
}

const evidence = {
  schemaVersion: 1,
  sourceSha,
  verificationId,
  verifiedAt: new Date().toISOString(),
  provider: 'Google Ads API',
  apiVersion: 'v25',
  runtimeIdentity,
  credentials: {
    developerTokenAccepted: true,
    oauthRefreshAccepted: true,
    secretValuesExposed: false,
  },
  discovery: {
    requestId: discovery.requestId ?? null,
    accessibleCustomers,
    selectedCustomerId,
    loginCustomerId: loginCustomerId ?? null,
    selectedCustomerDirectlyAccessible: accessibleCustomers.includes(selectedCustomerId),
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
  prepare: {
    status: prepared.status,
    requestSha256: prepared.requestSha256,
  },
  targetingValidation: {
    valid: targetingValidation.valid,
    sideEffects: targetingValidation.sideEffects,
    requestSha256: targetingValidation.requestSha256,
    requestId: targetingValidation.requestId ?? null,
  },
  mutation: {
    createPausedExecuted: false,
    activateExecuted: false,
    spendGeneratedForVerification: false,
  },
  providerVerifiedEligibleForReadGate: true,
};

console.log(`GOOGLE_ADS_PROVIDER_READ_RESULT=${JSON.stringify(evidence)}`);

function envSecretRef(key: string): SecretReference {
  return { provider: 'env', key };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`GOOGLE_ADS_VERIFY_CONFIG_MISSING:${name}`);
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error('GOOGLE_ADS_VERIFY_POSITIVE_INT_REQUIRED');
  return parsed;
}

function csv(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
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

function selectCustomer(configured: string | undefined, accessible: readonly string[]): string {
  if (configured) return normalizeCustomerId(configured);
  if (accessible.length !== 1) throw new Error('GOOGLE_ADS_VERIFY_SELECTED_CUSTOMER_REQUIRED');
  return accessible[0] as string;
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
