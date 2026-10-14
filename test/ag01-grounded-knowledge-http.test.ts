import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAg01HttpServer } from '../src/orchestrator/http-server.js';
import type { Ag01ProductionRuntime } from '../src/orchestrator/production-runtime.js';

const servers: ReturnType<typeof createAg01HttpServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listen(runtime: Ag01ProductionRuntime): Promise<string> {
  const server = createAg01HttpServer(runtime);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function runtime(
  answerGroundedKnowledge: Ag01ProductionRuntime['answerGroundedKnowledge'],
): Ag01ProductionRuntime {
  return {
    serviceName: 'test-ag01',
    serviceVersion: '0.3.0-test',
    identity: {} as Ag01ProductionRuntime['identity'],
    runtimeCapabilityIds: [],
    followups: {} as Ag01ProductionRuntime['followups'],
    execute: () => Promise.reject(new Error('TEST_EXECUTE_NOT_EXPECTED')),
    resume: () => Promise.reject(new Error('TEST_RESUME_NOT_EXPECTED')),
    answerGroundedKnowledge,
    readiness: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

describe('AG-01 grounded knowledge HTTP boundary', () => {
  it('returns a grounded answer without exposing document contents', async () => {
    const answerGroundedKnowledge = vi.fn().mockResolvedValue({
      answer: 'O Sunset começa às 16:30.',
      confidence: 0.96,
      citedResourceIds: ['DOC-EVENT-001'],
      evidence: [
        'toca-os:resource:DOC-EVENT-001',
        'drive:file:drive-DOC-EVENT-001',
        'ag01:grounded-knowledge:drive-active-canonical-only',
      ],
      modelResponseId: 'vertex-1',
      model: 'gemini-2.5-flash',
    });
    const baseUrl = await listen(runtime(answerGroundedKnowledge));

    const response = await fetch(`${baseUrl}/v1/knowledge/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'http-grounded-1',
        message: 'Que horas começa o Sunset?',
        expectedIntent: 'EVENT_INFO',
        correlationId: 'corr-grounded-1',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe('corr-grounded-1');
    await expect(response.json()).resolves.toMatchObject({
      status: 'GROUNDED',
      answer: 'O Sunset começa às 16:30.',
      confidence: 0.96,
      citedResourceIds: ['DOC-EVENT-001'],
    });
    expect(answerGroundedKnowledge).toHaveBeenCalledWith({
      idempotencyKey: 'http-grounded-1',
      message: 'Que horas começa o Sunset?',
      expectedIntent: 'EVENT_INFO',
      correlationId: 'corr-grounded-1',
    });
  });

  it('rejects UNKNOWN before calling the grounded knowledge service', async () => {
    const answerGroundedKnowledge = vi.fn().mockResolvedValue(null);
    const baseUrl = await listen(runtime(answerGroundedKnowledge));

    const response = await fetch(`${baseUrl}/v1/knowledge/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'http-grounded-unknown',
        message: 'Me ajuda com isso',
        expectedIntent: 'UNKNOWN',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(answerGroundedKnowledge).not.toHaveBeenCalled();
  });

  it('returns NO_GROUNDED_ANSWER when canonical evidence is insufficient', async () => {
    const answerGroundedKnowledge = vi.fn().mockResolvedValue(null);
    const baseUrl = await listen(runtime(answerGroundedKnowledge));

    const response = await fetch(`${baseUrl}/v1/knowledge/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'http-grounded-none',
        message: 'Qual é a informação?',
        expectedIntent: 'FAQ_OPERATIONAL',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'NO_GROUNDED_ANSWER',
      answer: null,
      confidence: 0,
      citedResourceIds: [],
      evidence: [],
    });
  });
});
