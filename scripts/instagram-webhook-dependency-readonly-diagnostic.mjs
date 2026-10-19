import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { stableTraffic } from './ag01-activation-rollback-guard.mjs';

export const REPOSITORY = 'luizanunciostoca/toca-mcp-server';
export const WORKFLOW_PATH =
  '.github/workflows/instagram-webhook-dependency-readonly-diagnostic.yml';
export const TITLE =
  'PRODUCTION AUTHORIZATION — Instagram webhook dependency READONLY diagnostic AUTO';
export const PROJECT = 'toca-mcp-production';
export const REGION = 'southamerica-east1';
export const SERVICE = 'toca-webhook-next-production';
export const SERVICE_PATH = 'projects/' + PROJECT + '/locations/' + REGION + '/services/' + SERVICE;
export const DEPLOYER = 'toca-mcp-deployer@' + PROJECT + '.iam.gserviceaccount.com';
const RUNTIME_ACCOUNT = 'toca-mcp-runtime@' + PROJECT + '.iam.gserviceaccount.com';
export const PROXY_SHA256 = 'fae2766aac9d614a2bdef2f2a7778f3d054f3acd5ff07a81a9e300bd471512eb';
export const EXPECTED = Object.freeze({
  runtimeSourceSha: '7e765803509a42b0c4b117a57dd2312d148714b8',
  runtimeTreeSha: 'd0be6ad97b387408b3f4eacbd7710a626d8b4b0a',
  candidateRevision: 'toca-webhook-next-production-wr39212114627a1',
  candidateDigest: 'sha256:c231edd54bafcd4002f3d8991ab18b2b9edb35696bc9ca6ccb497c6702bc4c14',
  previousRevision: 'toca-webhook-next-production-w9434008a1',
  previousDigest: 'sha256:44b24e15e0077f2386e426bdb65780318cf9f909b429bec508ffe723c7bb3339',
  databaseSecret: 'toca-database-url',
  cloudSqlInstance: 'toca-mcp-production:southamerica-east1:toca-mcp-db',
});
export const REQUIRED_MARKERS = Object.freeze({
  WEBHOOK_DEPENDENCY_READONLY_DIAGNOSTIC: 'AUTHORIZED',
  CLOUD_RUN_METADATA_READS_AUTHORIZED: 'true',
  EXISTING_DATABASE_SECRET_READ_AUTHORIZED: 'true',
  OUTBOX_AGGREGATE_READONLY_AUTHORIZED: 'true',
  DATABASE_MUTATIONS_AUTHORIZED: 'false',
  SERVICE_MUTATIONS_AUTHORIZED: 'false',
  TRAFFIC_MUTATIONS_AUTHORIZED: 'false',
  IAM_MUTATIONS_AUTHORIZED: 'false',
  SECRET_MUTATIONS_AUTHORIZED: 'false',
  CLOUD_LOGGING_READS_AUTHORIZED: 'false',
  ALTERNATE_IDENTITIES_AUTHORIZED: 'false',
  PROVIDER_BUSINESS_CALLS_AUTHORIZED: 'false',
  OUTBOX_DRAIN_REPLAY_AUTHORIZED: 'false',
  NEW_PAID_RESOURCES_AUTHORIZED: 'false',
  GENERAL_AUTONOMY_AUTHORIZED: 'false',
  EXPECTED_DEPLOYER: DEPLOYER,
  EXPECTED_SERVICE: SERVICE,
  EXPECTED_RUNTIME_SOURCE_SHA: EXPECTED.runtimeSourceSha,
  EXPECTED_RUNTIME_TREE_SHA: EXPECTED.runtimeTreeSha,
  EXPECTED_CANDIDATE_REVISION: EXPECTED.candidateRevision,
  EXPECTED_CANDIDATE_IMAGE_DIGEST: EXPECTED.candidateDigest,
  EXPECTED_SERVING_REVISION: EXPECTED.previousRevision,
  EXPECTED_SERVING_IMAGE_DIGEST: EXPECTED.previousDigest,
  EXPECTED_DATABASE_SECRET: EXPECTED.databaseSecret,
  EXPECTED_CLOUD_SQL_INSTANCE: EXPECTED.cloudSqlInstance,
});
export const CONTRACT_PATHS = Object.freeze([
  'src/config.ts',
  'src/health/runtime-readiness.ts',
  'src/health/readiness.ts',
  'src/persistence/postgres.ts',
  'scripts/ag01-activation-rollback-guard.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'Dockerfile',
]);
export const OUTBOX_SQL = [
  'select',
  '           coalesce(',
  '             extract(',
  '               epoch from (',
  "                 now() - (min(available_at) filter (where status in ('PENDING', 'FAILED_RETRYABLE')))",
  '               )',
  '             ),',
  '             0',
  '           ) as oldest_pending_age_seconds,',
  "           count(*) filter (where status = 'DEAD_LETTER') as dead_letter_count",
  '         from event_outbox',
].join('\n');
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[1-9][0-9]{0,14}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SQL_STATES = new Set([
  '42501',
  '42P01',
  '42703',
  '57014',
  '08001',
  '08006',
  '28P01',
  '28000',
]);
const GCP_STATUSES = new Set([
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'DEADLINE_EXCEEDED',
  'UNAVAILABLE',
  'RESOURCE_EXHAUSTED',
  'INVALID_ARGUMENT',
]);

export class DiagnosticError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'DiagnosticError';
    this.code = code;
    this.httpStatus = Number.isInteger(details.httpStatus) ? details.httpStatus : null;
    this.providerStatus = GCP_STATUSES.has(details.providerStatus) ? details.providerStatus : null;
    this.sqlState = SQL_STATES.has(details.sqlState) ? details.sqlState : null;
  }
}
const requireCondition = (value, code) => {
  if (!value) throw new DiagnosticError(code);
};
export const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const fingerprint = (value) => hash(canonical(value));

function instanceFields(value) {
  // Never spread a saved scope: its previous fingerprint is not a new input.
  const result = {
    repository: value.repository,
    sourceSha: value.sourceSha,
    runId: value.runId,
    runAttempt: value.runAttempt,
    actor: value.actor,
    issueNumber: value.issueNumber,
  };
  requireCondition(
    result.repository === REPOSITORY &&
      result.actor === REPOSITORY.split('/')[0] &&
      SHA.test(result.sourceSha) &&
      ID.test(result.runId) &&
      result.runAttempt === '1' &&
      ID.test(result.issueNumber),
    'OWNER_FIRST_ATTEMPT_INSTANCE_REQUIRED',
  );
  return result;
}

export function instanceFromEnv(env) {
  const instance = instanceFields({
    repository: env.GITHUB_REPOSITORY,
    sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    actor: env.GITHUB_ACTOR,
    issueNumber: env.AUTHORIZATION_ISSUE_NUMBER,
  });
  requireCondition(
    env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_EVENT_NAME === 'issues' &&
      env.GITHUB_WORKFLOW_REF === REPOSITORY + '/' + WORKFLOW_PATH + '@refs/heads/main' &&
      env.GITHUB_WORKFLOW_SHA === instance.sourceSha,
    'EXACT_MAIN_ISSUE_WORKFLOW_REQUIRED',
  );
  return instance;
}

function markers(body) {
  requireCondition(typeof body === 'string', 'AUTHORIZATION_BODY_REQUIRED');
  const values = new Map();
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], [...(values.get(match[1]) ?? []), match[2]]);
  }
  return (key, expected) => {
    const matches = values.get(key);
    requireCondition(matches?.length === 1, 'AUTHORIZATION_MARKER_NOT_UNIQUE');
    requireCondition(
      expected === undefined || matches[0] === expected,
      'AUTHORIZATION_MARKER_MISMATCH',
    );
    return matches[0];
  };
}

export function normalizedBody(body) {
  return body
    .replace(/^AUTHORIZATION_STATE=CONSUMED\r?$/m, 'AUTHORIZATION_STATE=ACTIVE')
    .replace(/^CONSUMED_BY_RUN_(?:ID|ATTEMPT)=.*\r?\n?/gm, '')
    .trimEnd();
}

export function authorizationScope(
  issue,
  input,
  now = new Date(),
  consumed = false,
  expired = false,
) {
  const instance = instanceFields(input);
  requireCondition(
    issue?.number === Number(instance.issueNumber) &&
      issue.state === 'open' &&
      issue.user?.login === instance.actor &&
      issue.title?.startsWith(TITLE),
    'NEW_LIVE_OWNER_ISSUE_REQUIRED',
  );
  const get = markers(issue.body);
  get('AUTHORIZATION_STATE', consumed ? 'CONSUMED' : 'ACTIVE');
  get('AUTHORIZED_CONTROLLER_SHA', instance.sourceSha);
  for (const [key, value] of Object.entries(REQUIRED_MARKERS)) get(key, value);
  if (consumed) {
    get('CONSUMED_BY_RUN_ID', instance.runId);
    get('CONSUMED_BY_RUN_ATTEMPT', '1');
  } else requireCondition(!/^CONSUMED_/m.test(issue.body), 'AUTHORIZATION_REPLAY_MARKERS');
  const expiresAt = get('AUTHORIZATION_EXPIRES_AT');
  const created = Date.parse(issue.created_at);
  const expiry = Date.parse(expiresAt);
  requireCondition(
    Number.isFinite(created) &&
      Number.isFinite(expiry) &&
      created <= now.getTime() &&
      expiry > created &&
      expiry - created <= 86_400_000 &&
      (expired || expiry > now.getTime()),
    'AUTHORIZATION_EXPIRED_OR_UNBOUNDED',
  );
  const scope = {
    ...instance,
    ...EXPECTED,
    issueCreatedAt: issue.created_at,
    issueTitle: issue.title,
    expiresAt,
    issueBodyHash: hash(normalizedBody(issue.body)),
    diagnosticId: 'webhook-dependency-' + instance.issueNumber + '-' + instance.runId + '-1',
  };
  return { ...scope, authorizationFingerprint: fingerprint(scope) };
}

export function verifyAuthorizationScope(
  saved,
  issue,
  now = new Date(),
  consumed = false,
  expired = false,
) {
  const { authorizationFingerprint, ...signed } = saved;
  requireCondition(
    HASH.test(authorizationFingerprint) && fingerprint(signed) === authorizationFingerprint,
    'SAVED_AUTHORIZATION_SCOPE_TAMPERED',
  );
  const fresh = authorizationScope(issue, instanceFields(saved), now, consumed, expired);
  requireCondition(
    fresh.authorizationFingerprint === authorizationFingerprint,
    'LIVE_AUTHORIZATION_CHANGED',
  );
  // Callers use this freshly reconstructed object, never unverified saved fields.
  return fresh;
}

export function verifyRunBinding(run, workflow, event, scope, finishing = false) {
  requireCondition(
    run?.id === Number(scope.runId) &&
      run.run_attempt === 1 &&
      run.event === 'issues' &&
      run.head_sha === scope.sourceSha &&
      run.head_branch === 'main' &&
      run.path === WORKFLOW_PATH &&
      run.workflow_id === workflow?.id &&
      workflow.path === WORKFLOW_PATH &&
      workflow.state === 'active' &&
      run.actor?.login === scope.actor &&
      run.triggering_actor?.login === scope.actor &&
      (run.status === 'in_progress' || (finishing && run.status === 'completed')) &&
      event?.action === 'opened' &&
      event.repository?.full_name === REPOSITORY &&
      event.sender?.login === scope.actor &&
      event.issue?.number === Number(scope.issueNumber) &&
      event.issue.user?.login === scope.actor &&
      event.issue.created_at === scope.issueCreatedAt &&
      event.issue.title?.startsWith(TITLE) &&
      Date.parse(run.created_at) >= Date.parse(scope.issueCreatedAt) &&
      Date.parse(run.created_at) < Date.parse(scope.expiresAt),
    'RUN_WORKFLOW_OR_NEW_ISSUE_BINDING_MISMATCH',
  );
}

export function requireStableMain(control, mainSha, instance) {
  requireCondition(mainSha === instance.sourceSha, 'CURRENT_MAIN_CHANGED');
  requireCondition(
    control?.number === 640 && control.state === 'open' && control.user?.login === instance.actor,
    'CANONICAL_MAIN_CONTROL_REQUIRED',
  );
  const get = markers(control.body);
  for (const [key, value] of Object.entries({
    PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION: '2',
    CONTROL_PLANE_ROLE: 'INTEGRATION_QUEUE_AND_MAIN_STABILITY',
    MAIN_STABILITY: 'PASS',
    EVALUATED_MAIN_SHA: instance.sourceSha,
    MERGE_RESERVATION: 'NONE',
    EXTERNAL_SIDE_EFFECTS_AUTHORIZED: 'false',
    PROVIDER_CALLS_AUTHORIZED: 'false',
    DATABASE_MUTATIONS_AUTHORIZED: 'false',
    SERVICE_MUTATIONS_AUTHORIZED: 'false',
  }))
    get(key, value);
  const values = [...control.body.matchAll(/^GENERAL_AUTONOMY=(.*)\r?$/gm)].map((x) => x[1].trim());
  requireCondition(
    values.length > 0 && values.every((value) => value === 'false'),
    'GENERAL_AUTONOMY_MUST_REMAIN_FALSE',
  );
}

function envEntries(revision) {
  const entries = new Map();
  for (const item of revision?.containers?.[0]?.env ?? []) {
    requireCondition(
      typeof item.name === 'string' && !entries.has(item.name),
      'REVISION_ENV_AMBIGUOUS',
    );
    const plain = Object.hasOwn(item, 'value');
    const secret = item.valueSource?.secretKeyRef;
    requireCondition(
      (plain && typeof item.value === 'string' && !secret) || (!plain && Boolean(secret)),
      'REVISION_ENV_UNREADABLE',
    );
    entries.set(item.name, item);
  }
  return entries;
}

function observedField(entries, name, fallback, origin = 'PARSER_DEFAULT') {
  const item = entries.get(name);
  if (item?.valueSource)
    return {
      presence: 'SECRET_REFERENCE_UNOBSERVED',
      value: undefined,
      origin: 'SECRET_REFERENCE',
    };
  if (item)
    return {
      presence: item.value.trim() ? 'PRESENT' : 'EMPTY',
      value: item.value,
      origin: 'REVISION_OVERRIDE',
    };
  return { presence: 'ABSENT', value: fallback, origin: fallback === undefined ? 'NONE' : origin };
}

const TEXT_FIELDS = Object.freeze({
  TOCA_DEFAULT_TENANT_ID: 'READINESS_TENANT_ID_REQUIRED',
  TOCA_DEFAULT_WORKSPACE_ID: 'READINESS_WORKSPACE_ID_REQUIRED',
  TOCA_DEFAULT_ORGANIZATION_ID: 'READINESS_ORGANIZATION_ID_REQUIRED',
  TOCA_DEPLOY_ENVIRONMENT: 'READINESS_DEPLOY_ENVIRONMENT_REQUIRED',
  TOCA_RELEASE_SHA: 'READINESS_RELEASE_SHA_REQUIRED',
});
const PRESENCE = new Set(['PRESENT', 'EMPTY', 'ABSENT', 'SECRET_REFERENCE_UNOBSERVED']);
const ORIGINS = new Set([
  'SECRET_REFERENCE',
  'REVISION_OVERRIDE',
  'NONE',
  'PARSER_DEFAULT',
  'VERIFIED_IMAGE_DEFAULT',
]);
const CHECK_CODES = new Set([
  ...Object.values(TEXT_FIELDS),
  'READINESS_BOOLEAN_INVALID_TOCA_PLATFORM_KILL_SWITCH',
  'READINESS_DATABASE_URL_REQUIRED',
  'READINESS_SERVICE_ROLE_REQUIRED',
  'READINESS_SERVICE_ROLE_INVALID',
  'READINESS_MCP_ROLE_REQUIRES_MCP_ENABLED',
  'READINESS_WEBHOOK_ROLE_REQUIRES_MCP_DISABLED',
  'CONFIG_NODE_ENV_INVALID',
  'CONFIG_MCP_ENABLED_INVALID',
]);

export function criticalConfiguration(revision, databasePayloadPresent) {
  const entries = envEntries(revision);
  const fields = {};
  const codes = [];
  let unknown = false;
  const observe = (name, fallback, origin) => {
    const field = observedField(entries, name, fallback, origin);
    fields[name] = { presence: field.presence, origin: field.origin };
    return field;
  };
  const node = observe('NODE_ENV', 'production', 'VERIFIED_IMAGE_DEFAULT');
  const nodeValid = ['production', 'development', 'test'].includes(node.value);
  fields.NODE_ENV.valid = node.presence === 'SECRET_REFERENCE_UNOBSERVED' ? null : nodeValid;
  fields.NODE_ENV.enumValue = nodeValid ? node.value : null;
  if (node.presence === 'SECRET_REFERENCE_UNOBSERVED') unknown = true;
  else if (!nodeValid) codes.push('CONFIG_NODE_ENV_INVALID');

  // config.ts defaults only undefined MCP_ENABLED to true; blank is invalid.
  const mcp = observe('MCP_ENABLED', 'true');
  const mcpValid = ['true', 'false'].includes(mcp.value);
  fields.MCP_ENABLED.valid = mcp.presence === 'SECRET_REFERENCE_UNOBSERVED' ? null : mcpValid;
  fields.MCP_ENABLED.booleanValue = mcpValid ? mcp.value === 'true' : null;
  if (mcp.presence === 'SECRET_REFERENCE_UNOBSERVED') unknown = true;
  else if (!mcpValid) codes.push('CONFIG_MCP_ENABLED_INVALID');

  // runtime-readiness.ts treats undefined/whitespace kill-switch as false,
  // but does not trim a nonempty boolean before matching true/false.
  const kill = observe('TOCA_PLATFORM_KILL_SWITCH');
  const killUnknown = kill.presence === 'SECRET_REFERENCE_UNOBSERVED';
  const killDefault = kill.value === undefined || kill.value.trim() === '';
  const killValid = killDefault || ['true', 'false'].includes(kill.value);
  fields.TOCA_PLATFORM_KILL_SWITCH.valid = killUnknown ? null : killValid;
  fields.TOCA_PLATFORM_KILL_SWITCH.booleanValue =
    killUnknown || !killValid ? null : !killDefault && kill.value === 'true';
  if (killUnknown) unknown = true;
  else if (!killValid) codes.push('READINESS_BOOLEAN_INVALID_TOCA_PLATFORM_KILL_SWITCH');

  const database = observe('DATABASE_URL');
  const databasePresent =
    database.presence === 'SECRET_REFERENCE_UNOBSERVED'
      ? databasePayloadPresent
      : Boolean(database.value?.trim());
  fields.DATABASE_URL.presentAfterAuthorizedSecretRead =
    typeof databasePresent === 'boolean' ? databasePresent : null;
  if (databasePresent === undefined) unknown = true;
  else if (!databasePresent) codes.push('READINESS_DATABASE_URL_REQUIRED');

  for (const [name, code] of Object.entries(TEXT_FIELDS)) {
    const field = observe(name);
    if (node.value !== 'production') continue;
    if (field.presence === 'SECRET_REFERENCE_UNOBSERVED') unknown = true;
    else if (!field.value?.trim()) codes.push(code);
  }
  const role = observe('TOCA_SERVICE_ROLE');
  const normalizedRole = role.value?.trim();
  fields.TOCA_SERVICE_ROLE.enumValue = ['mcp', 'webhook'].includes(normalizedRole)
    ? normalizedRole
    : null;
  if (node.value === 'production') {
    if (role.presence === 'SECRET_REFERENCE_UNOBSERVED') unknown = true;
    else if (!normalizedRole) codes.push('READINESS_SERVICE_ROLE_REQUIRED');
    else if (!['mcp', 'webhook'].includes(normalizedRole))
      codes.push('READINESS_SERVICE_ROLE_INVALID');
    else if (mcpValid && normalizedRole === 'mcp' && mcp.value === 'false')
      codes.push('READINESS_MCP_ROLE_REQUIRES_MCP_ENABLED');
    else if (mcpValid && normalizedRole === 'webhook' && mcp.value === 'true')
      codes.push('READINESS_WEBHOOK_ROLE_REQUIRES_MCP_DISABLED');
  }
  return {
    status: codes.length
      ? 'FAIL_OBSERVED_SIGNALS'
      : unknown
        ? 'NOT_PROVEN'
        : 'PASS_OBSERVED_FIELDS',
    fields,
    codes,
    firstFailureCode: codes[0] ?? null,
    unobservedSecretValues: unknown,
    effectiveValueBasis: 'REVISION_OVERRIDES_PLUS_VERIFIED_IMAGE_AND_SOURCE_DEFAULTS',
    historicalFailureCause: 'NOT_ESTABLISHED',
    rawValuesPublished: false,
  };
}

export function outboxThreshold(revision) {
  const field = observedField(envEntries(revision), 'TOCA_READY_OUTBOX_MAX_LAG_SECONDS');
  if (field.presence === 'SECRET_REFERENCE_UNOBSERVED')
    return {
      status: 'NOT_PROVEN',
      value: null,
      defaultApplied: false,
      code: 'OUTBOX_THRESHOLD_SECRET_UNOBSERVED',
    };
  const defaultApplied = field.value === undefined || field.value.trim() === '';
  // Preserve positiveInteger's parseInt semantics, including e.g. "300ms".
  const value = defaultApplied ? 300 : Number.parseInt(field.value, 10);
  const valid = Number.isSafeInteger(value) && value > 0;
  return {
    status: valid ? 'VALID' : 'INVALID',
    value: valid ? value : null,
    defaultApplied,
    code: valid ? null : 'READINESS_POSITIVE_INTEGER_INVALID',
  };
}

function secretVersion(revision) {
  const ref = envEntries(revision).get('DATABASE_URL')?.valueSource?.secretKeyRef;
  requireCondition(
    ref &&
      [
        EXPECTED.databaseSecret,
        'projects/' + PROJECT + '/secrets/' + EXPECTED.databaseSecret,
        'projects/990081828836/secrets/' + EXPECTED.databaseSecret,
      ].includes(ref.secret) &&
      /^(latest|[1-9][0-9]{0,14})$/.test(ref.version),
    'EXISTING_DATABASE_SECRET_BINDING_REQUIRED',
  );
  const instances = (revision.volumes ?? []).flatMap(
    (volume) => volume.cloudSqlInstance?.instances ?? [],
  );
  requireCondition(
    instances.length === 1 && instances[0] === EXPECTED.cloudSqlInstance,
    'EXACT_EXISTING_CLOUD_SQL_INSTANCE_REQUIRED',
  );
  return ref.version;
}

export function verifyMetadata(service, candidate, previous, scope) {
  let traffic;
  try {
    traffic = stableTraffic(service, { service: SERVICE });
  } catch {
    throw new DiagnosticError('SERVICE_PRESTATE_UNVERIFIED');
  }
  requireCondition(
    traffic.size === 1 && traffic.get(scope.previousRevision) === 100,
    'SERVING_PREVIOUS_100_PERCENT_REQUIRED',
  );
  for (const [revision, name, digest, isPrevious] of [
    [candidate, scope.candidateRevision, scope.candidateDigest, false],
    [previous, scope.previousRevision, scope.previousDigest, true],
  ]) {
    requireCondition(
      [PROJECT, '990081828836'].some(
        (project) =>
          revision?.name ===
          'projects/' +
            project +
            '/locations/' +
            REGION +
            '/services/' +
            SERVICE +
            '/revisions/' +
            name,
      ) &&
        UUID.test(revision.uid) &&
        revision.serviceAccount === RUNTIME_ACCOUNT &&
        revision.containers?.length === 1,
      'REVISION_IDENTITY_MISMATCH',
    );
    const container = revision.containers[0];
    requireCondition(
      typeof container.image === 'string' &&
        container.image.startsWith(REGION + '-docker.pkg.dev/' + PROJECT + '/toca-mcp/') &&
        container.image.endsWith('@' + digest),
      'REVISION_DIGEST_MISMATCH',
    );
    requireCondition(
      (!container.command?.length || JSON.stringify(container.command) === '["node"]') &&
        (!container.args?.length || JSON.stringify(container.args) === '["dist/src/http.js"]'),
      'EFFECTIVE_ENV_ENTRYPOINT_NOT_PROVEN',
    );
    if (isPrevious)
      requireCondition(
        revision.conditions?.some(
          (condition) => condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED',
        ),
        'SERVING_REVISION_NOT_READY',
      );
  }
  requireCondition(
    envEntries(candidate).get('TOCA_RELEASE_SHA')?.value === scope.runtimeSourceSha,
    'CANDIDATE_RUNTIME_SOURCE_MISMATCH',
  );
  const candidateVersion = secretVersion(candidate);
  const candidateEnv = envEntries(candidate);
  for (const name of ['PGOPTIONS', 'PGPORT']) {
    const value = observedField(candidateEnv, name);
    requireCondition(
      value.presence !== 'SECRET_REFERENCE_UNOBSERVED' &&
        (value.value === undefined ||
          value.value === '' ||
          (name === 'PGPORT' && value.value === '5432')),
      'RUNTIME_DATABASE_SESSION_BINDING_NOT_PROVEN',
    );
  }
  requireCondition(
    secretVersion(previous) === candidateVersion,
    'DATABASE_REFERENCE_CHANGED_BETWEEN_REVISIONS',
  );
  return {
    privateContext: {
      databaseSecretVersion: candidateVersion,
      cloudSqlInstance: EXPECTED.cloudSqlInstance,
    },
    publicContext: {
      serviceUid: service.uid,
      candidateUid: candidate.uid,
      previousUid: previous.uid,
      runtimeFingerprint: fingerprint({ service, candidate, previous }),
      previousTrafficPercent: 100,
      candidateSourceVerified: true,
      expectedDigestsVerified: true,
      existingDatabaseReferenceVerified: true,
    },
    candidate,
  };
}

export function evaluateOutbox(row, threshold) {
  requireCondition(row && typeof row === 'object', 'READINESS_OUTBOX_QUERY_EMPTY');
  const lag = Number(row.oldest_pending_age_seconds);
  const deadLetters = Number(row.dead_letter_count);
  const codes = [];
  if (threshold.status === 'INVALID') codes.push('READINESS_POSITIVE_INTEGER_INVALID');
  if (!Number.isFinite(lag) || (threshold.status === 'VALID' && lag > threshold.value))
    codes.push('READINESS_OUTBOX_LAG_EXCEEDED');
  if (!Number.isFinite(deadLetters) || deadLetters > 0)
    codes.push('READINESS_OUTBOX_DEAD_LETTER_PRESENT');
  requireCondition(
    !Number.isFinite(deadLetters) || (Number.isSafeInteger(deadLetters) && deadLetters >= 0),
    'OUTBOX_AGGREGATE_SHAPE_INVALID',
  );
  return {
    status: codes.length
      ? 'FAIL_OBSERVED_SIGNALS'
      : threshold.status === 'NOT_PROVEN'
        ? 'NOT_PROVEN'
        : 'PASS_OBSERVED_AGGREGATE',
    oldestPendingAgeSeconds: Number.isFinite(lag) ? lag : null,
    deadLetterCount: Number.isSafeInteger(deadLetters) ? deadLetters : null,
    maxLagSeconds: threshold.value,
    thresholdStatus: threshold.status,
    thresholdDefaultApplied: threshold.defaultApplied,
    codes,
    firstFailureCode: codes[0] ?? null,
    querySha256: hash(OUTBOX_SQL),
    rowsOrPayloadsPublished: false,
    historicalFailureCause: 'NOT_ESTABLISHED_BY_LATER_READ',
  };
}

export async function readOnlyOutbox(pool, threshold) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new DiagnosticError('DATABASE_CONNECTION_NOT_PROVEN', { sqlState: error?.code });
  }
  let result;
  let failure;
  try {
    await client.query('begin isolation level repeatable read read only');
    const mode = await client.query('show transaction_read_only');
    requireCondition(
      mode.rows?.[0]?.transaction_read_only === 'on',
      'DATABASE_READ_ONLY_MODE_REQUIRED',
    );
    const timeout = await client.query('show statement_timeout');
    requireCondition(
      ['5s', '5000ms'].includes(timeout.rows?.[0]?.statement_timeout),
      'SQL_STATEMENT_TIMEOUT_NOT_VERIFIED',
    );
    const lock = await client.query('show lock_timeout');
    requireCondition(
      ['2s', '2000ms'].includes(lock.rows?.[0]?.lock_timeout),
      'SQL_LOCK_TIMEOUT_NOT_VERIFIED',
    );
    const response = await client.query({ text: OUTBOX_SQL, query_timeout: 7000 });
    requireCondition(response.rows?.length === 1, 'OUTBOX_AGGREGATE_SHAPE_INVALID');
    result = evaluateOutbox(response.rows[0], threshold);
  } catch (error) {
    failure =
      error instanceof DiagnosticError
        ? error
        : new DiagnosticError(
            error?.code === '57014' ? 'OUTBOX_SQL_TIMEOUT' : 'OUTBOX_SQL_READ_NOT_PROVEN',
            { sqlState: error?.code },
          );
  } finally {
    try {
      await client.query('rollback');
    } catch {
      failure ??= new DiagnosticError('READ_ONLY_ROLLBACK_UNCONFIRMED');
    }
    try {
      client.release();
    } catch {
      failure ??= new DiagnosticError('DATABASE_CLIENT_RELEASE_NOT_PROVEN');
    }
  }
  if (failure) throw failure;
  return {
    ...result,
    transactionReadOnlyVerified: true,
    transactionRolledBack: true,
    statementTimeoutMs: 5000,
    lockTimeoutMs: 2000,
  };
}

export async function runDiagnostic(saved, deps) {
  let scope = await deps.authorize(saved, false);
  await deps.consume(scope);
  scope = await deps.authorize(scope, true);
  const before = await deps.metadata(scope);
  await deps.observation({
    criticalConfiguration: criticalConfiguration(before.candidate),
    metadata: before.publicContext,
  });
  scope = await deps.authorize(scope, true);
  const immediate = await deps.metadata(scope);
  requireCondition(
    fingerprint(immediate.publicContext) === fingerprint(before.publicContext),
    'RUNTIME_CHANGED_BEFORE_SQL_READ',
  );
  const rawDatabaseUrl = await deps.databaseSecret(immediate.privateContext);
  const critical = criticalConfiguration(immediate.candidate, rawDatabaseUrl.trim().length > 0);
  await deps.observation({ criticalConfiguration: critical, metadata: immediate.publicContext });
  scope = await deps.authorize(scope, true);
  const database = await deps.openDatabase(rawDatabaseUrl, immediate.privateContext);
  let outbox;
  let failure;
  try {
    requireCondition(
      database.runtimeDatabaseEndpointVerified === true,
      'RUNTIME_DATABASE_ENDPOINT_NOT_PROVEN',
    );
    outbox = await readOnlyOutbox(database.pool, outboxThreshold(immediate.candidate));
    outbox.runtimeDatabaseEndpointVerified = true;
    await deps.observation({
      criticalConfiguration: critical,
      outbox,
      metadata: immediate.publicContext,
    });
  } catch (error) {
    failure = error;
  } finally {
    try {
      await database.close();
    } catch {
      failure ??= new DiagnosticError('DATABASE_CLOSE_NOT_PROVEN');
    }
  }
  if (failure) throw failure;
  scope = await deps.authorize(scope, true);
  const after = await deps.metadata(scope);
  requireCondition(
    fingerprint(after.publicContext) === fingerprint(before.publicContext),
    'RUNTIME_CHANGED_DURING_SQL_READ',
  );
  await deps.authorize(scope, true);
  return {
    result: 'PASS_READONLY_DIAGNOSTIC',
    code: 'BOUNDED_METADATA_AND_OUTBOX_READBACK_COMPLETE',
    criticalConfiguration: critical,
    outbox,
    metadata: after.publicContext,
    authorizationStableBeforeAndAfter: true,
    runtimeStableBeforeAndAfter: true,
    productionAcceptance: 'NOT_GRANTED',
    historicalFailureCause: 'NOT_ESTABLISHED',
  };
}

const FAILURE_CODES = new Set([
  'OWNER_FIRST_ATTEMPT_INSTANCE_REQUIRED',
  'EXACT_MAIN_ISSUE_WORKFLOW_REQUIRED',
  'AUTHORIZATION_BODY_REQUIRED',
  'AUTHORIZATION_MARKER_NOT_UNIQUE',
  'AUTHORIZATION_MARKER_MISMATCH',
  'NEW_LIVE_OWNER_ISSUE_REQUIRED',
  'AUTHORIZATION_REPLAY_MARKERS',
  'AUTHORIZATION_EXPIRED_OR_UNBOUNDED',
  'SAVED_AUTHORIZATION_SCOPE_TAMPERED',
  'LIVE_AUTHORIZATION_CHANGED',
  'RUN_WORKFLOW_OR_NEW_ISSUE_BINDING_MISMATCH',
  'CURRENT_MAIN_CHANGED',
  'CANONICAL_MAIN_CONTROL_REQUIRED',
  'GENERAL_AUTONOMY_MUST_REMAIN_FALSE',
  'REVISION_ENV_AMBIGUOUS',
  'REVISION_ENV_UNREADABLE',
  'EXISTING_DATABASE_SECRET_BINDING_REQUIRED',
  'EXACT_EXISTING_CLOUD_SQL_INSTANCE_REQUIRED',
  'SERVICE_PRESTATE_UNVERIFIED',
  'SERVING_PREVIOUS_100_PERCENT_REQUIRED',
  'REVISION_IDENTITY_MISMATCH',
  'REVISION_DIGEST_MISMATCH',
  'EFFECTIVE_ENV_ENTRYPOINT_NOT_PROVEN',
  'SERVING_REVISION_NOT_READY',
  'CANDIDATE_RUNTIME_SOURCE_MISMATCH',
  'DATABASE_REFERENCE_CHANGED_BETWEEN_REVISIONS',
  'READINESS_OUTBOX_QUERY_EMPTY',
  'OUTBOX_AGGREGATE_SHAPE_INVALID',
  'DATABASE_READ_ONLY_MODE_REQUIRED',
  'SQL_STATEMENT_TIMEOUT_NOT_VERIFIED',
  'SQL_LOCK_TIMEOUT_NOT_VERIFIED',
  'OUTBOX_SQL_TIMEOUT',
  'OUTBOX_SQL_READ_NOT_PROVEN',
  'READ_ONLY_ROLLBACK_UNCONFIRMED',
  'RUNTIME_CHANGED_BEFORE_SQL_READ',
  'RUNTIME_CHANGED_DURING_SQL_READ',
  'EXACT_CONTROLLER_CHECKOUT_REQUIRED',
  'RUNTIME_SOURCE_NOT_AVAILABLE',
  'RUNTIME_TREE_MISMATCH',
  'RUNTIME_READINESS_CONTRACT_CHANGED',
  'VERIFIED_IMAGE_NODE_ENV_REQUIRED',
  'GITHUB_REQUEST_FAILED',
  'GITHUB_RESPONSE_INVALID',
  'GITHUB_RESPONSE_TOO_LARGE',
  'AUTHORIZATION_CONSUMPTION_READBACK_FAILED',
  'AUTHORIZATION_FINALIZATION_CHANGED',
  'AUTHORIZATION_FINALIZATION_READBACK_FAILED',
  'RESULT_COMMENT_READBACK_FAILED',
  'EXISTING_GCP_IDENTITY_UNAVAILABLE',
  'GCP_IDENTITY_MISMATCH',
  'CLOUD_METADATA_PATH_NOT_AUTHORIZED',
  'CLOUD_METADATA_READ_NOT_PROVEN',
  'CLOUD_METADATA_RESPONSE_TOO_LARGE',
  'EXISTING_DATABASE_SECRET_READ_NOT_PROVEN',
  'DATABASE_SECRET_PAYLOAD_INVALID',
  'DATABASE_URL_FORMAT_INVALID',
  'DATABASE_URL_SESSION_OPTIONS_UNSUPPORTED',
  'RUNTIME_DATABASE_ENDPOINT_NOT_PROVEN',
  'RUNTIME_DATABASE_SESSION_BINDING_NOT_PROVEN',
  'CLOUD_SQL_PROXY_DIGEST_MISMATCH',
  'CLOUD_SQL_PROXY_STARTUP_NOT_PROVEN',
  'DATABASE_CONNECTION_NOT_PROVEN',
  'DATABASE_CLIENT_RELEASE_NOT_PROVEN',
  'DATABASE_CLOSE_NOT_PROVEN',
  'INSTANCE_CONTEXT_MISMATCH',
  'DIAGNOSTIC_NOT_COMPLETED',
  'BOUNDED_METADATA_AND_OUTBOX_READBACK_COMPLETE',
  'NOT_PROVEN_UNCLASSIFIED_FAILURE',
]);
const OUTBOX_CODES = new Set([
  'READINESS_POSITIVE_INTEGER_INVALID',
  'READINESS_OUTBOX_LAG_EXCEEDED',
  'READINESS_OUTBOX_DEAD_LETTER_PRESENT',
]);
const fieldNames = [
  'NODE_ENV',
  'MCP_ENABLED',
  'TOCA_PLATFORM_KILL_SWITCH',
  'DATABASE_URL',
  ...Object.keys(TEXT_FIELDS),
  'TOCA_SERVICE_ROLE',
];
const boolOrNull = (value) => (typeof value === 'boolean' ? value : null);
const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);
const codeList = (values, allowed) =>
  Array.isArray(values) ? values.filter((value) => allowed.has(value)) : [];

export function publicResult(scope, input = {}) {
  const instance = instanceFields(scope);
  const output = {
    schemaVersion: 1,
    result: input.result === 'PASS_READONLY_DIAGNOSTIC' ? input.result : 'NOT_PROVEN',
    code: FAILURE_CODES.has(input.code) ? input.code : 'DIAGNOSTIC_NOT_COMPLETED',
    observedAt: new Date().toISOString(),
    controllerSha: scope.sourceSha,
    runtimeSourceSha: EXPECTED.runtimeSourceSha,
    runtimeTreeSha: EXPECTED.runtimeTreeSha,
    candidateRevision: EXPECTED.candidateRevision,
    candidateDigest: EXPECTED.candidateDigest,
    servingRevision: EXPECTED.previousRevision,
    servingDigest: EXPECTED.previousDigest,
    authorizationIssue: Number(scope.issueNumber),
    runId: scope.runId,
    runAttempt: scope.runAttempt,
    diagnosticId: 'webhook-dependency-' + instance.issueNumber + '-' + instance.runId + '-1',
    authorizationStableBeforeAndAfter: input.authorizationStableBeforeAndAfter === true,
    runtimeStableBeforeAndAfter: input.runtimeStableBeforeAndAfter === true,
    productionAcceptance: 'NOT_GRANTED',
    historicalFailureCause: 'NOT_ESTABLISHED',
    serviceMutations: false,
    trafficMutations: false,
    iamMutations: false,
    secretMutations: false,
    databaseMutations: false,
    providerBusinessCalls: false,
    cloudLoggingReads: false,
    alternativeIdentityUsed: false,
    secretPayloadPublished: false,
    rawEnvironmentPublished: false,
    rawOutboxRowsPublished: false,
    httpStatus:
      Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599
        ? input.httpStatus
        : null,
    providerStatus: GCP_STATUSES.has(input.providerStatus) ? input.providerStatus : null,
    sqlState: SQL_STATES.has(input.sqlState) ? input.sqlState : null,
  };
  const critical = input.criticalConfiguration;
  if (critical) {
    const fields = {};
    for (const name of fieldNames) {
      const field = critical.fields?.[name];
      if (!field) continue;
      fields[name] = {
        presence: PRESENCE.has(field.presence) ? field.presence : 'ABSENT',
        origin: ORIGINS.has(field.origin) ? field.origin : 'NONE',
        valid: boolOrNull(field.valid),
        booleanValue: boolOrNull(field.booleanValue),
        presentAfterAuthorizedSecretRead: boolOrNull(field.presentAfterAuthorizedSecretRead),
        enumValue: (name === 'NODE_ENV'
          ? ['production', 'development', 'test']
          : name === 'TOCA_SERVICE_ROLE'
            ? ['mcp', 'webhook']
            : []
        ).includes(field.enumValue)
          ? field.enumValue
          : null,
      };
    }
    const codes = codeList(critical.codes, CHECK_CODES);
    output.criticalConfiguration = {
      status: ['FAIL_OBSERVED_SIGNALS', 'NOT_PROVEN', 'PASS_OBSERVED_FIELDS'].includes(
        critical.status,
      )
        ? critical.status
        : 'NOT_PROVEN',
      fields,
      codes,
      firstFailureCode: codes[0] ?? null,
      unobservedSecretValues: critical.unobservedSecretValues === true,
      effectiveValueBasis: 'REVISION_OVERRIDES_PLUS_VERIFIED_IMAGE_AND_SOURCE_DEFAULTS',
      historicalFailureCause: 'NOT_ESTABLISHED',
      rawValuesPublished: false,
    };
  }
  if (input.metadata) {
    output.metadata = {
      serviceUid: UUID.test(input.metadata.serviceUid) ? input.metadata.serviceUid : null,
      candidateUid: UUID.test(input.metadata.candidateUid) ? input.metadata.candidateUid : null,
      previousUid: UUID.test(input.metadata.previousUid) ? input.metadata.previousUid : null,
      runtimeFingerprint: HASH.test(input.metadata.runtimeFingerprint)
        ? input.metadata.runtimeFingerprint
        : null,
      previousTrafficPercent: input.metadata.previousTrafficPercent === 100 ? 100 : null,
      candidateSourceVerified: input.metadata.candidateSourceVerified === true,
      expectedDigestsVerified: input.metadata.expectedDigestsVerified === true,
      existingDatabaseReferenceVerified: input.metadata.existingDatabaseReferenceVerified === true,
    };
  }
  if (input.outbox) {
    const outbox = input.outbox;
    const codes = codeList(outbox.codes, OUTBOX_CODES);
    output.outbox = {
      status: ['FAIL_OBSERVED_SIGNALS', 'NOT_PROVEN', 'PASS_OBSERVED_AGGREGATE'].includes(
        outbox.status,
      )
        ? outbox.status
        : 'NOT_PROVEN',
      oldestPendingAgeSeconds: finiteOrNull(outbox.oldestPendingAgeSeconds),
      deadLetterCount:
        Number.isSafeInteger(outbox.deadLetterCount) && outbox.deadLetterCount >= 0
          ? outbox.deadLetterCount
          : null,
      maxLagSeconds:
        Number.isSafeInteger(outbox.maxLagSeconds) && outbox.maxLagSeconds > 0
          ? outbox.maxLagSeconds
          : null,
      thresholdStatus: ['VALID', 'INVALID', 'NOT_PROVEN'].includes(outbox.thresholdStatus)
        ? outbox.thresholdStatus
        : 'NOT_PROVEN',
      thresholdDefaultApplied: outbox.thresholdDefaultApplied === true,
      codes,
      firstFailureCode: codes[0] ?? null,
      querySha256: hash(OUTBOX_SQL),
      transactionReadOnlyVerified: outbox.transactionReadOnlyVerified === true,
      runtimeDatabaseEndpointVerified: outbox.runtimeDatabaseEndpointVerified === true,
      transactionRolledBack: outbox.transactionRolledBack === true,
      statementTimeoutMs: outbox.statementTimeoutMs === 5000 ? 5000 : null,
      lockTimeoutMs: outbox.lockTimeoutMs === 2000 ? 2000 : null,
      rowsOrPayloadsPublished: false,
      historicalFailureCause: 'NOT_ESTABLISHED_BY_LATER_READ',
    };
  }
  if (
    output.result === 'PASS_READONLY_DIAGNOSTIC' &&
    !(
      output.code === 'BOUNDED_METADATA_AND_OUTBOX_READBACK_COMPLETE' &&
      output.authorizationStableBeforeAndAfter &&
      output.runtimeStableBeforeAndAfter &&
      output.metadata?.runtimeFingerprint &&
      output.metadata.serviceUid &&
      output.metadata.candidateUid &&
      output.metadata.previousUid &&
      output.metadata.previousTrafficPercent === 100 &&
      output.metadata.candidateSourceVerified &&
      output.metadata.expectedDigestsVerified &&
      output.metadata.existingDatabaseReferenceVerified &&
      output.criticalConfiguration &&
      Object.keys(output.criticalConfiguration.fields).length === fieldNames.length &&
      output.outbox?.transactionReadOnlyVerified &&
      output.outbox.runtimeDatabaseEndpointVerified &&
      output.outbox.transactionRolledBack &&
      output.outbox.statementTimeoutMs === 5000 &&
      output.outbox.lockTimeoutMs === 2000
    )
  ) {
    output.result = 'NOT_PROVEN';
    output.code = 'DIAGNOSTIC_NOT_COMPLETED';
  }
  return output;
}

export function failureResult(error) {
  return {
    result: 'NOT_PROVEN',
    code:
      error instanceof DiagnosticError && FAILURE_CODES.has(error.code)
        ? error.code
        : 'NOT_PROVEN_UNCLASSIFIED_FAILURE',
    httpStatus: error instanceof DiagnosticError ? error.httpStatus : null,
    providerStatus: error instanceof DiagnosticError ? error.providerStatus : null,
    sqlState: SQL_STATES.has(error?.sqlState ?? error?.code)
      ? (error.sqlState ?? error.code)
      : null,
  };
}

const exec = promisify(execFile);
async function command(file, args, code) {
  try {
    return (
      await exec(file, args, {
        encoding: 'utf8',
        timeout: 30_000,
        killSignal: 'SIGKILL',
        maxBuffer: 2 * 1024 * 1024,
      })
    ).stdout;
  } catch {
    throw new DiagnosticError(code);
  }
}

export async function sourceCompatibility(scope, runCommand = command, read = readFile) {
  requireCondition(
    (
      await runCommand('git', ['rev-parse', 'HEAD'], 'EXACT_CONTROLLER_CHECKOUT_REQUIRED')
    ).trim() === scope.sourceSha,
    'EXACT_CONTROLLER_CHECKOUT_REQUIRED',
  );
  requireCondition(
    (
      await runCommand(
        'git',
        ['rev-parse', scope.runtimeSourceSha + '^{tree}'],
        'RUNTIME_SOURCE_NOT_AVAILABLE',
      )
    ).trim() === scope.runtimeTreeSha,
    'RUNTIME_TREE_MISMATCH',
  );
  await runCommand(
    'git',
    ['diff', '--quiet', scope.runtimeSourceSha, scope.sourceSha, '--', ...CONTRACT_PATHS],
    'RUNTIME_READINESS_CONTRACT_CHANGED',
  );
  const docker = await read('Dockerfile', 'utf8');
  const runtime = docker.split(/^FROM .* AS runtime\s*$/m)[1];
  requireCondition(
    runtime &&
      [...runtime.matchAll(/^ENV NODE_ENV=(.*)$/gm)].length === 1 &&
      /^ENV NODE_ENV=production$/m.test(runtime),
    'VERIFIED_IMAGE_NODE_ENV_REQUIRED',
  );
}

async function limitedJSON(response, limit, code) {
  const reader = response.body?.getReader();
  requireCondition(reader, code);
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel().catch(() => undefined);
      throw new DiagnosticError(code);
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DiagnosticError(code);
  }
}

async function requestJSON(url, options, code, oversizedCode, request = fetch) {
  let response;
  try {
    response = await request(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    let data;
    try {
      data = await limitedJSON(response, 2 * 1024 * 1024, oversizedCode);
    } catch (error) {
      if (!response.ok) throw new DiagnosticError(code, { httpStatus: response.status });
      throw error;
    }
    if (!response.ok)
      throw new DiagnosticError(code, {
        httpStatus: response.status,
        providerStatus: data?.error?.status,
      });
    return { data, etag: response.headers.get('etag') };
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    throw new DiagnosticError(code);
  }
}

async function github(path, method = 'GET', body, etag) {
  const result = await requestJSON(
    'https://api.github.com/repos/' + REPOSITORY + '/' + path,
    {
      method,
      headers: {
        Authorization: 'Bearer ' + process.env.GH_TOKEN,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(etag ? { 'If-Match': etag } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    'GITHUB_REQUEST_FAILED',
    'GITHUB_RESPONSE_TOO_LARGE',
  );
  return { ...result.data, httpEtag: result.etag };
}

async function liveAuthorization(saved, consumed = false) {
  const [issue, main, control, run, workflow, event] = await Promise.all([
    github('issues/' + saved.issueNumber),
    github('git/ref/heads/main'),
    github('issues/640'),
    github('actions/runs/' + saved.runId),
    github('actions/workflows/' + WORKFLOW_PATH.split('/').at(-1)),
    readFile(process.env.GITHUB_EVENT_PATH, 'utf8').then(JSON.parse),
  ]);
  requireStableMain(control, main.object?.sha, saved);
  const scope = verifyAuthorizationScope(saved, issue, new Date(), consumed);
  verifyRunBinding(run, workflow, event, scope);
  return scope;
}

const sameIssue = (left, right) =>
  left.body === right.body &&
  left.title === right.title &&
  left.state === right.state &&
  left.user?.login === right.user?.login &&
  left.created_at === right.created_at &&
  left.updated_at === right.updated_at;

function consumedBody(body, scope) {
  return (
    body.replace(/^AUTHORIZATION_STATE=ACTIVE\r?$/m, 'AUTHORIZATION_STATE=CONSUMED').trimEnd() +
    '\nCONSUMED_BY_RUN_ID=' +
    scope.runId +
    '\nCONSUMED_BY_RUN_ATTEMPT=1\n'
  );
}

export async function consumeAuthorization(scope, api = github) {
  const before = await api('issues/' + scope.issueNumber);
  verifyAuthorizationScope(scope, before);
  const immediate = await api('issues/' + scope.issueNumber);
  requireCondition(sameIssue(before, immediate), 'LIVE_AUTHORIZATION_CHANGED');
  const body = consumedBody(immediate.body, scope);
  // Rechecks and readback supplement the conditional request. No atomicity or
  // automatic retry is inferred if the provider loses/rejects this response.
  await api('issues/' + scope.issueNumber, 'PATCH', { body }, immediate.httpEtag);
  const after = await api('issues/' + scope.issueNumber);
  requireCondition(after.body === body, 'AUTHORIZATION_CONSUMPTION_READBACK_FAILED');
  verifyAuthorizationScope(scope, after, new Date(), true);
}

async function verifiedGcpToken() {
  requireCondition(
    (
      await command(
        'gcloud',
        ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
        'EXISTING_GCP_IDENTITY_UNAVAILABLE',
      )
    ).trim() === DEPLOYER,
    'GCP_IDENTITY_MISMATCH',
  );
  return (
    await command('gcloud', ['auth', 'print-access-token'], 'EXISTING_GCP_IDENTITY_UNAVAILABLE')
  ).trim();
}

export async function cloudMetadataGet(path, token, request = fetch) {
  requireCondition(
    [
      SERVICE_PATH,
      SERVICE_PATH + '/revisions/' + EXPECTED.candidateRevision,
      SERVICE_PATH + '/revisions/' + EXPECTED.previousRevision,
    ].includes(path),
    'CLOUD_METADATA_PATH_NOT_AUTHORIZED',
  );
  return (
    await requestJSON(
      'https://run.googleapis.com/v2/' + path,
      { method: 'GET', headers: { Authorization: 'Bearer ' + token } },
      'CLOUD_METADATA_READ_NOT_PROVEN',
      'CLOUD_METADATA_RESPONSE_TOO_LARGE',
      request,
    )
  ).data;
}

async function currentMetadata(scope, observe) {
  await sourceCompatibility(scope);
  const token = await verifiedGcpToken();
  const [service, candidate, previous] = await Promise.all([
    cloudMetadataGet(SERVICE_PATH, token),
    cloudMetadataGet(SERVICE_PATH + '/revisions/' + EXPECTED.candidateRevision, token),
    cloudMetadataGet(SERVICE_PATH + '/revisions/' + EXPECTED.previousRevision, token),
  ]);
  // Missing critical fields remain useful sanitized observations even if a
  // binding prerequisite later prevents SQL. They are never promoted to cause.
  await observe({ criticalConfiguration: criticalConfiguration(candidate) });
  return verifyMetadata(service, candidate, previous, scope);
}

export async function accessDatabaseSecret(context, token, request = fetch) {
  requireCondition(
    /^(latest|[1-9][0-9]{0,14})$/.test(context.databaseSecretVersion),
    'EXISTING_DATABASE_SECRET_BINDING_REQUIRED',
  );
  const prefix = 'projects/' + PROJECT + '/secrets/' + EXPECTED.databaseSecret + '/versions/';
  const response = await requestJSON(
    'https://secretmanager.googleapis.com/v1/' + prefix + context.databaseSecretVersion + ':access',
    { method: 'GET', headers: { Authorization: 'Bearer ' + token } },
    'EXISTING_DATABASE_SECRET_READ_NOT_PROVEN',
    'DATABASE_SECRET_PAYLOAD_INVALID',
    request,
  );
  const data = response.data;
  const names = [prefix, 'projects/990081828836/secrets/' + EXPECTED.databaseSecret + '/versions/'];
  requireCondition(
    names.some((name) => data.name?.startsWith(name) && ID.test(data.name.slice(name.length))) &&
      (context.databaseSecretVersion === 'latest' ||
        data.name.endsWith('/' + context.databaseSecretVersion)) &&
      typeof data.payload?.data === 'string' &&
      data.payload.data.length <= 16384 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(data.payload.data),
    'DATABASE_SECRET_PAYLOAD_INVALID',
  );
  // The only secret payload exists in memory for the single local connection.
  return Buffer.from(data.payload.data, 'base64').toString('utf8').trim();
}

export function databaseOptions(raw) {
  let url;
  try {
    // pg-connection-string also permits the URI form user:password@/db with
    // an explicit socket in ?host=. The sentinel is never used as a target.
    try {
      url = new URL(raw);
    } catch {
      url = new URL(raw.replace('@/', '@___DUMMY___/'));
    }
    requireCondition(
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.username &&
        url.password &&
        url.pathname.length > 1,
      'DATABASE_URL_FORMAT_INVALID',
    );
    // The runtime uses its connectionString unchanged. Session/schema options
    // could redirect the unqualified aggregate to a different event_outbox.
    // Transport-only parameters are replaced by the exact authorized proxy;
    // every other query parameter is unsupported, including options/search_path.
    const transportParameters = new Set([
      'host',
      'port',
      'ssl',
      'sslmode',
      'connect_timeout',
      'application_name',
    ]);
    requireCondition(
      [...url.searchParams.keys()].every((key) => transportParameters.has(key)),
      'DATABASE_URL_SESSION_OPTIONS_UNSUPPORTED',
    );
    const queryHosts = url.searchParams.getAll('host');
    const queryPorts = url.searchParams.getAll('port');
    const host = queryHosts[0] || decodeURIComponent(url.hostname);
    const port = queryPorts[0] || url.port || '5432';
    requireCondition(
      queryHosts.length <= 1 &&
        queryPorts.length <= 1 &&
        !(queryHosts.length && /^%2f/i.test(url.hostname)) &&
        host === '/cloudsql/' + EXPECTED.cloudSqlInstance &&
        port === '5432',
      'RUNTIME_DATABASE_ENDPOINT_NOT_PROVEN',
    );
    return {
      host: '127.0.0.1',
      port: 6543,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURI(url.pathname.slice(1)),
      ssl: false,
      max: 1,
      connectionTimeoutMillis: 5000,
      query_timeout: 7000,
      options:
        '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000',
    };
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    throw new DiagnosticError('DATABASE_URL_FORMAT_INVALID');
  }
}

async function localPortReady(proxy) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    requireCondition(
      proxy.exitCode === null && proxy.signalCode === null,
      'CLOUD_SQL_PROXY_STARTUP_NOT_PROVEN',
    );
    const ready = await new Promise((accept) => {
      const socket = createConnection({ host: '127.0.0.1', port: 6543 });
      const done = (value) => {
        socket.destroy();
        accept(value);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(250, () => done(false));
    });
    if (ready) return;
    await new Promise((accept) => setTimeout(accept, 100));
  }
  throw new DiagnosticError('CLOUD_SQL_PROXY_STARTUP_NOT_PROVEN');
}

async function openDatabase(raw, context) {
  requireCondition(
    context.cloudSqlInstance === EXPECTED.cloudSqlInstance,
    'EXACT_EXISTING_CLOUD_SQL_INSTANCE_REQUIRED',
  );
  const proxyPath = process.env.CLOUD_SQL_PROXY_PATH;
  requireCondition(
    typeof proxyPath === 'string' && hash(await readFile(proxyPath)) === PROXY_SHA256,
    'CLOUD_SQL_PROXY_DIGEST_MISMATCH',
  );
  const options = databaseOptions(raw);
  const { default: pg } = await import('pg');
  const proxy = spawn(
    proxyPath,
    ['--address', '127.0.0.1', '--port', '6543', EXPECTED.cloudSqlInstance],
    { stdio: 'ignore' },
  );
  let proxyError = false;
  proxy.on('error', () => {
    proxyError = true;
  });
  const pool = new pg.Pool(options);
  pool.on('error', () => undefined);
  const close = async () => {
    let timer;
    try {
      await Promise.race([
        pool.end(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new DiagnosticError('DATABASE_CLOSE_NOT_PROVEN')), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (proxy.exitCode === null) proxy.kill('SIGKILL');
    }
  };
  try {
    await localPortReady(proxy);
    requireCondition(!proxyError, 'CLOUD_SQL_PROXY_STARTUP_NOT_PROVEN');
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  return { pool, close, runtimeDatabaseEndpointVerified: true };
}

export async function finishAuthorization(saved, result, api = github, now = new Date()) {
  const issue = await api('issues/' + saved.issueNumber);
  const state = markers(issue.body)('AUTHORIZATION_STATE');
  requireCondition(['ACTIVE', 'CONSUMED'].includes(state), 'AUTHORIZATION_FINALIZATION_CHANGED');
  const scope = verifyAuthorizationScope(saved, issue, now, state === 'CONSUMED', true);
  const safe = publicResult(scope, result);
  const immediate = await api('issues/' + scope.issueNumber);
  requireCondition(sameIssue(issue, immediate), 'AUTHORIZATION_FINALIZATION_CHANGED');
  const body = 'WEBHOOK_DEPENDENCY_READONLY_DIAGNOSTIC\n' + JSON.stringify(safe, null, 2);
  const posted = await api('issues/' + scope.issueNumber + '/comments', 'POST', { body });
  requireCondition(ID.test(String(posted.id)), 'RESULT_COMMENT_READBACK_FAILED');
  const readback = await api('issues/comments/' + posted.id);
  requireCondition(
    readback.body === body && readback.user?.login === 'github-actions[bot]',
    'RESULT_COMMENT_READBACK_FAILED',
  );
  const closing = await api('issues/' + scope.issueNumber);
  verifyAuthorizationScope(scope, closing, now, state === 'CONSUMED', true);
  requireCondition(
    closing.body === immediate.body && closing.title === immediate.title,
    'AUTHORIZATION_FINALIZATION_CHANGED',
  );
  const finalBody = state === 'CONSUMED' ? closing.body : consumedBody(closing.body, scope);
  await api(
    'issues/' + scope.issueNumber,
    'PATCH',
    { body: finalBody, state: 'closed' },
    closing.httpEtag,
  );
  const final = await api('issues/' + scope.issueNumber);
  requireCondition(
    final.state === 'closed' &&
      final.body === finalBody &&
      final.title === scope.issueTitle &&
      final.user?.login === scope.actor,
    'AUTHORIZATION_FINALIZATION_READBACK_FAILED',
  );
  return {
    status: 'CLOSED_OWN_AUTHORIZATION',
    issue: Number(scope.issueNumber),
    commentId: posted.id,
    runId: scope.runId,
    bodySha256: hash(finalBody),
  };
}

async function main() {
  const mode = process.argv[2];
  const instance = instanceFromEnv(process.env);
  const directory = resolve(process.env.WEBHOOK_DIAGNOSTIC_DIR);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = (name) => resolve(directory, name + '.json');
  const save = (name, value) =>
    writeFile(path(name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  let scope;
  let observation = {};
  try {
    if (mode === 'authorize') {
      const issue = await github('issues/' + instance.issueNumber);
      scope = authorizationScope(issue, instance);
      scope = await liveAuthorization(scope);
      await sourceCompatibility(scope);
      await save('authorization', scope);
      await save('context', {
        ...instance,
        authorizationFingerprint: scope.authorizationFingerprint,
        runtimeSourceSha: EXPECTED.runtimeSourceSha,
        runtimeTreeSha: EXPECTED.runtimeTreeSha,
        authorized: true,
      });
      await save('result', publicResult(scope));
      await save('finalization', { status: 'PENDING_AUTHORIZED_PHASE' });
      return;
    }
    scope = JSON.parse(await readFile(path('authorization'), 'utf8'));
    requireCondition(
      fingerprint(instanceFields(scope)) === fingerprint(instance),
      'INSTANCE_CONTEXT_MISMATCH',
    );
    if (mode === 'finish') {
      const [run, workflow, event] = await Promise.all([
        github('actions/runs/' + scope.runId),
        github('actions/workflows/' + WORKFLOW_PATH.split('/').at(-1)),
        readFile(process.env.GITHUB_EVENT_PATH, 'utf8').then(JSON.parse),
      ]);
      verifyRunBinding(run, workflow, event, scope, true);
      const result = JSON.parse(await readFile(path('result'), 'utf8'));
      await save('result', publicResult(scope, result));
      await save('finalization', await finishAuthorization(scope, result));
      return;
    }
    requireCondition(mode === 'diagnose', 'DIAGNOSTIC_NOT_COMPLETED');
    const observe = async (part) => {
      observation = publicResult(scope, {
        ...observation,
        ...part,
        result: 'NOT_PROVEN',
        code: 'DIAGNOSTIC_NOT_COMPLETED',
      });
      await save('result', observation);
    };
    const result = await runDiagnostic(scope, {
      authorize: liveAuthorization,
      consume: consumeAuthorization,
      metadata: (fresh) => currentMetadata(fresh, observe),
      observation: observe,
      databaseSecret: async (context) => accessDatabaseSecret(context, await verifiedGcpToken()),
      openDatabase,
    });
    await save('result', publicResult(scope, result));
  } catch (error) {
    const failure = failureResult(error);
    if (scope)
      await save(
        mode === 'finish' ? 'finalization' : 'result',
        mode === 'finish' ? failure : publicResult(scope, { ...observation, ...failure }),
      );
    console.error(JSON.stringify(failure));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('{"result":"NOT_PROVEN","code":"NOT_PROVEN_UNCLASSIFIED_FAILURE"}');
    process.exitCode = 1;
  });
}
