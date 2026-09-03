import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Instagram conversation shadow proof documentation', () => {
  it('documents the zero-write safety boundary and three required proof cases', async () => {
    const document = await readFile(
      'docs/architecture/instagram-conversation-shadow-proof-v1.md',
      'utf8',
    );

    expect(document).toContain('two nearby DIRECT messages');
    expect(document).toContain('LOW-confidence');
    expect(document).toContain('P0 harassment/threat');
    expect(document).toContain('no `instagram.engagement.reply.v1` outbox event');
    expect(document).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED');
    expect(document).toContain('must remain false');
  });
});
