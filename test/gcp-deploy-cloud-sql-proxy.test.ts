import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

describe('GCP deploy Cloud SQL transport', () => {
  it('pins and verifies the Cloud SQL Auth Proxy before repository database operations', () => {
    expect(workflow).toContain("PROXY_VERSION='2.24.1'");
    expect(workflow).toContain(
      "PROXY_SHA256='fae2766aac9d614a2bdef2f2a7778f3d054f3acd5ff07a81a9e300bd471512eb'",
    );
    expect(workflow).toContain('sha256sum --check --strict');
    expect(workflow).toContain('/tmp/cloud-sql-proxy --address 127.0.0.1 --port 5432');
    expect(workflow.indexOf('CLOUD_SQL_PROXY_READY=true')).toBeLessThan(
      workflow.indexOf('pnpm migrate'),
    );
  });

  it('rewrites secret database URLs to loopback and disables client TLS only behind the authenticated proxy', () => {
    expect(workflow).toContain('url.hostname = "127.0.0.1";');
    expect(workflow).toContain('url.port = "5432";');
    expect(workflow).toContain('url.searchParams.delete(key)');
    expect(workflow).toContain('export DATABASE_SSL=false');
  });

  it('does not open Cloud SQL authorized networks as a migration workaround', () => {
    expect(workflow).not.toContain('authorized-networks');
    expect(workflow).not.toContain('0.0.0.0/0');
  });

  it('uses the same authenticated proxy transport for evidence capture and cleans it up', () => {
    expect(workflow).toContain(
      'Capture database Audit Outbox Workflow Privacy and migration refs through authenticated proxy',
    );
    expect(workflow).toContain('Stop Cloud SQL Auth Proxy');
    expect(workflow).toContain('kill "$CLOUD_SQL_PROXY_PID"');
  });
});
