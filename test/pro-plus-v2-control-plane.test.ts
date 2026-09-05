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
    expect(Object.values(state.issues).map((entry) => entry.number)).toEqual([639, 640, 641, 642]);
    for (const entry of Object.values(state.issues))
      expect(entry.externalSideEffectsAuthorized).toBe(false);
  });

  it('fails closed on subjective artifact reuse and long-lived promotion as a default', () => {
    const build = readJson('control/pro-plus/build-broker-policy.json') as {
      mainStabilityRequired: boolean;
      artifactReusePolicy: string;
      subjectiveEquivalenceAllowed: boolean;
    };
    const promotion = readJson('control/pro-plus/promotion-materialization-policy.json') as {
      defaultStrategy: string;
      longLivedDraftDefault: boolean;
      separatePromotionAuthorizationRequired: boolean;
    };
    expect(build.mainStabilityRequired).toBe(true);
    expect(build.artifactReusePolicy).toBe('EXACT_TREE_AND_RUNTIME_CONTRACT_ONLY');
    expect(build.subjectiveEquivalenceAllowed).toBe(false);
    expect(promotion.defaultStrategy).toBe('MATERIALIZE_ON_DEMAND');
    expect(promotion.longLivedDraftDefault).toBe(false);
    expect(promotion.separatePromotionAuthorizationRequired).toBe(true);
  });

  it('keeps state-plane validation read-only and binds the Build Broker to evidence', () => {
    const validation = readFileSync('.github/workflows/pro-plus-v2-state-plane-validation.yml', 'utf8');
    const build = readFileSync('.github/workflows/instagram-engagement-shadow-runtime-build.yml', 'utf8');
    expect(validation).toContain('issues: read');
    expect(validation).not.toContain('issues: write');
    expect(validation).toContain('check-pro-plus-v2-state-plane.mjs');
    expect(build).toContain('EVIDENCE_TYPE=IMMUTABLE_RUNTIME_BUILD');
    expect(build).toContain('RUNTIME_CONTRACT=SERVER_IMAGE_V1');
    expect(build).toContain('BUILD_REUSED=');
  });
});
