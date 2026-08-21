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
assertDistinct(
  'MCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT',
  requireValue('GCP_MCP_RUNTIME_SERVICE_ACCOUNT'),
  requireValue('GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT'),
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
  const region = requireValue('GCP_REGION');
  const productionProjectId = requireValue('PRODUCTION_GCP_PROJECT_ID');
  const productionProjectNumber = requireValue('PRODUCTION_GCP_PROJECT_NUMBER');
  const productionRegion = requireValue('PRODUCTION_GCP_REGION');

  assertDistinct('GCP_PROJECT_ID', projectId, productionProjectId);
  assertDistinct('GCP_PROJECT_NUMBER', projectNumber, productionProjectNumber);

  const stagingCloudSqlInstance = requireValue('GCP_CLOUD_SQL_INSTANCE');
  const productionCloudSqlInstance = requireValue('PRODUCTION_GCP_CLOUD_SQL_INSTANCE');
  assertDistinct(
    'GCP_CLOUD_SQL_INSTANCE_NAME',
    stagingCloudSqlInstance,
    productionCloudSqlInstance,
  );
  assertDistinct(
    'GCP_CLOUD_SQL_RESOURCE',
    `${projectId}:${region}:${stagingCloudSqlInstance}`,
    `${productionProjectId}:${productionRegion}:${productionCloudSqlInstance}`,
  );

  const stagingMcpServiceName = requireValue('GCP_CLOUD_RUN_MCP_SERVICE');
  const stagingWebhookServiceName = requireValue('GCP_CLOUD_RUN_WEBHOOK_SERVICE');
  const productionMcpServiceName = requireValue('PRODUCTION_GCP_CLOUD_RUN_MCP_SERVICE');
  const productionWebhookServiceName = requireValue('PRODUCTION_GCP_CLOUD_RUN_WEBHOOK_SERVICE');
  for (const [label, stagingServiceName] of [
    ['MCP_SERVICE', stagingMcpServiceName],
    ['WEBHOOK_SERVICE', stagingWebhookServiceName],
  ]) {
    assertDistinct(`${label}_NAME_VS_PRODUCTION_MCP`, stagingServiceName, productionMcpServiceName);
    assertDistinct(
      `${label}_NAME_VS_PRODUCTION_WEBHOOK`,
      stagingServiceName,
      productionWebhookServiceName,
    );
  }

  const stagingMcp = `${projectId}:${region}:${stagingMcpServiceName}`;
  const stagingWebhook = `${projectId}:${region}:${stagingWebhookServiceName}`;
  const productionMcp = `${productionProjectId}:${productionRegion}:${productionMcpServiceName}`;
  const productionWebhook = `${productionProjectId}:${productionRegion}:${productionWebhookServiceName}`;
  for (const [label, stagingService] of [
    ['MCP_SERVICE', stagingMcp],
    ['WEBHOOK_SERVICE', stagingWebhook],
  ]) {
    assertDistinct(`${label}_VS_PRODUCTION_MCP`, stagingService, productionMcp);
    assertDistinct(`${label}_VS_PRODUCTION_WEBHOOK`, stagingService, productionWebhook);
  }

  const stagingDatabaseSecretId = requireProjectLocalSecretId('GCP_DATABASE_URL_SECRET');
  const productionDatabaseSecretId = requireProjectLocalSecretId(
    'PRODUCTION_GCP_DATABASE_URL_SECRET',
  );
  assertDistinct(
    'GCP_DATABASE_URL_SECRET_ID',
    stagingDatabaseSecretId,
    productionDatabaseSecretId,
  );
  assertDistinct(
    'GCP_DATABASE_URL_SECRET_RESOURCE',
    `${projectId}:${stagingDatabaseSecretId}`,
    `${productionProjectId}:${productionDatabaseSecretId}`,
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
    'GCP_MCP_RUNTIME_SERVICE_ACCOUNT',
    requireValue('GCP_MCP_RUNTIME_SERVICE_ACCOUNT'),
    requireValue('PRODUCTION_GCP_MCP_RUNTIME_SERVICE_ACCOUNT'),
  );
  assertDistinct(
    'GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT',
    requireValue('GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT'),
    requireValue('PRODUCTION_GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT'),
  );

  requireOwnWorkloadIdentity(projectNumber);
  requireOwnServiceAccount('GCP_DEPLOY_SERVICE_ACCOUNT', projectId);
  requireOwnServiceAccount('GCP_MCP_RUNTIME_SERVICE_ACCOUNT', projectId);
  requireOwnServiceAccount('GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT', projectId);

  const isolationMode = requireValue('STAGING_DATABASE_ISOLATION_MODE');
  if (isolationMode !== 'DEDICATED_CLOUD_SQL') {
    fail('STAGING_DATABASE_ISOLATION_MODE_INVALID', 'expected DEDICATED_CLOUD_SQL');
  }

  if (providerMode() === 'ISOLATED') {
    requireValue('STAGING_PROVIDER_ISOLATION_EVIDENCE_REF');
  }
}

function validateProviderMode() {
  if (environment !== 'staging') return;
  const mode = providerMode();
  if (mode !== 'DISABLED' && mode !== 'ISOLATED') {
    fail('STAGING_PROVIDER_MODE_INVALID', 'expected DISABLED or ISOLATED');
  }
  if (mode === 'DISABLED' && anyProviderEnabled()) {
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

function assertDistinct(label, stagingValue, productionValue) {
  if (stagingValue === productionValue) {
    fail('STAGING_PRODUCTION_COLLISION', `${label} matches the prohibited reference`);
  }
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
