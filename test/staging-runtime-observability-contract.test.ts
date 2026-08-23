import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface StagingObservabilityPolicy {
  readonly version: number;
  readonly notificationChannels: {
    readonly managedLabel: string;
    readonly requiredEnabledCount: number;
    readonly requiredFamilies: readonly string[];
  };
  readonly domainReadiness: readonly {
    readonly id: string;
    readonly checkName: string;
    readonly alertRole: string;
  }[];
  readonly nativeSignals: {
    readonly latency: {
      readonly metricType: string;
      readonly aligner: string;
      readonly thresholdMilliseconds: number;
    };
    readonly errorRate: {
      readonly metricType: string;
      readonly errorResponseClass: string;
      readonly thresholdRatio: number;
    };
  };
  readonly requiredIamRoles: readonly string[];
  readonly forbid: Record<string, boolean>;
}

const policyPath = 'infra/observability/staging-runtime-observability-policy.json';
const workflowPath = '.github/workflows/staging-runtime-observability.yml';
const reconcilePath = 'ops/staging-runtime-observability-reconcile-v3.sh';

function policy(): StagingObservabilityPolicy {
  return JSON.parse(readFileSync(policyPath, 'utf8')) as StagingObservabilityPolicy;
}

describe('staging runtime observability coverage contract', () => {
  it('materializes the required reliability domains from canonical readiness checks', () => {
    const config = policy();

    expect(config.version).toBe(3);
    expect(config.notificationChannels).toMatchObject({
      managedLabel: 'staging_reliability',
      requiredEnabledCount: 2,
      requiredFamilies: ['email', 'webhook_tokenauth'],
    });

    expect(
      config.domainReadiness.map(({ id, checkName, alertRole }) => ({ id, checkName, alertRole })),
    ).toEqual([
      { id: 'db', checkName: 'db', alertRole: 'db_readiness' },
      { id: 'ag01', checkName: 'ag01', alertRole: 'ag01_readiness' },
      { id: 'workflow', checkName: 'workflow', alertRole: 'workflow_readiness' },
      { id: 'approval', checkName: 'approval_store', alertRole: 'approval_readiness' },
      { id: 'crm', checkName: 'crm', alertRole: 'crm_readiness' },
      { id: 'outbox_dlq', checkName: 'outbox', alertRole: 'outbox_dlq_readiness' },
    ]);
  });

  it('uses Cloud Run native golden signals for latency and 5xx error ratio', () => {
    const config = policy();

    expect(config.nativeSignals.latency).toMatchObject({
      metricType: 'run.googleapis.com/request_latencies',
      aligner: 'ALIGN_PERCENTILE_95',
      thresholdMilliseconds: 2000,
    });
    expect(config.nativeSignals.errorRate).toMatchObject({
      metricType: 'run.googleapis.com/request_count',
      errorResponseClass: '5xx',
      thresholdRatio: 0.01,
    });
  });

  it('grants only the monitoring permissions required by the reconciliation', () => {
    const config = policy();

    expect(config.requiredIamRoles).toEqual([
      'roles/run.viewer',
      'roles/monitoring.viewer',
      'roles/monitoring.dashboardEditor',
      'roles/monitoring.uptimeCheckConfigEditor',
      'roles/monitoring.alertPolicyEditor',
    ]);
    expect(config.requiredIamRoles).not.toContain('roles/owner');
    expect(config.requiredIamRoles).not.toContain('roles/editor');
    expect(Object.values(config.forbid).every(Boolean)).toBe(true);
  });

  it('keeps domain probes read-only and isolates a failing domain from unrelated readiness failures', () => {
    const script = readFileSync(reconcilePath, 'utf8');

    expect(script).toContain(
      'acceptedResponseStatusCodes:[{statusClass:"STATUS_CLASS_2XX"},{statusValue:503}]',
    );
    expect(script).toContain(
      'contentMatchers:[{content:$matcher,matcher:"CONTAINS_STRING"}]',
    );
    expect(script).toContain('denominatorFilter:$denominator');
    expect(script).toContain('ALIGN_PERCENTILE_95');
    expect(script).not.toContain('gcloud sql');
    expect(script).not.toContain('gcloud run services update');
    expect(script).not.toContain('gcloud run services replace');
    expect(script).not.toContain('backups create');
    execFileSync('bash', ['-n', reconcilePath], { stdio: 'pipe' });
  });

  it('pins exact source provenance and invokes the single canonical reconciliation path', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('expected_source_sha:');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"');
    expect(workflow).toContain('bash "$RECONCILE_SCRIPT"');
    expect(workflow).toContain('roles/monitoring.alertPolicyEditor');
    expect(workflow).not.toContain('gcloud run services update');
    expect(workflow).not.toContain('gcloud sql');
  });
});
