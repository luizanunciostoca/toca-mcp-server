import { existsSync, readFileSync } from 'node:fs';

const required = [
  'src/server.ts',
  'src/index.ts',
  'src/http.ts',
  'src/http-server.ts',
  'src/config.ts',
  'src/registry.ts',
  'src/core/auth.ts',
  'src/core/audit.ts',
  'src/core/connected-account.ts',
  'src/core/connected-account-store.ts',
  'src/core/errors.ts',
  'src/core/execution-context.ts',
  'src/core/executor.ts',
  'src/core/observability.ts',
  'src/core/policy.ts',
  'src/core/secrets.ts',
  'src/core/tool-registry.ts',
  'src/providers/meta/meta-api-client.ts',
  'src/providers/meta/meta-assets.ts',
  'src/providers/meta/meta-connection.ts',
  'src/providers/meta/meta-connection-service.ts',
  'src/providers/meta/meta-discovery.ts',
  'src/providers/meta/meta-graph.ts',
  'src/providers/meta/meta-oauth.ts',
  'src/providers/instagram/instagram-capabilities.ts',
  'src/providers/instagram/instagram-contracts.ts',
  'src/providers/meta-ads/budget-guardrail.ts',
  'src/providers/meta-ads/meta-ads-contracts.ts',
  'src/providers/meta-ads/meta-ads-graph-provider.ts',
  'src/scheduler/in-memory-scheduler.ts',
  'src/scheduler/scheduler-contracts.ts',
  'test/config.test.ts',
  'test/core.test.ts',
  'test/http-server.test.ts',
  'test/meta.test.ts',
  'test/meta-assets.test.ts',
  'test/meta-graph.test.ts',
  'test/preconnection-contracts.test.ts',
  'test/preconnection-runtime.test.ts',
  'test/secrets.test.ts',
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
if (!packageJson.scripts?.['start:http']) {
  console.error('Remote MCP start script is required');
  process.exit(1);
}

const qualityWorkflow = readFileSync('.github/workflows/quality.yml', 'utf8');
if (!qualityWorkflow.includes('pnpm install --frozen-lockfile')) {
  console.error('Quality Gate must enforce frozen lockfile installation');
  process.exit(1);
}

const registry = readFileSync('src/registry.ts', 'utf8');
if (registry.includes('instagram.publish') || registry.includes('meta_ads.')) {
  console.error(
    'Preconnection branches must not advertise Instagram or Meta Ads write capabilities',
  );
  process.exit(1);
}

const envExample = readFileSync('.env.example', 'utf8');
if (/META_(APP_SECRET|ACCESS_TOKEN)=\S+/.test(envExample)) {
  console.error('.env.example must not contain raw Meta secrets or tokens');
  process.exit(1);
}

const validationGate = readFileSync('docs/integrations/phase-1-real-validation.md', 'utf8');
if (!validationGate.includes('real-provider plus real-ChatGPT evidence')) {
  console.error('Phase 1 must retain the real-provider and ChatGPT validation gate');
  process.exit(1);
}

if (existsSync('.github/workflows/preconnection-format.yml')) {
  console.error('Temporary preconnection formatter workflow must be removed before validation');
  process.exit(1);
}

console.log('Architecture check passed.');
