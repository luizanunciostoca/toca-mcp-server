import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/instagram-engagement-tiered-knowledge-shadow.yml';

describe('Instagram tiered knowledge shadow environment encoding', () => {
  it('preserves the comma-separated KB source list with a custom gcloud delimiter', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain('KB_SOURCE_IDS: SRC-OPS-001,SRC-MENU-002,SRC-LOC-001');
    expect(workflow).toContain('--set-env-vars "^#^$env_vars"');
    expect(workflow).toContain(
      'INSTAGRAM_ENGAGEMENT_KB_SOURCE_IDS=$KB_SOURCE_IDS#INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE=gcp-iam',
    );
    expect(workflow).toContain(
      '--set-env-vars "^#^NODE_ENV=production#META_ENABLED=false#INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true',
    );
    expect(workflow).toContain(
      '--update-env-vars "^#^INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true#INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false',
    );
    expect(workflow).not.toContain(
      'INSTAGRAM_ENGAGEMENT_KB_SOURCE_IDS=$KB_SOURCE_IDS,INSTAGRAM_ENGAGEMENT_GOOGLE_SHEETS_AUTH_MODE',
    );
  });
});
