import { existsSync, readFileSync } from 'node:fs';

const required = [
  'src/server.ts',
  'src/index.ts',
  'src/config.ts',
  'src/registry.ts',
  'src/core/auth.ts',
  'src/core/audit.ts',
  'src/core/connected-account.ts',
  'src/core/errors.ts',
  'src/core/execution-context.ts',
  'src/core/executor.ts',
  'src/core/observability.ts',
  'src/core/policy.ts',
  'src/core/secrets.ts',
  'src/core/tool-registry.ts',
  'test/core.test.ts',
  'tests/server.test.ts',
  'docs/architecture/README.md',
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

const qualityWorkflow = readFileSync('.github/workflows/quality.yml', 'utf8');
if (!qualityWorkflow.includes('pnpm install --frozen-lockfile')) {
  console.error('Quality Gate must enforce frozen lockfile installation');
  process.exit(1);
}

console.log('Architecture check passed.');
