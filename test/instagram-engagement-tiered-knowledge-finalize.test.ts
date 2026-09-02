import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/instagram-engagement-tiered-knowledge-finalize.yml';

describe('Instagram tiered knowledge finalization workflow', () => {
  it('uses Cloud Run job exit status as the readiness and retrieval authority', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain('Prove fail-closed tiered readiness by process exit');
    expect(workflow).toContain('dist/src/instagram-engagement-readiness-preflight.js');
    expect(workflow).toContain('Prove PostgreSQL menu and location retrieval by process exit');
    expect(workflow).toContain('dist/src/ops/verify-instagram-engagement-tiered-knowledge.js');
    expect(workflow).not.toContain('contains("instagram-engagement-readiness")');
    expect(workflow).not.toContain('contains("instagram-engagement-tiered-knowledge-smoke")');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('Roll back daemon on failed finalization');
  });
});
