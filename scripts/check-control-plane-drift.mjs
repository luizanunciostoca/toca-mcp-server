import { pathToFileURL } from 'node:url';

const DEFAULT_API_URL = 'https://api.github.com';
const EVIDENCE_MARKER = 'TOCA_EXACT_MAIN_EVIDENCE_V1';

export function evaluateControlPlaneDrift({
  mainSha,
  stabilityBody,
  evidenceComments,
  expectedAuthor,
}) {
  const errors = [];
  if (!/^[a-f0-9]{40}$/.test(mainSha)) errors.push('CONTROL_PLANE_MAIN_SHA_INVALID');

  const stability = firstMarker(stabilityBody, /^MAIN_STABILITY=(\S+)$/m);
  const evaluatedSha = firstMarker(stabilityBody, /^EVALUATED_MAIN_SHA=([a-f0-9]{40})$/m);
  const reservation = firstMarker(stabilityBody, /^MERGE_RESERVATION=(\S+)$/m);

  if (stability !== 'PASS')
    errors.push(`CONTROL_PLANE_MAIN_STABILITY_INVALID:${stability ?? 'MISSING'}`);
  if (evaluatedSha !== mainSha) {
    errors.push(`CONTROL_PLANE_EVALUATED_MAIN_SHA_DRIFT:${evaluatedSha ?? 'MISSING'}:${mainSha}`);
  }
  if (reservation !== 'NONE') {
    errors.push(`CONTROL_PLANE_MERGE_RESERVATION_ACTIVE:${reservation ?? 'MISSING'}`);
  }

  if (!resolveExactMainEvidence({ evidenceComments, mainSha, expectedAuthor })) {
    errors.push(`CONTROL_PLANE_EXACT_MAIN_EVIDENCE_MISSING:${mainSha}`);
  }
  return errors;
}

export function resolveExactMainEvidence({ evidenceComments, mainSha, expectedAuthor }) {
  for (const comment of [...evidenceComments].reverse()) {
    if (comment.authorLogin !== expectedAuthor) continue;
    const record = parseEvidenceRecord(comment.body);
    if (!record || record.mainSha !== mainSha) continue;
    return record;
  }
  return null;
}

export function parseEvidenceRecord(body) {
  const lines = String(body).split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line.trim() === EVIDENCE_MARKER);
  if (markerIndex < 0) return null;
  const payload = lines.slice(markerIndex + 1).find((line) => line.trim().startsWith('{'));
  if (!payload) return null;

  let record;
  try {
    record = JSON.parse(payload);
  } catch {
    return null;
  }
  if (
    record?.schemaVersion !== 1 ||
    record?.recordType !== 'EXACT_MAIN_CERTIFICATION' ||
    !/^[a-f0-9]{40}$/.test(record?.mainSha ?? '') ||
    !isRunId(record?.qualityRunId) ||
    !isRunId(record?.autonomyRunId) ||
    !isRunId(record?.securityRunId)
  ) {
    return null;
  }
  return record;
}

export async function fetchAllIssueComments({ apiUrl, repository, issueNumber, token }) {
  const comments = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await githubJson(
      `${apiUrl}/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(batch)) throw new Error('CONTROL_PLANE_COMMENTS_RESPONSE_INVALID');
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments;
}

async function main() {
  const repository = requiredEnv('GITHUB_REPOSITORY');
  const candidateSha = requiredEnv('GITHUB_SHA');
  const token = requiredEnv('GITHUB_TOKEN');
  const apiUrl = process.env.GITHUB_API_URL?.trim() || DEFAULT_API_URL;
  const expectedAuthor =
    process.env.CONTROL_PLANE_EVIDENCE_AUTHOR?.trim() || repository.split('/')[0];

  const mainBranch = await githubJson(`${apiUrl}/repos/${repository}/branches/main`, token);
  const liveMainSha = mainBranch?.commit?.sha;
  if (liveMainSha !== candidateSha) {
    throw new Error(
      `CONTROL_PLANE_WATCH_STALE_CHECKOUT:${candidateSha}:${liveMainSha ?? 'MISSING'}`,
    );
  }

  const stabilityIssue = await githubJson(`${apiUrl}/repos/${repository}/issues/640`, token);
  const rawComments = await fetchAllIssueComments({
    apiUrl,
    repository,
    issueNumber: 641,
    token,
  });
  const evidenceComments = rawComments.map((comment) => ({
    body: String(comment?.body ?? ''),
    authorLogin: String(comment?.user?.login ?? ''),
  }));

  const errors = evaluateControlPlaneDrift({
    mainSha: candidateSha,
    stabilityBody: String(stabilityIssue?.body ?? ''),
    evidenceComments,
    expectedAuthor,
  });
  const record = resolveExactMainEvidence({
    evidenceComments,
    mainSha: candidateSha,
    expectedAuthor,
  });
  if (errors.length > 0 || !record) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }

  const runChecks = [
    [record.qualityRunId, 'Quality Gate'],
    [record.autonomyRunId, 'Autonomy Safety'],
    [record.securityRunId, 'Security Supply Chain'],
  ];
  for (const [runId, expectedName] of runChecks) {
    const run = await githubJson(`${apiUrl}/repos/${repository}/actions/runs/${runId}`, token);
    if (
      run?.head_sha !== candidateSha ||
      run?.name !== expectedName ||
      run?.event !== 'push' ||
      run?.status !== 'completed' ||
      run?.conclusion !== 'success'
    ) {
      console.error(
        `CONTROL_PLANE_ACTIONS_PROOF_INVALID:${expectedName}:${runId}:${run?.head_sha ?? 'MISSING'}:${run?.status ?? 'MISSING'}:${run?.conclusion ?? 'MISSING'}`,
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `CONTROL_PLANE_DRIFT_WATCH=PASS main=${candidateSha} evidence_author=${expectedAuthor}`,
  );
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'toca-control-plane-drift-watch',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`CONTROL_PLANE_GITHUB_READ_FAILED:${response.status}`);
  }
  return response.json();
}

function firstMarker(body, pattern) {
  const match = String(body).match(pattern);
  return match?.[1] ?? null;
}

function isRunId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
