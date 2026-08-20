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

if (environment === 'production' && process.env.GCP_DATABASE_URL_SECRET_VERSION === 'latest') {
  fail(
    'PRODUCTION_DATABASE_SECRET_VERSION_MUST_BE_PINNED',
    'GCP_DATABASE_URL_SECRET_VERSION cannot be latest in production',
  );
}

if (environment === 'staging') validateStagingIsolation();

console.log(`GCP_DEPLOY_ENVIRONMENT_VALIDATED=${environment}`);

function validateStagingIsolation() {
  const productionReferences = {
    GCP_PROJECT_ID: requireValue('PRODUCTION_GCP_PROJECT_ID'),
    GCP_CLOUD_SQL_INSTANCE: requireValue('PRODUCTION_GCP_CLOUD_SQL_INSTANCE'),
    GCP_CLOUD_RUN_SERVICE: requireValue('PRODUCTION_GCP_CLOUD_RUN_SERVICE'),
    GCP_DATABASE_URL_SECRET: requireValue('PRODUCTION_GCP_DATABASE_URL_SECRET'),
    GCP_WORKLOAD_IDENTITY_PROVIDER: requireValue('PRODUCTION_GCP_WORKLOAD_IDENTITY_PROVIDER'),
    GCP_DEPLOY_SERVICE_ACCOUNT: requireValue('PRODUCTION_GCP_DEPLOY_SERVICE_ACCOUNT'),
    GCP_RUNTIME_SERVICE_ACCOUNT: requireValue('PRODUCTION_GCP_RUNTIME_SERVICE_ACCOUNT'),
  };

  for (const [key, productionValue] of Object.entries(productionReferences)) {
    const stagingValue = requireValue(key);
    if (stagingValue === productionValue) {
      fail('STAGING_PRODUCTION_COLLISION', `${key} matches the production reference`);
    }
  }

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

function requireValue(key) {
  const value = process.env[key]?.trim();
  if (!value) fail('GCP_DEPLOY_CONFIGURATION_MISSING', key);
  return value;
}

function fail(code, detail) {
  console.error(`${code}:${detail}`);
  process.exit(1);
}
