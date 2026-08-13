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
  'src/health/readiness.ts',
  'src/persistence/postgres.ts',
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
  'src/providers/instagram/instagram-publication-readiness-preflight.ts',
  'src/providers/instagram/instagram-publication-readiness-runtime.ts',
  'src/providers/meta-ads/budget-guardrail.ts',
  'src/providers/meta-ads/meta-ads-contracts.ts',
  'src/providers/meta-ads/meta-ads-graph-provider.ts',
  'src/providers/meta-ads/meta-ads-read-provider.ts',
  'src/tools/register-meta-ads-read.ts',
  'src/scheduler/in-memory-scheduler.ts',
  'src/scheduler/postgres-scheduler.ts',
  'src/scheduler/scheduler-contracts.ts',
  'src/worker/worker.ts',
  'src/worker/worker-runtime.ts',
  'src/worker/postgres-dead-letter.ts',
  'migrations/001_production_foundation.sql',
  'migrations/002_worker_dead_letter.sql',
  'scripts/migrate.ts',
  'Dockerfile',
  'infra/cloudrun/service.template.yaml',
  '.github/workflows/deploy-gcp.yml',
  '.github/workflows/deploy-instagram-publication-worker-gcp.yml',
  'docs/deployment/gcp.md',
  'docs/operations/worker-runbook.md',
  'docs/integrations/instagram-engagement.md',
  'test/config.test.ts',
  'test/core.test.ts',
  'test/http-server.test.ts',
  'test/meta.test.ts',
  'test/meta-assets.test.ts',
  'test/meta-graph.test.ts',
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
if (registry.includes('instagram.comments.reply') || registry.includes('instagram.messaging.')) {
  console.error('Unpromoted external write capabilities must not be advertised');
  process.exit(1);
}

const allowedMetaAdsReadNames = new Set([
  'meta_ads.accounts.list',
  'meta_ads.campaigns.list',
  'meta_ads.insights.get',
]);
const advertisedMetaAdsNames = [...registry.matchAll(/name: '(meta_ads\.[^']+)'/g)].map(
  (match) => match[1],
);
for (const name of advertisedMetaAdsNames) {
  if (!allowedMetaAdsReadNames.has(name)) {
    console.error(`Unpromoted Meta Ads capability must not be advertised: ${name}`);
    process.exit(1);
  }
  const marker = `name: '${name}'`;
  const start = registry.indexOf(marker);
  const end = registry.indexOf('\n  },', start);
  const definition = registry.slice(start, end === -1 ? registry.length : end);
  if (
    !definition.includes("riskClass: 'READ'") ||
    !definition.includes("capabilityStatus: 'IMPLEMENTED'") ||
    !definition.includes('sideEffects: false')
  ) {
    console.error(`Meta Ads read capability violates the read-only boundary: ${name}`);
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
]) {
  if (existsSync(temporary)) {
    console.error(`Temporary workflow must be removed before validation: ${temporary}`);
    process.exit(1);
  }
}

console.log('Architecture check passed.');
