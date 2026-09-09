import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-limited-runtime-refresh.yml',
  'utf8',
);

describe('Instagram engagement LIMITED runtime refresh', () => {
  it('requires exact current main, current LIMITED state, and immutable runtime binding', () => {
    for (const marker of [
      'test "$CURRENT_MAIN_SHA" = "$GITHUB_SHA"',
      'AUTHORIZED_CONTROLLER_SHA=$GITHUB_SHA',
      'RUNTIME_SOURCE_SHA=$GITHUB_SHA',
      'RUNTIME_IMAGE_DIGEST=$RUNTIME_DIGEST',
      'CURRENT_LIMITED_STATE_REQUIRED=true',
      "grep -Fxq 'MAIN_STABILITY=PASS'",
      'EVALUATED_MAIN_SHA=$GITHUB_SHA',
      "grep -Fxq 'MERGE_RESERVATION=NONE'",
      'gcloud artifacts docker images describe',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('refuses to widen the serving autonomy envelope', () => {
    for (const marker of [
      'AUTONOMY_STAGE=LIMITED',
      'AUTO_REPLY_CHANNELS=DIRECT',
      'COMMENT_AUTO_REPLY_AUTHORIZED=false',
      'INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED=true',
      'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true',
      'INSTAGRAM_ENGAGEMENT_AUTO_REPLY_CHANNELS=DIRECT',
      'INSTAGRAM_PUBLICATION_WRITES_ENABLED=false',
      'INSTAGRAM_ENGAGEMENT_BATCH_SIZE=1',
      'COMMENT_AUTO_REPLY_ENABLED=false',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('stages at zero traffic, verifies the named candidate, and cuts over explicitly', () => {
    for (const marker of [
      '--no-traffic --quiet',
      'ZERO_TRAFFIC_STAGE_VERIFIED=true',
      'CANDIDATE_REVISION',
      'PRE_REVISION',
      'test "$CANDIDATE_REVISION" != "$PRE_REVISION"',
      'endswith($digest)',
      'gcloud run services update-traffic "$DAEMON_SERVICE_NAME"',
      '--to-revisions="${CANDIDATE_REVISION}=100" --quiet',
    ]) {
      expect(workflow).toContain(marker);
    }
  });

  it('does not migrate, mutate scheduler configuration, or send synthetic replies', () => {
    expect(workflow).toContain('DATABASE_MIGRATIONS_AUTHORIZED=false');
    expect(workflow).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('SCHEDULER_MUTATION=false');
    expect(workflow).not.toContain('migrate-and-verify');
    expect(workflow).not.toContain('gcloud scheduler jobs update');
    expect(workflow).not.toContain('gcloud scheduler jobs pause');
    expect(workflow).not.toContain('gcloud scheduler jobs resume');
    expect(workflow).not.toContain('sendDirectReply');
    expect(workflow).not.toContain('replyToComment');
  });

  it('fingerprints scheduler state and rolls traffic back on any failure', () => {
    expect(workflow).toContain("jq -c '{state,schedule,timeZone,httpTarget}'");
    expect(workflow).toContain('test "$POST_SCHEDULER_FINGERPRINT" = "$PRE_SCHEDULER_FINGERPRINT"');
    expect(workflow).toContain('Rollback traffic to previous LIMITED revision on failure');
    expect(workflow).toContain('--to-revisions="${PRE_REVISION}=100" --quiet');
    expect(workflow).toContain('ROLLBACK_ON_FAILURE=true');
  });
});
