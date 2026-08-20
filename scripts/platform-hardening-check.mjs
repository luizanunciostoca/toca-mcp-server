import { readFile } from 'node:fs/promises';

const requiredFiles = [
  '.github/workflows/quality.yml',
  '.github/workflows/security-supply-chain.yml',
  '.github/workflows/deploy-gcp.yml',
  'Dockerfile',
  'docs/operations/disaster-recovery-next-runbook.md',
  'docs/operations/observability-incident-runbook.md',
  'docs/operations/security-supply-chain-runbook.md',
  'infra/observability/platform-hardening-alerts.json',
  'infra/observability/platform-hardening-dashboard.json',
  'infra/observability/platform-hardening-synthetics.json',
  'src/core/audit-ledger.ts',
  'src/core/operational-observability.ts',
  'src/core/structured-logger.ts',
  'src/core/platform-slo-catalog.ts',
  'src/core/resilience-drills.ts',
  'src/health/readiness.ts',
  'src/health/runtime-readiness.ts',
];

const files = new Map();
for (const path of requiredFiles) files.set(path, await readFile(path, 'utf8'));

const failures = [];

function requireContains(path, expected, code) {
  const content = files.get(path);
  if (!content?.includes(expected)) failures.push(`${code}:${path}:${expected}`);
}

function forbidContains(path, forbidden, code) {
  const content = files.get(path);
  if (content?.includes(forbidden)) failures.push(`${code}:${path}:${forbidden}`);
}

for (const marker of [
  'node scripts/platform-hardening-check.mjs',
  'pnpm architecture:check',
  'pnpm typecheck',
  'pnpm test',
  'pnpm build',
]) {
  requireContains('.github/workflows/quality.yml', marker, 'QUALITY_GATE_MARKER_MISSING');
}

const securityWorkflowPath = '.github/workflows/security-supply-chain.yml';
for (const marker of [
  'actions/dependency-review-action@',
  'github/codeql-action/init@',
  'github/codeql-action/analyze@',
  'gitleaks/gitleaks-action@',
  'aquasecurity/trivy-action@',
  'actions/upload-artifact@',
  'pnpm audit --audit-level high',
  "format: 'cyclonedx'",
  'docker build',
  "scan-type: 'image'",
]) {
  requireContains(securityWorkflowPath, marker, 'SECURITY_SUPPLY_CHAIN_MARKER_MISSING');
}

const deployPath = '.github/workflows/deploy-gcp.yml';
for (const marker of [
  'workload_identity_provider: ${{ env.GCP_WORKLOAD_IDENTITY_PROVIDER }}',
  'service_account: ${{ env.GCP_DEPLOY_SERVICE_ACCOUNT }}',
  'toca-mcp-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com',
  'toca-mcp-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com',
  '--update-secrets',
  'GCP_DATABASE_URL_SECRET_VERSION',
  'pointInTimeRecoveryEnabled',
  'pnpm migrate',
  '--revision-suffix',
  '--tag',
  '--no-traffic',
  '--startup-probe',
  '--readiness-probe',
  'httpGet.path=/readyz',
  '--liveness-probe',
  'httpGet.path=/healthz',
  'PROVIDER_VERIFIED',
  'TOCA_DEFAULT_TENANT_ID',
  'TOCA_DEFAULT_WORKSPACE_ID',
  'TOCA_DEFAULT_ORGANIZATION_ID',
  '--to-revisions',
]) {
  requireContains(deployPath, marker, 'DEPLOY_NEXT_MARKER_MISSING');
}
for (const forbidden of [
  'credentials_json:',
  'META_ADS_READ_ENABLED=true',
  'META_ADS_WRITE_ENABLED=true',
  'WHATSAPP_ENABLED=true',
  'EMAIL_SENDGRID_ENABLED=true',
]) {
  forbidContains(deployPath, forbidden, 'DEPLOY_UNGOVERNED_PROVIDER_ACTIVATION');
}

requireContains('Dockerfile', 'USER node', 'CONTAINER_NON_ROOT_USER_MISSING');
requireContains('Dockerfile', 'COPY migrations ./migrations', 'CONTAINER_MIGRATIONS_MISSING');
requireContains('src/core/audit-ledger.ts', 'verifyAuditLedger', 'AUDIT_INTEGRITY_VERIFIER_MISSING');
requireContains('src/core/operational-observability.ts', 'correlationId', 'CORRELATION_ID_MISSING');
requireContains('src/core/structured-logger.ts', 'JSON.stringify', 'STRUCTURED_JSON_LOGGING_MISSING');

const readinessPath = 'src/health/runtime-readiness.ts';
for (const checkName of [
  'db',
  'migrations',
  'schema',
  'audit',
  'outbox',
  'approval_store',
  'crm',
  'ag01',
  'meta',
  'whatsapp',
  'email',
  'google_ads',
  'provider_credentials',
  'critical_configuration',
]) {
  requireContains(readinessPath, `namedCheck('${checkName}'`, `READINESS_CHECK_MISSING:${checkName}`);
}
for (const marker of [
  'READINESS_MIGRATIONS_PENDING',
  'READINESS_SCHEMA_MISSING',
  'READINESS_AUDIT_HEAD_MISMATCH',
  'READINESS_OUTBOX_LAG_EXCEEDED',
  'READINESS_OUTBOX_DEAD_LETTER_PRESENT',
  'PROVIDER_NOT_VERIFIED',
  'PRODUCTION_VALIDATED',
]) {
  requireContains(readinessPath, marker, 'READINESS_FAIL_CLOSED_MARKER_MISSING');
}
requireContains('src/health/readiness.ts', "status: failed ? 'not_ready' : 'ready'", 'READINESS_STATUS_GATE_MISSING');

const alerts = JSON.parse(files.get('infra/observability/platform-hardening-alerts.json'));
const dashboard = JSON.parse(files.get('infra/observability/platform-hardening-dashboard.json'));
const synthetics = JSON.parse(files.get('infra/observability/platform-hardening-synthetics.json'));

const requiredSignals = [
  'http.request_rate',
  'http.request_error_ratio',
  'http.request_p95_seconds',
  'publication.verified_terminal_success_ratio',
  'workflow.terminal_success_ratio',
  'provider.readback_verified_ratio',
  'provider.error_count',
  'lead.ingestion_success_ratio',
  'lead.first_response_p95_seconds',
  'webhook.accepted_success_ratio',
  'webhook.failure_count',
  'outbox.oldest_pending_age_seconds',
  'retry.exhausted_count',
  'dead_letter.pending_count',
  'queue.backlog_count',
  'ag01.failure_count',
  'approval.decision_p95_seconds',
  'crm.durable_write_success_ratio',
  'crm.error_count',
  'attribution.durable_write_success_ratio',
  'revenue_attribution.error_count',
  'whatsapp.delivery_verified_ratio',
  'email.delivery_verified_ratio',
  'r31.feedback_loop_success_ratio',
];
const manifestText = JSON.stringify({ alerts, dashboard });
for (const signal of requiredSignals) {
  if (!manifestText.includes(signal)) failures.push(`OBSERVABILITY_SIGNAL_MISSING:${signal}`);
}

if (alerts.routing?.minimumNotificationChannels < 2)
  failures.push('ALERT_REDUNDANT_CHANNELS_REQUIRED');
if (alerts.routing?.requireRedundantChannelFamilies !== true)
  failures.push('ALERT_REDUNDANT_CHANNEL_FAMILIES_REQUIRED');
if (alerts.routing?.syntheticFiringRequiresReadback !== true)
  failures.push('ALERT_SYNTHETIC_READBACK_REQUIRED');
if (synthetics.safety?.realSideEffectsForTesting !== false)
  failures.push('SYNTHETIC_REAL_SIDE_EFFECTS_MUST_BE_FALSE');
if (synthetics.safety?.destructiveOperations !== false)
  failures.push('SYNTHETIC_DESTRUCTIVE_OPERATIONS_MUST_BE_FALSE');
if (synthetics.safety?.providerMutationAllowed !== false)
  failures.push('SYNTHETIC_PROVIDER_MUTATION_MUST_BE_FALSE');

const drillContract = files.get('src/core/resilience-drills.ts');
for (const scenario of [
  'restart',
  'worker_crash',
  'duplicate_webhook',
  'delayed_callback',
  'provider_outage',
  'partial_provider_write',
  'ambiguous_status',
  'expired_token',
  'quota_exceeded',
]) {
  if (!drillContract.includes(`'${scenario}'`)) failures.push(`DRILL_SCENARIO_MISSING:${scenario}`);
}
if (!drillContract.includes('destructiveProviderMutationAllowed: false'))
  failures.push('DRILL_DESTRUCTIVE_MUTATION_GUARD_MISSING');

const drRunbook = files.get('docs/operations/disaster-recovery-next-runbook.md');
for (const marker of ['RPO `<=15m`', 'RTO `<=60m`', 'PITR', 'isolated restore']) {
  if (!drRunbook.includes(marker)) failures.push(`DR_RUNBOOK_MARKER_MISSING:${marker}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`PLATFORM_HARDENING_CHECK_PASS=${requiredFiles.length}`);
