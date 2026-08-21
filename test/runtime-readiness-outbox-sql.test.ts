import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createRuntimeReadinessChecks } from '../src/health/runtime-readiness.js';

describe('runtime readiness outbox SQL', () => {
  it('applies FILTER to min(available_at) instead of the scalar extract expression', async () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://readiness.invalid/toca',
      MCP_ENABLED: 'true',
    };
    let observedSql = '';
    const pool = {
      query: (text: string) => {
        observedSql = text;
        return Promise.resolve({
          rows: [{ oldest_pending_age_seconds: 0, dead_letter_count: 0 }],
          rowCount: 1,
        });
      },
    } as unknown as pg.Pool;

    const outbox = createRuntimeReadinessChecks({
      config: loadConfig(env),
      env,
      pool,
    }).find((check) => check.name === 'outbox');

    expect(outbox).toBeDefined();
    await expect(outbox?.check()).resolves.toBeUndefined();

    const normalizedSql = observedSql.replace(/\s+/g, ' ').trim();
    expect(normalizedSql).toContain(
      "min(available_at) filter (where status in ('PENDING', 'FAILED_RETRYABLE'))",
    );
    expect(normalizedSql).not.toContain('extract(epoch from (now() - min(available_at))) filter');
  });
});
