import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ag01 = readFileSync('.github/workflows/ag01-grounded-runtime-activation.yml', 'utf8');
const instagram = readFileSync(
  '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
  'utf8',
);
const guardian = readFileSync(
  '.github/workflows/ag01-grounded-activation-rollback-guardian.yml',
  'utf8',
);

describe('grounded production activation workflows', () => {
  it('keeps AG-01 private, zero-traffic first and provider-write free', () => {
    expect(ag01).toContain('AG01_GROUNDED_RUNTIME_ACTIVATION=AUTHORIZED');
    expect(ag01).toContain('DIRECT_PROVIDER_WRITE_AUTHORIZED=false');
    expect(ag01).toContain('EXTERNAL_BUSINESS_SIDE_EFFECTS_AUTHORIZED=false');
    expect(ag01).toContain('--no-traffic --no-allow-unauthenticated');
    expect(ag01).toContain('/v1/knowledge/answer');
    expect(ag01).toContain('.confidence>=0.85');
    expect(ag01).toContain('DRIVE_SCOPE=READ_ONLY');
    expect(ag01).not.toContain('--allow-unauthenticated');
  });

  it('activates Instagram fallback without widening autonomy or changing scheduler', () => {
    expect(instagram).toContain('INSTAGRAM_AG01_GROUNDED_FALLBACK_LIMITED_ACTIVATION=AUTHORIZED');
    expect(instagram).toContain('AUTO_REPLY_CHANNELS=DIRECT,COMMENT');
    expect(instagram).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
    expect(instagram).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(instagram).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(instagram).toContain('PROVIDER_CONFIG_MUTATION_AUTHORIZED=false');
    expect(instagram).toContain('INSTAGRAM_ENGAGEMENT_AG01_GROUNDED_FALLBACK_ENABLED=true');
    expect(instagram).toContain('--no-traffic --quiet');
    expect(instagram).toContain('DIRECT,COMMENT');
    expect(instagram).toContain('GENERAL_AUTONOMY=false');
  });

  it('restores canonical traffic if either activation fails after mutation', () => {
    expect(guardian).toContain('AG-01 Grounded Runtime Activation');
    expect(guardian).toContain('Instagram Engagement AG-01 Fallback LIMITED Activation');
    expect(guardian).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(guardian).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(guardian).toContain('historicalVerification.canonicalProductionRevision');
    expect(guardian).toContain('ENGAGEMENT_PROMOTED_REVISION=');
    expect(guardian).toContain('--to-revisions "$PREVIOUS_REVISION=100"');
    expect(guardian).not.toContain('scheduler jobs update');
  });
});
