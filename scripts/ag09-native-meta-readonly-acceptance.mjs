import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { stableTraffic } from './ag01-activation-rollback-guard.mjs';

// This is a client of the existing AG-01 service. It grants no runtime permission,
// deploys no code, and never sends a Meta request directly.
export const REPOSITORY = 'luizanunciostoca/toca-mcp-server';
export const TITLE = 'PRODUCTION AUTHORIZATION — AG09 native Meta READONLY acceptance AUTO';
export const ACCOUNT = '311793958882290';
export const CAPABILITY = 'meta_ads.insights.get';
export const SERVICE = 'toca-ag01-orchestrator';
const PROJECT = 'toca-mcp-production';
const REGION = 'southamerica-east1';
const SERVICE_PATH = 'projects/' + PROJECT + '/locations/' + REGION + '/services/' + SERVICE;
const DEPLOYER = 'toca-mcp-deployer@' + PROJECT + '.iam.gserviceaccount.com';
const RUNTIME = 'toca-mcp-runtime@' + PROJECT + '.iam.gserviceaccount.com';
const DATABASE_SECRET = 'toca-database-url';
const META_SECRET = 'toca-meta-oauth-token';
const IMAGE_PREFIX = REGION + '-docker.pkg.dev/' + PROJECT + '/toca-mcp/';
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SAFE_ACCOUNT_READS = new Set([
  CAPABILITY,
  'meta_ads.campaigns.list',
  'meta_ads.adsets.list',
  'meta_ads.ads.list',
]);
export const INSIGHT_FIELDS = Object.freeze([
  'account_id',
  'account_currency',
  'date_start',
  'date_stop',
  'impressions',
  'reach',
  'clicks',
  'spend',
]);
export const REQUIRED_MARKERS = Object.freeze({
  AG09_NATIVE_META_READONLY_ACCEPTANCE: 'AUTHORIZED',
  AG09_ROUTE_ID: 'R08',
  AG09_CAPABILITY_ID: CAPABILITY,
  META_ADS_ACCOUNT_ID: ACCOUNT,
  META_ADS_CURRENCY: 'BRL',
  PROVIDER_READS_AUTHORIZED: 'true',
  PROVIDER_WRITES_AUTHORIZED: 'false',
  EXTERNAL_REPLY_WRITES_AUTHORIZED: 'false',
  SERVICE_MUTATIONS_AUTHORIZED: 'false',
  IAM_MUTATIONS_AUTHORIZED: 'false',
  SECRET_MUTATIONS_AUTHORIZED: 'false',
  DATABASE_MUTATIONS_AUTHORIZED: 'false',
  EXISTING_DATABASE_SECRET_READ_AUTHORIZED: 'true',
  READONLY_DATABASE_READBACK_AUTHORIZED: 'true',
  WORKFLOWSTORE_MISSION_STATE_WRITES_AUTHORIZED: 'true',
  CORE_AUDIT_WRITES_AUTHORIZED: 'true',
  NEW_PAID_RESOURCES_AUTHORIZED: 'false',
  GENERAL_AUTONOMY_AUTHORIZED: 'false',
});

export class AcceptanceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AcceptanceError';
    this.code = code;
  }
}
const requireCondition = (value, code) => {
  if (!value) throw new AcceptanceError(code);
};
export const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
const iso = (value) => new Date(value).toISOString();
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
const fingerprint = (value) => hash(canonical(value));
const sameSet = (left, right) =>
  Array.isArray(left) &&
  JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...right].sort());
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 300;

function markers(body) {
  requireCondition(typeof body === 'string', 'AUTHORIZATION_BODY_REQUIRED');
  const values = new Map();
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], [...(values.get(match[1]) ?? []), match[2]]);
  }
  return (key, expected) => {
    const found = values.get(key);
    requireCondition(found?.length === 1, 'MARKER_NOT_UNIQUE_' + key);
    requireCondition(expected === undefined || found[0] === expected, 'MARKER_MISMATCH_' + key);
    return found[0];
  };
}

export function instanceFromEnv(env) {
  const instance = {
    repository: env.GITHUB_REPOSITORY,
    sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    actor: env.GITHUB_ACTOR,
    issueNumber: env.AUTHORIZATION_ISSUE_NUMBER,
  };
  requireCondition(
    instance.repository === REPOSITORY &&
      instance.actor === REPOSITORY.split('/')[0] &&
      SHA.test(instance.sourceSha) &&
      POSITIVE.test(instance.runId) &&
      instance.runAttempt === '1' &&
      POSITIVE.test(instance.issueNumber) &&
      env.GITHUB_REF === 'refs/heads/main',
    'NEW_OWNER_AUTHORIZATION_ON_MAIN_REQUIRED',
  );
  return instance;
}

function calendarDate(value) {
  requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(value), 'READ_WINDOW_INVALID');
  const parsed = new Date(value + 'T00:00:00.000Z');
  requireCondition(
    Number.isFinite(parsed.getTime()) && iso(parsed).slice(0, 10) === value,
    'READ_WINDOW_INVALID',
  );
  return parsed.getTime();
}

export function authorizationScope(issue, instance, now = new Date(), consumed = false) {
  requireCondition(
    issue?.number === Number(instance.issueNumber) &&
      issue.state === 'open' &&
      issue.user?.login === instance.actor &&
      issue.title?.startsWith(TITLE),
    'LIVE_OWNER_AUTHORIZATION_REQUIRED',
  );
  const get = markers(issue.body);
  get('AUTHORIZED_CONTROLLER_SHA', instance.sourceSha);
  get('AUTHORIZATION_STATE', consumed ? 'CONSUMED' : 'ACTIVE');
  for (const [key, value] of Object.entries(REQUIRED_MARKERS)) get(key, value);
  if (consumed) {
    get('CONSUMED_BY_RUN_ID', instance.runId);
    get('CONSUMED_BY_RUN_ATTEMPT', instance.runAttempt);
  } else requireCondition(!/^CONSUMED_BY_RUN_/m.test(issue.body), 'AUTHORIZATION_REPLAY_MARKERS');
  // Live checks pass the previous scope; retain only its immutable identity.
  // Derived fields, including the old fingerprint, must be rebuilt below.
  const scope = {
    repository: instance.repository,
    sourceSha: instance.sourceSha,
    runId: instance.runId,
    runAttempt: instance.runAttempt,
    actor: instance.actor,
    issueNumber: instance.issueNumber,
    runtimeSourceSha: get('EXPECTED_RUNTIME_SOURCE_SHA'),
    runtimeTreeSha: get('EXPECTED_RUNTIME_TREE_SHA'),
    revision: get('EXPECTED_AG01_REVISION'),
    digest: get('EXPECTED_AG01_IMAGE_DIGEST'),
    since: get('META_ADS_READ_SINCE'),
    until: get('META_ADS_READ_UNTIL'),
    expiresAt: get('AUTHORIZATION_EXPIRES_AT'),
    account: ACCOUNT,
    currency: 'BRL',
  };
  requireCondition(
    SHA.test(scope.runtimeSourceSha) && SHA.test(scope.runtimeTreeSha),
    'RUNTIME_SOURCE_IDENTITY_REQUIRED',
  );
  requireCondition(
    new RegExp('^' + SERVICE + '-[a-z0-9-]+$').test(scope.revision) &&
      scope.revision.length <= 63 &&
      DIGEST.test(scope.digest),
    'RUNTIME_REVISION_IDENTITY_REQUIRED',
  );
  const since = calendarDate(scope.since);
  const until = calendarDate(scope.until);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bahia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  requireCondition(
    since <= until && until - since <= 6 * 86_400_000 && scope.until < today,
    'CLOSED_BOUNDED_READ_WINDOW_REQUIRED',
  );
  const expiry = Date.parse(scope.expiresAt);
  requireCondition(
    Number.isFinite(expiry) && expiry > now.getTime() && expiry <= now.getTime() + 86_400_000,
    'AUTHORIZATION_EXPIRED_OR_UNBOUNDED',
  );
  scope.idempotencyKey = 'ag09-readonly-' + instance.issueNumber + '-' + instance.runId + '-1';
  scope.correlationId = scope.idempotencyKey;
  scope.issueBodyHash = hash(normalizedAuthorizationBody(issue.body));
  scope.authorizationFingerprint = fingerprint(scope);
  return scope;
}

export function verifyAuthorizationScope(issue, scope, now = new Date(), consumed = false) {
  const { authorizationFingerprint, ...savedScope } = scope;
  requireCondition(fingerprint(savedScope) === authorizationFingerprint, 'AUTHORIZATION_CHANGED');
  const current = authorizationScope(issue, scope, now, consumed);
  requireCondition(
    current.authorizationFingerprint === authorizationFingerprint,
    'AUTHORIZATION_CHANGED',
  );
  return current;
}

function normalizedAuthorizationBody(body) {
  return body
    .replace(/^AUTHORIZATION_STATE=CONSUMED$/m, 'AUTHORIZATION_STATE=ACTIVE')
    .replace(/^CONSUMED_BY_RUN_(?:ID|ATTEMPT)=.*\r?\n?/gm, '')
    .trimEnd();
}

export function runtimeGateEvidence(revision) {
  const entries = revision?.containers?.[0]?.env ?? [];
  const value = (name) => {
    const matches = entries.filter((entry) => entry.name === name);
    return matches.length === 1 && typeof matches[0].value === 'string' ? matches[0].value : null;
  };
  const capabilityGrants = (value('AG01_ALLOWED_CAPABILITY_IDS') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const accountGrants = (value('AG01_ALLOWED_TARGET_ACCOUNTS') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    specialistsEnabled: value('TOCA_AG01_INTERNAL_SPECIALISTS_ENABLED') === 'true',
    metaAdsReadEnabled: value('META_ADS_READ_ENABLED') === 'true',
    insightsGrantDeclared: capabilityGrants.includes(CAPABILITY),
    canonicalAccountGrantDeclared: sameSet(accountGrants, [ACCOUNT]),
    roleExplicitlyDeclared: value('AG01_AUTHORIZATION_ROLES') !== null,
    tenantExplicitlyDeclared: value('TOCA_DEFAULT_TENANT_ID') !== null,
    metaTokenReferenceDeclared:
      value('META_ACCESS_TOKEN_ENV_KEY') === 'TOCA_SECRET_META_ACCESS_TOKEN',
    metaSecretBindingPresent: entries.some(
      (entry) => entry.name === 'TOCA_SECRET_META_ACCESS_TOKEN' && entry.valueSource?.secretKeyRef,
    ),
    databaseSecretBindingPresent: entries.some(
      (entry) => entry.name === 'DATABASE_URL' && entry.valueSource?.secretKeyRef,
    ),
    rawEnvironmentPublished: false,
  };
}

export function requireStableMain(control, mainSha, instance) {
  requireCondition(mainSha === instance.sourceSha, 'CURRENT_MAIN_CHANGED');
  const get = markers(control?.body);
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
  const autonomy = [...control.body.matchAll(/^GENERAL_AUTONOMY=(.*)$/gm)].map((match) => match[1]);
  requireCondition(
    autonomy.length > 0 && autonomy.every((value) => value === 'false'),
    'GENERAL_AUTONOMY_MUST_REMAIN_FALSE',
  );
}

export function requireExistingExecutionPolicy(policy) {
  const runtime = policy?.activeRuntime?.ag01Orchestrator;
  requireCondition(
    runtime?.executionAuthorized === true &&
      runtime.executionAuthority === 'CORE_POLICY_APPROVAL_ONLY' &&
      runtime.directProviderWriteAuthorized === false &&
      runtime.resourceName === SERVICE &&
      runtime.runtimeServiceAccount === RUNTIME &&
      runtime.private === true,
    'EXISTING_AG01_EXECUTION_AUTHORITY_REQUIRED',
  );
}

function serviceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AcceptanceError('AG01_URL_INVALID');
  }
  requireCondition(
    url.protocol === 'https:' &&
      url.pathname === '/' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.hostname.startsWith(SERVICE + '-') &&
      url.hostname.endsWith('.run.app'),
    'AG01_URL_INVALID',
  );
  return url.origin;
}

export function revisionContext(service, revision, iam, scope) {
  const traffic = stableTraffic(service, { service: SERVICE });
  requireCondition(
    traffic.size === 1 && traffic.get(scope.revision) === 100,
    'AG01_PRESTATE_CHANGED',
  );
  requireCondition(
    service.invokerIamDisabled !== true && iam && Array.isArray(iam.bindings ?? []),
    'PRIVATE_INVOKER_POSTURE_REQUIRED',
  );
  requireCondition(
    !(iam.bindings ?? []).some(
      (binding) =>
        binding.role === 'roles/run.invoker' &&
        (binding.members ?? []).some(
          (member) => member === 'allUsers' || member === 'allAuthenticatedUsers',
        ),
    ),
    'PUBLIC_INVOKER_FORBIDDEN',
  );
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
          scope.revision,
    ) &&
      UUID.test(revision.uid) &&
      revision.serviceAccount === RUNTIME &&
      revision.conditions?.some(
        (condition) => condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED',
      ) &&
      revision.containers?.length === 1,
    'AG01_REVISION_NOT_VERIFIED',
  );
  const container = revision.containers[0];
  requireCondition(
    typeof container.image === 'string' &&
      container.image.startsWith(IMAGE_PREFIX) &&
      container.image.endsWith('@' + scope.digest),
    'AG01_IMAGE_MISMATCH',
  );
  const env = {};
  const secretRefs = {};
  for (const item of container.env ?? []) {
    requireCondition(
      typeof item.name === 'string' && !(item.name in env) && !(item.name in secretRefs),
      'RUNTIME_ENV_AMBIGUOUS',
    );
    if (Object.hasOwn(item, 'value')) env[item.name] = item.value;
    else if (item.valueSource?.secretKeyRef) secretRefs[item.name] = item.valueSource.secretKeyRef;
    else throw new AcceptanceError('RUNTIME_ENV_UNREADABLE');
  }
  requireCondition(env.TOCA_RELEASE_SHA === scope.runtimeSourceSha, 'RUNTIME_RELEASE_SHA_MISMATCH');
  requireCondition(
    env.NODE_ENV === 'production' &&
      env.AG01_MODEL_PROVIDER === 'vertex' &&
      env.AG01_GOOGLE_AUTH_MODE === 'gcp_metadata',
    'RUNTIME_CONFIGURATION_CONTEXT_INCOMPLETE',
  );
  requireCondition(
    env.TOCA_AG01_INTERNAL_SPECIALISTS_ENABLED === 'true',
    'SPECIALISTS_NOT_ENABLED',
  );
  requireCondition(env.META_ADS_READ_ENABLED === 'true', 'META_READ_BINDING_DISABLED');
  const tokenKey = env.META_ACCESS_TOKEN_ENV_KEY;
  requireCondition(tokenKey === 'TOCA_SECRET_META_ACCESS_TOKEN', 'META_TOKEN_REFERENCE_NOT_BOUND');
  const secretName = (ref) => {
    requireCondition(
      ref && typeof ref.secret === 'string' && /^(latest|[1-9][0-9]*)$/.test(ref.version),
      'SECRET_REFERENCE_INVALID',
    );
    const prefix = 'projects/' + PROJECT + '/secrets/';
    const numeric = 'projects/990081828836/secrets/';
    if (ref.secret.startsWith(prefix)) return ref.secret.slice(prefix.length);
    if (ref.secret.startsWith(numeric)) return ref.secret.slice(numeric.length);
    requireCondition(!ref.secret.includes('/'), 'SECRET_PROJECT_MISMATCH');
    return ref.secret;
  };
  requireCondition(
    secretName(secretRefs[tokenKey]) === META_SECRET,
    'META_SECRET_REFERENCE_MISMATCH',
  );
  requireCondition(
    secretName(secretRefs.DATABASE_URL) === DATABASE_SECRET,
    'DATABASE_SECRET_REFERENCE_MISMATCH',
  );
  const instances = (revision.volumes ?? []).flatMap(
    (volume) => volume.cloudSqlInstance?.instances ?? [],
  );
  requireCondition(
    instances.length === 1 &&
      instances[0].startsWith(PROJECT + ':' + REGION + ':') &&
      /^[a-z][a-z0-9-]*$/.test(instances[0].split(':')[2]),
    'EXISTING_CLOUD_SQL_BINDING_REQUIRED',
  );
  const privateContext = {
    env: { ...env, K_SERVICE: SERVICE, K_REVISION: scope.revision },
    databaseSecretVersion: secretRefs.DATABASE_URL.version,
    cloudSqlInstance: instances[0],
  };
  const publicContext = {
    serviceUid: service.uid,
    serviceEtag: service.etag,
    revisionUid: revision.uid,
    baseUrl: serviceUrl(service.uri),
    // The hash binds all effective env/secret references without publishing them.
    runtimeFingerprint: fingerprint({ service, revision, iam }),
    metaSecretReferenceVerified: true,
    databaseSecretReferenceVerified: true,
    privateInvokerPostureVerified: true,
  };
  return { privateContext, publicContext };
}

export function configurationScope(config, routeCapabilities) {
  requireCondition(sameSet(config.authorizationRoles, ['READER']), 'CORE_READ_ONLY_ROLE_REQUIRED');
  requireCondition(
    config.allowedRouteIds.length === 0 || config.allowedRouteIds.includes('R08'),
    'R08_NOT_AUTHORIZED',
  );
  requireCondition(sameSet(config.allowedTargetAccounts, [ACCOUNT]), 'ACCOUNT_GRANT_NOT_EXCLUSIVE');
  const relevant = config.allowedCapabilityIds.filter((capability) =>
    routeCapabilities.includes(capability),
  );
  requireCondition(relevant.includes(CAPABILITY), 'INSIGHTS_CAPABILITY_NOT_AUTHORIZED');
  // R08 is enforced by AG01_ROUTE_HINT_CONFLICT before plan execution. Grants
  // outside R08 are irrelevant. Accountless or unproved R08 readers are not.
  requireCondition(
    relevant.every((capability) => SAFE_ACCOUNT_READS.has(capability)),
    'R08_READER_ACCOUNT_BOUNDARY_NOT_PROVEN',
  );
  for (const value of [
    config.tenantId,
    config.workspaceId,
    config.organizationId,
    config.servicePrincipalId,
  ])
    requireCondition(text(value), 'RUNTIME_IDENTITY_CONTEXT_REQUIRED');
  return {
    tenantId: config.tenantId,
    workspaceId: config.workspaceId,
    organizationId: config.organizationId,
    principalId: config.servicePrincipalId,
    roles: [...config.authorizationRoles],
    routeCapabilities: [...new Set(relevant)].sort(),
    account: ACCOUNT,
    identityOrigin: 'LIVE_REVISION_AND_MATCHING_PRODUCTION_CONFIG_PARSER',
  };
}

export function requestFor(scope) {
  const payload = {
    adAccountId: ACCOUNT,
    currency: 'BRL',
    level: 'account',
    fields: INSIGHT_FIELDS,
    since: scope.since,
    until: scope.until,
  };
  return {
    idempotencyKey: scope.idempotencyKey,
    correlationId: scope.correlationId,
    routeHint: 'R08',
    message:
      'Missão interna AG-09/R08 autorizada de aceitação READ ONLY. Execute uma única leitura nativa TOCA Core ' +
      CAPABILITY +
      ' com este payload exato: ' +
      JSON.stringify(payload) +
      '. Use o SOP/template canônicos já existentes. Não use agregadores, outras contas, escrita ou aprovação para escrita. ' +
      'Retorne o resultado real, inclusive NO_ROWS quando a API retornar data=[]. Não sintetize métricas nem simule uma execução.',
  };
}

function requireScope(instance, identity, correlationId) {
  requireCondition(
    instance?.tenantId === identity.tenantId &&
      instance.workspaceId === identity.workspaceId &&
      instance.organizationId === identity.organizationId &&
      instance.requesterPrincipalId === identity.principalId &&
      instance.correlationId === correlationId,
    'WORKFLOW_SCOPE_MISMATCH',
  );
}

export function verifyMission(snapshot, scope, identity, audit, auditVerification) {
  const instance = snapshot?.instance;
  requireScope(instance, identity, scope.correlationId);
  requireCondition(
    instance.definitionId === 'ag01-internal-specialist-mission' &&
      instance.definitionVersion === '1.1.0' &&
      instance.routeId === 'R08' &&
      instance.status === 'SUCCEEDED' &&
      snapshot.steps?.length === 1,
    'MISSION_NOT_SUCCEEDED',
  );
  const manifest = instance.input;
  const step = snapshot.steps[0];
  requireCondition(
    manifest?.mission_id === instance.workflowId &&
      manifest.owner === 'AG-09' &&
      manifest.routeId === 'R08' &&
      manifest.correlationId === scope.correlationId &&
      manifest.capability === step.capabilityId &&
      identity.routeCapabilities.includes(step.capabilityId),
    'MISSION_MANIFEST_MISMATCH',
  );
  requireCondition(
    step.stepId === 'execute-core-capability' &&
      step.status === 'SUCCEEDED' &&
      step.claimedBy === null &&
      step.claimExecutionId === null &&
      step.attempts === 1 &&
      step.maxAttempts === 1 &&
      step.input?.adAccountId === ACCOUNT,
    'MISSION_EXECUTION_BOUNDARY_INVALID',
  );
  // Both canonical stores clear the active claim on completion. The durable
  // STEP_CLAIMED -> STEP_SUCCEEDED events retain the actual worker and claim ID.
  const claims = (snapshot.events ?? []).filter(
    (event) => event.eventType === 'STEP_CLAIMED' && event.stepId === step.stepId,
  );
  const completions = (snapshot.events ?? []).filter(
    (event) => event.eventType === 'STEP_SUCCEEDED' && event.stepId === step.stepId,
  );
  requireCondition(
    claims.length === 1 &&
      completions.length === 1 &&
      [...claims, ...completions].every(
        (event) =>
          event.workflowId === instance.workflowId && event.correlationId === scope.correlationId,
      ) &&
      claims[0].payload?.workerId === 'ag01-internal:AG-09' &&
      claims[0].payload.attempt === 1 &&
      text(claims[0].payload.executionId) &&
      completions[0].payload?.executionId === claims[0].payload.executionId,
    'DURABLE_WORKER_CLAIM_NOT_VERIFIED',
  );
  const execution = step.output;
  requireCondition(
    text(execution?.executionId) &&
      execution.capabilityId === step.capabilityId &&
      step.evidence?.includes('ag01:worker:AG-09') &&
      step.evidence.includes('ag01:core-execution:' + execution.executionId),
    'CORE_ACK_NOT_PERSISTED',
  );
  requireCondition(
    Array.isArray(audit) &&
      audit.length >= 2 &&
      auditVerification?.valid === true &&
      auditVerification.executionId === execution.executionId &&
      auditVerification.recordCount === audit.length,
    'CORE_AUDIT_CHAIN_NOT_VERIFIED',
  );
  requireCondition(
    audit.every(
      (record) =>
        record.executionId === execution.executionId &&
        record.correlationId === scope.correlationId &&
        record.toolName === step.capabilityId &&
        record.requester === identity.principalId &&
        record.tenantId === identity.tenantId &&
        record.workspaceId === identity.workspaceId &&
        record.organizationId === identity.organizationId &&
        record.principalType === 'SERVICE' &&
        record.authenticationMethod === 'INFRASTRUCTURE_IDENTITY' &&
        record.riskClass === 'READ' &&
        sameSet(record.authorizationRoles, ['READER']) &&
        record.connectedAccount === ACCOUNT &&
        !record.approvalId,
    ),
    'CORE_AUDIT_SCOPE_MISMATCH',
  );
  requireCondition(
    audit[0].status === 'STARTED' &&
      audit.at(-1).status === 'SUCCEEDED' &&
      !audit.some((record) => ['FAILED', 'DENIED'].includes(record.status)),
    'CORE_AUDIT_NOT_SUCCEEDED',
  );
  if (step.capabilityId !== CAPABILITY) {
    return {
      missionId: instance.workflowId,
      executionId: execution.executionId,
      capability: step.capabilityId,
      resultDigest: fingerprint(execution.result),
    };
  }
  requireCondition(
    step.input.currency === 'BRL' &&
      step.input.level === 'account' &&
      step.input.since === scope.since &&
      step.input.until === scope.until &&
      sameSet(step.input.fields, INSIGHT_FIELDS),
    'INSIGHTS_REQUEST_SCOPE_MISMATCH',
  );
  const result = execution.result;
  const source = result?.source;
  requireCondition(
    source?.provider === 'META_MARKETING_API' &&
      source.gateway === 'TOCA_MCP_SERVER' &&
      source.repository === REPOSITORY &&
      source.capability === CAPABILITY &&
      source.reportingTimeZone === 'America/Bahia' &&
      source.externalAggregatorsAccepted === false &&
      result.accountId === ACCOUNT &&
      result.currency === 'BRL' &&
      result.level === 'account' &&
      result.window?.since === scope.since &&
      result.window?.until === scope.until &&
      Array.isArray(result.data),
    'NATIVE_META_RESULT_NOT_VERIFIED',
  );
  requireCondition(
    result.observationState === (result.data.length ? 'ROWS_RETURNED' : 'NO_ROWS'),
    'META_EMPTY_RESULT_AMBIGUOUS',
  );
  requireCondition(
    result.data.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        row.account_id === ACCOUNT &&
        row.account_currency === 'BRL' &&
        typeof row.date_start === 'string' &&
        typeof row.date_stop === 'string' &&
        row.date_start >= scope.since &&
        row.date_stop <= scope.until &&
        row.date_start <= row.date_stop,
    ),
    'META_ROW_ACCOUNT_CURRENCY_OR_WINDOW_MISMATCH',
  );
  return {
    missionId: instance.workflowId,
    executionId: execution.executionId,
    capability: CAPABILITY,
    provider: source.provider,
    observationState: result.observationState,
    rowCount: result.data.length,
    providerCurrencyVerified: result.data.length > 0,
    resultDigest: fingerprint(result),
    auditHeadHash: auditVerification.headHash,
  };
}

export async function readPersistedProof(database, scope, identity) {
  const ids = await database.findMissions(scope.correlationId, identity);
  requireCondition(ids.length > 0 && ids.length <= 8, 'SPECIALIST_MISSION_NOT_FOUND_OR_UNBOUNDED');
  const records = await database.auditByCorrelation(scope.correlationId);
  const proofs = [];
  for (const id of ids) {
    const snapshot = await database.workflow(id);
    const executionId = snapshot?.steps?.[0]?.output?.executionId;
    requireCondition(text(executionId), 'CORE_ACK_NOT_PERSISTED');
    proofs.push(
      verifyMission(
        snapshot,
        scope,
        identity,
        records.filter((record) => record.executionId === executionId),
        await database.verifyAudit(executionId),
      ),
    );
  }
  requireCondition(
    proofs.filter((proof) => proof.capability === CAPABILITY).length === 1,
    'SINGLE_INSIGHTS_MISSION_REQUIRED',
  );
  requireCondition(
    records.every((record) => proofs.some((proof) => proof.executionId === record.executionId)),
    'UNEXPECTED_CORE_EXECUTION_IN_CORRELATION',
  );
  return proofs;
}

export async function executeAcceptance(context, deps) {
  const { scope, identity } = context;
  const before = await deps.liveContext(scope);
  requireCondition(
    fingerprint(before.publicContext) === fingerprint(context.runtime),
    'AG01_PRESTATE_CHANGED',
  );
  requireCondition(
    fingerprint(before.identity) === fingerprint(identity),
    'RUNTIME_GRANTS_CHANGED',
  );
  const database = await deps.openDatabase(before.privateContext);
  try {
    await database.preflight();
    requireCondition(
      (await database.findMissions(scope.correlationId, identity)).length === 0 &&
        (await database.auditByCorrelation(scope.correlationId)).length === 0,
      'MISSION_AUTHORIZATION_REPLAY',
    );
    await deps.health(context.runtime.baseUrl);
    await deps.authorize(scope, false);
    const immediate = await deps.liveContext(scope);
    requireCondition(
      fingerprint(immediate.publicContext) === fingerprint(context.runtime) &&
        fingerprint(immediate.identity) === fingerprint(identity),
      'AG01_PRESTATE_CHANGED',
    );
    await deps.consume(scope);
    await deps.authorize(scope, true);
    await deps.markRequestStarted();
    let response = { status: 0, body: null };
    try {
      // There is deliberately one POST and no POST/resume retry.
      response = await deps.post(
        context.runtime.baseUrl + '/v1/orchestrator/execute',
        requestFor(scope),
      );
    } catch {
      // A lost response is reconciled only through persisted readback.
    }
    const proofs = await readPersistedProof(database, scope, identity);
    if (response.status !== 0) {
      const result = response.body?.orchestration;
      requireCondition(
        response.status === 200 &&
          result?.status === 'SUCCEEDED' &&
          result.routeId === 'R08' &&
          result.primaryAgent === 'AG-09' &&
          result.correlationId === scope.correlationId &&
          result.duplicate === false,
        'ORCHESTRATION_RESPONSE_NOT_SUCCEEDED',
      );
    }
    const after = await deps.liveContext(scope);
    requireCondition(
      fingerprint(after.publicContext) === fingerprint(context.runtime) &&
        fingerprint(after.identity) === fingerprint(identity),
      'AG01_CHANGED_DURING_READ',
    );
    return {
      schemaVersion: 1,
      result: 'PASS',
      classification:
        response.status === 0
          ? 'DURABLE_ACK_VERIFIED_HTTP_RESPONSE_UNCERTAIN'
          : 'DURABLE_AG09_META_READ_VERIFIED',
      controllerSha: scope.sourceSha,
      runtimeSourceSha: scope.runtimeSourceSha,
      runtimeTreeSha: scope.runtimeTreeSha,
      revision: scope.revision,
      imageDigest: scope.digest,
      authorizationIssue: Number(scope.issueNumber),
      runId: scope.runId,
      runAttempt: scope.runAttempt,
      correlationId: scope.correlationId,
      routeId: 'R08',
      accountId: ACCOUNT,
      currency: 'BRL',
      since: scope.since,
      until: scope.until,
      httpStatus: response.status || null,
      providerWrites: false,
      serviceMutations: false,
      iamMutations: false,
      databaseReadbackReadOnly: true,
      internalWorkflowAndAuditPersistedByAg01: true,
      rawProviderRowsPublished: false,
      secretPayloadPublished: false,
      proofs,
    };
  } finally {
    await database.close();
  }
}

// Operational adapters. Tests inject these boundaries; no test needs a provider,
// credential, PostgreSQL service, listener, or GCP runtime.
const exec = promisify(execFile);
async function command(file, args, code, input) {
  try {
    if (input === undefined)
      return (
        await exec(file, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000 })
      ).stdout;
    return await new Promise((accept, reject) => {
      const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new AcceptanceError(code));
      }, 30_000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.length > 8 * 1024 * 1024) child.kill('SIGTERM');
      });
      child.stderr.resume();
      child.on('error', () => {
        clearTimeout(timer);
        reject(new AcceptanceError(code));
      });
      child.on('close', (status) => {
        clearTimeout(timer);
        if (status === 0) accept(output);
        else reject(new AcceptanceError(code));
      });
      child.stdin.end(input);
    });
  } catch {
    throw new AcceptanceError(code);
  }
}
const github = async (path, method = 'GET', body) =>
  JSON.parse(
    await command(
      'gh',
      [
        'api',
        '--method',
        method,
        'repos/' + REPOSITORY + '/' + path,
        ...(body === undefined ? [] : ['--input', '-']),
      ],
      'GITHUB_READ_OR_AUTHORIZATION_FAILED',
      body === undefined ? undefined : JSON.stringify(body),
    ),
  );

async function liveAuthorization(scope, consumed = false) {
  const [issue, main, control] = await Promise.all([
    github('issues/' + scope.issueNumber),
    github('git/ref/heads/main'),
    github('issues/640'),
  ]);
  requireStableMain(control, main.object?.sha, scope);
  verifyAuthorizationScope(issue, scope, new Date(), consumed);
  return issue;
}

async function sourceCompatibility(scope) {
  requireExistingExecutionPolicy(
    JSON.parse(await readFile('infra/control-plane/policy.json', 'utf8')),
  );
  requireCondition(
    (
      await command(
        'git',
        ['rev-parse', scope.runtimeSourceSha + '^{tree}'],
        'RUNTIME_SOURCE_NOT_AVAILABLE',
      )
    ).trim() === scope.runtimeTreeSha,
    'RUNTIME_TREE_MISMATCH',
  );
  // This checks the client/parser/Core contract against the observed running
  // source. It neither labels the image as current main nor reuses it to deploy.
  await command(
    'git',
    [
      'diff',
      '--quiet',
      scope.runtimeSourceSha,
      scope.sourceSha,
      '--',
      'src',
      'package.json',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'Dockerfile',
    ],
    'RUNTIME_SOURCE_CONTRACT_CHANGED',
  );
}

async function cloudGet(path) {
  const token = (
    await command('gcloud', ['auth', 'print-access-token'], 'EXISTING_GCP_IDENTITY_UNAVAILABLE')
  ).trim();
  try {
    const response = await fetch('https://run.googleapis.com/v2/' + path, {
      headers: { Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    requireCondition(response.ok, 'EXISTING_GCP_READ_ACCESS_DENIED');
    return await response.json();
  } catch (error) {
    if (error instanceof AcceptanceError) throw error;
    throw new AcceptanceError('EXISTING_GCP_READ_UNAVAILABLE');
  }
}

async function databaseUrl(context) {
  return (
    await command(
      'gcloud',
      [
        'secrets',
        'versions',
        'access',
        context.databaseSecretVersion,
        '--secret',
        DATABASE_SECRET,
        '--project',
        PROJECT,
      ],
      'EXISTING_DATABASE_SECRET_READ_DENIED',
    )
  ).trim();
}

async function currentRuntime(scope) {
  await sourceCompatibility(scope);
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
  const [service, revision, iam] = await Promise.all([
    cloudGet(SERVICE_PATH),
    cloudGet(SERVICE_PATH + '/revisions/' + scope.revision),
    cloudGet(SERVICE_PATH + ':getIamPolicy'),
  ]);
  let context;
  try {
    context = revisionContext(service, revision, iam, scope);
  } catch (error) {
    if (error instanceof AcceptanceError) error.gates = runtimeGateEvidence(revision);
    throw error;
  }
  const rawDatabaseUrl = await databaseUrl(context.privateContext);
  const [{ loadAg01ProductionConfig }, { getRouteDefinition }] = await Promise.all([
    import('../dist/src/orchestrator/production-config.js'),
    import('../dist/src/governance/route-catalog.js'),
  ]);
  let config;
  try {
    // Use the same parser and effective plain env as the running revision.
    // K_SERVICE is the verified Cloud Run service, not a guessed principal.
    config = loadAg01ProductionConfig({
      ...context.privateContext.env,
      DATABASE_URL: rawDatabaseUrl,
    });
  } catch {
    throw new AcceptanceError('RUNTIME_CONFIGURATION_CONTEXT_INCOMPLETE');
  }
  try {
    return {
      ...context,
      identity: configurationScope(config, getRouteDefinition('R08').capabilityIds),
    };
  } catch (error) {
    if (error instanceof AcceptanceError) error.gates = runtimeGateEvidence(revision);
    throw error;
  }
}

export async function databasePreflight(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const mode = await client.query('show transaction_read_only');
    requireCondition(
      mode.rows?.[0]?.transaction_read_only === 'on',
      'DATABASE_READ_ONLY_MODE_REQUIRED',
    );
    for (const table of [
      'workflow_instances',
      'workflow_steps',
      'workflow_dependencies',
      'workflow_events',
      'workflow_human_tasks',
      'workflow_timers',
      'workflow_compensations',
      'audit_ledger_events',
      'audit_ledger_heads',
    ]) {
      await client.query('select 1 from ' + table + ' limit 0');
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (error instanceof AcceptanceError) throw error;
    throw new AcceptanceError('EXISTING_DATABASE_READ_ACCESS_DENIED');
  } finally {
    client.release();
  }
}

async function openDatabase(context) {
  const proxyPath = process.env.CLOUD_SQL_PROXY_PATH;
  requireCondition(typeof proxyPath === 'string', 'VERIFIED_CLOUD_SQL_PROXY_REQUIRED');
  requireCondition(
    hash(await readFile(proxyPath)) ===
      'fae2766aac9d614a2bdef2f2a7778f3d054f3acd5ff07a81a9e300bd471512eb',
    'CLOUD_SQL_PROXY_DIGEST_MISMATCH',
  );
  const raw = await databaseUrl(context);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AcceptanceError('DATABASE_REFERENCE_PAYLOAD_INVALID');
  }
  requireCondition(
    ['postgres:', 'postgresql:'].includes(url.protocol),
    'DATABASE_REFERENCE_PAYLOAD_INVALID',
  );
  url.hostname = '127.0.0.1';
  url.port = '6543';
  for (const key of [
    'host',
    'port',
    'ssl',
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'sslaccept',
    'options',
  ])
    url.searchParams.delete(key);
  const [{ default: pg }, { PostgresWorkflowStore }, { PostgresAuditSink }, { ToolRegistry }] =
    await Promise.all([
      import('pg'),
      import('../dist/src/persistence/postgres-workflow-store.js'),
      import('../dist/src/persistence/postgres-audit-sink.js'),
      import('../dist/src/core/tool-registry.js'),
    ]);
  const proxy = spawn(
    proxyPath,
    ['--address', '127.0.0.1', '--port', '6543', context.cloudSqlInstance],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  proxy.stderr.resume();
  let proxyError = false;
  proxy.on('error', () => {
    proxyError = true;
  });
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: false,
    max: 2,
    connectionTimeoutMillis: 5000,
    options: '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000',
  });
  const workflows = new PostgresWorkflowStore(pool);
  const audit = new PostgresAuditSink(pool, new ToolRegistry());
  const close = async () => {
    try {
      await pool.end();
    } finally {
      if (proxy.exitCode === null) proxy.kill('SIGTERM');
    }
  };
  try {
    let connected = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      requireCondition(
        !proxyError && proxy.exitCode === null,
        'EXISTING_CLOUD_SQL_PROXY_ACCESS_DENIED',
      );
      try {
        await databasePreflight(pool);
        connected = true;
        break;
      } catch {
        if (attempt < 5) await new Promise((accept) => setTimeout(accept, 1000));
      }
    }
    requireCondition(connected, 'EXISTING_DATABASE_READ_ACCESS_DENIED');
  } catch (error) {
    await close();
    throw error;
  }
  return {
    preflight: () => databasePreflight(pool),
    findMissions: async (correlationId, identity) => {
      const result = await pool.query(
        'select workflow_id from workflow_instances where correlation_id = $1 and tenant_id = $2 and workspace_id = $3 and organization_id = $4 and requester_principal_id = $5 order by created_at asc limit 9',
        [
          correlationId,
          identity.tenantId,
          identity.workspaceId,
          identity.organizationId,
          identity.principalId,
        ],
      );
      return result.rows.map((row) => row.workflow_id);
    },
    workflow: (workflowId) => workflows.get(workflowId),
    auditByCorrelation: (correlationId) => audit.listByCorrelation(correlationId, 100),
    verifyAudit: (executionId) => audit.verifyExecution(executionId),
    close,
  };
}

async function authenticatedRequest(url, method, body) {
  requireCondition(
    text(process.env.ID_TOKEN) ||
      (typeof process.env.ID_TOKEN === 'string' && process.env.ID_TOKEN.length > 300),
    'PRIVATE_INVOKER_TOKEN_REQUIRED',
  );
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + process.env.ID_TOKEN,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(method === 'POST' ? 120_000 : 20_000),
    redirect: 'error',
  });
  const raw = await response.text();
  requireCondition(raw.length <= 1024 * 1024, 'AG01_RESPONSE_TOO_LARGE');
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* The persisted proof remains authoritative. */
  }
  return { status: response.status, body: json };
}

async function main() {
  const mode = process.argv[2];
  const directory = resolve(process.env.AG09_ACCEPTANCE_DIR ?? '.ag09-readonly-acceptance');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const contextPath = resolve(directory, 'context.json');
  const authorizationPath = resolve(directory, 'authorization.json');
  const resultPath = resolve(directory, 'result.json');
  const instance = instanceFromEnv(process.env);
  const save = (path, value) =>
    writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  try {
    if (mode === 'authorize') {
      const issue = await github('issues/' + instance.issueNumber);
      const scope = authorizationScope(issue, instance);
      await liveAuthorization(scope);
      await save(authorizationPath, scope);
      return;
    }
    const scope = JSON.parse(await readFile(authorizationPath, 'utf8'));
    requireCondition(
      scope.sourceSha === instance.sourceSha &&
        scope.runId === instance.runId &&
        scope.runAttempt === instance.runAttempt &&
        scope.issueNumber === instance.issueNumber,
      'ACCEPTANCE_CONTEXT_INSTANCE_MISMATCH',
    );
    if (mode === 'finish') {
      const issue = await github('issues/' + scope.issueNumber);
      requireCondition(
        issue.state === 'open' &&
          issue.user?.login === instance.actor &&
          issue.title?.startsWith(TITLE) &&
          hash(normalizedAuthorizationBody(issue.body)) === scope.issueBodyHash,
        'AUTHORIZATION_FINALIZATION_STATE_CHANGED',
      );
      const get = markers(issue.body);
      const state = get('AUTHORIZATION_STATE');
      requireCondition(
        ['ACTIVE', 'CONSUMED'].includes(state),
        'AUTHORIZATION_FINALIZATION_STATE_CHANGED',
      );
      if (state === 'CONSUMED') {
        get('CONSUMED_BY_RUN_ID', instance.runId);
        get('CONSUMED_BY_RUN_ATTEMPT', instance.runAttempt);
      }
      let result = { result: 'NOT_PROVEN', code: 'ACCEPTANCE_PHASE_DID_NOT_COMPLETE' };
      try {
        result = JSON.parse(await readFile(resultPath, 'utf8'));
      } catch {
        /* No provider result is inferred. */
      }
      if (result.result === 'PREFLIGHT_PASS')
        result = { result: 'NOT_PROVEN', code: 'ACCEPTANCE_EXECUTION_DID_NOT_COMPLETE' };
      await save(resultPath, result);
      const comment = 'AG09_NATIVE_META_READONLY_ACCEPTANCE\n' + JSON.stringify(result, null, 2);
      const posted = await github('issues/' + scope.issueNumber + '/comments', 'POST', {
        body: comment,
      });
      requireCondition(
        (await github('issues/comments/' + posted.id)).body === comment,
        'RESULT_COMMENT_READBACK_FAILED',
      );
      const immediate = await github('issues/' + scope.issueNumber);
      requireCondition(
        immediate.body === issue.body &&
          immediate.state === 'open' &&
          immediate.user?.login === instance.actor &&
          immediate.title === issue.title,
        'AUTHORIZATION_FINALIZATION_STATE_CHANGED',
      );
      const body = issue.body.replace(
        /^AUTHORIZATION_STATE=(?:ACTIVE|CONSUMED)$/m,
        'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED',
      );
      await github('issues/' + scope.issueNumber, 'PATCH', { body, state: 'closed' });
      const closed = await github('issues/' + scope.issueNumber);
      requireCondition(
        closed.body === body && closed.state === 'closed',
        'AUTHORIZATION_CLOSURE_READBACK_FAILED',
      );
      return;
    }
    if (mode === 'preflight') {
      await liveAuthorization(scope);
      const runtime = await currentRuntime(scope);
      const database = await openDatabase(runtime.privateContext);
      try {
        await database.preflight();
      } finally {
        await database.close();
      }
      await save(contextPath, {
        scope,
        identity: runtime.identity,
        runtime: runtime.publicContext,
      });
      await appendFile(
        process.env.GITHUB_OUTPUT,
        'base_url=' + runtime.publicContext.baseUrl + '\n',
      );
      await save(resultPath, {
        result: 'PREFLIGHT_PASS',
        providerCalls: false,
        serviceMutations: false,
        secretPayloadPublished: false,
        databaseReadOnly: true,
      });
      return;
    }
    requireCondition(mode === 'execute', 'UNSUPPORTED_ACCEPTANCE_PHASE');
    const context = JSON.parse(await readFile(contextPath, 'utf8'));
    requireCondition(
      context.scope?.sourceSha === instance.sourceSha &&
        context.scope.runId === instance.runId &&
        context.scope.runAttempt === instance.runAttempt &&
        context.scope.issueNumber === instance.issueNumber,
      'ACCEPTANCE_CONTEXT_INSTANCE_MISMATCH',
    );
    const result = await executeAcceptance(context, {
      liveContext: currentRuntime,
      openDatabase,
      authorize: liveAuthorization,
      health: async (baseUrl) => {
        for (const path of ['/health', '/ready']) {
          const response = await authenticatedRequest(baseUrl + path, 'GET');
          requireCondition(response.status === 200, 'AG01_AUTHENTICATED_HEALTH_NOT_READY');
        }
      },
      consume: async (scope) => {
        const issue = await liveAuthorization(scope);
        const body =
          issue.body.replace(/^AUTHORIZATION_STATE=ACTIVE$/m, 'AUTHORIZATION_STATE=CONSUMED') +
          '\nCONSUMED_BY_RUN_ID=' +
          scope.runId +
          '\nCONSUMED_BY_RUN_ATTEMPT=' +
          scope.runAttempt +
          '\n';
        await github('issues/' + scope.issueNumber, 'PATCH', { body });
      },
      markRequestStarted: () =>
        writeFile(resolve(directory, 'request-started'), 'POST_ONCE\n', {
          flag: 'wx',
          mode: 0o600,
        }),
      post: (url, body) => authenticatedRequest(url, 'POST', body),
    });
    await save(resultPath, result);
    console.log('AG09_READONLY_ACCEPTANCE_RESULT=' + JSON.stringify(result));
  } catch (error) {
    const code =
      error instanceof AcceptanceError ? error.code : 'AG09_READONLY_ACCEPTANCE_NOT_PROVEN';
    await save(mode === 'finish' ? resolve(directory, 'finalization.json') : resultPath, {
      result: 'NOT_PROVEN',
      code,
      controllerSha: instance.sourceSha,
      runId: instance.runId,
      providerWrites: false,
      serviceMutations: false,
      iamMutations: false,
      secretPayloadPublished: false,
      rawProviderRowsPublished: false,
      ...(error instanceof AcceptanceError && error.gates ? { gates: error.gates } : {}),
    });
    console.error(code);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
