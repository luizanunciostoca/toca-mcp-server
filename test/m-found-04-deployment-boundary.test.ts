import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('M-FOUND-04 deployment identity boundary', () => {
  it('keeps the production MCP Cloud Run service authentication-required', () => {
    const workflow = repositoryFile(
      '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml',
    );
    expect(workflow).toMatch(
      /gcloud run deploy "\$MCP_SERVICE_NAME"[\s\S]*?--no-allow-unauthenticated/,
    );
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
