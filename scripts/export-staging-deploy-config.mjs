import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const configPath = process.argv[2] ?? 'infra/environments/staging.json';
const raw = await readFile(configPath, 'utf8');
const config = JSON.parse(raw);

function requireString(key, value) {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`STAGING_CONFIG_INVALID:${key}`);
  }
  return value.trim();
}

function requireBoolean(key, value) {
  if (typeof value !== 'boolean') throw new Error(`STAGING_CONFIG_INVALID:${key}`);
  return value;
}

function emit(key, value) {
  const stringValue = String(value);
  if (/[\r\n]/.test(stringValue)) throw new Error(`STAGING_CONFIG_MULTILINE:${key}`);
  process.stdout.write(`${key}=${stringValue}\n`);
}

if (config.schemaVersion !== 1 || config.environment !== 'staging') {
  throw new Error('STAGING_CONFIG_INVALID:schema');
}

const projectId = requireString('projectId', config.projectId);
const projectNumber = requireString('projectNumber', config.projectNumber);
const region = requireString('region', config.region);
const artifactRepository = requireString('artifactRepository', config.artifactRepository);
const cloudSqlInstance = requireString('cloudSqlInstance', config.cloudSqlInstance);
const mcpService = requireString('mcpService', config.mcpService);
const webhookService = requireString('webhookService', config.webhookService);
const workloadIdentityProvider = requireString(
  'workloadIdentityProvider',
  config.workloadIdentityProvider,
);
const deployServiceAccount = requireString('deployServiceAccount', config.deployServiceAccount);
const mcpRuntimeServiceAccount = requireString(
  'mcpRuntimeServiceAccount',
  config.mcpRuntimeServiceAccount,
);
const webhookRuntimeServiceAccount = requireString(
  'webhookRuntimeServiceAccount',
  config.webhookRuntimeServiceAccount,
);
const databaseIsolationMode = requireString('databaseIsolationMode', config.databaseIsolationMode);
const providerMode = requireString('providerMode', config.providerMode);
const databaseSecretId = requireString(
  'secretReferences.databaseUrl.id',
  config.secretReferences?.databaseUrl?.id,
);
const databaseSecretVersion = requireString(
  'secretReferences.databaseUrl.version',
  config.secretReferences?.databaseUrl?.version,
);
const runtime = config.runtimeDefaults ?? {};

if (!/^\d{6,20}$/.test(projectNumber)) throw new Error('STAGING_CONFIG_INVALID:projectNumber');
if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
  throw new Error('STAGING_CONFIG_INVALID:projectId');
}
if (/production/i.test(projectId)) throw new Error('STAGING_CONFIG_FORBIDDEN:production-project');
if (!workloadIdentityProvider.startsWith(`projects/${projectNumber}/locations/global/`)) {
  throw new Error('STAGING_CONFIG_INVALID:workloadIdentityProvider');
}
for (const [key, account] of [
  ['deployServiceAccount', deployServiceAccount],
  ['mcpRuntimeServiceAccount', mcpRuntimeServiceAccount],
  ['webhookRuntimeServiceAccount', webhookRuntimeServiceAccount],
]) {
  if (!account.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
    throw new Error(`STAGING_CONFIG_INVALID:${key}`);
  }
}
if (mcpService === webhookService) throw new Error('STAGING_CONFIG_INVALID:service-collision');
if (databaseIsolationMode !== 'DEDICATED_CLOUD_SQL') {
  throw new Error('STAGING_CONFIG_INVALID:databaseIsolationMode');
}
if (providerMode !== 'DISABLED') throw new Error('STAGING_CONFIG_INVALID:providerMode');
if (!/^[A-Za-z0-9_-]+$/.test(databaseSecretId)) {
  throw new Error('STAGING_CONFIG_INVALID:databaseSecretId');
}
if (!/^(latest|[1-9]\d*)$/.test(databaseSecretVersion)) {
  throw new Error('STAGING_CONFIG_INVALID:databaseSecretVersion');
}

const providerBooleans = [
  ['metaEnabled', runtime.metaEnabled],
  ['metaProviderVerified', runtime.metaProviderVerified],
  ['metaWebhookEnabled', runtime.metaWebhookEnabled],
  ['metaWebhookPersistenceEnabled', runtime.metaWebhookPersistenceEnabled],
  ['instagramReadEnabled', runtime.instagramReadEnabled],
  ['metaAdsReadEnabled', runtime.metaAdsReadEnabled],
  ['metaAdsWriteEnabled', runtime.metaAdsWriteEnabled],
  ['whatsappEnabled', runtime.whatsappEnabled],
  ['whatsappProviderVerified', runtime.whatsappProviderVerified],
  ['emailSendgridEnabled', runtime.emailSendgridEnabled],
  ['emailSendgridProviderVerified', runtime.emailSendgridProviderVerified],
  ['googleAdsProviderVerified', runtime.googleAdsProviderVerified],
  ['ag01ModelEnabled', runtime.ag01ModelEnabled],
  ['ag01ModelProviderVerified', runtime.ag01ModelProviderVerified],
];
for (const [key, value] of providerBooleans) {
  if (requireBoolean(`runtimeDefaults.${key}`, value) !== false) {
    throw new Error(`STAGING_CONFIG_FORBIDDEN:provider-enabled:${key}`);
  }
}
if (runtime.googleAdsPhase !== 'OFF') {
  throw new Error('STAGING_CONFIG_FORBIDDEN:googleAdsPhase');
}

const hash = createHash('sha256').update(raw).digest('hex');

emit('STAGING_CONFIG_PATH', configPath);
emit('STAGING_CONFIG_SHA256', hash);
emit('GCP_PROJECT_ID', projectId);
emit('GCP_PROJECT_NUMBER', projectNumber);
emit('GCP_REGION', region);
emit('GCP_ARTIFACT_REPOSITORY', artifactRepository);
emit('GCP_CLOUD_SQL_INSTANCE', cloudSqlInstance);
emit('GCP_CLOUD_RUN_MCP_SERVICE', mcpService);
emit('GCP_CLOUD_RUN_WEBHOOK_SERVICE', webhookService);
emit('GCP_WORKLOAD_IDENTITY_PROVIDER', workloadIdentityProvider);
emit('GCP_DEPLOY_SERVICE_ACCOUNT', deployServiceAccount);
emit('GCP_MCP_RUNTIME_SERVICE_ACCOUNT', mcpRuntimeServiceAccount);
emit('GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT', webhookRuntimeServiceAccount);
emit('GCP_DATABASE_URL_SECRET', databaseSecretId);
emit('GCP_DATABASE_URL_SECRET_VERSION', databaseSecretVersion);
emit('STAGING_DATABASE_ISOLATION_MODE', databaseIsolationMode);
emit('STAGING_PROVIDER_MODE', providerMode);
emit('STAGING_PROVIDER_ISOLATION_EVIDENCE_REF', '');
emit('TOCA_DEFAULT_TENANT_ID', requireString('runtimeDefaults.tenantId', runtime.tenantId));
emit('TOCA_DEFAULT_WORKSPACE_ID', requireString('runtimeDefaults.workspaceId', runtime.workspaceId));
emit(
  'TOCA_DEFAULT_ORGANIZATION_ID',
  requireString('runtimeDefaults.organizationId', runtime.organizationId),
);
emit(
  'TOCA_READY_OUTBOX_MAX_LAG_SECONDS',
  requireString('runtimeDefaults.readyOutboxMaxLagSeconds', runtime.readyOutboxMaxLagSeconds),
);
emit('META_ENABLED', 'false');
emit('META_PROVIDER_VERIFIED', 'false');
emit('META_WEBHOOK_ENABLED', 'false');
emit('META_WEBHOOK_PERSISTENCE_ENABLED', 'false');
emit('INSTAGRAM_READ_ENABLED', 'false');
emit('META_ADS_READ_ENABLED', 'false');
emit('META_ADS_WRITE_ENABLED', 'false');
emit('WHATSAPP_ENABLED', 'false');
emit('WHATSAPP_BUSINESS_ID', '');
emit('WHATSAPP_PROVIDER_VERIFIED', 'false');
emit('EMAIL_SENDGRID_ENABLED', 'false');
emit('EMAIL_SENDGRID_PROVIDER_VERIFIED', 'false');
emit('GOOGLE_ADS_PHASE', 'OFF');
emit('GOOGLE_ADS_PROVIDER_VERIFIED', 'false');
emit('AG01_MODEL_ENABLED', 'false');
emit('AG01_MODEL_PROVIDER_VERIFIED', 'false');
