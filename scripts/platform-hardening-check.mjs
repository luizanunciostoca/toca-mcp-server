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
  'scripts/capture-platform-evidence.mjs',
  'scripts/validate-gcp-deploy-environment.mjs',
  'src/core/policy.ts',
  'src/health/runtime-readiness.ts',
  'src/http.ts',
];

const files = new Map();
for (const path of requiredFiles) files.set(path, await readFile(path, 'utf8'));
const failures = [];
const need = (path, marker, code) => {
  if (!files.get(path)?.includes(marker)) failures.push(`${code}:${path}:${marker}`);
};
const forbid = (path, marker, code) => {
  if (files.get(path)?.includes(marker)) failures.push(`${code}:${path}:${marker}`);
};

for (const marker of ['node scripts/platform-hardening-check.mjs', 'pnpm architecture:check', 'pnpm typecheck', 'pnpm test', 'pnpm build']) {
  need('.github/workflows/quality.yml', marker, 'QUALITY_GATE_MISSING');
}
for (const marker of ['actions/dependency-review-action@', 'github/codeql-action/init@', 'github/codeql-action/analyze@', 'gitleaks/gitleaks-action@', 'aquasecurity/trivy-action@', 'actions/upload-artifact@', 'pnpm audit --audit-level high', "format: 'cyclonedx'"]) {
  need('.github/workflows/security-supply-chain.yml', marker, 'SECURITY_SUPPLY_CHAIN_MISSING');
}

const deploy = '.github/workflows/deploy-gcp.yml';
for (const marker of [
  'node scripts/validate-gcp-deploy-environment.mjs',
  'GCP_CLOUD_RUN_MCP_SERVICE',
  'GCP_CLOUD_RUN_WEBHOOK_SERVICE',
  'GCP_MCP_RUNTIME_SERVICE_ACCOUNT',
  'GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT',
  'PRODUCTION_GCP_CLOUD_RUN_MCP_SERVICE',
  'PRODUCTION_GCP_CLOUD_RUN_WEBHOOK_SERVICE',
  'staging_evidence_ref',
  'production_authorization_ref',
  'pnpm migrate',
  '--provenance=mode=max',
  '--sbom=true',
  'containerimage.digest',
  'Artifact Registry digest readback mismatch',
  'IMAGE=${IMAGE_REPOSITORY}@${IMAGE_DIGEST}',
  '--no-traffic',
  '--no-allow-unauthenticated',
  '--allow-unauthenticated',
  'TOCA_SERVICE_ROLE=mcp',
  'TOCA_SERVICE_ROLE=webhook',
  'MCP_ENABLED=true',
  'MCP_ENABLED=false',
  'WEBHOOK_URL/mcp',
  'WEBHOOK_URL/oauth/meta/start',
  'capture-platform-evidence.mjs',
  'platform-evidence/manifest.json',
  'rollback_mcp_revision',
  'rollback_webhook_revision',
  'rollback_compatibility_ref',
  'pointInTimeRecoveryEnabled',
  'transactionLogRetentionDays',
  'retainedBackups',
]) need(deploy, marker, 'DEPLOY_CONTRACT_MISSING');
for (const marker of [
  'GCP_PROJECT_ID: toca-mcp-production',
  'GCP_CLOUD_SQL_INSTANCE: toca-mcp-db',
  'GCP_DATABASE_URL_SECRET: toca-database-url',
  'credentials_json:',
  '.github/workflows/tmp-readiness-repair-once.yml',
]) forbid(deploy, marker, 'DEPLOY_FORBIDDEN_FALLBACK');

const validator = 'scripts/validate-gcp-deploy-environment.mjs';
for (const marker of [
  'GCP_CLOUD_RUN_MCP_SERVICE',
  'GCP_CLOUD_RUN_WEBHOOK_SERVICE',
  'GCP_MCP_RUNTIME_SERVICE_ACCOUNT',
  'GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT',
  'STAGING_PRODUCTION_COLLISION',
  'DEDICATED_CLOUD_SQL',
  'STAGING_PROVIDER_MODE_INVALID',
  'STAGING_PROVIDER_MODE_CONFLICT',
  'STAGING_PROVIDER_ISOLATION_EVIDENCE_REF',
  'STAGING_WIF_NOT_OWNED_BY_PROJECT',
  'STAGING_SERVICE_ACCOUNT_NOT_OWNED_BY_PROJECT',
  'GCP_SECRET_MUST_BE_PROJECT_LOCAL_ID',
  'PRODUCTION_DATABASE_SECRET_VERSION_MUST_BE_PINNED',
  'PRODUCTION_PROVIDER_SECRET_VERSION_MUST_BE_PINNED',
]) need(validator, marker, 'ISOLATION_GUARD_MISSING');

const readiness = 'src/health/runtime-readiness.ts';
for (const check of ['db','migrations','schema','audit','outbox','approval_store','crm','privacy','workflow','ag01','meta','whatsapp','email','google_ads','provider_credentials','critical_configuration']) {
  need(readiness, `namedCheck('${check}'`, `READINESS_CHECK_MISSING:${check}`);
}
for (const marker of ['READINESS_MIGRATIONS_PENDING','READINESS_SCHEMA_MISSING','READINESS_AUDIT_HEAD_MISMATCH','READINESS_OUTBOX_LAG_EXCEEDED','READINESS_OUTBOX_DEAD_LETTER_PRESENT','READINESS_MCP_ROLE_REQUIRES_MCP_ENABLED','READINESS_WEBHOOK_ROLE_REQUIRES_MCP_DISABLED','PROVIDER_NOT_VERIFIED','privacy_ledger_events','workflow_instances']) {
  need(readiness, marker, 'READINESS_FAIL_CLOSED_MISSING');
}

for (const marker of ["'/webhooks/meta'", "'/webhooks/sendgrid/events'", "'/healthz'", "'/readyz'", 'WEBHOOK_SERVICE_ALLOWED_PATHS', 'isWebhookService()']) {
  need('src/http.ts', marker, 'WEBHOOK_SURFACE_GUARD_MISSING');
}
need('src/core/policy.ts', 'TOCA_PLATFORM_KILL_SWITCH', 'MUTATION_KILL_SWITCH_MISSING');
need('src/core/policy.ts', 'tool.sideEffects && platformMutationKillSwitchActive(context)', 'MUTATION_KILL_SWITCH_MISSING');

const alertText = files.get('infra/observability/platform-hardening-alerts.json');
const dashboardText = files.get('infra/observability/platform-hardening-dashboard.json');
const syntheticText = files.get('infra/observability/platform-hardening-synthetics.json');
for (const signal of [
  'ag01.failure_count','core.execution_error_ratio','approval.decision_p95_seconds','email.send_success_ratio','email.delivery_verified_ratio','email.bounce_ratio','whatsapp.webhook_success_ratio','whatsapp.send_success_ratio','whatsapp.readback_verified_ratio','provider.call_p95_seconds','provider.error_count','crm.durable_write_success_ratio','outbox.oldest_pending_age_seconds','retry.exhausted_count','dead_letter.pending_count','commerce.readback_verified_ratio','google_ads.api_error_ratio','meta.api_error_ratio'
]) {
  if (!alertText.includes(signal) && !dashboardText.includes(signal)) failures.push(`OBSERVABILITY_SIGNAL_MISSING:${signal}`);
}
const alerts = JSON.parse(alertText);
const synthetics = JSON.parse(syntheticText);
if (alerts.routing?.minimumNotificationChannels < 2) failures.push('ALERT_REDUNDANT_CHANNELS_REQUIRED');
if (alerts.routing?.requireRedundantChannelFamilies !== true) failures.push('ALERT_REDUNDANT_FAMILIES_REQUIRED');
if (alerts.routing?.syntheticFiringRequiresReadback !== true) failures.push('ALERT_READBACK_REQUIRED');
if (synthetics.safety?.realSideEffectsForTesting !== false || synthetics.safety?.destructiveOperations !== false || synthetics.safety?.providerMutationAllowed !== false) failures.push('SYNTHETIC_SAFETY_GUARD_INVALID');

for (const marker of ['RPO `<=15m`', 'RTO `<=60m`', 'PITR', 'isolated restore']) {
  need('docs/operations/disaster-recovery-next-runbook.md', marker, 'DR_RUNBOOK_MISSING');
}
for (const marker of ['notification', 'readback', 'correlation', 'runbook']) {
  need('docs/operations/observability-incident-runbook.md', marker, 'OBSERVABILITY_RUNBOOK_MISSING');
}
for (const marker of ['schema_migrations','audit_ledger_events','event_outbox','workflow_instances','privacy_ledger_events']) {
  need('scripts/capture-platform-evidence.mjs', marker, 'EVIDENCE_CAPTURE_MISSING');
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(`PLATFORM_HARDENING_CHECK_PASS=${requiredFiles.length}`);
