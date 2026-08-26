import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const apply = process.argv.includes('--apply');
const verifyOnly = process.argv.includes('--verify');
const policy = JSON.parse(readFileSync('control/github-main-branch-protection.v1.json', 'utf8'));
const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
const apiBase = process.env.GITHUB_API_URL?.trim() || 'https://api.github.com';
const url = `${apiBase}/repos/${policy.repository}/branches/${policy.branch}/protection`;

if (!apply && !verifyOnly) {
  console.log(
    JSON.stringify(
      {
        mode: 'DRY_RUN',
        repository: policy.repository,
        branch: policy.branch,
        requiredContexts: policy.protection.required_status_checks.contexts,
        applyCommand: 'GITHUB_TOKEN=*** node scripts/apply-main-branch-protection.mjs --apply',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (!token) throw new Error('GITHUB_ADMIN_TOKEN_REQUIRED');

const before = await getProtection();
if (apply) {
  mkdirSync('artifacts', { recursive: true });
  const backupPath = `artifacts/main-branch-protection-before-${Date.now()}.json`;
  writeFileSync(backupPath, `${JSON.stringify(before, null, 2)}\n`, 'utf8');
  const response = await fetch(url, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(policy.protection),
  });
  if (!response.ok) {
    throw new Error(`BRANCH_PROTECTION_APPLY_FAILED:${response.status}:${await response.text()}`);
  }
  console.log(`BRANCH_PROTECTION_APPLIED backup=${backupPath}`);
}

const readback = await getProtection();
verifyReadback(readback, policy.protection);
console.log(
  `BRANCH_PROTECTION_READBACK=PASS repository=${policy.repository} branch=${policy.branch}`,
);

async function getProtection() {
  const response = await fetch(url, { headers: headers() });
  if (response.status === 404) return { missing: true };
  if (!response.ok) {
    throw new Error(`BRANCH_PROTECTION_READ_FAILED:${response.status}:${await response.text()}`);
  }
  return response.json();
}

function headers() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'toca-mcp-branch-protection-controller',
    'Content-Type': 'application/json',
  };
}

function verifyReadback(actual, expected) {
  if (actual.missing === true) throw new Error('BRANCH_PROTECTION_MISSING');
  const actualContexts = new Set(actual.required_status_checks?.contexts ?? []);
  for (const context of expected.required_status_checks.contexts) {
    if (!actualContexts.has(context))
      throw new Error(`BRANCH_PROTECTION_CONTEXT_MISSING:${context}`);
  }
  assert(
    actual.required_status_checks?.strict === expected.required_status_checks.strict,
    'BRANCH_PROTECTION_STRICT_MISMATCH',
  );
  assert(
    actual.enforce_admins?.enabled === expected.enforce_admins,
    'BRANCH_PROTECTION_ADMINS_MISMATCH',
  );
  const reviews = actual.required_pull_request_reviews;
  assert(
    reviews?.dismiss_stale_reviews === expected.required_pull_request_reviews.dismiss_stale_reviews,
    'BRANCH_PROTECTION_DISMISS_STALE_MISMATCH',
  );
  assert(
    reviews?.require_code_owner_reviews ===
      expected.required_pull_request_reviews.require_code_owner_reviews,
    'BRANCH_PROTECTION_CODEOWNERS_MISMATCH',
  );
  assert(
    reviews?.required_approving_review_count >=
      expected.required_pull_request_reviews.required_approving_review_count,
    'BRANCH_PROTECTION_REVIEW_COUNT_MISMATCH',
  );
  assert(
    reviews?.require_last_push_approval ===
      expected.required_pull_request_reviews.require_last_push_approval,
    'BRANCH_PROTECTION_LAST_PUSH_MISMATCH',
  );
  for (const [field, expectedValue] of Object.entries({
    required_linear_history: expected.required_linear_history,
    allow_force_pushes: expected.allow_force_pushes,
    allow_deletions: expected.allow_deletions,
    block_creations: expected.block_creations,
    required_conversation_resolution: expected.required_conversation_resolution,
    lock_branch: expected.lock_branch,
    allow_fork_syncing: expected.allow_fork_syncing,
  })) {
    assert(
      actual[field]?.enabled === expectedValue,
      `BRANCH_PROTECTION_READBACK_MISMATCH:${field}`,
    );
  }
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
