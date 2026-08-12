import { describe, expect, it } from 'vitest';
import { evaluateReadiness } from '../src/health/readiness.js';

describe('evaluateReadiness', () => {
  it('reports ready when all checks pass', async () => {
    const report = await evaluateReadiness([
      { name: 'database', check: () => Promise.resolve() },
      { name: 'secrets', check: () => Promise.resolve() },
    ]);
    expect(report).toEqual({
      status: 'ready',
      checks: [
        { name: 'database', ok: true },
        { name: 'secrets', ok: true },
      ],
    });
  });

  it('reports not_ready without leaking error details', async () => {
    const report = await evaluateReadiness([
      { name: 'database', check: () => Promise.reject(new Error('password=secret')) },
    ]);
    expect(report).toEqual({
      status: 'not_ready',
      checks: [{ name: 'database', ok: false }],
    });
    expect(JSON.stringify(report)).not.toContain('secret');
  });
});
