import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};
const entrypoint = readFileSync('src/instagram-controlled-publication.ts', 'utf8');

describe('Controlled Instagram publication architecture', () => {
  it('uses a dedicated compiled entrypoint', () => {
    expect(packageJson.scripts?.['start:instagram-controlled-publication']).toBe(
      'node dist/src/instagram-controlled-publication.js',
    );
  });

  it('remains isolated from MCP capability registration and direct provider writes', () => {
    expect(entrypoint).toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED');
    expect(entrypoint).toContain('createInstagramPublicationRuntimeHandlers');
    expect(entrypoint).not.toContain("from './registry");
    expect(entrypoint).not.toContain('McpServer');
    expect(entrypoint).not.toContain('media_publish');
  });
});
