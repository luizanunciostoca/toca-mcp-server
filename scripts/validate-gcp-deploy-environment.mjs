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
  'GCP_CLOUD_RUN_SERVICE',
  'GCP_WORKLOAD_IDENTITY_PROVIDER',
  'GCP_DEPLOY_SERVICE_ACCOUNT',
  'GCP_RUNTIME_SERVICE_ACCOUNT',
  'GCP_DATABASE_URL_SECRET',
  'GCP_DATABASE_URL_SECRET_VERSION',
];
for (const key of requiredRuntimeCoordinates) requireValue(key);

requireProjectLocalSecretId('GCP_DATABASE_URL_SECRET');
validateEnabledProviderSecretIds();

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
  const region = requireValue('GCP_REGION');
  const productionProjectId = requireValue('PRODUCTION_GCP_PROJECT_ID');
  const productionProjectNumber = requireValue('PRODUCTION_GCP_PROJECT_NUMBER');
  const productionRegion = requireValue('PRODUCTION_GCP_REGION');

  assertDistinct('GCP_PROJECT_ID', projectId, productionProjectId);
  assertDistinct('GCP_PROJECT_NUMBER', projectNumber, productionProjectNumber);
  assertDistinct(
    'GCP_CLOUD_SQL_RESOURCE',
    `${projectId}:${region}:${requireValue('GCP_CLOUD_SQL_INSTANCE')}`,
    `${productionProjectId}:${productionRegion}:${requireValue('PRODUCTION_GCP_CLOUD_SQL_INSTANCE')}`,
  );
  assertDistinct(
    'GCP_CLOUD_RUN_RESOURCE',
    `${projectId}:${region}:${requireValue('GCP_CLOUD_RUN_SERVICE')}`,
    `${productionProjectId}:${productionRegion}:${requireValue('PRODUCTION_GCP_CLOUD_RUN_SERVICE')}`,
  );
  assertDistinct(
    'GCP_DATABASE_URL_SECRET_RESOURCE',
    `${projectId}:${requireProjectLocalSecretId('GCP_DATABASE_URL_SECRET')}`,
    `${productionProjectId}:${requireProjectLocalSecretId('PRODUCTION_GCP_DATABASE_URL_SECRET')}`,
  );
  assertDistinct(
    'GCP_WORKLOAD_IDENTITY_PROVIDER',
    requireValue('GCP_WORKLOAD_IDENTITY_PROVIDER'),
    requireValue('PRODUCTION_GCP_WORKLOAD_IDENTITY_PROVIDER'),
  );
  assertDistinct(
    'GCP_DEPLOY_SERVICE_ACCOUNT',
    requireValue('GCP_DEPLOY_SERVICE_ACCOUNT'),
    requireValue('PRODUCTION_GCP_DEPLOY_SERVICE_ACCOUNT'),
  );
  assertDistinct(
    'GCP_RUNTIME_SERVICE_ACCOUNT',
    requireValue('GCP_RUNTIME_SERVICE_ACCOUNT'),
    requireValue('PRODUCTION_GCP_RUNTIME_SERVICE_ACCOUNT'),
  );

  requireOwnWorkloadIdentity(projectNumber);
  requireOwnServiceAccount('GCP_DEPLOY_SERVICE_ACCOUNT', projectId);
  requireOwnServiceAccount('GCP_RUNTIME_SERVICE_ACCOUNT', projectId);

  const isolationMode = requireValue('STAGING_DATABASE_ISOLATION_MODE');
  if (isolationMode !== 'DEDICATED_CLOUD_SQL' && isolationMode !== 'EXPLICITLY_APPROVED') {
    fail(
      'STAGING_DATABASE_ISOLATION_MODE_INVALID',
      'expected DEDICATED_CLOUD_SQL or EXPLICITLY_APPROVED',
    );
  }
  if (isolationMode === 'EXPLICITLY_APPROVED') {
    requireValue('STAGING_DATABASE_ISOLATION_APPROVAL_REF');
  }
}

function validateEnabledProviderSecretIds() {
  const metaBacked =
    enabled('META_ENABLED') ||
    enabled('META_WEBHOOK_ENABLED') ||
    enabled('INSTAGRAM_READ_ENABLED') ||
    enabled('META_ADS_READ_ENABLED') ||
    enabled('META_ADS_WRITE_ENABLED') ||
    enabled('WHATSAPP_ENABLED');

  if (metaBacked) requireProjectLocalSecretId('GCP_META_ACCESS_TOKEN_SECRET');
  if (enabled('META_ENABLED')) requireProjectLocalSecretId('GCP_META_APP_SECRET');
  if (enabled('META_WEBHOOK_ENABLED')) {
    requireProjectLocalSecretId('GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET');
  }
  if (enabled('EMAIL_SENDGRID_ENABLED')) {
    requireProjectLocalSecretId('GCP_SENDGRID_API_KEY_SECRET');
  }
  if (requireValue('GOOGLE_ADS_PHASE') !== 'OFF') {
    requireProjectLocalSecretId('GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET');
    requireProjectLocalSecretId('GCP_GOOGLE_ADS_CLIENT_ID_SECRET');
    requireProjectLocalSecretId('GCP_GOOGLE_ADS_CLIENT_SECRET_SECRET');
    requireProjectLocalSecretId('GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET');
  }
  if (enabled('AG01_MODEL_ENABLED')) {
    requireProjectLocalSecretId('GCP_AG01_MODEL_API_KEY_SECRET');
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
  const value = requireValue(key);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    fail('GCP_SECRET_MUST_BE_PROJECT_LOCAL_ID', key);
  }
  return value;
}

function assertDistinct(label, stagingValue, productionValue) {
  if (stagingValue === productionValue) {
    fail('STAGING_PRODUCTION_COLLISION', `${label} matches the production reference`);
  }
}

function enabled(key) {
  return process.env[key]?.trim() === 'true';
}

function requireValue(key) {
  const value = process.env[key]?.trim();
  if (!value) fail('GCP_DEPLOY_CONFIGURATION_MISSING', key);
  return value;
}

function fail(code, detail) {
  console.error(`${code}:${detail}`);
  process.exit(1);
}
