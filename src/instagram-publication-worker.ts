import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { runInstagramPublicationWorkerBatch } from './worker/instagram-publication-worker-runtime.js';

const config = loadConfig(process.env);

if (!config.INSTAGRAM_PUBLICATION_WRITES_ENABLED) {
  console.info('instagram.publication.worker.disabled');
} else {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
  try {
    const claimed = await runInstagramPublicationWorkerBatch({ config, pool });
    console.info('instagram.publication.worker.completed', { claimed });
  } finally {
    await pool.end();
  }
}
