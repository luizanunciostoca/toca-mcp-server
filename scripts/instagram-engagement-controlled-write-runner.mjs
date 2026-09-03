import { createHash } from 'node:crypto';
import { loadConfig } from '../dist/src/config.js';
import { createInstagramEngagementBatchRuntime } from '../dist/src/instagram-engagement/runtime.js';
import { createPostgresPool } from '../dist/src/persistence/postgres.js';

const session = requiredEnv('INSTAGRAM_ENGAGEMENT_CANARY_SESSION');
if (!/^[A-Za-z0-9._-]{8,120}$/.test(session)) throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_SESSION_INVALID');
if (process.env.INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED?.trim().toLowerCase() !== 'true') {
  throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_RUNTIME_MUST_BE_ENABLED');
}
if (process.env.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED?.trim().toLowerCase() !== 'true') {
  throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_WRITES_MUST_BE_ENABLED');
}
if (process.env.INSTAGRAM_ENGAGEMENT_BATCH_SIZE?.trim() !== '1') {
  throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_BATCH_SIZE_MUST_BE_ONE');
}

const config = loadConfig(process.env);
if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const workerHash = createHash('sha256').update(session, 'utf8').digest('hex').slice(0, 16);

try {
  const runtime = createInstagramEngagementBatchRuntime({
    config,
    pool,
    workerId: `instagram-canary:${workerHash}`,
  });
  if (!runtime.writesEnabled) throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_RUNTIME_WRITE_BOUNDARY_CLOSED');
  const result = await runtime.runBatch();
  if (result.claimed !== 1) throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_CLAIM_COUNT_INVALID');
  if (result.succeeded !== 1) throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_SUCCESS_COUNT_INVALID');
  if (result.failed !== 0) throw new Error('INSTAGRAM_ENGAGEMENT_CANARY_FAILURE_COUNT_INVALID');
  console.log('INSTAGRAM_ENGAGEMENT_CONTROLLED_WRITE_BATCH=PASS');
  console.log('CANARY_CLAIMED_COUNT=1');
  console.log('CANARY_SUCCEEDED_COUNT=1');
  console.log('CANARY_FAILED_COUNT=0');
} finally {
  await pool.end();
}

function requiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
}
