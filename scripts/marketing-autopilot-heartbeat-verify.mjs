import { readFile } from 'node:fs/promises';

const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
const token = process.env.GH_TOKEN;
const expectedName = process.env.HEARTBEAT_WORKFLOW_NAME || 'GitHub Native Instagram Publisher';
const expectedPath =
  process.env.HEARTBEAT_WORKFLOW_PATH || '.github/workflows/github-native-instagram-publisher.yml';
const fixturePath = process.env.MARKETING_AUTOPILOT_HEARTBEAT_RUN_FIXTURE;
const nowValue = process.env.MARKETING_AUTOPILOT_HEARTBEAT_NOW;

function fail(code) {
  throw new Error(code);
}

function requireString(value, code) {
  if (typeof value !== 'string' || value.length === 0) fail(code);
  return value;
}

function requireRunAttempt(value, code) {
  if (!Number.isInteger(value) || value !== 1) fail(code);
  return value;
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    fail(code);
  }
}

async function fetchRun(runId) {
  if (fixturePath) return readJson(fixturePath, 'MARKETING_AUTOPILOT_HEARTBEAT_FIXTURE_INVALID');
  requireString(repository, 'MARKETING_AUTOPILOT_HEARTBEAT_REPOSITORY_MISSING');
  requireString(token, 'MARKETING_AUTOPILOT_HEARTBEAT_TOKEN_MISSING');
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs/${encodeURIComponent(runId)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok) fail(`MARKETING_AUTOPILOT_HEARTBEAT_RUN_READBACK_HTTP_${response.status}`);
  return response.json();
}

const event = await readJson(
  requireString(eventPath, 'MARKETING_AUTOPILOT_HEARTBEAT_EVENT_PATH_MISSING'),
  'MARKETING_AUTOPILOT_HEARTBEAT_EVENT_INVALID',
);
const eventRun = event?.workflow_run;
if (event?.action !== 'completed' || typeof eventRun !== 'object' || eventRun === null) {
  fail('MARKETING_AUTOPILOT_HEARTBEAT_EVENT_NOT_COMPLETED');
}

const runId = String(eventRun.id ?? '');
if (!/^[0-9]+$/.test(runId)) fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_ID_INVALID');
if (eventRun.name !== expectedName) fail('MARKETING_AUTOPILOT_HEARTBEAT_EVENT_NAME_MISMATCH');
if (eventRun.event !== 'schedule') fail('MARKETING_AUTOPILOT_HEARTBEAT_EVENT_NOT_SCHEDULE');
if (eventRun.status !== 'completed' || eventRun.conclusion !== 'success') {
  fail('MARKETING_AUTOPILOT_HEARTBEAT_EVENT_NOT_SUCCESS');
}
if (eventRun.head_branch !== 'main') fail('MARKETING_AUTOPILOT_HEARTBEAT_EVENT_BRANCH_INVALID');
requireRunAttempt(eventRun.run_attempt, 'MARKETING_AUTOPILOT_HEARTBEAT_EVENT_ATTEMPT_INVALID');

const run = await fetchRun(runId);
if (String(run?.id ?? '') !== runId) fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_ID_MISMATCH');
if (run?.name !== expectedName) fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_NAME_MISMATCH');
if (run?.path !== expectedPath) fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_PATH_MISMATCH');
if (run?.event !== 'schedule') fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_NOT_SCHEDULE');
if (run?.status !== 'completed' || run?.conclusion !== 'success') {
  fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_NOT_SUCCESS');
}
if (run?.head_branch !== 'main') fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_BRANCH_INVALID');
requireRunAttempt(run?.run_attempt, 'MARKETING_AUTOPILOT_HEARTBEAT_RUN_ATTEMPT_INVALID');
if (repository && run?.repository?.full_name !== repository) {
  fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_REPOSITORY_MISMATCH');
}
if (eventRun.head_sha && run?.head_sha !== eventRun.head_sha) {
  fail('MARKETING_AUTOPILOT_HEARTBEAT_RUN_SHA_MISMATCH');
}

const updatedAt = requireString(
  run?.updated_at,
  'MARKETING_AUTOPILOT_HEARTBEAT_UPDATED_AT_MISSING',
);
const updatedEpoch = Date.parse(updatedAt);
const nowEpoch = nowValue ? Date.parse(nowValue) : Date.now();
if (!Number.isFinite(updatedEpoch) || !Number.isFinite(nowEpoch)) {
  fail('MARKETING_AUTOPILOT_HEARTBEAT_CLOCK_INVALID');
}
const heartbeatAgeSeconds = Math.floor((nowEpoch - updatedEpoch) / 1000);
if (heartbeatAgeSeconds < -120 || heartbeatAgeSeconds > 900) {
  fail('MARKETING_AUTOPILOT_HEARTBEAT_STALE');
}

process.stdout.write(
  `${JSON.stringify({
    status: 'VERIFIED',
    upstreamRunId: runId,
    upstreamHeadSha: run.head_sha,
    updatedAt,
    heartbeatAgeSeconds,
  })}\n`,
);
