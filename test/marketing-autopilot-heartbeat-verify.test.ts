import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'scripts/marketing-autopilot-heartbeat-verify.mjs';
const repository = 'luizanunciostoca/toca-mcp-server';
const workflowName = 'GitHub Native Instagram Publisher';
const workflowPath = '.github/workflows/github-native-instagram-publisher.yml';
const runId = 35138109900;
const headSha = '9ac2c98cd535fae46691b3f2750cf1be49228830';
const updatedAt = '2026-09-16T19:02:47Z';
const now = '2026-09-16T19:07:47Z';

function eventFixture(overrides: Record<string, unknown> = {}) {
  return {
    action: 'completed',
    workflow_run: {
      id: runId,
      name: workflowName,
      event: 'schedule',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      head_sha: headSha,
      run_attempt: 1,
      ...overrides,
    },
  };
}

function runFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    name: workflowName,
    path: workflowPath,
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: headSha,
    run_attempt: 1,
    updated_at: updatedAt,
    repository: { full_name: repository },
    ...overrides,
  };
}

function verify({
  event = eventFixture(),
  run = runFixture(),
  clock = now,
}: {
  event?: Record<string, unknown>;
  run?: Record<string, unknown>;
  clock?: string;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'toca-heartbeat-'));
  const eventPath = join(dir, 'event.json');
  const runPath = join(dir, 'run.json');
  writeFileSync(eventPath, `${JSON.stringify(event)}\n`, 'utf8');
  writeFileSync(runPath, `${JSON.stringify(run)}\n`, 'utf8');
  return spawnSync('node', [script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: repository,
      GITHUB_EVENT_PATH: eventPath,
      HEARTBEAT_WORKFLOW_NAME: workflowName,
      HEARTBEAT_WORKFLOW_PATH: workflowPath,
      MARKETING_AUTOPILOT_HEARTBEAT_RUN_FIXTURE: runPath,
      MARKETING_AUTOPILOT_HEARTBEAT_NOW: clock,
    },
  });
}

describe('Marketing Autopilot trusted schedule heartbeat', () => {
  it('accepts a fresh scheduled main run only after canonical REST-shape readback', () => {
    const result = verify();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'VERIFIED',
      upstreamRunId: String(runId),
      upstreamHeadSha: headSha,
      heartbeatAgeSeconds: 300,
    });
  });

  it.each([
    ['wrong workflow path', eventFixture(), runFixture({ path: '.github/workflows/other.yml' })],
    ['manual upstream event', eventFixture({ event: 'workflow_dispatch' }), runFixture()],
    ['wrong branch', eventFixture({ head_branch: 'feature' }), runFixture()],
    ['failed upstream', eventFixture({ conclusion: 'failure' }), runFixture()],
    ['rerun attempt', eventFixture({ run_attempt: 2 }), runFixture()],
    ['SHA mismatch', eventFixture(), runFixture({ head_sha: '1'.repeat(40) })],
  ])('rejects %s', (_name, event, run) => {
    const result = verify({ event, run });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MARKETING_AUTOPILOT_HEARTBEAT_');
  });

  it('rejects a heartbeat older than the bounded freshness window', () => {
    const result = verify({ clock: '2026-09-16T19:17:48Z' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MARKETING_AUTOPILOT_HEARTBEAT_STALE');
  });

  it('rejects a canonical readback with a retry attempt even when the event payload claims attempt one', () => {
    const result = verify({ run: runFixture({ run_attempt: 2 }) });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MARKETING_AUTOPILOT_HEARTBEAT_RUN_ATTEMPT_INVALID');
  });
});
