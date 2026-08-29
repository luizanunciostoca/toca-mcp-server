import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-unique-candidate-autodispatch.yml',
  'utf8',
);

describe('Instagram engagement shadow issue autodispatch', () => {
  it('only accepts an owner-authored opened authorization issue on main', () => {
    expect(workflow).toContain('issues:');
    expect(workflow).toContain('types: [opened]');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain(
      'PRODUCTION AUTHORIZATION — Instagram daemon-routed unique candidate shadow recovery AUTO',
    );
  });

  it('binds the authorization to the exact main SHA and keeps writes disabled', () => {
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('AUTO_DISPATCH_AUTHORIZED=true');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
  });

  it('dispatches only the canonical unique-candidate recovery with governed inputs', () => {
    expect(workflow).toContain(
      'actions/workflows/instagram-engagement-shadow-unique-candidate-recovery.yml/dispatches',
    );
    expect(workflow).toContain('RECOVER_ENGAGEMENT_SHADOW_UNIQUE_CANDIDATE');
    expect(workflow).toContain('authorization_ref:$authorizationRef');
    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
  });
});
