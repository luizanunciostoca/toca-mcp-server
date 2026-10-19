import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'luizanunciostoca/toca-mcp-server';
const OWNER = 'luizanunciostoca';
const PROJECT = 'toca-mcp-production';
const PROJECT_NUMBER = '990081828836';
const REGION = 'southamerica-east1';
const RUNTIME_SA = 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const CONTEXT_FILE = 'activation-recovery/rollback-context.json';
const PRESTATE_FILE = 'activation-recovery/prestate.json';
const DIAGNOSTIC_FILE = 'activation-recovery/prestate-diagnostic.json';
const REVISION_TYPE = 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
const RECOVERABLE_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out']);

export const WORKFLOWS = Object.freeze({
  ag01: {
    name: 'AG-01 Grounded Runtime Activation',
    path: '.github/workflows/ag01-grounded-runtime-activation.yml',
    title: 'PRODUCTION AUTHORIZATION — AG-01 grounded runtime activation AUTO',
    service: 'toca-ag01-orchestrator',
    suffix: 'gnd',
    tag: 'grounded',
    image: 'ag01',
    private: true,
    required: {
      AG01_GROUNDED_RUNTIME_ACTIVATION: 'AUTHORIZED',
      ARTIFACT_BUILD_AUTHORIZED: 'true',
      SERVICE_MUTATION_AUTHORIZED: 'true',
      PROVIDER_WRITES_AUTHORIZED: 'false',
      DIRECT_PROVIDER_WRITE_AUTHORIZED: 'false',
      EXTERNAL_BUSINESS_SIDE_EFFECTS_AUTHORIZED: 'false',
      ZERO_TRAFFIC_STAGE_REQUIRED: 'true',
      ROLLBACK_ON_FAILURE: 'true',
    },
  },
  fallback: {
    name: 'Instagram Engagement AG-01 Fallback LIMITED Activation',
    path: '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
    title: 'PRODUCTION AUTHORIZATION — Instagram AG-01 grounded fallback LIMITED activation AUTO',
    service: 'toca-managed-instagram-daemon',
    suffix: 'ag01',
    tag: 'ag01',
    image: 'server',
    private: false,
    required: {
      INSTAGRAM_AG01_GROUNDED_FALLBACK_LIMITED_ACTIVATION: 'AUTHORIZED',
      AUTONOMY_STAGE: 'LIMITED',
      AUTO_REPLY_CHANNELS: 'DIRECT,COMMENT',
      CURRENT_LIMITED_STATE_REQUIRED: 'true',
      SERVICE_MUTATION_AUTHORIZED: 'true',
      SECRET_PAYLOAD_READS_AUTHORIZED: 'true',
      PROVIDER_READS_AUTHORIZED: 'true',
      PROVIDER_METHODS: 'GET_ONLY',
      DATABASE_MUTATIONS_AUTHORIZED: 'false',
      SCHEDULER_MUTATION_AUTHORIZED: 'false',
      PROVIDER_CONFIG_MUTATION_AUTHORIZED: 'false',
      GENERAL_AUTONOMY_PROMOTION_AUTHORIZED: 'false',
      ZERO_TRAFFIC_STAGE_REQUIRED: 'true',
      ROLLBACK_ON_FAILURE: 'true',
      BATCH_SIZE: '1',
    },
  },
});

const SPECIALIST_SCOPE = {
  AG01_INTERNAL_SPECIALISTS_ACTIVATION: 'AUTHORIZED',
  AG01_INTERNAL_SPECIALISTS_MODE: 'READ_ONLY',
  AG01_INTERNAL_SPECIALISTS_SIDE_EFFECTS_AUTHORIZED: 'false',
  AG01_INTERNAL_SPECIALISTS_WORKFLOWSTORE_EXISTING_SCHEMA_ONLY: 'true',
  AG01_INTERNAL_SPECIALISTS_CHATGPT_TASKS_DISPATCH: 'false',
};

export class GuardError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new GuardError(code);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function positiveId(value) {
  const text = String(value);
  requireCondition(
    /^[1-9][0-9]{0,14}$/.test(text) && Number.isSafeInteger(Number(text)),
    'INVALID_INSTANCE_ID',
  );
  return text;
}

export function instanceIdentity({
  kind,
  repository,
  sourceSha,
  runId,
  runAttempt,
  authorizationIssue,
}) {
  requireCondition(Object.hasOwn(WORKFLOWS, kind), 'UNSUPPORTED_WORKFLOW');
  const workflow = WORKFLOWS[kind];
  requireCondition(repository === REPOSITORY && SHA.test(sourceSha), 'INVALID_SOURCE_IDENTITY');
  runId = positiveId(runId);
  runAttempt = positiveId(runAttempt);
  authorizationIssue = positiveId(authorizationIssue);
  const unique = sourceSha.slice(0, 8) + '-' + runId + '-' + runAttempt;
  const candidateSuffix = workflow.suffix + '-' + unique;
  const candidateRevision = workflow.service + '-' + candidateSuffix;
  requireCondition(candidateRevision.length <= 63, 'CANDIDATE_NAME_TOO_LONG');
  // Cloud Run limits service name + traffic tag to 46 characters. GitHub run
  // IDs are unique; base36 preserves every run/attempt digit without truncation.
  // The authenticated context and revision retain the complete source identity.
  const candidateTag =
    workflow.tag[0] + '-' + BigInt(runId).toString(36) + '-' + BigInt(runAttempt).toString(36);
  requireCondition(workflow.service.length + candidateTag.length <= 46, 'CANDIDATE_TAG_TOO_LONG');
  return {
    kind,
    repository,
    sourceSha,
    runId,
    runAttempt,
    authorizationIssue,
    workflowPath: workflow.path,
    workflowName: workflow.name,
    project: PROJECT,
    region: REGION,
    service: workflow.service,
    candidateSuffix,
    candidateRevision,
    candidateTag,
  };
}

function marker(body, key, required = true) {
  requireCondition(typeof body === 'string', 'INVALID_AUTHORIZATION_BODY');
  const values = body.split(/\r?\n/).filter((line) => line.startsWith(key + '='));
  if (!required && values.length === 0) return undefined;
  requireCondition(values.length === 1, 'AUTHORIZATION_MARKER_COUNT');
  return values[0].slice(key.length + 1);
}

function consistentControlMarker(body, key, expected) {
  requireCondition(typeof body === 'string', 'INVALID_CONTROL_BODY');
  const lines = body.split(/\r?\n/).filter((line) => line.startsWith(key + '='));
  requireCondition(
    lines.length > 0 && lines.every((line) => line === key + '=' + expected),
    'MAIN_STABILITY_BLOCKED',
  );
}

export function authorizationScope(issue, identity, allowConsumed = false) {
  const workflow = WORKFLOWS[identity.kind];
  requireCondition(
    issue &&
      String(issue.number) === identity.authorizationIssue &&
      issue.user?.login === OWNER &&
      issue.title?.startsWith(workflow.title),
    'AUTHORIZATION_IDENTITY_MISMATCH',
  );
  const state = marker(issue.body, 'AUTHORIZATION_STATE');
  requireCondition(
    (state === 'ACTIVE' && issue.state === 'open') ||
      (allowConsumed && state === 'CONSUMED' && issue.state === 'closed'),
    'AUTHORIZATION_NOT_ACTIVE_OR_CONSUMED',
  );
  const scope = { AUTHORIZED_CONTROLLER_SHA: identity.sourceSha, ...workflow.required };
  for (const [key, value] of Object.entries(scope)) {
    requireCondition(marker(issue.body, key) === value, 'AUTHORIZATION_SCOPE_MISMATCH');
  }
  scope.EXPECTED_PREVIOUS_REVISION = marker(issue.body, 'EXPECTED_PREVIOUS_REVISION');
  requireCondition(
    new RegExp('^' + workflow.service + '-[a-z0-9-]+$').test(scope.EXPECTED_PREVIOUS_REVISION) &&
      scope.EXPECTED_PREVIOUS_REVISION.length <= 63,
    'INVALID_PREVIOUS_REVISION',
  );
  if (identity.kind === 'fallback') {
    scope.RUNTIME_IMAGE_DIGEST = marker(issue.body, 'RUNTIME_IMAGE_DIGEST');
    scope.AG01_SERVICE_URL = marker(issue.body, 'AG01_SERVICE_URL');
    scope.AG01_AUDIENCE = marker(issue.body, 'AG01_AUDIENCE');
    requireCondition(DIGEST.test(scope.RUNTIME_IMAGE_DIGEST), 'INVALID_AUTHORIZED_IMAGE_DIGEST');
    requireCondition(
      /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/.test(scope.AG01_SERVICE_URL) &&
        scope.AG01_AUDIENCE === scope.AG01_SERVICE_URL,
      'INVALID_AG01_AUDIENCE',
    );
  } else if (
    Object.keys(SPECIALIST_SCOPE).some((key) => marker(issue.body, key, false) !== undefined)
  ) {
    for (const [key, value] of Object.entries(SPECIALIST_SCOPE)) {
      requireCondition(marker(issue.body, key) === value, 'AG01_SPECIALIST_OPTIN_INCOMPLETE');
      scope[key] = value;
    }
  }
  return scope;
}

function serviceName(identity) {
  return 'projects/' + PROJECT + '/locations/' + REGION + '/services/' + identity.service;
}

function sameServiceName(value, identity) {
  return (
    value === serviceName(identity) ||
    value ===
      serviceName(identity).replace('projects/' + PROJECT + '/', 'projects/' + PROJECT_NUMBER + '/')
  );
}

function revisionName(value, identity) {
  if (typeof value !== 'string') return null;
  const prefixes = [
    serviceName(identity) + '/revisions/',
    serviceName(identity).replace('projects/' + PROJECT + '/', 'projects/' + PROJECT_NUMBER + '/') +
      '/revisions/',
  ];
  const prefix = prefixes.find((entry) => value.startsWith(entry));
  const short = prefix ? value.slice(prefix.length) : value;
  return new RegExp('^' + identity.service + '-[a-z0-9-]+$').test(short) && short.length <= 63
    ? short
    : null;
}

function trafficMap(entries, identity) {
  requireCondition(
    Array.isArray(entries) && entries.length > 0 && entries.length <= 100,
    'INVALID_TRAFFIC',
  );
  const result = new Map();
  const tags = new Set();
  let total = 0;
  for (const entry of entries) {
    const revision = revisionName(entry.revision, identity);
    const percent = entry.percent ?? 0;
    requireCondition(
      revision &&
        entry.type === REVISION_TYPE &&
        Number.isInteger(percent) &&
        percent >= 0 &&
        percent <= 100,
      'INVALID_TRAFFIC_TARGET',
    );
    if (entry.tag !== undefined) {
      requireCondition(
        /^[a-z][a-z0-9-]{0,62}$/.test(entry.tag) && !tags.has(entry.tag),
        'INVALID_TRAFFIC_TAG',
      );
      tags.add(entry.tag);
    }
    if (percent > 0) result.set(revision, (result.get(revision) ?? 0) + percent);
    total += percent;
  }
  requireCondition(total === 100, 'INVALID_TRAFFIC_TOTAL');
  return result;
}

function comparableTraffic(map) {
  return JSON.stringify([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function stableTraffic(service, identity, expectedUid) {
  requireCondition(
    sameServiceName(service?.name, identity) && UUID.test(service.uid),
    'SERVICE_IDENTITY_MISMATCH',
  );
  if (expectedUid) requireCondition(service.uid === expectedUid, 'SERVICE_RECREATED');
  requireCondition(
    (service.reconciling === undefined || service.reconciling === false) &&
      /^[1-9][0-9]*$/.test(String(service.generation)) &&
      String(service.observedGeneration) === String(service.generation),
    'SERVICE_NOT_STABLE',
  );
  requireCondition(
    typeof service.etag === 'string' && service.etag.length > 0 && service.etag.length <= 256,
    'MISSING_SERVICE_ETAG',
  );
  const desired = trafficMap(service.traffic, identity);
  const observed = trafficMap(service.trafficStatuses, identity);
  requireCondition(
    comparableTraffic(desired) === comparableTraffic(observed),
    'TRAFFIC_RECONCILIATION_MISMATCH',
  );
  return observed;
}

function imageDigest(revision) {
  const image = revision?.containers?.[0]?.image;
  const result = typeof image === 'string' ? image.match(/@(sha256:[0-9a-f]{64})$/)?.[1] : null;
  requireCondition(Boolean(result), 'REVISION_IMAGE_DIGEST_UNKNOWN');
  return result;
}

function assertRevision(revision, name, identity, expectedUid, digest, candidate = false) {
  requireCondition(
    revisionName(revision?.name, identity) === name &&
      revision?.name?.includes('/revisions/') &&
      UUID.test(revision.uid),
    'REVISION_IDENTITY_MISMATCH',
  );
  if (expectedUid) requireCondition(revision.uid === expectedUid, 'REVISION_RECREATED');
  requireCondition(revision.serviceAccount === RUNTIME_SA, 'RUNTIME_SERVICE_ACCOUNT_MISMATCH');
  if (!candidate)
    requireCondition(
      revision.conditions?.some(
        (condition) => condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED',
      ),
      'REVISION_NOT_READY',
    );
  requireCondition(imageDigest(revision) === digest, 'REVISION_IMAGE_DIGEST_MISMATCH');
  if (candidate) {
    const env = revision.containers?.[0]?.env ?? [];
    for (const [key, value] of Object.entries({
      TOCA_ACTIVATION_RUN_ID: identity.runId,
      TOCA_ACTIVATION_RUN_ATTEMPT: identity.runAttempt,
      TOCA_ACTIVATION_CONTROLLER_SHA: identity.sourceSha,
    })) {
      const matching = env.filter((item) => item.name === key);
      requireCondition(
        matching.length === 1 && matching[0].value === value,
        'CANDIDATE_INSTANCE_MISMATCH',
      );
    }
  }
}

function privateIam(service, iam) {
  requireCondition(
    iam &&
      (iam.bindings === undefined || Array.isArray(iam.bindings)) &&
      (service.invokerIamDisabled === undefined || typeof service.invokerIamDisabled === 'boolean'),
    'INVALID_IAM_READBACK',
  );
  for (const binding of iam.bindings ?? []) {
    requireCondition(
      binding &&
        typeof binding.role === 'string' &&
        (binding.members === undefined ||
          (Array.isArray(binding.members) &&
            binding.members.every((member) => typeof member === 'string'))),
      'INVALID_IAM_READBACK',
    );
  }
  const publicBinding = (iam.bindings ?? []).some(
    (binding) =>
      binding.role === 'roles/run.invoker' &&
      (binding.members ?? []).some(
        (member) => member === 'allUsers' || member === 'allAuthenticatedUsers',
      ),
  );
  return { publicBinding, invokerIamDisabled: service.invokerIamDisabled === true };
}

export async function liveAuthorization(
  identity,
  deps,
  { allowConsumed = false, stability = false } = {},
) {
  const issue = await deps.github('issues/' + identity.authorizationIssue);
  const scope = authorizationScope(issue, identity, allowConsumed);
  if (!allowConsumed)
    requireCondition(identity.runAttempt === '1', 'AUTHORIZATION_ATTEMPT_REUSE_FORBIDDEN');
  if (stability) {
    const main = await deps.github('branches/main');
    requireCondition(main.commit?.sha === identity.sourceSha, 'MAIN_SHA_CHANGED');
    const control = await deps.github('issues/640');
    const markers = {
      MAIN_STABILITY: 'PASS',
      EVALUATED_MAIN_SHA: identity.sourceSha,
      MERGE_RESERVATION: 'NONE',
      GENERAL_AUTONOMY: 'false',
    };
    if (identity.kind === 'fallback')
      Object.assign(markers, {
        ENGAGEMENT_AUTONOMY_STAGE: 'LIMITED',
        ENGAGEMENT_AUTO_REPLY_CHANNELS: 'DIRECT,COMMENT',
        DIRECT_LIMITED_RUNTIME_ACTIVE: 'true',
        COMMENT_LIMITED_RUNTIME_ACTIVE: 'true',
      });
    for (const [key, value] of Object.entries(markers)) {
      if (key === 'GENERAL_AUTONOMY') consistentControlMarker(control.body, key, value);
      else requireCondition(marker(control.body, key) === value, 'MAIN_STABILITY_BLOCKED');
    }
  }
  return { scope, fingerprint: sha256(JSON.stringify(scope)) };
}

export async function capturePrestate(identity, deps) {
  const diagnostic = {
    status: 'BLOCKED',
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    sourceSha: identity.sourceSha,
    serviceRead: 'UNKNOWN',
    iamRead: 'UNKNOWN',
    trafficSingleRevision: 'UNKNOWN',
    revisionMatch: 'UNKNOWN',
    baseUrlPresent: 'UNKNOWN',
    publicInvokerBindingPresent: 'UNKNOWN',
    invokerIamDisabled: 'UNKNOWN',
    revisionRead: 'UNKNOWN',
    revisionReady: 'UNKNOWN',
    runtimeServiceAccountMatch: 'UNKNOWN',
    expectedRevision: 'UNKNOWN',
    observedRevision: 'UNKNOWN',
    failureCode: 'UNKNOWN',
  };
  try {
    const authorization = await liveAuthorization(identity, deps, { stability: true });
    diagnostic.expectedRevision = authorization.scope.EXPECTED_PREVIOUS_REVISION;
    let service;
    try {
      service = await deps.cloud(serviceName(identity));
      diagnostic.serviceRead = 'PASS';
    } catch {
      throw new GuardError('SERVICE_READ_FAILED');
    }
    let iam;
    try {
      iam = await deps.iam(identity.service);
      diagnostic.iamRead = 'PASS';
      const privacy = privateIam(service, iam);
      diagnostic.publicInvokerBindingPresent = privacy.publicBinding;
      diagnostic.invokerIamDisabled = privacy.invokerIamDisabled;
    } catch {
      throw new GuardError('IAM_READ_FAILED');
    }
    const traffic = stableTraffic(service, identity);
    diagnostic.trafficSingleRevision = traffic.size === 1;
    const previous = traffic.size === 1 ? [...traffic.keys()][0] : null;
    diagnostic.observedRevision = previous ?? 'UNKNOWN';
    diagnostic.revisionMatch = previous === diagnostic.expectedRevision;
    diagnostic.baseUrlPresent =
      typeof service.uri === 'string' &&
      /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/.test(service.uri);
    let revision;
    if (previous) {
      try {
        revision = await deps.cloud(serviceName(identity) + '/revisions/' + previous);
        diagnostic.revisionRead = 'PASS';
        diagnostic.revisionReady =
          revision.conditions?.some(
            (condition) => condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED',
          ) ?? false;
        diagnostic.runtimeServiceAccountMatch = revision.serviceAccount === RUNTIME_SA;
      } catch {
        diagnostic.revisionRead = 'FAILED';
      }
    }
    requireCondition(diagnostic.trafficSingleRevision === true, 'TRAFFIC_NOT_SINGLE_100');
    requireCondition(diagnostic.revisionMatch === true, 'PRE_REVISION_MISMATCH');
    requireCondition(diagnostic.baseUrlPresent === true, 'BASE_URL_MISSING');
    if (WORKFLOWS[identity.kind].private) {
      requireCondition(
        diagnostic.publicInvokerBindingPresent === false && diagnostic.invokerIamDisabled === false,
        'PRIVATE_IAM_FAILED',
      );
    }
    requireCondition(diagnostic.revisionRead === 'PASS', 'REVISION_READ_FAILED');
    requireCondition(diagnostic.revisionReady === true, 'REVISION_NOT_READY');
    requireCondition(
      diagnostic.runtimeServiceAccountMatch === true,
      'RUNTIME_SERVICE_ACCOUNT_MISMATCH',
    );
    const digest = imageDigest(revision);
    assertRevision(revision, previous, identity, undefined, digest);
    const prestate = {
      ...identity,
      serviceUid: service.uid,
      preRevision: previous,
      preRevisionUid: revision.uid,
      preRevisionImageDigest: digest,
      baseUrl: service.uri,
      authorizationFingerprint: authorization.fingerprint,
      capturedAt: deps.now().toISOString(),
    };
    diagnostic.status = 'PASS';
    diagnostic.failureCode = 'NONE';
    return { prestate, diagnostic };
  } catch (error) {
    diagnostic.failureCode = error instanceof GuardError ? error.code : 'PRESTATE_READ_FAILED';
    return { prestate: null, diagnostic };
  }
}

const CONTEXT_KEYS = [
  'schemaVersion',
  'kind',
  'repository',
  'sourceSha',
  'runId',
  'runAttempt',
  'authorizationIssue',
  'workflowPath',
  'workflowName',
  'project',
  'region',
  'service',
  'candidateSuffix',
  'candidateRevision',
  'candidateTag',
  'serviceUid',
  'preRevision',
  'preRevisionUid',
  'preRevisionImageDigest',
  'baseUrl',
  'authorizationFingerprint',
  'capturedAt',
  'candidateImage',
  'candidateImageDigest',
  'policySha256',
  'prestateVerified',
  'zeroTrafficStageRequired',
  'rollbackOnFailure',
].sort();

export function validateContext(context, expected, policySha256) {
  requireCondition(
    context && typeof context === 'object' && !Array.isArray(context),
    'INVALID_CONTEXT',
  );
  requireCondition(
    JSON.stringify(Object.keys(context).sort()) === JSON.stringify(CONTEXT_KEYS),
    'INVALID_CONTEXT_FIELDS',
  );
  const identity = instanceIdentity(context);
  for (const [key, value] of Object.entries(identity))
    requireCondition(context[key] === value, 'CONTEXT_IDENTITY_MISMATCH');
  for (const [key, value] of Object.entries(expected))
    requireCondition(context[key] === value, 'CONTEXT_ORIGIN_MISMATCH');
  requireCondition(
    context.schemaVersion === 1 &&
      context.prestateVerified === true &&
      context.zeroTrafficStageRequired === true &&
      context.rollbackOnFailure === true,
    'INVALID_CONTEXT_CONTRACT',
  );
  requireCondition(
    UUID.test(context.serviceUid) && UUID.test(context.preRevisionUid),
    'INVALID_CONTEXT_UID',
  );
  requireCondition(
    revisionName(context.preRevision, identity) === context.preRevision &&
      context.preRevision !== context.candidateRevision,
    'INVALID_CONTEXT_PRESTATE',
  );
  requireCondition(
    DIGEST.test(context.preRevisionImageDigest) && DIGEST.test(context.candidateImageDigest),
    'INVALID_CONTEXT_DIGEST',
  );
  const image =
    REGION +
    '-docker.pkg.dev/' +
    PROJECT +
    '/toca-mcp/' +
    WORKFLOWS[context.kind].image +
    '@' +
    context.candidateImageDigest;
  requireCondition(context.candidateImage === image, 'INVALID_CONTEXT_IMAGE');
  requireCondition(
    /^[0-9a-f]{64}$/.test(context.authorizationFingerprint) &&
      /^[0-9a-f]{64}$/.test(context.policySha256) &&
      context.policySha256 === policySha256,
    'CONTEXT_POLICY_OR_AUTHORIZATION_MISMATCH',
  );
  requireCondition(
    /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/.test(context.baseUrl),
    'INVALID_CONTEXT_URL',
  );
  requireCondition(
    typeof context.capturedAt === 'string' && Number.isFinite(Date.parse(context.capturedAt)),
    'INVALID_CONTEXT_TIME',
  );
  return context;
}

export async function prepareContext(identity, initial, image, policySha256, deps) {
  const captured = await capturePrestate(identity, deps);
  requireCondition(captured.prestate !== null, captured.diagnostic.failureCode);
  const prestate = captured.prestate;
  requireCondition(
    prestate.serviceUid === initial.serviceUid &&
      prestate.preRevisionUid === initial.preRevisionUid &&
      prestate.preRevision === initial.preRevision &&
      prestate.authorizationFingerprint === initial.authorizationFingerprint,
    'PRESTATE_CHANGED_BEFORE_STAGE',
  );
  const digest = image?.match(/@(sha256:[0-9a-f]{64})$/)?.[1];
  const context = {
    schemaVersion: 1,
    ...prestate,
    candidateImage: image,
    candidateImageDigest: digest,
    policySha256,
    prestateVerified: true,
    zeroTrafficStageRequired: true,
    rollbackOnFailure: true,
  };
  validateContext(context, identity, policySha256);
  const authorization = await liveAuthorization(identity, deps, { stability: true });
  if (identity.kind === 'fallback')
    requireCondition(
      authorization.scope.RUNTIME_IMAGE_DIGEST === digest,
      'AUTHORIZED_IMAGE_CHANGED',
    );
  await assertCandidateAbsent(context, deps);
  return context;
}

async function assertCandidateAbsent(context, deps) {
  try {
    await deps.cloud(serviceName(context) + '/revisions/' + context.candidateRevision);
  } catch (error) {
    if (error instanceof GuardError && error.status === 404) return;
    throw new GuardError('CANDIDATE_EXISTENCE_UNKNOWN');
  }
  throw new GuardError('CANDIDATE_ALREADY_EXISTS');
}

function validateRun(run, expected, completed) {
  requireCondition(
    run &&
      String(run.id) === expected.runId &&
      String(run.run_attempt) === expected.runAttempt &&
      run.head_sha === expected.sourceSha &&
      run.head_branch === 'main' &&
      run.repository?.full_name === REPOSITORY &&
      run.head_repository?.full_name === REPOSITORY &&
      run.path === expected.workflowPath &&
      run.name === expected.workflowName &&
      run.event === 'issues' &&
      run.actor?.login === OWNER &&
      run.triggering_actor?.login === OWNER,
    'RUN_ORIGIN_MISMATCH',
  );
  if (completed)
    requireCondition(
      run.status === 'completed' && RECOVERABLE_CONCLUSIONS.has(run.conclusion),
      'ORIGIN_RUN_NOT_RECOVERABLE',
    );
}

export function artifactName(identity) {
  return 'activation-rollback-context-' + identity.runId + '-' + identity.runAttempt;
}

export function validateArtifact(artifact, run, expected, now) {
  requireCondition(
    artifact &&
      artifact.name === artifactName(expected) &&
      artifact.expired === false &&
      Number.isSafeInteger(artifact.id) &&
      artifact.id > 0 &&
      Number.isSafeInteger(artifact.size_in_bytes) &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes <= 1024 * 1024 &&
      DIGEST.test(artifact.digest),
    'INVALID_ARTIFACT_METADATA',
  );
  requireCondition(
    artifact.workflow_run?.id === run.id &&
      artifact.workflow_run?.head_sha === expected.sourceSha &&
      artifact.workflow_run?.head_branch === 'main' &&
      artifact.workflow_run?.repository_id === run.repository.id &&
      artifact.workflow_run?.head_repository_id === run.head_repository.id,
    'ARTIFACT_ORIGIN_MISMATCH',
  );
  const created = Date.parse(artifact.created_at);
  const expires = Date.parse(artifact.expires_at);
  requireCondition(
    Number.isFinite(created) &&
      Number.isFinite(expires) &&
      created >= Date.parse(run.run_started_at) &&
      created <= now.getTime() &&
      expires > now.getTime() &&
      now.getTime() - created <= 24 * 60 * 60 * 1000,
    'ARTIFACT_TIME_INVALID',
  );
}

async function readArtifactContext(artifact, run, expected, policySha256, deps) {
  validateArtifact(artifact, run, expected, deps.now());
  const bytes = await deps.downloadArtifact(artifact.id);
  requireCondition(
    Buffer.isBuffer(bytes) &&
      bytes.length <= 1024 * 1024 &&
      'sha256:' + sha256(bytes) === artifact.digest,
    'ARTIFACT_DIGEST_MISMATCH',
  );
  const context = validateContext(await deps.extractContext(bytes), expected, policySha256);
  requireCondition(
    Date.parse(context.capturedAt) >= Date.parse(run.run_started_at) &&
      Math.floor(Date.parse(context.capturedAt) / 1000) <=
        Math.floor(Date.parse(artifact.created_at) / 1000),
    'CONTEXT_CAPTURE_TIME_MISMATCH',
  );
  return context;
}

export async function validateStageContext(context, policySha256, artifactId, deps, deployInputs) {
  const authorization = await liveAuthorization(context, deps, { stability: true });
  requireCondition(
    authorization.fingerprint === context.authorizationFingerprint,
    'AUTHORIZATION_CHANGED',
  );
  requireCondition(
    deployInputs?.image === context.candidateImage,
    'EFFECTIVE_DEPLOY_IMAGE_MISMATCH',
  );
  if (context.kind === 'ag01') {
    const expected =
      authorization.scope.AG01_INTERNAL_SPECIALISTS_ACTIVATION === 'AUTHORIZED' ? 'true' : 'false';
    requireCondition(
      deployInputs.specialistsEnabled === expected,
      'EFFECTIVE_SPECIALIST_SCOPE_MISMATCH',
    );
  } else {
    requireCondition(
      deployInputs.ag01Url === authorization.scope.AG01_SERVICE_URL &&
        deployInputs.ag01Audience === authorization.scope.AG01_AUDIENCE &&
        context.candidateImageDigest === authorization.scope.RUNTIME_IMAGE_DIGEST,
      'EFFECTIVE_FALLBACK_SCOPE_MISMATCH',
    );
  }
  const run = await deps.github('actions/runs/' + context.runId);
  validateRun(run, context, false);
  const artifact = await deps.github('actions/artifacts/' + positiveId(artifactId));
  const durable = await readArtifactContext(artifact, run, context, policySha256, deps);
  requireCondition(
    CONTEXT_KEYS.every((key) => durable[key] === context[key]),
    'UPLOADED_CONTEXT_MISMATCH',
  );
  const service = await stableRead(context, deps);
  const traffic = stableTraffic(service, context, context.serviceUid);
  requireCondition(
    traffic.size === 1 && traffic.get(context.preRevision) === 100,
    'PRESTATE_CHANGED_BEFORE_STAGE',
  );
  const previous = await deps.cloud(serviceName(context) + '/revisions/' + context.preRevision);
  assertRevision(
    previous,
    context.preRevision,
    context,
    context.preRevisionUid,
    context.preRevisionImageDigest,
  );
  if (WORKFLOWS[context.kind].private) {
    const privacy = privateIam(service, await deps.iam(context.service));
    requireCondition(!privacy.publicBinding && !privacy.invokerIamDisabled, 'PRIVATE_IAM_FAILED');
  }
  await assertCandidateAbsent(context, deps);
  return { decision: 'LIVE_STAGE_PRECONDITIONS_VERIFIED', trafficMutation: false };
}

export async function guardianContext(event, policySha256, deps) {
  const origin = event?.workflow_run;
  const kind = Object.keys(WORKFLOWS).find((key) => WORKFLOWS[key].name === origin?.name);
  requireCondition(Boolean(kind), 'UNSUPPORTED_WORKFLOW');
  const expected = {
    kind,
    repository: REPOSITORY,
    sourceSha: origin.head_sha,
    runId: positiveId(origin.id),
    runAttempt: positiveId(origin.run_attempt),
    workflowPath: WORKFLOWS[kind].path,
    workflowName: WORKFLOWS[kind].name,
  };
  requireCondition(
    event.repository?.full_name === REPOSITORY &&
      origin.head_branch === 'main' &&
      RECOVERABLE_CONCLUSIONS.has(origin.conclusion),
    'INVALID_GUARDIAN_EVENT',
  );
  const latest = await deps.github('actions/runs/' + expected.runId);
  if (String(latest.run_attempt) !== expected.runAttempt) return { decision: 'NOOP_STALE_ATTEMPT' };
  validateRun(latest, expected, true);
  const run = await deps.github(
    'actions/runs/' + expected.runId + '/attempts/' + expected.runAttempt,
  );
  validateRun(run, expected, true);
  const main = await deps.github('branches/main');
  requireCondition(main.commit?.sha === expected.sourceSha, 'MAIN_SHA_CHANGED');
  const listed = await deps.github(
    'actions/runs/' +
      expected.runId +
      '/artifacts?name=' +
      artifactName(expected) +
      '&per_page=100',
  );
  requireCondition(
    Array.isArray(listed.artifacts) && listed.total_count === listed.artifacts.length,
    'ARTIFACT_LIST_INCOMPLETE',
  );
  const artifacts = listed.artifacts.filter((artifact) => artifact.name === artifactName(expected));
  if (artifacts.length === 0) return { decision: 'NOOP_LEGACY_OR_NO_STAGE_CONTEXT' };
  requireCondition(artifacts.length === 1, 'DUPLICATE_CONTEXT_ARTIFACT');
  const artifact = artifacts[0];
  const context = await readArtifactContext(artifact, run, expected, policySha256, deps);
  const authorization = await liveAuthorization(context, deps, { allowConsumed: true });
  requireCondition(
    authorization.fingerprint === context.authorizationFingerprint,
    'AUTHORIZATION_CHANGED',
  );
  return { decision: 'CONTEXT_VERIFIED', context };
}

export function rollbackDecision(context, service) {
  const traffic = stableTraffic(service, context, context.serviceUid);
  const candidatePercent = traffic.get(context.candidateRevision) ?? 0;
  if (candidatePercent === 0) {
    return {
      decision:
        traffic.get(context.preRevision) === 100
          ? 'NOOP_ALREADY_RESTORED'
          : 'NOOP_NO_OWN_CANDIDATE_TRAFFIC',
      mutate: false,
    };
  }
  requireCondition(
    traffic.size === 1 && candidatePercent === 100,
    'SPLIT_TRAFFIC_NOT_OWNED_BY_INSTANCE',
  );
  return { decision: 'RESTORE_INSTANCE_PRESTATE', mutate: true };
}

export function calendarProbeEvidence(answer, target, sourceSha) {
  requireCondition(
    ['candidate', 'base'].includes(target) && SHA.test(sourceSha),
    'INVALID_CALENDAR_PROBE_IDENTITY',
  );
  const publicAnswer = typeof answer?.answer === 'string' ? answer.answer : '';
  const citations = Array.isArray(answer?.citedResourceIds) ? answer.citedResourceIds : [];
  const citationsValid =
    citations.length > 0 &&
    citations.length <= 32 &&
    citations.every((id) => typeof id === 'string' && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(id));
  const officialUrl = 'https://tocadomorcego.com.br/produtos/experiencia-por-do-sol-3822.html';
  const grounded =
    answer?.status === 'GROUNDED' &&
    typeof answer.confidence === 'number' &&
    answer.confidence >= 0.85 &&
    answer.confidence <= 1 &&
    Array.isArray(answer.evidence) &&
    answer.evidence.length > 0;
  const passed =
    grounded &&
    publicAnswer.length > 0 &&
    publicAnswer.length <= 1000 &&
    publicAnswer.includes(officialUrl) &&
    citationsValid;
  return {
    schemaVersion: 1,
    target,
    sourceSha,
    question: 'Em quais dias funciona o Pôr do Sol?',
    expectedIntent: 'LOCATION_HOURS',
    probeStatus: passed ? 'GROUNDED_URL_CITATIONS_VERIFIED' : 'BLOCKED',
    semanticReview: 'REQUIRED_NO_FIXED_DAYS_OR_UNREQUESTED_HOURS',
    answer: publicAnswer.slice(0, 1000),
    answerTruncated: publicAnswer.length > 1000,
    citedResourceIds: citationsValid ? citations : [],
    externalBusinessSideEffects: false,
    specialistMissionAck: 'NOT_PROVEN_BY_KNOWLEDGE_PROBE',
  };
}

export function trafficPatch(context, service, target) {
  requireCondition(
    target === context.preRevision || target === context.candidateRevision,
    'INVALID_TRAFFIC_DESTINATION',
  );
  stableTraffic(service, context, context.serviceUid);
  const traffic = service.traffic.map((entry) => ({
    type: REVISION_TYPE,
    revision: revisionName(entry.revision, context),
    percent: 0,
    ...(entry.tag ? { tag: entry.tag } : {}),
  }));
  const untagged = traffic.find((entry) => entry.revision === target && !entry.tag);
  if (untagged) untagged.percent = 100;
  else traffic.push({ type: REVISION_TYPE, revision: target, percent: 100 });
  return { name: service.name, etag: service.etag, traffic };
}

async function stableRead(context, deps) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const service = await deps.cloud(serviceName(context));
    try {
      stableTraffic(service, context, context.serviceUid);
      return service;
    } catch (error) {
      if (
        !(error instanceof GuardError) ||
        !['SERVICE_NOT_STABLE', 'TRAFFIC_RECONCILIATION_MISMATCH'].includes(error.code)
      )
        throw error;
      if (attempt === 29) throw error;
      await deps.wait(2000);
    }
  }
  throw new GuardError('SERVICE_NOT_STABLE');
}

async function verifyRevisions(context, deps, candidateMustBeReady = false) {
  const previous = await deps.cloud(serviceName(context) + '/revisions/' + context.preRevision);
  assertRevision(
    previous,
    context.preRevision,
    context,
    context.preRevisionUid,
    context.preRevisionImageDigest,
  );
  const candidate = await deps.cloud(
    serviceName(context) + '/revisions/' + context.candidateRevision,
  );
  assertRevision(
    candidate,
    context.candidateRevision,
    context,
    undefined,
    context.candidateImageDigest,
    true,
  );
  if (candidateMustBeReady)
    requireCondition(
      candidate.conditions?.some(
        (condition) => condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED',
      ),
      'CANDIDATE_NOT_READY',
    );
  requireCondition(
    Date.parse(candidate.createTime) >= Date.parse(context.capturedAt),
    'CANDIDATE_PREDATES_INSTANCE',
  );
}

async function patchAndReadback(context, service, target, deps) {
  const body = trafficPatch(context, service, target);
  // The ETag comes from this exact readback; conflicts never retry a write.
  const operation = await deps.cloud(
    serviceName(context) + '?updateMask=traffic&allowMissing=false',
    { method: 'PATCH', body },
  );
  requireCondition(
    typeof operation?.name === 'string' &&
      new RegExp(
        '^projects/(' +
          PROJECT +
          '|' +
          PROJECT_NUMBER +
          ')/locations/' +
          REGION +
          '/operations/[a-zA-Z0-9-]+$',
      ).test(operation.name),
    'INVALID_TRAFFIC_OPERATION',
  );
  let result = operation;
  for (let attempt = 0; !result.done && attempt < 30; attempt += 1) {
    await deps.wait(2000);
    result = await deps.cloud(operation.name);
  }
  requireCondition(result.done === true && !result.error, 'TRAFFIC_OPERATION_NOT_CONFIRMED');
  const final = await stableRead(context, deps);
  const traffic = stableTraffic(final, context, context.serviceUid);
  requireCondition(traffic.size === 1 && traffic.get(target) === 100, 'TRAFFIC_READBACK_MISMATCH');
  return final;
}

export async function executeRollback(context, deps) {
  const authorization = await liveAuthorization(context, deps, { allowConsumed: true });
  requireCondition(
    authorization.fingerprint === context.authorizationFingerprint,
    'AUTHORIZATION_CHANGED',
  );
  let service = await stableRead(context, deps);
  const decision = rollbackDecision(context, service);
  if (!decision.mutate) return { ...decision, trafficMutation: false };
  await verifyRevisions(context, deps);
  // Re-read after revision and authorization checks; CAS closes the remaining race.
  service = await stableRead(context, deps);
  const fresh = rollbackDecision(context, service);
  if (!fresh.mutate) return { ...fresh, trafficMutation: false };
  try {
    await patchAndReadback(context, service, context.preRevision, deps);
  } catch (error) {
    const failureCode = error instanceof GuardError ? error.code : 'ROLLBACK_RESPONSE_UNKNOWN';
    let observed;
    try {
      observed = rollbackDecision(context, await stableRead(context, deps));
    } catch {
      deps.evidence({ rollbackStatus: 'FAILED', failureCode, readback: 'UNKNOWN' });
      throw new GuardError(failureCode);
    }
    deps.evidence({
      rollbackStatus: 'RESPONSE_UNCERTAIN',
      failureCode,
      readback: observed.decision,
    });
    if (observed.decision === 'NOOP_ALREADY_RESTORED') {
      return {
        decision: 'INSTANCE_PRESTATE_RESTORED_AFTER_UNCERTAIN_RESPONSE',
        mutationAttempted: true,
        trafficMutation: 'UNKNOWN',
        prestateRestored: true,
      };
    }
    // An error never causes a second PATCH, including when another revision now owns traffic.
    throw new GuardError(failureCode);
  }
  return { decision: 'INSTANCE_PRESTATE_RESTORED', trafficMutation: true };
}

export async function executePromotion(context, deps) {
  const authorization = await liveAuthorization(context, deps, { stability: true });
  requireCondition(
    authorization.fingerprint === context.authorizationFingerprint,
    'AUTHORIZATION_CHANGED',
  );
  await verifyRevisions(context, deps, true);
  const service = await stableRead(context, deps);
  const traffic = stableTraffic(service, context, context.serviceUid);
  requireCondition(
    traffic.size === 1 && traffic.get(context.preRevision) === 100,
    'PRESTATE_CHANGED_BEFORE_PROMOTION',
  );
  if (WORKFLOWS[context.kind].private) {
    const privacy = privateIam(service, await deps.iam(context.service));
    requireCondition(!privacy.publicBinding && !privacy.invokerIamDisabled, 'PRIVATE_IAM_FAILED');
  }
  // Persist intent before the call: an applied promotion can return an error.
  deps.output('promotion_attempted', 'true');
  try {
    await patchAndReadback(context, service, context.candidateRevision, deps);
    deps.output('traffic_changed', 'true');
    return { decision: 'INSTANCE_CANDIDATE_PROMOTED', trafficMutation: true };
  } catch (error) {
    const failureCode = error instanceof GuardError ? error.code : 'PROMOTION_RESPONSE_UNKNOWN';
    let recovery;
    try {
      recovery = await executeRollback(context, deps);
    } catch (recoveryError) {
      const recoveryCode =
        recoveryError instanceof GuardError ? recoveryError.code : 'RECOVERY_RESPONSE_UNKNOWN';
      deps.evidence({
        promotionStatus: 'FAILED',
        failureCode,
        recovery: { status: 'BLOCKED', failureCode: recoveryCode },
      });
      throw new GuardError('PROMOTION_FAILED_' + failureCode + '_RECOVERY_BLOCKED_' + recoveryCode);
    }
    deps.evidence({
      promotionStatus: 'FAILED',
      failureCode,
      recovery,
    });
    throw new GuardError('PROMOTION_FAILED_RECOVERY_' + recovery.decision);
  }
}

async function checkedFetch(url, options = {}, bytes = false, request = fetch) {
  let response;
  try {
    response = await request(url, { ...options, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new GuardError('REQUEST_OUTCOME_UNKNOWN');
  }
  if (!response.ok)
    throw new GuardError(
      response.status === 409 || response.status === 412
        ? 'SERVICE_ETAG_CONFLICT'
        : 'HTTP_REQUEST_FAILED',
      response.status,
    );
  if (bytes) {
    const buffer = Buffer.from(await response.arrayBuffer());
    requireCondition(buffer.length <= 1024 * 1024, 'ARTIFACT_TOO_LARGE');
    return buffer;
  }
  try {
    return await response.json();
  } catch {
    throw new GuardError('INVALID_JSON_RESPONSE');
  }
}

export async function downloadArtifactArchive(id, githubHeaders, request = fetch) {
  let response;
  try {
    response = await request(
      'https://api.github.com/repos/' +
        REPOSITORY +
        '/actions/artifacts/' +
        positiveId(id) +
        '/zip',
      { headers: githubHeaders, redirect: 'manual', signal: AbortSignal.timeout(30000) },
    );
  } catch {
    throw new GuardError('ARTIFACT_DOWNLOAD_FAILED');
  }
  requireCondition(response.status === 302, 'ARTIFACT_REDIRECT_INVALID');
  let location;
  try {
    location = new URL(response.headers.get('location'));
  } catch {
    throw new GuardError('ARTIFACT_REDIRECT_INVALID');
  }
  requireCondition(
    location.protocol === 'https:' &&
      location.username === '' &&
      location.password === '' &&
      location.port === '' &&
      /(?:^|\.)(?:blob\.core\.windows\.net|githubusercontent\.com|github\.com)$/.test(
        location.hostname,
      ),
    'ARTIFACT_HOST_INVALID',
  );
  // Never forward GitHub credentials to artifact storage, or follow a second redirect.
  return checkedFetch(location, { redirect: 'error' }, true, request);
}

export function extractContextArchive(bytes) {
  requireCondition(
    Buffer.isBuffer(bytes) && bytes.length <= 1024 * 1024,
    'INVALID_ARTIFACT_ARCHIVE',
  );
  const folder = mkdtempSync(join(tmpdir(), 'ag01-recovery-'));
  try {
    const archive = join(folder, 'context.zip');
    writeFileSync(archive, bytes, { mode: 0o600 });
    const names = execFileSync('unzip', ['-Z1', archive], {
      encoding: 'utf8',
      maxBuffer: 8192,
      timeout: 5000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n');
    requireCondition(
      names.length === 1 && names[0] === 'rollback-context.json',
      'INVALID_ARTIFACT_ARCHIVE',
    );
    const json = execFileSync('unzip', ['-p', archive, 'rollback-context.json'], {
      encoding: 'utf8',
      maxBuffer: 32768,
      timeout: 5000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(json);
  } catch (error) {
    if (error instanceof GuardError) throw error;
    throw new GuardError('INVALID_ARTIFACT_ARCHIVE');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function productionDependencies() {
  const githubHeaders = {
    Authorization: 'Bearer ' + process.env.GH_TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  let cloudToken;
  const token = () => {
    if (!cloudToken) {
      try {
        cloudToken = execFileSync('gcloud', ['auth', 'print-access-token'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
      } catch {
        throw new GuardError('CLOUD_ACCESS_TOKEN_UNAVAILABLE');
      }
      requireCondition(
        cloudToken.length > 0 && !/\s/.test(cloudToken),
        'CLOUD_ACCESS_TOKEN_UNAVAILABLE',
      );
    }
    return cloudToken;
  };
  return {
    now: () => new Date(),
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    output: (key, value) => {
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
    },
    evidence: (data) => {
      const safe = JSON.stringify(data);
      console.log(safe);
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, safe + '\n');
    },
    github: (path) =>
      checkedFetch('https://api.github.com/repos/' + REPOSITORY + '/' + path, {
        headers: githubHeaders,
      }),
    cloud: (path, options = {}) =>
      checkedFetch('https://run.googleapis.com/v2/' + path, {
        method: options.method ?? 'GET',
        headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      }),
    iam: async (service) => {
      requireCondition(
        Object.values(WORKFLOWS).some((workflow) => workflow.service === service),
        'INVALID_IAM_SERVICE',
      );
      try {
        return JSON.parse(
          execFileSync(
            'gcloud',
            [
              'run',
              'services',
              'get-iam-policy',
              service,
              '--project',
              PROJECT,
              '--region',
              REGION,
              '--format=json',
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ),
        );
      } catch {
        throw new GuardError('IAM_READ_FAILED');
      }
    },
    downloadArtifact: (id) => downloadArtifactArchive(id, githubHeaders),
    extractContext: extractContextArchive,
  };
}

function eventIdentity(kind) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const origin = event.workflow_run;
  return instanceIdentity({
    kind,
    repository: process.env.GITHUB_REPOSITORY,
    sourceSha: origin?.head_sha ?? process.env.GITHUB_SHA,
    runId: origin?.id ?? process.env.GITHUB_RUN_ID,
    runAttempt: origin?.run_attempt ?? process.env.GITHUB_RUN_ATTEMPT,
    authorizationIssue: origin
      ? JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')).authorizationIssue
      : event.issue.number,
  });
}

async function main() {
  const [command, kind] = process.argv.slice(2);
  const deps = productionDependencies();
  const policySha256 = sha256(readFileSync('infra/control-plane/policy.json'));
  mkdirSync('activation-recovery', { recursive: true });
  if (command === 'guardian-context') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const result = await guardianContext(event, policySha256, deps);
    if (result.context)
      writeFileSync(CONTEXT_FILE, JSON.stringify(result.context) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
    deps.output('context_verified', result.context ? 'true' : 'false');
    deps.output('kind', result.context?.kind ?? '');
    deps.evidence({ decision: result.decision, trafficMutation: false });
    return;
  }
  if (command === 'calendar-evidence') {
    const answer = JSON.parse(readFileSync(process.env.CALENDAR_ANSWER_FILE, 'utf8'));
    const evidence = calendarProbeEvidence(answer, kind, process.env.GITHUB_SHA);
    mkdirSync('ag01-grounded-evidence', { recursive: true });
    writeFileSync(
      'ag01-grounded-evidence/calendar-' + kind + '.json',
      JSON.stringify(evidence) + '\n',
    );
    requireCondition(
      evidence.probeStatus === 'GROUNDED_URL_CITATIONS_VERIFIED',
      'CALENDAR_PROBE_NOT_VERIFIED',
    );
    deps.evidence({
      calendarProbe: kind,
      status: evidence.probeStatus,
      semanticReview: evidence.semanticReview,
    });
    return;
  }
  const identity = eventIdentity(kind);
  if (command === 'authorize') {
    const run = await deps.github('actions/runs/' + identity.runId);
    validateRun(run, identity, false);
    await liveAuthorization(identity, deps, { stability: true });
    deps.evidence({
      authorization: 'LIVE_VALIDATED',
      runId: identity.runId,
      runAttempt: identity.runAttempt,
    });
    return;
  }
  if (command === 'prestate') {
    const result = await capturePrestate(identity, deps);
    writeFileSync(DIAGNOSTIC_FILE, JSON.stringify(result.diagnostic) + '\n');
    deps.evidence(result.diagnostic);
    requireCondition(result.prestate !== null, result.diagnostic.failureCode);
    writeFileSync(PRESTATE_FILE, JSON.stringify(result.prestate) + '\n', { mode: 0o600 });
    for (const [key, value] of Object.entries({
      pre_revision: result.prestate.preRevision,
      base_url: result.prestate.baseUrl,
      candidate_revision: identity.candidateRevision,
      candidate_suffix: identity.candidateSuffix,
      candidate_tag: identity.candidateTag,
    }))
      deps.output(key, value);
    return;
  }
  if (command === 'prepare') {
    const initial = JSON.parse(readFileSync(PRESTATE_FILE, 'utf8'));
    const context = await prepareContext(
      identity,
      initial,
      process.env.RECOVERY_IMAGE,
      policySha256,
      deps,
    );
    writeFileSync(CONTEXT_FILE, JSON.stringify(context) + '\n', { flag: 'wx', mode: 0o600 });
    deps.evidence({
      decision: 'INSTANCE_PRESTATE_PERSISTED',
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      preRevision: context.preRevision,
      candidateRevision: context.candidateRevision,
      trafficMutation: false,
    });
    return;
  }
  requireCondition(existsSync(CONTEXT_FILE), 'INSTANCE_CONTEXT_MISSING');
  const context = validateContext(
    JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')),
    identity,
    policySha256,
  );
  if (command === 'validate-stage') {
    deps.evidence(
      await validateStageContext(context, policySha256, process.env.CONTEXT_ARTIFACT_ID, deps, {
        image: context.kind === 'ag01' ? process.env.IMAGE : process.env.RUNTIME_IMAGE,
        specialistsEnabled: process.env.SPECIALISTS_ENABLED,
        ag01Url: process.env.AG01_URL,
        ag01Audience: process.env.AG01_AUDIENCE,
      }),
    );
    return;
  }
  if (command === 'promote') deps.evidence(await executePromotion(context, deps));
  else if (command === 'rollback') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (event.workflow_run) {
      validateRun(await deps.github('actions/runs/' + context.runId), context, true);
      const main = await deps.github('branches/main');
      requireCondition(main.commit?.sha === context.sourceSha, 'MAIN_SHA_CHANGED');
    }
    deps.evidence(await executeRollback(context, deps));
  } else throw new GuardError('INVALID_COMMAND');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Do not publish provider bodies, token-bearing errors, environment or raw IAM.
    const code = error instanceof GuardError ? error.code : 'RECOVERY_UNEXPECTED_ERROR';
    console.error(JSON.stringify({ status: 'BLOCKED', failureCode: code }));
    process.exitCode = 1;
  });
}
