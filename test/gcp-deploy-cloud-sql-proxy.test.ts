import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');
const evidenceScript = readFileSync('scripts/capture-platform-evidence.mjs', 'utf8');

describe('GCP deploy database least-privilege transport', () => {
  it('builds an immutable candidate before running migrations under the runtime identity', () => {
    const build = workflow.indexOf('Build attest push and resolve immutable image digest');
    const migrate = workflow.indexOf('Apply repository migrations through runtime identity job');
    expect(build).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(build);
    const block = workflow.slice(
      migrate,
      workflow.indexOf('Build non-secret runtime configuration', migrate),
    );
    expect(block).toContain('--image "$IMAGE"');
    expect(block).toContain('--service-account "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT"');
    expect(block).toContain('--set-cloudsql-instances');
    expect(block).toContain(
      '--set-secrets "DATABASE_URL=${GCP_DATABASE_URL_SECRET}:${GCP_DATABASE_URL_SECRET_VERSION}"',
    );
    expect(block).toContain('--args dist/scripts/migrate.js');
    expect(block).toContain('DATABASE_MIGRATION_JOB_CLEANUP=PASS');
    expect(block).toContain('secretPayloadDisclosed:false');
    expect(block).toContain('providerCallExecuted:false');
  });

  it('never reads the database secret payload into the deployer runner', () => {
    expect(workflow).not.toContain('RAW_DATABASE_URL=');
    expect(workflow).not.toContain('CLOUD_SQL_PROXY_PID');
    expect(workflow).not.toContain('cloud-sql-proxy');
    expect(workflow).not.toContain('url.hostname = "127.0.0.1"');
    expect(workflow).not.toContain(
      'gcloud secrets versions access "$GCP_DATABASE_URL_SECRET_VERSION"',
    );
  });

  it('captures sanitized database evidence under the same runtime identity and proves cleanup', () => {
    const start = workflow.indexOf(
      'Capture database Audit Outbox Workflow Privacy and migration refs through runtime identity job',
    );
    const end = workflow.indexOf('Capture non-secret deploy and provider evidence', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = workflow.slice(start, end);
    expect(block).toContain('--service-account "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT"');
    expect(block).toContain('--set-cloudsql-instances');
    expect(block).toContain('--args scripts/capture-platform-evidence.mjs,-');
    expect(block).toContain('PLATFORM_EVIDENCE_BASE64=');
    expect(block).toContain('database-runtime.json');
    expect(block).toContain('DATABASE_EVIDENCE_JOB_CLEANUP=PASS');
    expect(block).toContain('secretPayloadDisclosed:false');
  });

  it('ships only the sanitized evidence helper needed by the runtime-identity job', () => {
    expect(dockerfile).toContain(
      'COPY --from=build /app/scripts/capture-platform-evidence.mjs ./scripts/capture-platform-evidence.mjs',
    );
    expect(evidenceScript).toContain("const emitToStdout = outputTarget === '-';");
    expect(evidenceScript).toContain('PLATFORM_EVIDENCE_BASE64=');
  });

  it('does not open Cloud SQL authorized networks as a workaround', () => {
    expect(workflow).not.toContain('authorized-networks');
    expect(workflow).not.toContain('0.0.0.0/0');
  });
});
