import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

describe('PRO+ v2 control plane', () => {
  it('keeps mutable coordination state out of main commits', () => {
    const state = readJson('control/pro-plus/state-plane.json') as {
      storage: string;
      mutationsChangeMainSha: boolean;
      issues: Record<string, { number: number; externalSideEffectsAuthorized: boolean }>;
    };
    expect(state.storage).toBe('GITHUB_ISSUES');
    expect(state.mutationsChangeMainSha).toBe(false);
    expect(
      Object.values(state.issues)
        .map((entry) => entry.number)
        .sort((a, b) => a - b),
    ).toEqual([639, 640, 641, 642]);
    for (const entry of Object.values(state.issues))
      expect(entry.externalSideEffectsAuthorized).toBe(false);
  });

  it('fails closed on subjective artifact reuse and long-lived promotion as a default', () => {
    const build = readJson('control/pro-plus/build-broker-policy.json') as {
      mainStabilityRequired: boolean;
      artifactReusePolicy: string;
      sourceShaMustEqualCurrentMain: boolean;
      maxEvidenceCommentsScanned: number;
      evidenceLookupWindow: string;
      evidenceLookupMissAction: string;
      subjectiveEquivalenceAllowed: boolean;
    };
    const promotion = readJson('control/pro-plus/promotion-materialization-policy.json') as {
      defaultStrategy: string;
      longLivedDraftDefault: boolean;
      separatePromotionAuthorizationRequired: boolean;
    };
    expect(build.mainStabilityRequired).toBe(true);
    expect(build.artifactReusePolicy).toBe('EXACT_TREE_AND_RUNTIME_CONTRACT_ONLY');
    expect(build.sourceShaMustEqualCurrentMain).toBe(true);
    expect(build.maxEvidenceCommentsScanned).toBe(100);
    expect(build.evidenceLookupWindow).toBe('LATEST_100_COMMENTS');
    expect(build.evidenceLookupMissAction).toBe('REBUILD');
    expect(build.subjectiveEquivalenceAllowed).toBe(false);
    expect(promotion.defaultStrategy).toBe('MATERIALIZE_ON_DEMAND');
    expect(promotion.longLivedDraftDefault).toBe(false);
    expect(promotion.separatePromotionAuthorizationRequired).toBe(true);
  });

  it('keeps state-plane validation read-only and binds the Build Broker to evidence', () => {
    const validation = readFileSync(
      '.github/workflows/pro-plus-v2-state-plane-validation.yml',
      'utf8',
    );
    const stateValidation = readFileSync('scripts/check-pro-plus-v2-state-plane.mjs', 'utf8');
    const build = readFileSync(
      '.github/workflows/instagram-engagement-shadow-runtime-build.yml',
      'utf8',
    );
    expect(validation).toContain('issues: read');
    expect(validation).not.toContain('issues: write');
    expect(validation).not.toContain('--paginate --slurp');
    expect(validation).toContain('comments(last:100)');
    expect(validation).toContain("$GITHUB_EVENT_NAME\" == 'issue_comment'");
    expect(validation).toContain('check-pro-plus-v2-state-plane.mjs');
    expect(stateValidation).toContain("'MERGE_RESERVED'");
    expect(stateValidation).toContain("'MERGED'");
    expect(stateValidation).toContain("'POST_MERGE_ACCEPTANCE'");
    expect(stateValidation).toContain("const evidenceId = marker(body, 'EVIDENCE_ID');");
    expect(build).toContain('EVIDENCE_TYPE=IMMUTABLE_RUNTIME_BUILD');
    expect(build).toContain("RUNTIME_CONTRACT='SERVER_IMAGE_V1'");
    expect(build).not.toContain('--paginate --slurp');
    expect(build).toContain('comments(last:100)');
    expect(build).toContain('BUILD_BROKER_EVIDENCE_SCAN_LIMIT=100');
    expect(build).toContain('candidate_source_sha=$CANDIDATE_SOURCE_SHA');
    expect(build).toContain(
      'CANDIDATE_SOURCE_SHA: ${{ steps.broker.outputs.candidate_source_sha }}',
    );
    expect(build).toContain('SOURCE_SHA=$RUNTIME_SOURCE_SHA');
    expect(build).toContain('test "$RUNTIME_SOURCE_SHA" = "$GITHUB_SHA"');
    expect(build).toContain('BUILD_REUSED=');
    expect(build).toContain('key_count="$(grep -Ec "^${key}=" <<< "$STABILITY_BODY" || true)"');
    expect(build).toContain('value_count="$(grep -Fxc "$required" <<< "$STABILITY_BODY" || true)"');
    expect(build).toContain('marker must be unique and exact');
    expect(build).toContain('grep -Fxc "SOURCE_SHA=$GITHUB_SHA"');
    expect(build).toContain('grep -Fxc "TREE_SHA=$TREE_SHA"');
    expect(build).toContain('grep -Fxc "RUNTIME_CONTRACT=$RUNTIME_CONTRACT"');
  });
});
