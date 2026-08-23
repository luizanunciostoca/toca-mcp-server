import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/staging-runtime-observability.yml';
const POLICY_PATH = 'infra/observability/staging-runtime-observability-policy.json';

function workflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

function policy(): Record<string, unknown> {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf8')) as Record<string, unknown>;
}

describe('staging runtime capacity observability acceptance boundary', () => {
  it('never authenticates to production or mutates IAM', () => {
    const source = workflow();

    expect(source).not.toContain('INFRA_WIF');
    expect(source).not.toContain('INFRA_ADMIN_SA');
    expect(source).not.toContain('toca-mcp-infra-admin@toca-mcp-production');
    expect(source).not.toContain('add-iam-policy-binding');
    expect(source).not.toContain('secrets versions access');
    expect(source).toContain('Authenticate isolated staging operator only');
    expect(source).toContain(
      'projects/729069789107/locations/global/workloadIdentityPools/github-staging/providers/github-toca-mcp-staging',
    );
  });

  it('pins workflow source and records trigger and actual checkout SHA separately', () => {
    const source = workflow();

    expect(source).toContain('ref: ${{ github.sha }}');
    expect(source).not.toContain('ref: main');
    expect(source).toContain('ACTUAL_CHECKOUT_SHA="$(git rev-parse HEAD)"');
    expect(source).toContain('test "$ACTUAL_CHECKOUT_SHA" = "$GITHUB_SHA"');
    expect(source).toContain('--arg triggerSha "$GITHUB_SHA"');
    expect(source).toContain('--arg actualCheckoutSha "$ACTUAL_CHECKOUT_SHA"');
  });

  it('fails closed unless exact candidate digest revision identity and 100 percent traffic agree', () => {
    const source = workflow();

    expect(source).toContain('expected_candidate_sha:');
    expect(source).toContain('expected_image_digest:');
    expect(source).toContain('TOCA_RELEASE_SHA');
    expect(source).toContain("(.percent // 0) == 100");
    expect(source).toContain('test "$traffic_count" = 1');
    expect(source).toContain('test "$traffic_sum" = 100');
    expect(source).toContain('test "$release_sha" = "$EXPECTED_CANDIDATE_SHA"');
    expect(source).toContain('test "$image_digest" = "$EXPECTED_IMAGE_DIGEST"');
    expect(source).toContain('test "$runtime_sa" = "$expected_sa"');
  });

  it('contains only bounded non-destructive capacity levels and recovery probes', () => {
    const source = workflow();
    const parsed = policy() as {
      capacity?: {
        levels?: number[];
        requestsPerLevel?: number;
        maxErrorRate?: number;
        destructiveStress?: boolean;
      };
      forbid?: { productionAccess?: boolean; secretRead?: boolean; destructiveStress?: boolean };
      operation?: string;
      version?: number;
    };

    expect(source).toContain('for concurrency in 1 5 10 25');
    expect(source).toContain('seq 1 50 | xargs -P "$concurrency"');
    expect(source).toContain('capacity stage returned non-200 response');
    expect(source).toContain('recoveryAfterEachLevel:true');
    expect(source).toContain('run.googleapis.com/container/cpu/utilizations');
    expect(source).toContain('run.googleapis.com/container/memory/utilizations');
    expect(source).toContain('cloudsql.googleapis.com/database/postgresql/num_backends');

    expect(parsed.version).toBe(3);
    expect(parsed.operation).toBe('staging-runtime-capacity-observability-verification');
    expect(parsed.capacity?.levels).toEqual([1, 5, 10, 25]);
    expect(parsed.capacity?.requestsPerLevel).toBe(50);
    expect(parsed.capacity?.maxErrorRate).toBe(0);
    expect(parsed.capacity?.destructiveStress).toBe(false);
    expect(parsed.forbid?.productionAccess).toBe(true);
    expect(parsed.forbid?.secretRead).toBe(true);
    expect(parsed.forbid?.destructiveStress).toBe(true);
  });
});
