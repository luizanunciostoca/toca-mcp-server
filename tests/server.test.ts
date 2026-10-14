import { afterEach, describe, expect, it, vi } from 'vitest';
import * as capabilityEvidence from '../src/governance/capability-validation-evidence.js';
import { SERVER_NAME, SERVER_VERSION, createTocaServer } from '../src/server.js';

describe('TOCA MCP production foundation', () => {
  afterEach(() => vi.restoreAllMocks());
  it('exposes stable server metadata', () => {
    expect(SERVER_NAME).toBe('toca-mcp-server');
    expect(SERVER_VERSION).toBe('0.2.0');
    expect(
      createTocaServer({
        env: {
          NODE_ENV: 'test',
          MCP_ENABLED: 'true',
        },
      }),
    ).toBeDefined();
  });
  it('isolates nonwriters even when provider-write evidence is unavailable', () => {
    const loader = vi
      .spyOn(capabilityEvidence, 'loadCapabilityValidationEvidenceManifest')
      .mockImplementation(() => {
        throw new Error('CAPABILITY_VALIDATION_EVIDENCE_MANIFEST_NOT_FOUND');
      });
    expect(() =>
      createTocaServer({
        env: {
          NODE_ENV: 'test',
          MCP_ENABLED: 'true',
          TOCA_RELEASE_SHA: 'f'.repeat(40),
          INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'false',
        },
      }),
    ).not.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });

  it('forwards the release SHA and preserves exact-head failures for configured direct writers', () => {
    // The canonical manifest can be empty; test dependency enforcement independently of its contents.
    const loader = vi
      .spyOn(capabilityEvidence, 'loadCapabilityValidationEvidenceManifest')
      .mockImplementation(() => {
        throw new Error('CAPABILITY_EVIDENCE_MANIFEST_EXACT_HEAD_MISMATCH');
      });
    expect(() =>
      createTocaServer({
        env: {
          NODE_ENV: 'test',
          MCP_ENABLED: 'true',
          TOCA_RELEASE_SHA: 'f'.repeat(40),
          INSTAGRAM_PUBLICATION_WRITES_ENABLED: 'true',
          DATABASE_URL: 'postgres://example',
          INSTAGRAM_BUSINESS_ACCOUNT_ID: '17841402033495654',
          META_ACCESS_TOKEN_ENV_KEY: 'TEST_META_ACCESS_TOKEN',
          TEST_META_ACCESS_TOKEN: 'test-token',
        },
      }),
    ).toThrow('CAPABILITY_EVIDENCE_MANIFEST_EXACT_HEAD_MISMATCH');
    expect(loader).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith({ exactHeadSha: 'f'.repeat(40) });
  });
});
