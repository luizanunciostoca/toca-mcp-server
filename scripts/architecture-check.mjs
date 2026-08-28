import { existsSync, readFileSync } from 'node:fs';

const required = [
  'src/server.ts',
  'src/index.ts',
  'src/http.ts',
  'src/http-server.ts',
  'src/config.ts',
  'src/registry.ts',
  'src/instagram-publication-readiness-preflight.ts',
  'src/core/auth.ts',
  'src/core/audit.ts',
  'src/core/connected-account.ts',
  'src/core/connected-account-store.ts',
  'src/core/errors.ts',
  'src/core/execution-context.ts',
  'src/core/executor.ts',
  'src/core/observability.ts',
  'src/core/structured-logger.ts',
  'src/core/policy.ts',
  'src/core/secrets.ts',
  'src/core/environment-secret-resolver.ts',
  'src/core/tool-registry.ts',
  'src/governance/approval-governance.ts',
  'src/governance/capability-catalog.ts',
  'src/governance/capability-ids.ts',
  'src/governance/capability-lifecycle.ts',
  'src/governance/governance-drift.ts',
  'src/governance/index.ts',
  'src/governance/release-lifecycle.ts',
  'src/governance/route-catalog.ts',
  'src/governance/state-machine.ts',
  'src/governance/structural-evaluators.ts',
  'src/governance/structural-lifecycles.ts',
  'src/governance/types.ts',
  'src/health/readiness.ts',
  'src/persistence/postgres.ts',
  'src/persistence/postgres-approval-store.ts',
  'src/persistence/postgres-meta-ads-geo-audience-store.ts',
  'src/policy/engagement-policy.ts',
  'src/providers/meta/meta-api-client.ts',
  'src/providers/meta/meta-assets.ts',
  'src/providers/meta/meta-connection.ts',
  'src/providers/meta/meta-connection-service.ts',
  'src/providers/meta/meta-discovery.ts',
  'src/providers/meta/meta-graph.ts',
  'src/providers/meta/meta-oauth.ts',
  'src/providers/instagram/instagram-capabilities.ts',
  'src/providers/instagram/instagram-contracts.ts',
  'src/providers/instagram/instagram-engagement-contracts.ts',
  'src/providers/instagram/instagram-engagement-provider.ts',
  'src/providers/instagram/instagram-messaging-read-provider.ts',
  'src/providers/instagram/instagram-publication-readiness-preflight.ts',
  'src/providers/instagram/instagram-publication-readiness-runtime.ts',
  'src/providers/meta-ads/budget-guardrail.ts',
  'src/providers/meta-ads/meta-ads-contracts.ts',
  'src/providers/meta-ads/meta-ads-graph-provider.ts',
  'src/providers/meta-ads/meta-ads-read-provider.ts',
  'src/providers/meta-ads/meta-ads-demand-intelligence.ts',
  'src/providers/meta-ads/meta-ads-controlled-graph-provider.ts',
  'src/providers/meta-ads/meta-ads-controlled-write.ts',
  'src/tools/register-meta-ads-read.ts',
  'src/tools/register-meta-ads-write.ts',
  'src/scheduler/in-memory-scheduler.ts',
  'src/scheduler/postgres-scheduler.ts',
  'src/scheduler/scheduler-contracts.ts',
  'src/worker/worker.ts',
  'src/worker/worker-runtime.ts',
  'src/worker/postgres-dead-letter.ts',
  'migrations/001_production_foundation.sql',
  'migrations/002_worker_dead_letter.sql',
  'migrations/005_approval_governance.sql',
  'migrations/022_meta_ads_geo_demand_intelligence.sql',
  'scripts/migrate.ts',
  'Dockerfile',
  'infra/cloudrun/service.template.yaml',
  '.github/workflows/deploy-gcp.yml',
  '.github/workflows/deploy-instagram-publication-worker-gcp.yml',
  'docs/deployment/gcp.md',
  'docs/operations/worker-runbook.md',
  'docs/integrations/instagram-engagement.md',
  'docs/architecture/meta-ads-morro-demand-intelligence.md',
  'test/config.test.ts',
  'test/core.test.ts',
  'test/http-server.test.ts',
  'test/meta.test.ts',
  'test/meta-assets.test.ts',
  'test/meta-graph.test.ts',
  'test/meta-ads-controlled-write.test.ts',
  'test/meta-ads-demand-intelligence.test.ts',
  'test/preconnection-contracts.test.ts',
  'test/preconnection-runtime.test.ts',
  'test/secrets.test.ts',
  'test/gcp-foundation.test.ts',
  'test/worker.test.ts',
  'test/readiness.test.ts',
  'test/engagement-policy.test.ts',
  'test/instagram-publication-readiness-preflight.test.ts',
  'test/instagram-publication-readiness-runtime.test.ts',
  'tests/server.test.ts',
  'docs/architecture/README.md',
  'docs/architecture/preconnection-roadmap.md',
  'docs/architecture/routes-capabilities-v1.md',
  'docs/integrations/meta.md',
  'docs/integrations/phase-1-real-validation.md',
  '.env.example',
  '.github/workflows/quality.yml',
  '.gitignore',
  'pnpm-lock.yaml',
];
const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) {
  console.error(`Missing required architecture files: ${missing.join(', ')}`);
  process.exit(1);
}
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (packageJson.name !== 'toca-mcp-server' || packageJson.private !== true) {
  console.error('package.json violates repository architecture contract');
  process.exit(1);
}
if (!packageJson.dependencies?.['@modelcontextprotocol/node']) {
  console.error('Remote Node MCP runtime dependency is required');
  process.exit(1);
}
if (!packageJson.dependencies?.pg || !packageJson.scripts?.migrate) {
  console.error('PostgreSQL production persistence and migration scripts are required');
  process.exit(1);
}
if (!packageJson.scripts?.['start:http']) {
  console.error('Remote MCP start script is required');
  process.exit(1);
}
const routeCatalog = readFileSync('src/governance/route-catalog.ts', 'utf8');
const capabilityCatalog = readFileSync('src/governance/capability-catalog.ts', 'utf8');
const capabilityIds = readFileSync('src/governance/capability-ids.ts', 'utf8');
for (let number = 1; number <= 32; number += 1) {
  const routeId = `R${String(number).padStart(2, '0')}`;
  if (!routeCatalog.includes(`routeId: '${routeId}'`) || !capabilityIds.includes(`${routeId}: [`)) {
    console.error(`Official route is missing from the governed catalog: ${routeId}`);
    process.exit(1);
  }
}
for (const field of [
  'capability_id',
  'route_id',
  'version',
  'lifecycle_status',
  'risk_class',
  'side_effects',
  'approval_required',
  'idempotent',
  'provider',
  'required_scopes',
  'required_config',
  'input_schema',
  'output_schema',
  'timeout_ms',
  'retry_policy',
  'verification_method',
  'rollback_method',
  'owner',
  'last_validated_at',
  'evidence',
]) {
  if (!capabilityCatalog.includes(field)) {
    console.error(`Capability catalog is missing mandatory metadata: ${field}`);
    process.exit(1);
  }
}
if (
  packageJson.scripts?.['start:instagram-publication-readiness'] !==
  'node dist/src/instagram-publication-readiness-preflight.js'
) {
  console.error('Publication readiness preflight must use its dedicated compiled entrypoint');
  process.exit(1);
}
const qualityWorkflow = readFileSync('.github/workflows/quality.yml', 'utf8');
if (!qualityWorkflow.includes('pnpm install --frozen-lockfile')) {
  console.error('Quality Gate must enforce frozen lockfile installation');
  process.exit(1);
}
const deployWorkflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');
if (
  !deployWorkflow.includes('id-token: write') ||
  !deployWorkflow.includes('workload_identity_provider')
) {
  console.error('GCP deployment must use GitHub OIDC / Workload Identity Federation');
  process.exit(1);
}
if (deployWorkflow.includes('service_account_key') || deployWorkflow.includes('credentials_json')) {
  console.error('Long-lived Google service-account keys are forbidden');
  process.exit(1);
}
const publicationWorkerDeployWorkflow = readFileSync(
  '.github/workflows/deploy-instagram-publication-worker-gcp.yml',
  'utf8',
);
if (
  !publicationWorkerDeployWorkflow.includes('id-token: write') ||
  !publicationWorkerDeployWorkflow.includes('workload_identity_provider')
) {
  console.error(
    'Publication worker GCP deployment must use GitHub OIDC / Workload Identity Federation',
  );
  process.exit(1);
}
if (
  !publicationWorkerDeployWorkflow.includes('dist/src/instagram-publication-worker.js') ||
  !publicationWorkerDeployWorkflow.includes('INSTAGRAM_PUBLICATION_WRITES_ENABLED=false') ||
  !publicationWorkerDeployWorkflow.includes('META_ENABLED=false')
) {
  console.error(
    'Publication worker deployment must remain explicitly disabled and use its dedicated entrypoint',
  );
  process.exit(1);
}
if (
  publicationWorkerDeployWorkflow.includes('INSTAGRAM_PUBLICATION_WRITES_ENABLED=true') ||
  publicationWorkerDeployWorkflow.includes('META_ENABLED=true') ||
  publicationWorkerDeployWorkflow.includes('service_account_key') ||
  publicationWorkerDeployWorkflow.includes('credentials_json')
) {
  console.error(
    'Publication worker deployment cannot arm writes or use long-lived GCP credentials',
  );
  process.exit(1);
}
const publicationReadinessPreflight = readFileSync(
  'src/providers/instagram/instagram-publication-readiness-preflight.ts',
  'utf8',
);
if (
  !publicationReadinessPreflight.includes("metaClient.get('me/permissions')") ||
  !publicationReadinessPreflight.includes("metaClient.get('me/accounts'") ||
  publicationReadinessPreflight.includes('.post(') ||
  publicationReadinessPreflight.includes('media_publish') ||
  publicationReadinessPreflight.includes('INSTAGRAM_PUBLICATION_WRITES_ENABLED=true')
) {
  console.error('Publication readiness preflight must remain read-only and GET-only');
  process.exit(1);
}
const registry = readFileSync('src/registry.ts', 'utf8');
if (registry.includes('instagram.comments.reply')) {
  console.error('Unpromoted external write capabilities must not be advertised');
  process.exit(1);
}
const allowedInstagramMessagingReadNames = new Set([
  'instagram.messaging.conversations.read',
  'instagram.messaging.messages.read',
]);
const advertisedInstagramMessagingNames = [
  ...registry.matchAll(/name: '(instagram\.messaging\.[^']+)'/g),
].map((match) => match[1]);
for (const name of advertisedInstagramMessagingNames) {
  if (!allowedInstagramMessagingReadNames.has(name)) {
    console.error('Unpromoted Instagram messaging capability must not be advertised: ' + name);
    process.exit(1);
  }
  const marker = "name: '" + name + "'";
  const start = registry.indexOf(marker);
  const definition = registry.slice(start, start + 800);
  if (
    !definition.includes("riskClass: 'READ'") ||
    !definition.includes("capabilityStatus: 'IMPLEMENTED'") ||
    !definition.includes('sideEffects: false') ||
    !definition.includes('idempotent: true') ||
    !definition.includes(
      "requiredScopes: ['instagram_basic', 'instagram_manage_messages', 'pages_manage_metadata']",
    )
  ) {
    console.error('Instagram messaging read capability violates the read-only boundary: ' + name);
    process.exit(1);
  }
}
const allowedMetaAdsReadNames = new Set([
  'meta_ads.accounts.list',
  'meta_ads.campaigns.list',
  'meta_ads.adsets.list',
  'meta_ads.ads.list',
  'meta_ads.insights.get',
  'meta_ads.audience.inspect',
  'meta_ads.opportunity.detect',
  'meta_ads.budget.recommend',
]);
const allowedMetaAdsControlledNames = new Set([
  'meta_ads.campaign.prepare_paused',
  'meta_ads.campaign.create_paused',
]);
const advertisedMetaAdsNames = [...registry.matchAll(/name: '(meta_ads\.[^']+)'/g)].map(
  (match) => match[1],
);
for (const name of advertisedMetaAdsNames) {
  if (!allowedMetaAdsReadNames.has(name) && !allowedMetaAdsControlledNames.has(name)) {
    console.error(`Unpromoted Meta Ads capability must not be advertised: ${name}`);
    process.exit(1);
  }

  const marker = `name: '${name}'`;
  const start = registry.indexOf(marker);
  const end = registry.indexOf('\n  },', start);
  const definition = registry.slice(start, end === -1 ? registry.length : end);

  if (allowedMetaAdsReadNames.has(name)) {
    if (
      !definition.includes("riskClass: 'READ'") ||
      !definition.includes("capabilityStatus: 'IMPLEMENTED'") ||
      !definition.includes('sideEffects: false') ||
      !definition.includes("requiredScopes: ['ads_read']")
    ) {
      console.error(`Meta Ads read capability violates the read-only boundary: ${name}`);
      process.exit(1);
    }
    continue;
  }

  if (name === 'meta_ads.campaign.prepare_paused') {
    if (
      !definition.includes("riskClass: 'READ'") ||
      !definition.includes("capabilityStatus: 'IMPLEMENTED'") ||
      !definition.includes('sideEffects: false') ||
      !definition.includes('idempotent: true') ||
      !definition.includes("requiredScopes: ['ads_management']")
    ) {
      console.error('Meta Ads prepare-paused capability violates the controlled-write boundary');
      process.exit(1);
    }
    continue;
  }

  if (
    !definition.includes("riskClass: 'WRITE_EXTERNAL'") ||
    !definition.includes("capabilityStatus: 'IMPLEMENTED'") ||
    !definition.includes('sideEffects: true') ||
    !definition.includes('idempotent: false') ||
    !definition.includes("requiredScopes: ['ads_management']")
  ) {
    console.error('Meta Ads create-paused capability violates the controlled-write boundary');
    process.exit(1);
  }
}
const metaAdsReadProvider = readFileSync(
  'src/providers/meta-ads/meta-ads-read-provider.ts',
  'utf8',
);
if (
  metaAdsReadProvider.includes('.post(') ||
  metaAdsReadProvider.includes('createCampaign') ||
  metaAdsReadProvider.includes('updateBudget') ||
  metaAdsReadProvider.includes('updateStatus')
) {
  console.error('Meta Ads read provider must remain GET-only and mutation-free');
  process.exit(1);
}
const metaAdsControlledWrite = readFileSync(
  'src/providers/meta-ads/meta-ads-controlled-write.ts',
  'utf8',
);
if (
  !metaAdsControlledWrite.includes("status: 'PAUSED'") ||
  !metaAdsControlledWrite.includes('META_ADS_APPROVAL_SHA256_MISMATCH') ||
  !metaAdsControlledWrite.includes('META_ADS_DUPLICATE_CAMPAIGN_NAME') ||
  metaAdsControlledWrite.includes("status: 'ACTIVE'") ||
  metaAdsControlledWrite.includes('updateStatus(') ||
  metaAdsControlledWrite.includes('updateBudget(')
) {
  console.error('Meta Ads controlled write must remain create-paused-only and approval-bound');
  process.exit(1);
}
const metaAdsControlledGraph = readFileSync(
  'src/providers/meta-ads/meta-ads-controlled-graph-provider.ts',
  'utf8',
);
if (
  !metaAdsControlledGraph.includes('META_ADS_STATUS_MUTATION_NOT_ALLOWED') ||
  !metaAdsControlledGraph.includes('META_ADS_BUDGET_MUTATION_NOT_ALLOWED') ||
  metaAdsControlledGraph.includes("status: 'ACTIVE'")
) {
  console.error('Meta Ads controlled provider must reject status/budget mutation');
  process.exit(1);
}
const plannedPublicationNames = [
  'instagram.publish.image',
  'instagram.publish.carousel',
  'instagram.publish.reel',
  'instagram.publish.story',
  'instagram.publication.schedule',
  'instagram.publication.reschedule',
  'instagram.publication.cancel_scheduled',
];
for (const name of plannedPublicationNames) {
  const marker = `name: '${name}'`;
  const start = registry.indexOf(marker);
  if (start === -1) continue;
  const end = registry.indexOf('\n  },', start);
  const definition = registry.slice(start, end === -1 ? registry.length : end);
  if (!definition.includes("capabilityStatus: 'PLANNED'")) {
    console.error(`Publication capability must remain PLANNED until explicit promotion: ${name}`);
    process.exit(1);
  }
}
const envExample = readFileSync('.env.example', 'utf8');
if (/META_(APP_SECRET|ACCESS_TOKEN)=\S+/.test(envExample)) {
  console.error('.env.example must not contain raw Meta secrets or tokens');
  process.exit(1);
}
const worker = readFileSync('src/worker/worker.ts', 'utf8');
if (!worker.includes('deadLetters.put') || !worker.includes(':retry:')) {
  console.error('Worker must preserve retry and dead-letter behavior');
  process.exit(1);
}
const httpServer = readFileSync('src/http-server.ts', 'utf8');
if (!httpServer.includes("'/healthz'") || !httpServer.includes("'/readyz'")) {
  console.error('Runtime must expose separate liveness and readiness probes');
  process.exit(1);
}
const validationGate = readFileSync('docs/integrations/phase-1-real-validation.md', 'utf8');
if (!validationGate.includes('real-provider plus real-ChatGPT evidence')) {
  console.error('Phase 1 must retain the real-provider and ChatGPT validation gate');
  process.exit(1);
}
for (const temporary of [
  '.github/workflows/preconnection-format.yml',
  '.github/workflows/gcp-foundation-normalize.yml',
  '.github/workflows/gcp-format.yml',
  '.github/workflows/meta-ads-format-fix.yml',
  '.github/workflows/meta-ads-format-probe.yml',
]) {
  if (existsSync(temporary)) {
    console.error(`Temporary workflow must be removed before validation: ${temporary}`);
    process.exit(1);
  }
}
console.log('Architecture check passed.');
