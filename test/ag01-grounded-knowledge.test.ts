import { describe, expect, it, vi } from 'vitest';
import {
  GoogleDriveCanonicalContentClient,
  VertexGroundedKnowledgeAnswerAdapter,
  rankResources,
} from '../src/orchestrator/grounded-knowledge.js';
import type {
  TocaOsCanonicalResource,
  TocaOsRegistryClient,
  TocaOsRegistrySnapshot,
} from '../src/orchestrator/toca-os-registry.js';

function resource(
  resourceId: string,
  overrides: Partial<TocaOsCanonicalResource> = {},
): TocaOsCanonicalResource {
  return {
    resourceId,
    driveId: `drive-${resourceId}`,
    title: resourceId,
    type: 'DOCUMENT',
    module: 'EVENTOS',
    logicalPath: `TOCA_OS/${resourceId}`,
    status: 'ACTIVE_CANONICAL',
    purpose: 'Programação oficial e informações do evento',
    lastValidatedAt: '2026-09-16T12:00:00Z',
    governanceStatus: 'CANONICAL',
    ...overrides,
  };
}

function snapshot(resources: readonly TocaOsCanonicalResource[]): TocaOsRegistrySnapshot {
  return {
    routes: new Map(),
    resources: new Map(resources.map((item) => [item.resourceId, item])),
    fetchedAt: '2026-09-16T12:00:00Z',
    evidence: ['toca-os:test-registry'],
  };
}

function registry(value: TocaOsRegistrySnapshot): TocaOsRegistryClient {
  return { snapshot: vi.fn().mockResolvedValue(value) };
}

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
}

describe('AG-01 grounded TOCA OS knowledge', () => {
  it('never reads a Drive file whose registry status is not ACTIVE_CANONICAL', async () => {
    const item = resource('DOC-LEGACY-001', { status: 'SUPERSEDED' });
    const fetchFn = fakeFetch(() => new Response('unexpected', { status: 500 }));
    const client = new GoogleDriveCanonicalContentClient({
      registry: registry(snapshot([item])),
      tokens: { getAccessToken: () => Promise.resolve('drive-token') },
      fetchFn,
    });

    await expect(client.read(item.resourceId)).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects unsupported binary content even for an ACTIVE_CANONICAL resource', async () => {
    const item = resource('DOC-BINARY-001');
    let calls = 0;
    const fetchFn = fakeFetch((url) => {
      calls += 1;
      expect(url).toContain(encodeURIComponent(item.driveId));
      return new Response(
        JSON.stringify({
          id: item.driveId,
          name: item.title,
          mimeType: 'application/pdf',
          modifiedTime: '2026-09-16T12:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const client = new GoogleDriveCanonicalContentClient({
      registry: registry(snapshot([item])),
      tokens: { getAccessToken: () => Promise.resolve('drive-token') },
      fetchFn,
    });

    await expect(client.read(item.resourceId)).resolves.toBeNull();
    expect(calls).toBe(1);
  });

  it('reads only canonical Google Docs content and returns evidence bound to resourceId and driveId', async () => {
    const item = resource('DOC-EVENT-001');
    const fetchFn = fakeFetch((url) => {
      if (url.includes('/export?')) {
        return new Response('Sunset oficial a partir das 16:30.', { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: item.driveId,
          name: item.title,
          mimeType: 'application/vnd.google-apps.document',
          modifiedTime: '2026-09-16T12:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const client = new GoogleDriveCanonicalContentClient({
      registry: registry(snapshot([item])),
      tokens: { getAccessToken: () => Promise.resolve('drive-token') },
      fetchFn,
    });

    const document = await client.read(item.resourceId);
    expect(document?.content).toContain('16:30');
    expect(document?.evidence).toContain(`toca-os:resource:${item.resourceId}`);
    expect(document?.evidence).toContain(`drive:file:${item.driveId}`);
  });

  it('ranks only ACTIVE_CANONICAL governed document resources', () => {
    const eligible = resource('DOC-EVENT-001', {
      title: 'Programação Sunset',
      purpose: 'Agenda e programação oficial do evento Sunset',
    });
    const superseded = resource('DOC-EVENT-OLD', {
      status: 'SUPERSEDED',
      title: 'Programação antiga Sunset',
    });
    const template = resource('TPL-EVENT-001', {
      title: 'Template Sunset',
    });

    const ranked = rankResources(
      'Qual a programação do sunset?',
      'EVENT_INFO',
      snapshot([eligible, superseded, template]),
    );
    expect(ranked.map((item) => item.resourceId)).toEqual(['DOC-EVENT-001']);
  });

  it('fails closed when the model cites a resource that was not supplied by the canonical loader', async () => {
    const document = {
      resourceId: 'DOC-EVENT-001',
      driveId: 'drive-DOC-EVENT-001',
      title: 'Programação oficial',
      logicalPath: 'TOCA_OS/DOC-EVENT-001',
      content: 'Sunset oficial a partir das 16:30.',
      modifiedTime: '2026-09-16T12:00:00Z',
      evidence: ['toca-os:resource:DOC-EVENT-001', 'drive:file:drive-DOC-EVENT-001'],
    } as const;
    const fetchFn = fakeFetch(() =>
      new Response(
        JSON.stringify({
          responseId: 'vertex-grounded-test',
          modelVersion: 'gemini-2.5-flash',
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: 'Resposta inventada.',
                      confidence: 0.99,
                      citedResourceIds: ['DOC-NOT-SUPPLIED'],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = new VertexGroundedKnowledgeAnswerAdapter({
      projectId: 'project-test',
      location: 'global',
      model: 'gemini-2.5-flash',
      timeoutMs: 1_000,
      maxRetries: 0,
      maxOutputTokens: 800,
      accessTokenProvider: { getAccessToken: () => Promise.resolve('vertex-token') },
      fetchFn,
    });

    await expect(
      adapter.answer({
        message: 'Qual a programação?',
        expectedIntent: 'EVENT_INFO',
        documents: [document],
      }),
    ).rejects.toThrow('AG01_GROUNDED_MODEL_UNKNOWN_CITATION');
  });
});
