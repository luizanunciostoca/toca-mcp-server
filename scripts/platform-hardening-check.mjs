import { readFile } from 'node:fs/promises';

const requiredFiles = [
  '.github/workflows/quality.yml',
  '.github/workflows/security-supply-chain.yml',
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
];

const files = new Map();
for (const path of requiredFiles) files.set(path, await readFile(path, 'utf8'));

const failures = [];

function requireContains(path, expected, code) {
  const content = files.get(path);
  if (!content?.includes(expected)) failures.push(`${code}:${path}:${expected}`);
}

requireContains(
  '.github/workflows/quality.yml',
  'node scripts/platform-hardening-check.mjs',
  'QUALITY_HARDENING_GATE_MISSING',
);
requireContains(
  '.github/workflows/quality.yml',
  'pnpm architecture:check',
  'QUALITY_ARCHITECTURE_GATE_MISSING',
);
requireContains(
  '.github/workflows/quality.yml',
  'pnpm typecheck',
  'QUALITY_TYPECHECK_GATE_MISSING',
);
requireContains('.github/workflows/quality.yml', 'pnpm test', 'QUALITY_TEST_GATE_MISSING');
requireContains('.github/workflows/quality.yml', 'pnpm build', 'QUALITY_BUILD_GATE_MISSING');

const securityWorkflowPath = '.github/workflows/security-supply-chain.yml';
for (const action of [
  'actions/dependency-review-action@',
  'github/codeql-action/init@',
  'github/codeql-action/analyze@',
  'gitleaks/gitleaks-action@',
  'aquasecurity/trivy-action@',
  'actions/upload-artifact@',
]) {
  requireContains(securityWorkflowPath, action, 'SECURITY_SCANNER_MISSING');
}
requireContains(
  securityWorkflowPath,
  'pnpm audit --audit-level high',
  'VULNERABILITY_AUDIT_MISSING',
);
requireContains(securityWorkflowPath, "format: 'cyclonedx'", 'SBOM_GENERATION_MISSING');
requireContains(securityWorkflowPath, 'docker build', 'CONTAINER_BUILD_MISSING');
requireContains(securityWorkflowPath, "scan-type: 'image'", 'CONTAINER_SCAN_MISSING');

const deployPath = '.github/workflows/deploy-gcp.yml';
const deploy = await readFile(deployPath, 'utf8');
if (
  !deploy.includes(
    'projects/990081828836/locations/global/workloadIdentityPools/github/providers/github-toca-mcp',
  )
)
  failures.push('WIF_IMMUTABLE_PROVIDER_ID_MISSING');
if (
  !deploy.includes(
    'GCP_DEPLOY_SERVICE_ACCOUNT: toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com',
  )
)
  failures.push('DEPLOY_IDENTITY_MISSING');
if (
  !deploy.includes(
    'GCP_RUNTIME_SERVICE_ACCOUNT: toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
  )
)
  failures.push('RUNTIME_IDENTITY_MISSING');
if (deploy.includes('GCP_DEPLOY_SERVICE_ACCOUNT: toca-mcp-runtime@'))
  failures.push('DEPLOY_RUNTIME_IDENTITY_COLLISION');
if (!deploy.includes('--update-secrets')) failures.push('SECRET_MANAGER_REFERENCE_MISSING');
if (deploy.includes('credentials_json:')) failures.push('LONG_LIVED_GCP_KEY_FORBIDDEN');

requireContains('Dockerfile', 'USER node', 'CONTAINER_NON_ROOT_USER_MISSING');
requireContains(
  'src/core/audit-ledger.ts',
  'verifyAuditLedger',
  'AUDIT_INTEGRITY_VERIFIER_MISSING',
);
requireContains(
  'src/core/operational-observability.ts',
  'correlationId',
  'CORRELATION_ID_MISSING',
);
requireContains(
  'src/core/structured-logger.ts',
  'JSON.stringify',
  'STRUCTURED_JSON_LOGGING_MISSING',
);

const alerts = JSON.parse(files.get('infra/observability/platform-hardening-alerts.json'));
const dashboard = JSON.parse(files.get('infra/observability/platform-hardening-dashboard.json'));
const synthetics = JSON.parse(files.get('infra/observability/platform-hardening-synthetics.json'));

const requiredSignals = [
  'publication.verified_terminal_success_ratio',
  'workflow.terminal_success_ratio',
  'provider.readback_verified_ratio',
  'lead.ingestion_success_ratio',
  'lead.first_response_p95_seconds',
  'webhook.accepted_success_ratio',
  'outbox.oldest_pending_age_seconds',
  'retry.exhausted_count',
  'dead_letter.pending_count',
  'crm.durable_write_success_ratio',
  'attribution.durable_write_success_ratio',
  'whatsapp.delivery_verified_ratio',
  'email.delivery_verified_ratio',
  'r31.feedback_loop_success_ratio',
];

const manifestText = JSON.stringify({ alerts, dashboard });
for (const signal of requiredSignals) {
  if (!manifestText.includes(signal)) failures.push(`OBSERVABILITY_SIGNAL_MISSING:${signal}`);
}

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
  if (!drillContract.includes(`'${scenario}'`))
    failures.push(`DRILL_SCENARIO_MISSING:${scenario}`);
}
if (!drillContract.includes('destructiveProviderMutationAllowed: false'))
  failures.push('DRILL_DESTRUCTIVE_MUTATION_GUARD_MISSING');

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log(`PLATFORM_HARDENING_CHECK_PASS=${requiredFiles.length}`);
