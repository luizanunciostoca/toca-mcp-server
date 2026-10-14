import { describe, expect, it, vi } from 'vitest';
import { Ag01GroundedInstagramKnowledgeSource } from '../src/instagram-engagement/ag01-grounded-knowledge.js';
import { MultiIntentInstagramEngagementKnowledgeSource } from '../src/instagram-engagement/multi-intent-knowledge.js';
import type {
  InstagramEngagementKnowledgeMatch,
  InstagramEngagementKnowledgeSource,
} from '../src/instagram-engagement/knowledge.js';

function jwt(expSeconds = Math.floor(Date.now() / 1000) + 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function groundedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'GROUNDED',
    answer: 'A informação oficial está confirmada no TOCA OS.',
    confidence: 0.94,
    citedResourceIds: ['DOC-TEST-001'],
    evidence: [
      'ag01:grounded-knowledge:drive-active-canonical-only',
      'toca-os:resource:DOC-TEST-001',
    ],
    modelResponseId: 'vertex-response-1',
    model: 'gemini-2.5-flash',
    ...overrides,
  };
}

function createFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
}

describe('Instagram AG-01 grounded fallback', () => {
  it('never reaches metadata or AG-01 for UNKNOWN intent', async () => {
    const fetchFn = createFetch(() => new Response('unexpected', { status: 500 }));
    const source = new Ag01GroundedInstagramKnowledgeSource({
      serviceUrl: 'https://ag01.example.test',
      fetchFn,
    });

    await expect(source.resolve('me ajuda com isso', 'UNKNOWN')).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('accepts only grounded answers with matching TOCA OS evidence', async () => {
    const fetchFn = createFetch((url) => {
      if (url.startsWith('http://metadata.google.internal/')) {
        return new Response(jwt(), { status: 200 });
      }
      return new Response(JSON.stringify(groundedBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const source = new Ag01GroundedInstagramKnowledgeSource({
      serviceUrl: 'https://ag01.example.test',
      fetchFn,
    });

    const match = await source.resolve('Qual é a política de entrada?', 'FAQ_OPERATIONAL');
    expect(match).toMatchObject({
      factsVerified: true,
      confidence: 0.94,
      tier: 'KNOWLEDGE_BASE',
      source: 'AG01_TOCA_OS_DRIVE:DOC-TEST-001',
    });
  });

  it('rejects a cited resource when AG-01 did not return matching evidence', async () => {
    const fetchFn = createFetch((url) => {
      if (url.startsWith('http://metadata.google.internal/')) {
        return new Response(jwt(), { status: 200 });
      }
      return new Response(
        JSON.stringify(
          groundedBody({
            citedResourceIds: ['DOC-FALSE-999'],
            evidence: ['ag01:grounded-knowledge:drive-active-canonical-only'],
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const source = new Ag01GroundedInstagramKnowledgeSource({
      serviceUrl: 'https://ag01.example.test',
      fetchFn,
    });

    await expect(source.resolve('Qual é a regra?', 'FAQ_OPERATIONAL')).resolves.toBeNull();
  });

  it('opens the circuit after repeated AG-01 failures and stops further network calls', async () => {
    let now = 1_800_000_000_000;
    let serviceCalls = 0;
    const fetchFn = createFetch((url) => {
      if (url.startsWith('http://metadata.google.internal/')) {
        return new Response(jwt(Math.floor(now / 1000) + 3600), { status: 200 });
      }
      serviceCalls += 1;
      return new Response('unavailable', { status: 503 });
    });
    const source = new Ag01GroundedInstagramKnowledgeSource({
      serviceUrl: 'https://ag01.example.test',
      fetchFn,
      now: () => now,
      sleep: () => Promise.resolve(),
      circuitFailureThreshold: 3,
      circuitOpenMs: 60_000,
    });

    await source.resolve('Pergunta 1', 'FAQ_OPERATIONAL');
    await source.resolve('Pergunta 2', 'FAQ_OPERATIONAL');
    await source.resolve('Pergunta 3', 'FAQ_OPERATIONAL');
    expect(serviceCalls).toBe(6);

    await source.resolve('Pergunta 4', 'FAQ_OPERATIONAL');
    expect(serviceCalls).toBe(6);

    now += 60_001;
    await source.resolve('Pergunta 5', 'FAQ_OPERATIONAL');
    expect(serviceCalls).toBe(8);
  });

  it('keeps deterministic FAQ resolution ahead of AG-01 fallback', async () => {
    const deterministic: InstagramEngagementKnowledgeMatch = {
      faqId: 'FAQ-001',
      intent: 'FAQ_OPERATIONAL',
      answer: 'Resposta determinística.',
      source: 'TOCA_OS',
      confidence: 1,
      factsVerified: true,
      tier: 'FAQ',
    };
    const delegate: InstagramEngagementKnowledgeSource = {
      resolve: vi.fn().mockResolvedValue(deterministic),
    };
    const fallbackResolve = vi.fn().mockResolvedValue(null);
    const fallback: InstagramEngagementKnowledgeSource = { resolve: fallbackResolve };
    const source = new MultiIntentInstagramEngagementKnowledgeSource(delegate, {
      groundedFallback: fallback,
    });

    await expect(source.resolve('Pergunta conhecida', 'FAQ_OPERATIONAL')).resolves.toEqual(
      deterministic,
    );
    expect(fallbackResolve).not.toHaveBeenCalled();
  });

  it('keeps the deterministic current-programming resolver ahead of AG-01', async () => {
    const delegate: InstagramEngagementKnowledgeSource = {
      resolve: vi.fn().mockResolvedValue(null),
    };
    const fallbackResolve = vi.fn().mockResolvedValue(null);
    const fallback: InstagramEngagementKnowledgeSource = { resolve: fallbackResolve };
    const source = new MultiIntentInstagramEngagementKnowledgeSource(delegate, {
      groundedFallback: fallback,
      now: () => new Date('2026-09-18T15:00:00-03:00'),
    });

    const result = await source.resolve('Qual a programação de hoje?', 'EVENT_INFO');
    expect(result?.factsVerified).toBe(true);
    expect(fallbackResolve).not.toHaveBeenCalled();
  });
});
