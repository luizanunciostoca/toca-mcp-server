import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Instagram conversation operations readiness contract', () => {
  it('fails closed unless migration 038 and both conversation tables are present', async () => {
    const readiness = await readFile('src/instagram-engagement-readiness-preflight.ts', 'utf8');
    const migration = await readFile(
      'migrations/038_instagram_conversation_operations.sql',
      'utf8',
    );

    expect(readiness).toContain("'instagram_engagement_threads'");
    expect(readiness).toContain("'instagram_engagement_message_groups'");
    expect(readiness).toContain("'038_instagram_conversation_operations.sql'");
    expect(readiness).toContain('INSTAGRAM_ENGAGEMENT_CONVERSATION_MIGRATION_NOT_APPLIED');
    expect(readiness).toContain('conversationOperationsVerified: true');

    expect(migration).toContain('create table if not exists instagram_engagement_threads');
    expect(migration).toContain('create table if not exists instagram_engagement_message_groups');
    expect(migration).toContain("'AWAITING_APPROVAL'");
    expect(migration).toContain("'FOLLOW_UP_REQUIRED'");
    expect(migration).toContain("'ESCALATED'");
  });
});
