import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { runInstagramPublicationWorkerBatch } from './worker/instagram-publication-worker-runtime.js';
import { runTocaManagedInstagramWorkerBatch } from './worker/toca-managed-instagram-worker-runtime.js';

const config = loadConfig(process.env);
const manualWorkerEnabled = config.INSTAGRAM_PUBLICATION_WRITES_ENABLED;
const tocaManagedWorkerEnabled = config.TOCA_MANAGED_INSTAGRAM_EXECUTOR_ENABLED;

if (manualWorkerEnabled && tocaManagedWorkerEnabled) {
  throw new Error('INSTAGRAM_PUBLICATION_WORKER_MODE_CONFLICT');
}

if (!manualWorkerEnabled && !tocaManagedWorkerEnabled) {
  console.info('instagram.publication.worker.disabled');
} else {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const tenantId = process.env.TOCA_DEFAULT_TENANT_ID?.trim();
  if (!tenantId) throw new Error('TOCA_DEFAULT_TENANT_ID_REQUIRED');
  const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
  try {
    if (tocaManagedWorkerEnabled) {
      const claimed = await runTocaManagedInstagramWorkerBatch({ config, pool, tenantId });
      console.info('instagram.publication.worker.toca_managed.completed', { claimed });
    } else {
      const claimed = await runInstagramPublicationWorkerBatch({ config, pool, tenantId });
      console.info('instagram.publication.worker.manual.completed', { claimed });
    }
  } finally {
    await pool.end();
  }
}
