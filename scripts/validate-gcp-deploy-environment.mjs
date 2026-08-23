import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const environment = requireValue('DEPLOY_ENVIRONMENT');
if (environment !== 'staging' && environment !== 'production') {
  fail('DEPLOY_ENVIRONMENT_INVALID', `unsupported environment ${environment}`);
}

const requiredRuntimeCoordinates = [
  'GCP_PROJECT_ID',
  'GCP_PROJECT_NUMBER',
  'GCP_REGION',
  'GCP_ARTIFACT_REPOSITORY',
  'GCP_CLOUD_SQL_INSTANCE',
  'GCP_CLOUD_RUN_MCP_SERVICE',
  'GCP_CLOUD_RUN_WEBHOOK_SERVICE',
  'GCP_WORKLOAD_IDENTITY_PROVIDER',
  'GCP_DEPLOY_SERVICE_ACCOUNT',
  'GCP_MCP_RUNTIME_SERVICE_ACCOUNT',
  'GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT',
  'GCP_DATABASE_URL_SECRET',
  'GCP_DATABASE_URL_SECRET_VERSION',
];
for (const key of requiredRuntimeCoordinates) requireValue(key);

assertDistinct(
  'MCP_WEBHOOK_CLOUD_RUN_SERVICE',
  requireValue('GCP_CLOUD_RUN_MCP_SERVICE'),
  requireValue('GCP_CLOUD_RUN_WEBHOOK_SERVICE'),
);
requireProjectLocalSecretId('GCP_DATABASE_URL_SECRET');
validateProviderMode();
validateEnabledProviderSecretIds();
validateSecretVersions();

if (environment === 'production' && process.env.GCP_DATABASE_URL_SECRET_VERSION === 'latest') {
  fail(
    'PRODUCTION_DATABASE_SECRET_VERSION_MUST_BE_PINNED',
    'GCP_DATABASE_URL_SECRET_VERSION cannot be latest in production',
  );
}

if (environment === 'staging') validateStagingIsolation();

console.log(`GCP_DEPLOY_ENVIRONMENT_VALIDATED=${environment}`);

function validateStagingIsolation() {
  const projectId = requireValue('GCP_PROJECT_ID');
  const projectNumber = requireValue('GCP_PROJECT_NUMBER');
  const configPath = requireValue('STAGING_CONFIG_PATH');
  const expectedHash = requireValue('STAGING_CONFIG_SHA256');
  const raw = readFileSync(configPath, 'utf8');
  const actualHash = createHash('sha256').update(raw).digest('hex');
  if (actualHash !== expectedHash) {
    fail('STAGING_CONFIG_HASH_MISMATCH', `${actualHash} != ${expectedHash}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    fail('STAGING_CONFIG_INVALID_JSON', configPath);
  }

  if (config.schemaVersion !== 1 || config.environment !== 'staging') {
    fail('STAGING_CONFIG_SCHEMA_INVALID', configPath);
  }

  const expected = {
    GCP_PROJECT_ID: config.projectId,
    GCP_PROJECT_NUMBER: config.projectNumber,
    GCP_REGION: config.region,
    GCP_ARTIFACT_REPOSITORY: config.artifactRepository,
    GCP_CLOUD_SQL_INSTANCE: config.cloudSqlInstance,
    GCP_CLOUD_RUN_MCP_SERVICE: config.mcpService,
    GCP_CLOUD_RUN_WEBHOOK_SERVICE: config.webhookService,
    GCP_WORKLOAD_IDENTITY_PROVIDER: config.workloadIdentityProvider,
    GCP_DEPLOY_SERVICE_ACCOUNT: config.deployServiceAccount,
    GCP_MCP_RUNTIME_SERVICE_ACCOUNT: config.mcpRuntimeServiceAccount,
    GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT: config.webhookRuntimeServiceAccount,
    GCP_DATABASE_URL_SECRET: config.secretReferences?.databaseUrl?.id,
    GCP_DATABASE_URL_SECRET_VERSION: config.secretReferences?.databaseUrl?.version,
    STAGING_DATABASE_ISOLATION_MODE: config.databaseIsolationMode,
    STAGING_PROVIDER_MODE: config.providerMode,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (typeof expectedValue !== 'string' || expectedValue.length === 0) {
      fail('STAGING_CONFIG_FIELD_MISSING', key);
    }
    if (requireValue(key) !== expectedValue) {
      fail('STAGING_CONFIG_ENV_MISMATCH', key);
    }
  }

  if (/production/i.test(projectId)) {
    fail('STAGING_PROJECT_NAME_FORBIDDEN', projectId);
  }
  for (const key of [
    'PRODUCTION_GCP_PROJECT_ID',
    'PRODUCTION_GCP_PROJECT_NUMBER',
    'PRODUCTION_GCP_REGION',
    'PRODUCTION_GCP_CLOUD_SQL_INSTANCE',
    'PRODUCTION_GCP_CLOUD_RUN_MCP_SERVICE',
    'PRODUCTION_GCP_CLOUD_RUN_WEBHOOK_SERVICE',
    'PRODUCTION_GCP_DATABASE_URL_SECRET',
    'PRODUCTION_GCP_WORKLOAD_IDENTITY_PROVIDER',
    'PRODUCTION_GCP_DEPLOY_SERVICE_ACCOUNT',
    'PRODUCTION_GCP_MCP_RUNTIME_SERVICE_ACCOUNT',
    'PRODUCTION_GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT',
  ]) {
    if (process.env[key]?.trim()) fail('STAGING_PRODUCTION_COORDINATE_FORBIDDEN', key);
  }

  requireOwnWorkloadIdentity(projectNumber);
  requireOwnServiceAccount('GCP_DEPLOY_SERVICE_ACCOUNT', projectId);
  requireOwnServiceAccount('GCP_MCP_RUNTIME_SERVICE_ACCOUNT', projectId);
  requireOwnServiceAccount('GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT', projectId);

  if (requireValue('STAGING_DATABASE_ISOLATION_MODE') !== 'DEDICATED_CLOUD_SQL') {
    fail('STAGING_DATABASE_ISOLATION_MODE_INVALID', 'expected DEDICATED_CLOUD_SQL');
  }
  if (providerMode() !== 'DISABLED') {
    fail('STAGING_PROVIDER_MODE_INVALID', 'canonical staging must remain DISABLED');
  }
  if (anyProviderEnabled()) {
    fail('STAGING_PROVIDER_MODE_CONFLICT', 'providers must remain disabled in canonical staging');
  }
}

function validateProviderMode() {
  if (environment !== 'staging') return;
  const mode = providerMode();
  if (mode !== 'DISABLED') {
    fail('STAGING_PROVIDER_MODE_INVALID', 'expected DISABLED');
  }
  if (anyProviderEnabled()) {
    fail('STAGING_PROVIDER_MODE_CONFLICT', 'providers must remain disabled in DISABLED mode');
  }
}

function providerMode() {
  return process.env.STAGING_PROVIDER_MODE?.trim() || 'DISABLED';
}

function anyProviderEnabled() {
  return (
    enabled('META_ENABLED') ||
    enabled('META_WEBHOOK_ENABLED') ||
    enabled('INSTAGRAM_READ_ENABLED') ||
    enabled('META_ADS_READ_ENABLED') ||
    enabled('META_ADS_WRITE_ENABLED') ||
    enabled('WHATSAPP_ENABLED') ||
    enabled('WHATSAPP_RUNTIME_ENABLED') ||
    enabled('EMAIL_SENDGRID_ENABLED') ||
    enabled('AG01_MODEL_ENABLED') ||
    value('GOOGLE_ADS_PHASE', 'OFF') !== 'OFF'
  );
}

function validateEnabledProviderSecretIds() {
  const metaBacked =
    enabled('META_ENABLED') ||
    enabled('META_WEBHOOK_ENABLED') ||
    enabled('INSTAGRAM_READ_ENABLED') ||
    enabled('META_ADS_READ_ENABLED') ||
    enabled('META_ADS_WRITE_ENABLED') ||
    enabled('WHATSAPP_ENABLED') ||
    enabled('WHATSAPP_RUNTIME_ENABLED');

  if (metaBacked) requireProjectLocalSecretId('GCP_META_ACCESS_TOKEN_SECRET');
  if (enabled('META_ENABLED') || enabled('META_WEBHOOK_ENABLED')) {
    requireProjectLocalSecretId('GCP_META_APP_SECRET');
  }
  if (enabled('META_WEBHOOK_ENABLED')) {
    requireProjectLocalSecretId('GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET');
  }
  if (enabled('EMAIL_SENDGRID_ENABLED')) {
    requireProjectLocalSecretId('GCP_SENDGRID_API_KEY_SECRET');
  }
  if (value('GOOGLE_ADS_PHASE', 'OFF') !== 'OFF') {
    requireProjectLocalSecretId('GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET');
    requireProjectLocalSecretId('GCP_GOOGLE_ADS_CLIENT_ID_SECRET');
    requireProjectLocalSecretId('GCP_GOOGLE_ADS_CLIENT_SECRET_SECRET');
    requireProjectLocalSecretId('GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET');
  }
  if (enabled('AG01_MODEL_ENABLED')) {
    requireProjectLocalSecretId('GCP_AG01_MODEL_API_KEY_SECRET');
  }
}

function validateSecretVersions() {
  if (environment !== 'production') return;
  const enabledSecrets = [
    ['GCP_META_ACCESS_TOKEN_SECRET', 'GCP_META_ACCESS_TOKEN_SECRET_VERSION'],
    ['GCP_META_APP_SECRET', 'GCP_META_APP_SECRET_VERSION'],
    ['GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET', 'GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET_VERSION'],
    ['GCP_SENDGRID_API_KEY_SECRET', 'GCP_SENDGRID_API_KEY_SECRET_VERSION'],
    ['GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET', 'GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET_VERSION'],
    ['GCP_GOOGLE_ADS_CLIENT_ID_SECRET', 'GCP_GOOGLE_ADS_CLIENT_ID_SECRET_VERSION'],
    ['GCP_GOOGLE_ADS_CLIENT_SECRET_SECRET', 'GCP_GOOGLE_ADS_CLIENT_SECRET_VERSION'],
    ['GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET', 'GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET_VERSION'],
    ['GCP_AG01_MODEL_API_KEY_SECRET', 'GCP_AG01_MODEL_API_KEY_SECRET_VERSION'],
  ];
  for (const [secretKey, versionKey] of enabledSecrets) {
    if (!process.env[secretKey]?.trim()) continue;
    const version = requireValue(versionKey);
    if (version === 'latest') {
      fail('PRODUCTION_PROVIDER_SECRET_VERSION_MUST_BE_PINNED', versionKey);
    }
  }
}

function requireOwnWorkloadIdentity(projectNumber) {
  const provider = requireValue('GCP_WORKLOAD_IDENTITY_PROVIDER');
  const expectedPrefix = `projects/${projectNumber}/locations/global/`;
  if (!provider.startsWith(expectedPrefix)) {
    fail(
      'STAGING_WIF_NOT_OWNED_BY_PROJECT',
      `GCP_WORKLOAD_IDENTITY_PROVIDER must start with ${expectedPrefix}`,
    );
  }
}

function requireOwnServiceAccount(key, projectId) {
  const serviceAccount = requireValue(key);
  const expectedSuffix = `@${projectId}.iam.gserviceaccount.com`;
  if (!serviceAccount.endsWith(expectedSuffix)) {
    fail('STAGING_SERVICE_ACCOUNT_NOT_OWNED_BY_PROJECT', `${key} must end with ${expectedSuffix}`);
  }
}

function requireProjectLocalSecretId(key) {
  const secret = requireValue(key);
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) {
    fail('GCP_SECRET_MUST_BE_PROJECT_LOCAL_ID', key);
  }
  return secret;
}

function assertDistinct(label, left, right) {
  if (left === right) fail('DEPLOY_CONFIGURATION_COLLISION', label);
}

function enabled(key) {
  return process.env[key]?.trim() === 'true';
}

function value(key, fallback) {
  return process.env[key]?.trim() || fallback;
}

function requireValue(key) {
  const configured = process.env[key]?.trim();
  if (!configured) fail('GCP_DEPLOY_CONFIGURATION_MISSING', key);
  return configured;
}

function fail(code, detail) {
  console.error(`${code}:${detail}`);
  process.exit(1);
}
