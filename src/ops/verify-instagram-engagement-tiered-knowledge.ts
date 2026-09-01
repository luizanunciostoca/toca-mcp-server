import { PostgresInstagramEngagementKnowledgeBaseSource } from '../instagram-engagement/postgres-knowledge-base.js';
import { createPostgresPool } from '../persistence/postgres.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('INSTAGRAM_ENGAGEMENT_DATABASE_URL_REQUIRED');

const pool = createPostgresPool({ connectionString: databaseUrl });
const source = new PostgresInstagramEngagementKnowledgeBaseSource(pool, {
  minimumConfidence: 0.5,
  limit: 12,
});

try {
  const menu = await source.resolve('Quanto custa Pedra do Morcego?', 'FAQ_OPERATIONAL');
  const location = await source.resolve('Onde fica a Toca do Morcego?', 'LOCATION_HOURS');

  if (!menu || menu.tier !== 'KNOWLEDGE_BASE' || !menu.factsVerified || !menu.chunkId) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KB_SMOKE_MENU_FAILED');
  }
  if (!location || location.tier !== 'KNOWLEDGE_BASE' || !location.factsVerified || !location.chunkId) {
    throw new Error('INSTAGRAM_ENGAGEMENT_KB_SMOKE_LOCATION_FAILED');
  }

  console.log(
    JSON.stringify({
      validation: 'instagram-engagement-tiered-knowledge-smoke',
      status: 'PASS',
      menuResolved: true,
      locationResolved: true,
      menuFactsVerified: menu.factsVerified,
      locationFactsVerified: location.factsVerified,
      menuTier: menu.tier,
      locationTier: location.tier,
      answerContentPrinted: false,
      sourceContentPrinted: false,
      secretsPrinted: false,
    }),
  );
} finally {
  await pool.end();
}
