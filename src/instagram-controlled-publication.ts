import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { runControlledInstagramPublication } from './worker/instagram-controlled-publication.js';
import { createInstagramPublicationRuntimeHandlers } from './worker/instagram-publication-runtime-bootstrap.js';
import { INSTAGRAM_PUBLICATION_JOB } from './worker/instagram-publication-job.js';

const config = loadConfig(process.env);

if (!config.INSTAGRAM_PUBLICATION_WRITES_ENABLED) {
  console.info('instagram.controlled-publication.disabled');
} else {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const rawRequest = readPublicationRequest(process.env);

  let payload: unknown;
  try {
    payload = JSON.parse(rawRequest);
  } catch {
    throw new Error('INSTAGRAM_PUBLICATION_REQUEST_JSON_INVALID');
  }

  const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
  try {
    const handlers = createInstagramPublicationRuntimeHandlers(config, pool);
    const handler = handlers.get(INSTAGRAM_PUBLICATION_JOB);
    if (!handler) throw new Error('INSTAGRAM_PUBLICATION_RUNTIME_NOT_CONFIGURED');

    await runControlledInstagramPublication({ payload, handler });
    console.info('instagram.controlled-publication.succeeded');
  } finally {
    await pool.end();
  }
}

function readPublicationRequest(env: NodeJS.ProcessEnv): string {
  const base64 = env.INSTAGRAM_PUBLICATION_REQUEST_BASE64?.trim();
  if (base64) {
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    if (!decoded.trim()) throw new Error('INSTAGRAM_PUBLICATION_REQUEST_JSON_REQUIRED');
    return decoded;
  }

  const json = env.INSTAGRAM_PUBLICATION_REQUEST_JSON;
  if (!json?.trim()) throw new Error('INSTAGRAM_PUBLICATION_REQUEST_JSON_REQUIRED');
  return json;
}
