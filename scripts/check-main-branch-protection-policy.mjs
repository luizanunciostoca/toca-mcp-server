import { readFileSync } from 'node:fs';

const policy = JSON.parse(readFileSync('control/github-main-branch-protection.v1.json', 'utf8'));
failUnless(policy.schemaVersion === '1.0.0', 'BRANCH_PROTECTION_SCHEMA_INVALID');
failUnless(
  policy.policyId === 'TOCA_GITHUB_MAIN_BRANCH_PROTECTION_V1',
  'BRANCH_PROTECTION_POLICY_ID_INVALID',
);
failUnless(
  policy.repository === 'luizanunciostoca/toca-mcp-server',
  'BRANCH_PROTECTION_REPOSITORY_INVALID',
);
failUnless(policy.branch === 'main', 'BRANCH_PROTECTION_BRANCH_INVALID');

const protection = policy.protection;
failUnless(
  protection?.required_status_checks?.strict === true,
  'BRANCH_PROTECTION_STRICT_CHECKS_REQUIRED',
);
failUnless(protection?.enforce_admins === true, 'BRANCH_PROTECTION_ADMIN_ENFORCEMENT_REQUIRED');
failUnless(
  protection?.required_pull_request_reviews?.dismiss_stale_reviews === true &&
    protection?.required_pull_request_reviews?.require_code_owner_reviews === true &&
    protection?.required_pull_request_reviews?.required_approving_review_count >= 1 &&
    protection?.required_pull_request_reviews?.require_last_push_approval === true,
  'BRANCH_PROTECTION_REVIEW_POLICY_INCOMPLETE',
);
for (const [field, expected] of Object.entries({
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: true,
})) {
  failUnless(protection?.[field] === expected, `BRANCH_PROTECTION_FIELD_INVALID:${field}`);
}

const workflows = [
  {
    context: 'quality',
    path: '.github/workflows/quality.yml',
    workflow: 'Quality Gate',
    job: 'quality',
  },
  {
    context: 'dependency-review',
    path: '.github/workflows/security-supply-chain.yml',
    workflow: 'Security Supply Chain',
    job: 'dependency-review',
  },
  {
    context: 'vulnerability-secret-container-sbom',
    path: '.github/workflows/security-supply-chain.yml',
    workflow: 'Security Supply Chain',
    job: 'vulnerability-secret-container-sbom',
  },
  {
    context: 'codeql',
    path: '.github/workflows/security-supply-chain.yml',
    workflow: 'Security Supply Chain',
    job: 'codeql',
  },
  {
    context: 'autonomy-safety',
    path: '.github/workflows/autonomy-safety.yml',
    workflow: 'Autonomy Safety',
    job: 'autonomy-safety',
  },
];
const requiredContexts = protection.required_status_checks.contexts;
failUnless(Array.isArray(requiredContexts), 'BRANCH_PROTECTION_CONTEXTS_INVALID');
for (const requirement of workflows) {
  failUnless(
    requiredContexts.includes(requirement.context),
    `BRANCH_PROTECTION_CONTEXT_MISSING:${requirement.context}`,
  );
  const workflow = readFileSync(requirement.path, 'utf8');
  failUnless(
    workflow.includes(`name: ${requirement.workflow}`),
    `BRANCH_PROTECTION_WORKFLOW_NAME_MISMATCH:${requirement.path}`,
  );
  failUnless(
    workflow.includes(`  ${requirement.job}:`),
    `BRANCH_PROTECTION_JOB_MISSING:${requirement.job}`,
  );
}

console.log(`MAIN_BRANCH_PROTECTION_POLICY_CHECK=PASS contexts=${requiredContexts.length}`);

function failUnless(condition, code) {
  if (condition) return;
  console.error(code);
  process.exit(1);
}
