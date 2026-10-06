import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const verifier = 'scripts/verify-cloud-run-service-absence.sh';
const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('Cloud Run service absence verifier', () => {
  it('passes only when a successful listing confirms the exact service is absent', () => {
    const result = runVerifier('absent');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('CLOUD_RUN_SERVICE_ABSENCE=PASS');
  });

  it('fails when the exact service is still present', () => {
    const result = runVerifier('present');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CLOUD_RUN_SERVICE_STILL_PRESENT:toca-webhook');
  });

  it('fails closed when Cloud Run listing/readback errors', () => {
    const result = runVerifier('error');
    expect(result.status).toBe(17);
    expect(result.stdout).not.toContain('CLOUD_RUN_SERVICE_ABSENCE=PASS');
  });

  it('uses an explicit project/region scoped list readback', () => {
    const source = readFileSync(verifier, 'utf8');
    expect(source).toContain('run services list');
    expect(source).toContain('--project "$PROJECT_ID"');
    expect(source).toContain('--region "$REGION"');
    expect(source).toContain("--format='value(metadata.name)'");
    expect(source).not.toContain('! "$GCLOUD_BIN"');
  });
});

function runVerifier(mode: 'absent' | 'present' | 'error') {
  const dir = mkdtempSync(join(tmpdir(), 'toca-gcloud-stub-'));
  cleanup.push(dir);
  const stub = join(dir, 'gcloud');
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "${MODE:-}" == error ]]; then
  echo "simulated readback failure" >&2
  exit 17
fi
[[ "$*" == *"run services list"* ]]
[[ "$*" == *"--project toca-project"* ]]
[[ "$*" == *"--region southamerica-east1"* ]]
if [[ "${MODE:-}" == present ]]; then
  printf '%s\\n' toca-webhook
else
  printf '%s\\n' another-service
fi
`,
  );
  chmodSync(stub, 0o755);
  return spawnSync('bash', [verifier, 'toca-webhook', 'toca-project', 'southamerica-east1'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, GCLOUD_BIN: stub, MODE: mode },
  });
}
