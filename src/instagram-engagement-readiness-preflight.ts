if (!process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_RANGE?.trim()) {
  process.env.INSTAGRAM_ENGAGEMENT_KNOWLEDGE_RANGE = 'FAQ_IA!A:T';
}

await import('./instagram-engagement-readiness-preflight-core.js');
