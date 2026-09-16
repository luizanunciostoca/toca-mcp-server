import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-gcp-recovery-owner-command-gateway.yml',
  'utf8',
);

describe('Instagram GCP recovery owner-command gateway', () => {
  it('requires the dedicated owner command', () => {
    const guards = [
      'issue_comment:',
      '      - created',
      'github.event.issue.number == 862',
      "github.actor == 'luizanunciostoca'",
      "github.event.comment.user.login == 'luizanunciostoca'",
      "github.event.comment.author_association == 'OWNER'",
    ];

    for (const guard of guards) {
      expect(workflow).toContain(guard);
    }

    expect(workflow).toContain('expected_command=');
    expect(workflow).toContain('AUTHORIZE_GCP_INSTAGRAM_RECOVERY_PREFLIGHT');
    expect(workflow).toContain('${AUTHORIZED_SOURCE_SHA}');
  });

  it('has no production provider or cloud identity capability', () => {
    expect(workflow).toContain('actions: write');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('issues: read');
    expect(workflow).not.toContain('id-token: write');
    expect(workflow).not.toContain('google-github-actions/auth');
    expect(workflow).not.toContain('gcloud ');
    expect(workflow).not.toContain('META_ACCESS_TOKEN');
    expect(workflow).not.toContain('/media_publish');
  });

  it('dispatches only the allowlisted preflight from live main', () => {
    expect(workflow).toContain('refs/heads/main');
    expect(workflow).toContain('/git/ref/heads/main');
    expect(workflow).toContain('test "$live_main_sha" = "$AUTHORIZED_SOURCE_SHA"');
    expect(workflow).toContain('instagram-gcp-publication-recovery-preflight.yml');
    expect(workflow).toContain('/dispatches');
    expect(workflow).toContain('test "$http_status" = \'204\'');
  });
});
