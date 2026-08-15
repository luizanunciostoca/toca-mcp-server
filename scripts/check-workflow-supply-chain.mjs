import { readFile } from 'node:fs/promises';

const permanentWorkflows = [
  '.github/workflows/quality.yml',
  '.github/workflows/deploy-gcp.yml',
  '.github/workflows/deploy-instagram-publication-worker-gcp.yml',
  '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml',
  '.github/workflows/gcp-cost-hygiene.yml',
  '.github/workflows/infrastructure-control-plane.yml',
  '.github/workflows/marketing-autopilot-publication.yml',
  '.github/workflows/m-found-12-postgres-e2e.yml',
  '.github/workflows/m-found-12-provider-read.yml',
];

const immutableCommit = /^[a-f0-9]{40}$/i;
const failures = [];

for (const path of permanentWorkflows) {
  const source = await readFile(path, 'utf8');
  for (const [index, line] of source.split('\n').entries()) {
    const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/);
    if (!match) continue;
    const action = match[1];
    if (action.startsWith('./') || action.startsWith('docker://')) continue;
    const separator = action.lastIndexOf('@');
    const ref = separator >= 0 ? action.slice(separator + 1) : '';
    if (!immutableCommit.test(ref)) {
      failures.push(
        `${path}:${index + 1}: action must use an immutable 40-char commit SHA: ${action}`,
      );
    }
  }

  if (!/^permissions:\s*$/m.test(source)) {
    failures.push(`${path}: explicit top-level permissions block is required`);
  }
}

if (failures.length > 0) {
  console.error('WORKFLOW_SUPPLY_CHAIN_CHECK_FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`WORKFLOW_SUPPLY_CHAIN_CHECK_PASS=${permanentWorkflows.length}`);
