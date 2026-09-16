import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-gcp-recovery-owner-command-gateway.yml',
  'utf8',
);

describe('Instagram GCP recovery owner-command gateway', () => {
  it('accepts only a created owner comment on the dedicated control issue', () => {
    expect(workflow).toContain('issue_comment:');
    expect(workflow).toContain('      - created');
    expect(workflow).toContain("github.event.issue.number == 862");
    expect(workflow).toContain("github.actor == 'luizanunciostoca'");
    expect(workflow).toContain("github.event.comment.user.login == 'luizanunciostoca'");
    expect(workflow).toContain("github.event.comment.author_association == 'OWNER'");
    expect(workflow).toContain(
      'expected_command="AUTHORIZE_GCP_INSTAGRAM_RECOVERY_PREFLIGHT ${AUTHORIZED_SOURCE_SHA}"',
    );
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

  it('binds authorization to live protected main and dispatches only the allowlisted preflight', () => {
    expect(workflow).toContain('refs/heads/main');
    expect(workflow).toContain('/git/ref/heads/main');
    expect(workflow).toContain('test "$live_main_sha" = "$AUTHORIZED_SOURCE_SHA"');
    expect(workflow).toContain(
      '/actions/workflows/instagram-gcp-publication-recovery-preflight.yml/dispatches',
    );
    expect(workflow).toContain("test \"$http_status\" = '204'");
  });
});
