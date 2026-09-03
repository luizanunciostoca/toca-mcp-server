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
    expect(workflow).toContain('RUNTIME_SOURCE_SHA=d166d2447b544cad81bc16b93e863e9c88c613a8');
    expect(workflow).toContain(
      'RUNTIME_IMAGE_DIGEST=sha256:44b24e15e0077f2386e426bdb65780318cf9f909b429bec508ffe723c7bb3339',
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
