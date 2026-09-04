import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-shadow-runtime-build.yml',
  'utf8',
);

describe('Instagram engagement shadow runtime build-only workflow', () => {
  it('requires an owner-authored exact-main authorization issue', () => {
    expect(workflow).toContain('issues:');
    expect(workflow).toContain('types: [opened]');
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('github.event.issue.user.login == github.repository_owner');
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_SHADOW_RUNTIME_BUILD=AUTHORIZED');
  });

  it('requires explicit build-only boundaries and keeps side effects disabled', () => {
    for (const boundary of [
      'AUTO_BUILD_AUTHORIZED=true',
      'RUNTIME_BUILD_ONLY=true',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'SERVICE_DEPLOY_AUTHORIZED=false',
      'EXTERNAL_REPLY_WRITES_AUTHORIZED=false',
    ]) {
      expect(workflow).toContain(boundary);
    }

    expect(workflow).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(workflow).not.toContain('migrate-and-verify');
    expect(workflow).not.toContain('gcloud run ');
    expect(workflow).not.toContain('gcloud scheduler ');
  });

  it('only publishes an immutable Artifact Registry runtime and sanitized evidence', () => {
    expect(workflow).toContain('docker build --pull -t "$IMAGE_TAG" .');
    expect(workflow).toContain('docker push "$IMAGE_TAG"');
    expect(workflow).toContain('gcloud artifacts docker images describe');
    expect(workflow).toContain('^sha256:[0-9a-f]{64}$');
    expect(workflow).toContain('SHADOW_RUNTIME_BUILD_STATUS=PASS');
    expect(workflow).toContain('BUILD_ONLY=true');
    expect(workflow).toContain('DATABASE_MUTATIONS=false');
    expect(workflow).toContain('SERVICE_DEPLOY=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES=false');
  });

  it('always consumes and closes the single-use authorization after validation', () => {
    for (const marker of [
      'Consume single-use build authorization',
      "if: always() && env.AUTHORIZATION_ISSUE_NUMBER != ''",
      'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED',
      'AUTO_BUILD_AUTHORIZED=false',
      's/^AUTHORIZATION_STATE=ACTIVE$/AUTHORIZATION_STATE=CONSUMED_AND_CLOSED/',
      's/^AUTO_BUILD_AUTHORIZED=true$/AUTO_BUILD_AUTHORIZED=false/',
      '-f state=closed',
      '-f state_reason=completed',
      'SHADOW_RUNTIME_BUILD_AUTHORIZATION_CONSUMED=true',
    ]) {
      expect(workflow).toContain(marker);
    }
  });
});
