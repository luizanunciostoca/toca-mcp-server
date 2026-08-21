import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
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

function runtimeWithFollowupTick(onTick: (limit: number) => void): Ag01ProductionRuntime {
  return {
    serviceName: 'test-ag01',
    serviceVersion: 'test',
    identity: {} as Ag01ProductionRuntime['identity'],
    runtimeCapabilityIds: [],
    followups: {
      tick(limit: number) {
        onTick(limit);
        return Promise.resolve({
          firedTimerIds: ['timer-1', 'timer-2'],
          processedWorkflowIds: ['workflow-1'],
        });
      },
    } as unknown as Ag01ProductionRuntime['followups'],
    execute: () => Promise.reject(new Error('TEST_EXECUTE_NOT_EXPECTED')),
    resume: () => Promise.reject(new Error('TEST_RESUME_NOT_EXPECTED')),
    readiness: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

describe('AG-01 durable follow-up wake boundary', () => {
  it('wakes the existing Workflow timer pump without requiring a request body', async () => {
    const limits: number[] = [];
    const baseUrl = await listen(runtimeWithFollowupTick((limit) => limits.push(limit)));

    const response = await fetch(`${baseUrl}/v1/orchestrator/followups/tick`, {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      firedTimerCount: 2,
      processedWorkflowCount: 1,
    });
    expect(limits).toEqual([100]);
  });

  it('refuses non-POST wake requests without firing timers', async () => {
    const limits: number[] = [];
    const baseUrl = await listen(runtimeWithFollowupTick((limit) => limits.push(limit)));

    const response = await fetch(`${baseUrl}/v1/orchestrator/followups/tick`);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    await expect(response.json()).resolves.toEqual({ error: 'method_not_allowed' });
    expect(limits).toHaveLength(0);
  });
});
