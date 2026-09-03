import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/ops/instagram-engagement-canary-eligibility-readonly.ts',
  'utf8',
);
const workflow = readFileSync(
  '.github/workflows/instagram-engagement-canary-eligibility-readonly.yml',
  'utf8',
);

describe('Instagram canary read-only eligibility gate', () => {
  it('reuses the controlled-write safety eligibility contract', () => {
    for (const marker of [
      "classification.confidence !== 'HIGH'",
      "['P2', 'P3'].includes(classification.priority)",
      'classification.containsPotentialSensitiveData',
      "classification.commercialIntent !== 'NONE'",
      "classification.urgency !== 'LOW'",
      'AUTO_ELIGIBLE.has(classification.intent)',
      'match?.factsVerified',
      'match.faqId?.trim()',
    ]) {
      expect(source).toContain(marker);
    }
  });

  it('is database-read-only and provider-free', () => {
    expect(source).toContain("candidate.status = 'PENDING'");
    expect(source).toContain("candidate.payload->>'channel' = 'DIRECT'");
    expect(source).toContain('DATABASE_MUTATIONS=false');
    expect(source).toContain('PROVIDER_CALLS=false');
    expect(source).not.toMatch(
      /\b(update|insert into|delete from)\s+event_outbox\b/iu,
    );
    expect(source).not.toContain('InstagramGraphEngagementProvider');
    expect(source).not.toContain('MetaApiClient');
  });

  it('distinguishes absence of a target from an execution failure', () => {
    expect(source).toContain("'NO_ELIGIBLE_TARGET'");
    expect(source).toContain("'READY'");
    expect(source).toContain("'MULTIPLE_ELIGIBLE_TARGETS'");
    expect(source).toContain('ELIGIBLE_TARGET_SHA256');
    expect(source).not.toContain('console.log(text');
  });

  it('requires exact-main immutable-image authorization without external writes', () => {
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('RUNTIME_SOURCE_SHA=$GITHUB_SHA');
    expect(workflow).toContain('READ_ONLY_ELIGIBILITY=true');
    expect(workflow).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_CALLS_AUTHORIZED=false');
    expect(workflow).toContain('EXTERNAL_REPLY_WRITES_AUTHORIZED=false');
    expect(workflow).toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false');
    expect(workflow).not.toContain('TOCA_SECRET_META_ACCESS_TOKEN');
    expect(workflow).not.toContain('gcloud run services update');
  });

  it('publishes only bounded status, counts and a hashed target', () => {
    expect(workflow).toContain('ELIGIBILITY=${STATUS}');
    expect(workflow).toContain('ELIGIBLE_TARGET_SHA256=${TARGET_SHA:-NONE}');
    expect(workflow).toContain('RAW_USER_DATA_LOGGED=false');
    expect(workflow).not.toContain('payload->>');
  });
});
