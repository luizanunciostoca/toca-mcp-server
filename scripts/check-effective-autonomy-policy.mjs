import { readFileSync } from 'node:fs';

const path = 'control/effective-autonomy-policy.v1.json';
const policy = JSON.parse(readFileSync(path, 'utf8'));

failUnless(policy.schemaVersion === '1.0.0', 'AUTONOMY_POLICY_SCHEMA_INVALID');
failUnless(policy.policyId === 'TOCA_EFFECTIVE_AUTONOMY_POLICY_V1', 'AUTONOMY_POLICY_ID_INVALID');
failUnless(policy.status === 'ACTIVE_CANONICAL', 'AUTONOMY_POLICY_NOT_CANONICAL');
failUnless(
  policy.scheduling?.canonicalPolicy === 'TOCA_MANAGED_SCHEDULING',
  'AUTONOMY_POLICY_SCHEDULING_NOT_MANAGED',
);
failUnless(
  policy.scheduling?.publicationIntent === 'TOCA_SCHEDULE' &&
    policy.scheduling?.scheduledState === 'TOCA_SCHEDULED' &&
    policy.scheduling?.nativeScheduledState === 'SCHEDULED',
  'AUTONOMY_POLICY_SCHEDULING_STATES_INVALID',
);
failUnless(
  policy.scheduling?.supersedes?.includes('NATIVE_PROVIDER_SCHEDULING_ONLY') &&
    policy.scheduling?.supersedes?.includes('MANUAL_HANDOFF_REQUIRED'),
  'AUTONOMY_POLICY_SUPERSESSION_MISSING',
);

const requiredAuthority = ['AUTO_INTERNAL', 'AUTO_EXTERNAL_PREAPPROVED', 'EXPLICIT_APPROVAL'];
failUnless(
  JSON.stringify(policy.authority?.levels) === JSON.stringify(requiredAuthority),
  'AUTONOMY_POLICY_AUTHORITY_LEVELS_INVALID',
);
failUnless(
  policy.authority?.preapprovedClassSelfPromotionForbidden === true &&
    policy.authority?.authorityPromotionRequiresHumanDecision === true,
  'AUTONOMY_POLICY_SELF_PROMOTION_GUARD_MISSING',
);

const requiredModes = ['OFF', 'OBSERVE', 'ASSISTED', 'SUPERVISED_AUTO', 'PREAPPROVED_AUTO'];
for (const mode of requiredModes) {
  failUnless(policy.modes?.values?.[mode], `AUTONOMY_POLICY_MODE_MISSING:${mode}`);
}
failUnless(policy.modes?.default === 'SUPERVISED_AUTO', 'AUTONOMY_POLICY_DEFAULT_MODE_INVALID');

const requiredChecks = [
  'POLICY_CONSISTENT',
  'RUNTIME_HEALTHY',
  'DB_HEALTHY',
  'PROVIDER_HEALTHY',
  'APPROVAL_ENGINE_HEALTHY',
  'SCHEDULER_HEALTHY',
  'OBSERVABILITY_HEALTHY',
  'NO_CRITICAL_INCIDENT',
  'EXACT_HEAD_CERTIFIED',
];
for (const check of requiredChecks) {
  failUnless(
    policy.readinessRequiredChecks?.includes(check),
    `AUTONOMY_POLICY_READINESS_MISSING:${check}`,
  );
}

const ruleIds = new Set();
for (const rule of policy.rules ?? []) {
  failUnless(!ruleIds.has(rule.ruleId), `AUTONOMY_POLICY_RULE_DUPLICATE:${rule.ruleId}`);
  ruleIds.add(rule.ruleId);
  failUnless(
    rule.capabilityIds?.length > 0,
    `AUTONOMY_POLICY_RULE_CAPABILITY_MISSING:${rule.ruleId}`,
  );
  failUnless(rule.allowedModes?.length > 0, `AUTONOMY_POLICY_RULE_MODE_MISSING:${rule.ruleId}`);
}

const activePreapproved = (policy.preapprovedClasses ?? []).filter(
  (candidate) => candidate.status === 'ACTIVE',
);
for (const candidate of activePreapproved) {
  failUnless(
    candidate.approvedBy,
    `AUTONOMY_POLICY_PREAPPROVED_APPROVER_MISSING:${candidate.classId}`,
  );
  failUnless(
    candidate.decisionEvidence?.length > 0 &&
      candidate.decisionEvidence.every((entry) => !/^system:self-promotion:/i.test(entry)),
    `AUTONOMY_POLICY_SELF_PROMOTION_FORBIDDEN:${candidate.classId}`,
  );
}
const preapprovedRules = (policy.rules ?? []).filter(
  (rule) => rule.authority === 'AUTO_EXTERNAL_PREAPPROVED',
);
failUnless(
  preapprovedRules.length === 0 || activePreapproved.length > 0,
  'AUTONOMY_POLICY_PREAPPROVED_AUTHORITY_WITHOUT_CLASS',
);

for (const sourcePath of [
  'src/marketing-autopilot-scheduling.ts',
  'src/marketing-autopilot-lifecycle.ts',
]) {
  const source = readFileSync(sourcePath, 'utf8');
  failUnless(
    !source.includes("'NATIVE_PROVIDER_SCHEDULING_ONLY'"),
    `AUTONOMY_POLICY_ACTIVE_SOURCE_DRIFT:${sourcePath}`,
  );
  failUnless(
    !source.includes("'MANUAL_HANDOFF_REQUIRED'"),
    `AUTONOMY_POLICY_ACTIVE_SOURCE_DRIFT:${sourcePath}`,
  );
}

console.log('EFFECTIVE_AUTONOMY_POLICY_CHECK=PASS');

function failUnless(condition, code) {
  if (condition) return;
  console.error(code);
  process.exit(1);
}
