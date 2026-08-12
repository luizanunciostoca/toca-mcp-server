import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { runInstagramPublicationReadinessPreflight } from './providers/instagram/instagram-publication-readiness-runtime.js';

const config = loadConfig(process.env);
if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');

const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
try {
  const readiness = await runInstagramPublicationReadinessPreflight({ config, pool });
  console.info('instagram.publication.readiness.ready', readiness);
} finally {
  await pool.end();
}
