import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-production-shadow-autodispatch.yml',
  'utf8',
);

describe('Instagram engagement production shadow issue autodispatch', () => {
  it('only accepts an owner-authored opened authorization issue on main', () => {
    expect(workflow).toContain('issues:');
    expect(workflow).toContain('types: [opened]');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain(
      'PRODUCTION AUTHORIZATION — Instagram conversation production shadow AUTO',
    );
  });

  it('binds authorization to exact main and immutable conversation-aware runtime', () => {
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_SHADOW=AUTHORIZED');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_DRS_CONTINUATION=AUTHORIZED');
    expect(workflow).toContain('PRODUCTION_MODE=SHADOW_ONLY');
    expect(workflow).toContain(
      'RUNTIME_SOURCE_SHA=bc9f02ff4663589c4f60fc585c89ca88b0369eba',
    );
    expect(workflow).toContain(
      'RUNTIME_IMAGE_DIGEST=sha256:4fdcea3fbc9e87f9790ca6cd6917176152104e840f6f37b31d680a42fa13b32a',
    );
  });

  it('keeps external reply writes disabled and requires explicit autodispatch', () => {
    expect(workflow).toContain('WRITE_BOUNDARY=INSTAGRAM_ENGAGEMENT_WRITES_ENABLED:false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('AUTO_DISPATCH_AUTHORIZED=true');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
  });

  it('dispatches only the canonical governed production shadow with governed inputs', () => {
    expect(workflow).toContain(
      'actions/workflows/instagram-engagement-shadow-production.yml/dispatches',
    );
    expect(workflow).toContain('DEPLOY_ENGAGEMENT_SHADOW');
    expect(workflow).toContain('authorization_ref:$authorizationRef');
  });
});
