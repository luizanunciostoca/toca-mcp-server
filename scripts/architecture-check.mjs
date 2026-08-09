import { existsSync, readFileSync } from 'node:fs';

const required = [
  'src/server.ts',
  'src/index.ts',
  'tests/server.test.ts',
  'docs/architecture/README.md',
  '.github/workflows/quality.yml',
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

console.log('Architecture check passed.');
