import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface StagingObservabilityPolicy {
  readonly version: number;
  readonly operation: string;
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
    readonly latency: { readonly metricType: string; readonly aligner: string; readonly thresholdMilliseconds: number };
    readonly errorRate: { readonly metricType: string; readonly errorResponseClass: string; readonly thresholdRatio: number };
  };
  readonly requiredIamRoles: readonly string[];
  readonly forbid: Record<string, boolean>;
}

const policyPath = 'infra/observability/staging-runtime-observability-policy.json';
const workflowPath = '.github/workflows/staging-reliability-alerts.yml';
const runtimeWorkflowPath = '.github/workflows/staging-runtime-observability.yml';
const reconcilePath = 'ops/staging-runtime-observability-reconcile-v3.sh';

function policy(): StagingObservabilityPolicy {
  return JSON.parse(readFileSync(policyPath, 'utf8')) as StagingObservabilityPolicy;
}

describe('staging reliability alert reconciliation contract', () => {
  it('extends the canonical runtime/capacity policy instead of creating a second authority', () => {
    const config = policy();
    expect(config.version).toBe(3);
    expect(config.operation).toBe('staging-runtime-capacity-observability-verification');
    expect(config.notificationChannels).toMatchObject({
      managedLabel: 'staging_reliability',
      requiredEnabledCount: 2,
      requiredFamilies: ['email', 'webhook_tokenauth'],
    });
    expect(config.domainReadiness.map(({ id, checkName, alertRole }) => ({ id, checkName, alertRole }))).toEqual([
      { id: 'db', checkName: 'db', alertRole: 'db_readiness' },
      { id: 'ag01', checkName: 'ag01', alertRole: 'ag01_readiness' },
      { id: 'workflow', checkName: 'workflow', alertRole: 'workflow_readiness' },
      { id: 'approval', checkName: 'approval_store', alertRole: 'approval_readiness' },
      { id: 'crm', checkName: 'crm', alertRole: 'crm_readiness' },
      { id: 'outbox_dlq', checkName: 'outbox', alertRole: 'outbox_dlq_readiness' },
    ]);
  });

  it('uses canonical Cloud Run latency and 5xx ratio signals', () => {
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

  it('declares least-privilege staging roles and fail-closed restrictions', () => {
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

  it('keeps reconciliation staging-only and non-destructive outside Monitoring', () => {
    const script = readFileSync(reconcilePath, 'utf8');
    expect(script).toContain('ALERT_POLICY_DRIFT_REQUIRES_COORDINATION');
    expect(script).toContain('denominatorFilter:$denominator');
    expect(script).toContain('rm -f "$EVIDENCE_DIR/SHA256SUMS"');
    expect(script).not.toContain('-X DELETE');
    expect(script).not.toContain('gcloud sql');
    expect(script).not.toContain('gcloud run services update');
    expect(script).not.toContain('gcloud run services replace');
    expect(script).not.toContain('backups create');
    execFileSync('bash', ['-n', reconcilePath], { stdio: 'pipe' });
  });

  it('uses only staging WIF and preserves the runtime/capacity gate', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    const runtimeWorkflow = readFileSync(runtimeWorkflowPath, 'utf8');
    expect(workflow).toContain('expected_source_sha:');
    expect(workflow).toContain('bash "$RECONCILE_SCRIPT"');
    expect(workflow).toContain('projects/729069789107/locations/global/workloadIdentityPools/github-staging/providers/github-toca-mcp-staging');
    expect(workflow).not.toContain('projects/990081828836/locations/global/workloadIdentityPools');
    expect(workflow).not.toContain('toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com');
    expect(workflow).not.toContain('gcloud projects add-iam-policy-binding');
    expect(runtimeWorkflow).toContain('run_capacity:');
    expect(runtimeWorkflow).toContain('expected_candidate_sha:');
  });
});
