import { existsSync, readFileSync } from 'node:fs';
import * as z from 'zod/v4';

export const AUTONOMY_AUTHORITY_LEVELS = [
  'AUTO_INTERNAL',
  'AUTO_EXTERNAL_PREAPPROVED',
  'EXPLICIT_APPROVAL',
] as const;
export type AutonomyAuthorityLevel = (typeof AUTONOMY_AUTHORITY_LEVELS)[number];

export const AUTONOMY_MODES = [
  'OFF',
  'OBSERVE',
  'ASSISTED',
  'SUPERVISED_AUTO',
  'PREAPPROVED_AUTO',
] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const AUTOPILOT_READINESS_CHECKS = [
  'POLICY_CONSISTENT',
  'RUNTIME_HEALTHY',
  'DB_HEALTHY',
  'PROVIDER_HEALTHY',
  'APPROVAL_ENGINE_HEALTHY',
  'SCHEDULER_HEALTHY',
  'OBSERVABILITY_HEALTHY',
  'NO_CRITICAL_INCIDENT',
  'EXACT_HEAD_CERTIFIED',
] as const;
export type AutopilotReadinessCheckName = (typeof AUTOPILOT_READINESS_CHECKS)[number];

const authoritySchema = z.enum(AUTONOMY_AUTHORITY_LEVELS);
const modeSchema = z.enum(AUTONOMY_MODES);
const readinessCheckSchema = z.enum(AUTOPILOT_READINESS_CHECKS);
const modeConfigSchema = z
  .object({
    internalActions: z.boolean(),
    externalActions: z.boolean(),
    shadowDecisions: z.boolean(),
  })
  .strict();

const ruleSchema = z
  .object({
    ruleId: z.string().min(1),
    capabilityIds: z.array(z.string().min(1)).min(1),
    operations: z.array(z.string().min(1)).min(1),
    providers: z.array(z.string().min(1)).min(1),
    tenantIds: z.array(z.string().min(1)).min(1),
    riskClasses: z.array(z.string().min(1)).min(1),
    sideEffect: z.boolean(),
    authority: authoritySchema,
    allowedModes: z.array(modeSchema).min(1),
  })
  .strict();

const preapprovedClassSchema = z
  .object({
    classId: z.string().min(1),
    capabilityIds: z.array(z.string().min(1)).min(1),
    provider: z.string().min(1),
    tenantIds: z.array(z.string().min(1)).min(1),
    constraintsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum(['DISABLED', 'ACTIVE']),
    approvedBy: z.string().min(1),
    decisionEvidence: z.array(z.string().min(1)).min(1),
  })
  .strict();

const effectiveAutonomyPolicySchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    policyId: z.literal('TOCA_EFFECTIVE_AUTONOMY_POLICY_V1'),
    policyVersion: z.string().min(1),
    status: z.literal('ACTIVE_CANONICAL'),
    source: z
      .object({
        driveDocumentId: z.string().min(1),
        title: z.string().min(1),
        lastReconciledAt: z.string().datetime({ offset: true }),
        derivedArtifact: z.literal(true),
      })
      .strict(),
    defaults: z
      .object({
        nonSideEffectAuthority: z.literal('AUTO_INTERNAL'),
        sideEffectAuthority: z.enum(['EXPLICIT_APPROVAL', 'AUTO_EXTERNAL_PREAPPROVED']),
        missingCapabilityDecision: z.literal('DENY'),
        unknownHealthDecision: z.literal('DENY'),
      })
      .strict(),
    scheduling: z
      .object({
        canonicalPolicy: z.literal('TOCA_MANAGED_SCHEDULING'),
        publicationIntent: z.literal('TOCA_SCHEDULE'),
        scheduledState: z.literal('TOCA_SCHEDULED'),
        nativeScheduledState: z.literal('SCHEDULED'),
        supersedes: z.array(z.string().min(1)).min(1),
        shareNowRequiresExplicitIntent: z.literal(true),
        nativeProviderEvidenceRequired: z.literal(true),
      })
      .strict(),
    authority: z
      .object({
        levels: z.tuple([
          z.literal('AUTO_INTERNAL'),
          z.literal('AUTO_EXTERNAL_PREAPPROVED'),
          z.literal('EXPLICIT_APPROVAL'),
        ]),
        gateStates: z.tuple([z.literal('HUMAN_REVIEW'), z.literal('BLOCKED')]),
        preapprovedClassSelfPromotionForbidden: z.literal(true),
        authorityPromotionRequiresHumanDecision: z.literal(true),
      })
      .strict(),
    modes: z
      .object({
        default: modeSchema,
        values: z
          .object({
            OFF: modeConfigSchema,
            OBSERVE: modeConfigSchema,
            ASSISTED: modeConfigSchema,
            SUPERVISED_AUTO: modeConfigSchema,
            PREAPPROVED_AUTO: modeConfigSchema,
          })
          .strict(),
      })
      .strict(),
    readinessRequiredChecks: z
      .array(readinessCheckSchema)
      .length(AUTOPILOT_READINESS_CHECKS.length),
    canary: z
      .object({
        shadowDecisionsMinimum: z.number().int().min(1),
        supervisedExternalActionsMinimum: z.number().int().min(1),
        rollbackMode: z.literal('SUPERVISED_AUTO'),
        rollbackOnAnyDivergence: z.literal(true),
      })
      .strict(),
    killSwitchScopes: z.tuple([
      z.literal('GLOBAL'),
      z.literal('TENANT'),
      z.literal('PROVIDER'),
      z.literal('CAPABILITY'),
    ]),
    rules: z.array(ruleSchema).min(1),
    preapprovedClasses: z.array(preapprovedClassSchema),
  })
  .strict();

export type EffectiveAutonomyPolicy = z.infer<typeof effectiveAutonomyPolicySchema>;
export type EffectiveAutonomyRule = z.infer<typeof ruleSchema>;
export type PreapprovedClass = z.infer<typeof preapprovedClassSchema>;

export interface AutonomyRuleQuery {
  readonly capabilityId: string;
  readonly operation: string;
  readonly provider: string;
  readonly tenantId: string;
  readonly riskClass: string;
  readonly sideEffect: boolean;
}

export interface CompiledAutonomyPolicy {
  readonly policy: EffectiveAutonomyPolicy;
  resolve(query: AutonomyRuleQuery): EffectiveAutonomyRule | undefined;
  activePreapprovedClass(
    classId: string,
    query: Pick<AutonomyRuleQuery, 'capabilityId' | 'provider' | 'tenantId'>,
  ): PreapprovedClass | undefined;
}

export function loadEffectiveAutonomyPolicy(): CompiledAutonomyPolicy {
  const path = autonomyPolicyPath();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return compileEffectiveAutonomyPolicy(raw);
}

export function compileEffectiveAutonomyPolicy(value: unknown): CompiledAutonomyPolicy {
  const policy = effectiveAutonomyPolicySchema.parse(value);
  assertUnique(
    policy.rules.map((rule) => rule.ruleId),
    'AUTONOMY_POLICY_RULE_DUPLICATE',
  );
  assertUnique(
    policy.preapprovedClasses.map((candidate) => candidate.classId),
    'AUTONOMY_POLICY_PREAPPROVED_CLASS_DUPLICATE',
  );
  assertReadinessSet(policy.readinessRequiredChecks);
  assertModeInvariants(policy);
  assertRuleConflicts(policy.rules);
  assertPreapprovedAuthority(policy);

  return {
    policy,
    resolve(query) {
      const matches = policy.rules.filter((rule) => ruleMatches(rule, query));
      if (matches.length > 1) {
        throw new Error(
          `AUTONOMY_POLICY_RUNTIME_CONFLICT:${matches
            .map((rule) => rule.ruleId)
            .sort()
            .join(',')}`,
        );
      }
      return matches[0];
    },
    activePreapprovedClass(classId, query) {
      return policy.preapprovedClasses.find(
        (candidate) =>
          candidate.classId === classId &&
          candidate.status === 'ACTIVE' &&
          selectorMatches(candidate.capabilityIds, query.capabilityId) &&
          selectorMatches([candidate.provider], query.provider) &&
          selectorMatches(candidate.tenantIds, query.tenantId),
      );
    },
  };
}

export function assertCanonicalSchedulingSources(
  values: readonly { readonly source: string; readonly policy: string }[],
  compiled = loadEffectiveAutonomyPolicy(),
): void {
  const canonical = compiled.policy.scheduling.canonicalPolicy;
  const conflicting = values.filter((value) => value.policy !== canonical);
  if (conflicting.length > 0) {
    throw new Error(
      `AUTONOMY_POLICY_SCHEDULING_DRIFT:${conflicting
        .map((value) => `${value.source}=${value.policy}`)
        .sort()
        .join(',')}`,
    );
  }
}

function autonomyPolicyPath(): URL {
  const candidates = [
    new URL('../../control/effective-autonomy-policy.v1.json', import.meta.url),
    new URL('../../../control/effective-autonomy-policy.v1.json', import.meta.url),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('EFFECTIVE_AUTONOMY_POLICY_NOT_FOUND');
  return found;
}

function assertReadinessSet(values: readonly AutopilotReadinessCheckName[]): void {
  assertUnique(values, 'AUTONOMY_POLICY_READINESS_CHECK_DUPLICATE');
  for (const required of AUTOPILOT_READINESS_CHECKS) {
    if (!values.includes(required))
      throw new Error(`AUTONOMY_POLICY_READINESS_CHECK_MISSING:${required}`);
  }
}

function assertModeInvariants(policy: EffectiveAutonomyPolicy): void {
  const { values } = policy.modes;
  if (values.OFF.internalActions || values.OFF.externalActions || values.OFF.shadowDecisions)
    throw new Error('AUTONOMY_POLICY_OFF_MODE_INVALID');
  if (
    !values.OBSERVE.shadowDecisions ||
    values.OBSERVE.internalActions ||
    values.OBSERVE.externalActions
  )
    throw new Error('AUTONOMY_POLICY_OBSERVE_MODE_INVALID');
  if (!values.ASSISTED.internalActions || values.ASSISTED.externalActions)
    throw new Error('AUTONOMY_POLICY_ASSISTED_MODE_INVALID');
  if (!values.SUPERVISED_AUTO.internalActions || !values.SUPERVISED_AUTO.externalActions)
    throw new Error('AUTONOMY_POLICY_SUPERVISED_MODE_INVALID');
  if (policy.modes.default === 'PREAPPROVED_AUTO')
    throw new Error('AUTONOMY_POLICY_PREAPPROVED_DEFAULT_FORBIDDEN');
}

function assertRuleConflicts(rules: readonly EffectiveAutonomyRule[]): void {
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    const left = rules[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const right = rules[rightIndex]!;
      if (!rulesOverlap(left, right)) continue;
      if (left.authority !== right.authority || !sameSet(left.allowedModes, right.allowedModes)) {
        throw new Error(`AUTONOMY_POLICY_DECISION_CONFLICT:${left.ruleId}:${right.ruleId}`);
      }
    }
  }
}

function assertPreapprovedAuthority(policy: EffectiveAutonomyPolicy): void {
  const activeClasses = policy.preapprovedClasses.filter(
    (candidate) => candidate.status === 'ACTIVE',
  );
  const preapprovedRules = policy.rules.filter(
    (rule) => rule.authority === 'AUTO_EXTERNAL_PREAPPROVED',
  );
  if (preapprovedRules.length > 0 && activeClasses.length === 0)
    throw new Error('AUTONOMY_POLICY_PREAPPROVED_AUTHORITY_WITHOUT_CLASS');
  for (const candidate of activeClasses) {
    if (candidate.decisionEvidence.some((entry) => /^system:self-promotion:/i.test(entry)))
      throw new Error(`AUTONOMY_POLICY_SELF_PROMOTION_FORBIDDEN:${candidate.classId}`);
  }
}

function rulesOverlap(left: EffectiveAutonomyRule, right: EffectiveAutonomyRule): boolean {
  return (
    left.sideEffect === right.sideEffect &&
    selectorsOverlap(left.capabilityIds, right.capabilityIds) &&
    selectorsOverlap(left.operations, right.operations) &&
    selectorsOverlap(left.providers, right.providers) &&
    selectorsOverlap(left.tenantIds, right.tenantIds) &&
    selectorsOverlap(left.riskClasses, right.riskClasses)
  );
}

function ruleMatches(rule: EffectiveAutonomyRule, query: AutonomyRuleQuery): boolean {
  return (
    rule.sideEffect === query.sideEffect &&
    selectorMatches(rule.capabilityIds, query.capabilityId) &&
    selectorMatches(rule.operations, query.operation) &&
    selectorMatches(rule.providers, query.provider) &&
    selectorMatches(rule.tenantIds, query.tenantId) &&
    selectorMatches(rule.riskClasses, query.riskClass)
  );
}

function selectorMatches(values: readonly string[], actual: string): boolean {
  return values.includes('*') || values.includes(actual);
}

function selectorsOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.includes('*') || right.includes('*') || left.some((value) => right.includes(value));
}

function sameSet<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function assertUnique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) throw new Error(code);
}
