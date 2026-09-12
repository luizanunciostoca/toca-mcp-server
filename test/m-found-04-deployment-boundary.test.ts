import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('M-FOUND-04 deployment identity boundary', () => {
  it('keeps the retired Instagram GCP daemon unable to deploy the production MCP service', () => {
    const workflow = repositoryFile(
      '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml',
    );

    expect(workflow).toContain('LEGACY_GCP_INSTAGRAM_DAEMON_RETIRED=1');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toMatch(/^\s*id-token:\s*write\s*$/m);
    expect(workflow).not.toMatch(/^\s*gcloud run deploy /m);
    expect(workflow).not.toContain('google-github-actions/auth');
  });

  it('removes the generic mcp-client requester from mutable MCP registration paths', () => {
    const server = repositoryFile('src/server.ts');
    const scheduler = repositoryFile('src/tools/register-instagram-managed-scheduler.ts');
    const metaAds = repositoryFile('src/tools/register-meta-ads-write.ts');

    expect(server).not.toContain("requester: 'mcp-client'");
    expect(scheduler).not.toContain("'mcp-client'");
    expect(metaAds).not.toContain("'mcp-client'");
  });
});
