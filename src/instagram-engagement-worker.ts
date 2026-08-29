import { hostname } from 'node:os';
import { loadConfig } from './config.js';
import { createInstagramEngagementBatchRuntime } from './instagram-engagement/runtime.js';
import { createPostgresPool } from './persistence/postgres.js';

const config = loadConfig();
if (!config.DATABASE_URL) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const workerId = `${process.env.K_REVISION?.trim() || hostname()}:instagram-engagement`;
const pollMs = boundedInteger(process.env.INSTAGRAM_ENGAGEMENT_POLL_MS, 1_000, 250, 60_000);
const runtime = createInstagramEngagementBatchRuntime({ config, pool, workerId });

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

console.log(
  'Instagram engagement worker started',
  JSON.stringify({
    workerId,
    writesEnabled: runtime.writesEnabled,
    knowledgeAuthMode: runtime.knowledgeAuthMode,
  }),
);

while (!stopping) {
  const result = await runtime.runBatch();
  if (result.claimed === 0) {
    await sleep(pollMs);
    continue;
  }
  console.log('Instagram engagement batch processed', JSON.stringify(result));
}

await pool.end();
console.log('Instagram engagement worker stopped');

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('INSTAGRAM_ENGAGEMENT_RUNTIME_INTEGER_INVALID');
  }
  return parsed;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
