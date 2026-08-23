import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface AcceptancePolicy {
  version: number;
  operation: string;
  capacity: {
    levels: number[];
    requestsPerLevel: number;
    maxErrorRate: number;
    destructiveStress: boolean;
  };
  forbid: {
    productionAccess: boolean;
    secretRead: boolean;
    destructiveStress: boolean;
  };
}

const WORKFLOW = readFileSync(
  '.github/workflows/staging-runtime-observability.yml',
  'utf8',
);
const POLICY = JSON.parse(
  readFileSync(
    'infra/observability/staging-runtime-observability-policy.json',
    'utf8',
  ),
) as AcceptancePolicy;

describe('staging runtime acceptance boundary', () => {
  it('is staging only', () => {
    const forbidden = [
      'INFRA_WIF',
      'INFRA_ADMIN_SA',
      'toca-mcp-infra-admin@toca-mcp-production',
      'add-iam-policy-binding',
      'secrets versions access',
    ];
    const stagingProvider =
      'workloadIdentityPools/github-staging/providers/github-toca-mcp-staging';

    for (const token of forbidden) {
      expect(WORKFLOW).not.toContain(token);
    }

    expect(WORKFLOW).toContain('Authenticate isolated staging operator only');
    expect(WORKFLOW).toContain(stagingProvider);
  });

  it('pins source and evidence SHA', () => {
    const required = [
      'ref: ${{ github.sha }}',
      'ACTUAL_CHECKOUT_SHA="$(git rev-parse HEAD)"',
      'test "$ACTUAL_CHECKOUT_SHA" = "$GITHUB_SHA"',
      '--arg triggerSha "$GITHUB_SHA"',
      '--arg actualCheckoutSha "$ACTUAL_CHECKOUT_SHA"',
    ];

    expect(WORKFLOW).not.toContain('ref: main');
    for (const token of required) {
      expect(WORKFLOW).toContain(token);
    }
  });

  it('requires exact runtime identity', () => {
    const required = [
      'expected_candidate_sha:',
      'expected_image_digest:',
      'TOCA_RELEASE_SHA',
      '(.percent // 0) == 100',
      'test "$traffic_count" = 1',
      'test "$traffic_sum" = 100',
      'test "$release_sha" = "$EXPECTED_CANDIDATE_SHA"',
      'test "$image_digest" = "$EXPECTED_IMAGE_DIGEST"',
      'test "$runtime_sa" = "$expected_sa"',
    ];

    for (const token of required) {
      expect(WORKFLOW).toContain(token);
    }
  });

  it('bounds capacity and telemetry', () => {
    const required = [
      'for concurrency in 1 5 10 25',
      'seq 1 50 | xargs -P "$concurrency"',
      'test "$errors" = 0',
      'recoveryAfterEachLevel:true',
      'container/cpu/utilizations',
      'container/memory/utilizations',
      'postgresql/num_backends',
    ];
    const expectedOperation =
      'staging-runtime-capacity-observability-verification';

    for (const token of required) {
      expect(WORKFLOW).toContain(token);
    }

    expect(POLICY.version).toBe(3);
    expect(POLICY.operation).toBe(expectedOperation);
    expect(POLICY.capacity.levels).toEqual([1, 5, 10, 25]);
    expect(POLICY.capacity.requestsPerLevel).toBe(50);
    expect(POLICY.capacity.maxErrorRate).toBe(0);
    expect(POLICY.capacity.destructiveStress).toBe(false);
    expect(POLICY.forbid.productionAccess).toBe(true);
    expect(POLICY.forbid.secretRead).toBe(true);
    expect(POLICY.forbid.destructiveStress).toBe(true);
  });
});
