import { describe, expect, it } from 'vitest';
// @ts-expect-error This production checker is intentionally a plain Node ESM script.
import * as checkerModule from '../scripts/check-control-plane-drift.mjs';

type DriftWatchInput = {
  readonly mainSha: string;
  readonly stabilityBody: string;
  readonly evidenceComments: readonly {
    readonly body: string;
    readonly authorLogin: string;
  }[];
  readonly expectedAuthor: string;
};

const checker = checkerModule as unknown as {
  readonly evaluateControlPlaneDrift: (input: DriftWatchInput) => string[];
  readonly evaluateRequiredWorkflowJobs: (input: {
    readonly workflowName: string;
    readonly runId: number;
    readonly jobsResponse: unknown;
  }) => string[];
  readonly parseEvidenceRecord: (body: string) => {
    readonly mainSha: string;
    readonly qualityRunId: number;
    readonly autonomyRunId: number;
    readonly securityRunId: number;
  } | null;
};
const { evaluateControlPlaneDrift, parseEvidenceRecord, evaluateRequiredWorkflowJobs } = checker;

const SHA = 'a'.repeat(40);
const OWNER = 'luizanunciostoca';

function stableBody(
  overrides: {
    stability?: string;
    evaluatedSha?: string;
    reservation?: string;
  } = {},
): string {
  return [
    `MAIN_STABILITY=${overrides.stability ?? 'PASS'}`,
    `EVALUATED_MAIN_SHA=${overrides.evaluatedSha ?? SHA}`,
    `MERGE_RESERVATION=${overrides.reservation ?? 'NONE'}`,
  ].join('\n');
}

function evidenceComment(
  overrides: Partial<{
    mainSha: string;
    qualityRunId: number;
    autonomyRunId: number;
    securityRunId: number;
    authorLogin: string;
  }> = {},
) {
  const record = {
    schemaVersion: 1,
    recordType: 'EXACT_MAIN_CERTIFICATION',
    mainSha: overrides.mainSha ?? SHA,
    qualityRunId: overrides.qualityRunId ?? 11,
    autonomyRunId: overrides.autonomyRunId ?? 22,
    securityRunId: overrides.securityRunId ?? 33,
  };
  return {
    authorLogin: overrides.authorLogin ?? OWNER,
    body: `TOCA_EXACT_MAIN_EVIDENCE_V1\n${JSON.stringify(record)}`,
  };
}

describe('control-plane drift watch', () => {
  it('accepts one owner-authored machine-readable exact-main evidence record', () => {
    expect(
      evaluateControlPlaneDrift({
        mainSha: SHA,
        stabilityBody: stableBody(),
        evidenceComments: [evidenceComment()],
        expectedAuthor: OWNER,
      }),
    ).toEqual([]);
  });

  it('fails closed when the evaluated main SHA is stale', () => {
    expect(
      evaluateControlPlaneDrift({
        mainSha: SHA,
        stabilityBody: stableBody({ evaluatedSha: 'b'.repeat(40) }),
        evidenceComments: [evidenceComment()],
        expectedAuthor: OWNER,
      }),
    ).toContain(`CONTROL_PLANE_EVALUATED_MAIN_SHA_DRIFT:${'b'.repeat(40)}:${SHA}`);
  });

  it('fails closed on non-PASS stability or an active merge reservation', () => {
    const errors = evaluateControlPlaneDrift({
      mainSha: SHA,
      stabilityBody: stableBody({ stability: 'FAIL', reservation: 'PR-999' }),
      evidenceComments: [evidenceComment()],
      expectedAuthor: OWNER,
    });
    expect(errors).toContain('CONTROL_PLANE_MAIN_STABILITY_INVALID:FAIL');
    expect(errors).toContain('CONTROL_PLANE_MERGE_RESERVATION_ACTIVE:PR-999');
  });

  it('does not accept prose PASS substrings as exact-main evidence', () => {
    expect(
      evaluateControlPlaneDrift({
        mainSha: SHA,
        stabilityBody: stableBody(),
        evidenceComments: [
          {
            authorLogin: OWNER,
            body: `${SHA} Quality result FAIL; prior PASS. Autonomy Safety NOT PASS. Security NOT PASS.`,
          },
        ],
        expectedAuthor: OWNER,
      }),
    ).toContain(`CONTROL_PLANE_EXACT_MAIN_EVIDENCE_MISSING:${SHA}`);
  });

  it('ignores a valid-looking record authored by an outsider', () => {
    expect(
      evaluateControlPlaneDrift({
        mainSha: SHA,
        stabilityBody: stableBody(),
        evidenceComments: [evidenceComment({ authorLogin: 'outsider' })],
        expectedAuthor: OWNER,
      }),
    ).toContain(`CONTROL_PLANE_EXACT_MAIN_EVIDENCE_MISSING:${SHA}`);
  });

  it('rejects a record for another SHA', () => {
    expect(
      evaluateControlPlaneDrift({
        mainSha: SHA,
        stabilityBody: stableBody(),
        evidenceComments: [evidenceComment({ mainSha: 'b'.repeat(40) })],
        expectedAuthor: OWNER,
      }),
    ).toContain(`CONTROL_PLANE_EXACT_MAIN_EVIDENCE_MISSING:${SHA}`);
  });

  it('rejects malformed run identifiers', () => {
    const body = `TOCA_EXACT_MAIN_EVIDENCE_V1\n${JSON.stringify({
      schemaVersion: 1,
      recordType: 'EXACT_MAIN_CERTIFICATION',
      mainSha: SHA,
      qualityRunId: 0,
      autonomyRunId: 22,
      securityRunId: 33,
    })}`;
    expect(parseEvidenceRecord(body)).toBeNull();
  });
  it('accepts all critical jobs while allowing push-only optional jobs to be skipped', () => {
    const jobs = [
      { name: 'codeql', run_id: 77, status: 'completed', conclusion: 'success' },
      { name: 'vulnerability-secret-container-sbom', run_id: 77, status: 'completed', conclusion: 'success' },
      { name: 'dependency-review', run_id: 77, status: 'completed', conclusion: 'skipped' },
    ];
    expect(
      evaluateRequiredWorkflowJobs({
        workflowName: 'Security Supply Chain',
        runId: 77,
        jobsResponse: { total_count: jobs.length, jobs },
      }),
    ).toEqual([]);
  });

  it('rejects a workflow-success result with a skipped CodeQL job', () => {
    const jobs = [
      { name: 'codeql', run_id: 77, status: 'completed', conclusion: 'skipped' },
      { name: 'vulnerability-secret-container-sbom', run_id: 77, status: 'completed', conclusion: 'success' },
    ];
    expect(
      evaluateRequiredWorkflowJobs({
        workflowName: 'Security Supply Chain',
        runId: 77,
        jobsResponse: { total_count: jobs.length, jobs },
      }),
    ).toContain('CONTROL_PLANE_ACTIONS_REQUIRED_JOB_INVALID:Security Supply Chain:77:codeql:skipped');
  });

  it('rejects missing, duplicated and failed required jobs', () => {
    const good = { name: 'quality', run_id: 77, status: 'completed', conclusion: 'success' };
    for (const jobs of [
      [{ ...good, name: 'unrelated' }],
      [good, good],
      [{ ...good, conclusion: 'failure' }],
      [{ ...good, status: 'queued', conclusion: null }],
    ]) {
      expect(
        evaluateRequiredWorkflowJobs({
          workflowName: 'Quality Gate',
          runId: 77,
          jobsResponse: { total_count: jobs.length, jobs },
        }),
      ).not.toEqual([]);
    }
  });

  it('rejects a required job returned from a different workflow run', () => {
    expect(
      evaluateRequiredWorkflowJobs({
        workflowName: 'Autonomy Safety',
        runId: 77,
        jobsResponse: {
          total_count: 1,
          jobs: [{ name: 'autonomy-safety', run_id: 78, status: 'completed', conclusion: 'success' }],
        },
      }),
    ).toContain('CONTROL_PLANE_ACTIONS_REQUIRED_JOB_INVALID:Autonomy Safety:77:autonomy-safety:WRONG_RUN');
  });

  it('fails closed on truncated, empty or invalid job API responses', () => {
    const good = { name: 'quality', run_id: 77, status: 'completed', conclusion: 'success' };
    for (const jobsResponse of [
      { total_count: 2, jobs: [good] },
      { total_count: 0, jobs: [] },
      { total_count: '1', jobs: [good] },
      { jobs: [good] },
      null,
    ]) {
      expect(
        evaluateRequiredWorkflowJobs({ workflowName: 'Quality Gate', runId: 77, jobsResponse }),
      ).toContain('CONTROL_PLANE_ACTIONS_JOBS_INCOMPLETE:Quality Gate:77');
    }
  });

  it('rejects unexpected workflow names rather than accepting no required jobs', () => {
    expect(
      evaluateRequiredWorkflowJobs({
        workflowName: 'Unknown Workflow',
        runId: 77,
        jobsResponse: { total_count: 0, jobs: [] },
      }),
    ).toEqual(['CONTROL_PLANE_ACTIONS_WORKFLOW_UNKNOWN:Unknown Workflow']);
  });

});
