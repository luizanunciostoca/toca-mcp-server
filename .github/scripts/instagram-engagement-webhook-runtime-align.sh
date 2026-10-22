#!/usr/bin/env bash
set -euo pipefail
umask 077

# This helper is deliberately outside the container build inputs.
# Model commands only transform local JSON; production phases use the same model.
model() {
  node --input-type=module - "$@" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const repo = 'luizanunciostoca/toca-mcp-server';
const project = 'toca-mcp-production';
const serviceName = 'toca-webhook-next-production';
const daemonName = 'toca-managed-instagram-daemon';
const runtimeIdentity = 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com';
const imagePrefix = 'southamerica-east1-docker.pkg.dev/' + project + '/toca-mcp/server@';
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const positive = /^[1-9][0-9]*$/;
const deployEnvironmentKey = 'TOCA_DEPLOY_ENVIRONMENT';
const repairWindowMs = 60 * 60 * 1000;
const readinessNames = new Set([
  'db', 'migrations', 'schema', 'audit', 'outbox', 'approval_store', 'crm', 'privacy',
  'workflow', 'ag01', 'meta', 'whatsapp', 'email', 'google_ads', 'provider_credentials',
  'critical_configuration',
]);
const check = (condition, code) => { if (!condition) throw new Error(code); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) :
  object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const equal = (left, right) => left === undefined || right === undefined ?
  left === right : hash(left) === hash(right);
const copy = (value) => structuredClone(value);
const lines = (body) => {
  check(typeof body === 'string', 'BODY_REQUIRED');
  const values = new Map();
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) values.set(match[1], [...(values.get(match[1]) ?? []), match[2]]);
  }
  return (key, expected, optional = false) => {
    const entries = values.get(key);
    if (optional && entries === undefined) return undefined;
    check(entries?.length === 1, 'MARKER_NOT_UNIQUE_' + key);
    if (expected !== undefined) check(entries[0] === expected, 'MARKER_MISMATCH_' + key);
    return entries[0];
  };
};
const requireMarkers = (get, markers) => {
  for (const [key, value] of Object.entries(markers)) get(key, value);
};
const consumedBody = (body) => body.replace(/^AUTHORIZATION_STATE=ACTIVE\r?$/m,
  'AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
function repairTimestamp(value) {
  check(typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value),
    'DEPLOY_ENVIRONMENT_REPAIR_TIME_INVALID');
  const parsed = Date.parse(value);
  check(Number.isFinite(parsed) && new Date(parsed).toISOString() ===
    (value.includes('.') ? value : value.replace(/Z$/, '.000Z')),
    'DEPLOY_ENVIRONMENT_REPAIR_TIME_INVALID');
  return parsed;
}
function validateRepairAuthorization(repair, fresh = false) {
  check(object(repair), 'DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZATION_MISSING');
  if (repair.enabled === false) {
    check(equal(repair, { enabled: false }), 'DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZATION_INVALID');
    return;
  }
  check(repair.enabled === true && equal(repair, {
    enabled: true, key: deployEnvironmentKey, before: 'ABSENT', value: 'production',
    issueCreatedAt: repair.issueCreatedAt, expiresAt: repair.expiresAt,
  }), 'DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZATION_INVALID');
  const created = repairTimestamp(repair.issueCreatedAt);
  const expires = repairTimestamp(repair.expiresAt);
  check(expires > created && expires - created <= repairWindowMs,
    'DEPLOY_ENVIRONMENT_REPAIR_WINDOW_INVALID');
  if (fresh) check(Date.now() >= created && Date.now() < expires,
    'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED');
}
function repairAuthorization(issue) {
  const get = lines(issue.body);
  const keys = [
    'WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZED',
    'WEBHOOK_DEPLOY_ENVIRONMENT_PRESTATE',
    'WEBHOOK_DEPLOY_ENVIRONMENT_VALUE',
    'WEBHOOK_DEPLOY_ENVIRONMENT_OTHER_CHANGES_AUTHORIZED',
    'WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_EXPIRES_AT',
  ];
  for (const line of issue.body.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('WEBHOOK_DEPLOY_ENVIRONMENT')) continue;
    const key = /^(WEBHOOK_DEPLOY_ENVIRONMENT[A-Z0-9_]*)=/.exec(line)?.[1];
    check(key !== undefined && keys.includes(key), 'DEPLOY_ENVIRONMENT_REPAIR_UNKNOWN_MARKER');
  }
  const optIn = get(keys[0], undefined, true);
  check(optIn === undefined || optIn === 'false' || optIn === 'true',
    'DEPLOY_ENVIRONMENT_REPAIR_OPT_IN_INVALID');
  if (optIn !== 'true') {
    check(keys.slice(1).every((key) => get(key, undefined, true) === undefined),
      'DEPLOY_ENVIRONMENT_REPAIR_OPT_IN_REQUIRED');
    return { enabled: false };
  }
  requireMarkers(get, {
    WEBHOOK_DEPLOY_ENVIRONMENT_PRESTATE: 'ABSENT',
    WEBHOOK_DEPLOY_ENVIRONMENT_VALUE: 'production',
    WEBHOOK_DEPLOY_ENVIRONMENT_OTHER_CHANGES_AUTHORIZED: 'false',
  });
  const repair = { enabled: true, key: deployEnvironmentKey, before: 'ABSENT', value: 'production',
    issueCreatedAt: new Date(repairTimestamp(issue.created_at)).toISOString(),
    expiresAt: new Date(repairTimestamp(get(keys[4]))).toISOString() };
  validateRepairAuthorization(repair, true);
  return repair;
}
const generatedAnnotations = new Set([
  'serving.knative.dev/creator', 'serving.knative.dev/lastModifier',
  'run.googleapis.com/operation-id', 'run.googleapis.com/ingress-status',
  'run.googleapis.com/urls', 'client.knative.dev/user-image',
]);
const configurableAnnotations = new Set([
  'run.googleapis.com/ingress', 'run.googleapis.com/invoker-iam-disabled',
  'run.googleapis.com/default-url-disabled', 'run.googleapis.com/client-name',
  'run.googleapis.com/client-version', 'run.googleapis.com/launch-stage',
  'run.googleapis.com/description', 'run.googleapis.com/custom-audiences',
  'run.googleapis.com/binary-authorization', 'run.googleapis.com/binary-authorization-breakglass',
  'run.googleapis.com/minScale', 'run.googleapis.com/maxScale',
  'run.googleapis.com/manualInstanceCount', 'run.googleapis.com/scalingMode',
  'run.googleapis.com/iap-enabled', 'autoscaling.knative.dev/minScale',
  'autoscaling.knative.dev/maxScale', 'run.googleapis.com/cloudsql-instances',
  'run.googleapis.com/secrets', 'run.googleapis.com/vpc-access-connector',
  'run.googleapis.com/vpc-access-egress', 'run.googleapis.com/network-interfaces',
  'run.googleapis.com/execution-environment', 'run.googleapis.com/cpu-throttling',
  'run.googleapis.com/startup-cpu-boost', 'run.googleapis.com/sessionAffinity',
  'run.googleapis.com/container-dependencies', 'run.googleapis.com/encryption-key',
  'run.googleapis.com/encryption-key-shutdown-hours',
  'run.googleapis.com/encryption-key-revocation-action',
  'run.googleapis.com/health-check-disabled', 'run.googleapis.com/base-images',
  'run.googleapis.com/gpu-zonal-redundancy-disabled', 'run.googleapis.com/build-name',
  'run.googleapis.com/build-id', 'run.googleapis.com/build-image-uri',
  'run.googleapis.com/build-source-location', 'run.googleapis.com/build-service-account',
  'run.googleapis.com/build-function-target', 'run.googleapis.com/build-base-image',
  'run.googleapis.com/build-enable-automatic-updates', 'run.googleapis.com/build-environment-variables',
]);
const generatedLabels = new Set([
  'serving.knative.dev/service', 'serving.knative.dev/serviceUid',
  'serving.knative.dev/configuration', 'serving.knative.dev/configurationGeneration',
  'serving.knative.dev/route', 'cloud.googleapis.com/location',
  'run.googleapis.com/startupProbeType', 'run.googleapis.com/container-sha256',
  'run.googleapis.com/satisfiesPzs', 'run.googleapis.com/satisfiesPzi',
]);
const reserved = /^(run\.googleapis\.com|autoscaling\.knative\.dev|serving\.knative\.dev|cloud\.googleapis\.com|client\.knative\.dev)\//;
function configurationMetadata(metadata) {
  const annotations = {};
  const labels = {};
  for (const [key, value] of Object.entries(metadata?.annotations ?? {})) {
    check(typeof value === 'string', 'ANNOTATION_VALUE_INVALID');
    if (generatedAnnotations.has(key)) continue;
    check(!reserved.test(key) || configurableAnnotations.has(key), 'UNKNOWN_RESERVED_ANNOTATION');
    annotations[key] = value;
  }
  for (const [key, value] of Object.entries(metadata?.labels ?? {})) {
    check(typeof value === 'string', 'LABEL_VALUE_INVALID');
    if (generatedLabels.has(key)) continue;
    check(!reserved.test(key), 'UNKNOWN_RESERVED_LABEL');
    labels[key] = value;
  }
  return { labels, annotations };
}
function routeMap(entries, latest, allowDynamicTags) {
  check(Array.isArray(entries) && entries.length > 0, 'TRAFFIC_MISSING');
  const percentages = {};
  const tags = {};
  for (const entry of entries) {
    check(object(entry), 'TRAFFIC_INVALID');
    const dynamic = entry.latestRevision === true;
    check(!(dynamic && entry.revisionName), 'TRAFFIC_TARGET_AMBIGUOUS');
    const revision = dynamic ? latest : entry.revisionName;
    check(typeof revision === 'string' && revision.startsWith(serviceName + '-'), 'TRAFFIC_REVISION_INVALID');
    const percent = entry.percent ?? 0;
    check(Number.isInteger(percent) && percent >= 0 && percent <= 100, 'TRAFFIC_PERCENT_INVALID');
    if (percent > 0) percentages[revision] = (percentages[revision] ?? 0) + percent;
    if (entry.tag !== undefined) {
      check(typeof entry.tag === 'string' && /^[a-z][a-z0-9-]{0,62}$/.test(entry.tag), 'TRAFFIC_TAG_INVALID');
      check(tags[entry.tag] === undefined, 'TRAFFIC_TAG_DUPLICATE');
      check(!dynamic || allowDynamicTags, 'THIRD_PARTY_DYNAMIC_TAG');
      tags[entry.tag] = revision;
    }
  }
  check(Object.values(percentages).reduce((total, value) => total + value, 0) === 100, 'TRAFFIC_SUM_INVALID');
  return { percentages, tags };
}
function serviceView(service, allowDynamicTags = false) {
  check(object(service?.metadata) && service.metadata.name === serviceName, 'SERVICE_NAME_MISMATCH');
  check([project, '990081828836'].includes(service.metadata.namespace), 'SERVICE_NAMESPACE_MISMATCH');
  check(typeof service.metadata.uid === 'string' && service.metadata.uid.length > 0, 'SERVICE_UID_MISSING');
  check(typeof service.metadata.resourceVersion === 'string' && service.metadata.resourceVersion.length > 0, 'RESOURCE_VERSION_MISSING');
  check(positive.test(String(service.metadata.generation)) &&
    String(service.metadata.generation) === String(service.status?.observedGeneration), 'SERVICE_NOT_RECONCILED');
  check(!service.status?.conditions?.some((condition) => condition.status === 'Unknown'), 'SERVICE_NOT_RECONCILED');
  check(object(service.spec?.template) && object(service.spec.template.spec), 'SERVICE_TEMPLATE_MISSING');
  const metadata = configurationMetadata(service.metadata);
  check(metadata.annotations['run.googleapis.com/ingress'] === 'all', 'INGRESS_CHANGED');
  check((metadata.annotations['run.googleapis.com/default-url-disabled'] ?? 'false') === 'false', 'DEFAULT_URL_DISABLED');
  check(metadata.annotations['run.googleapis.com/invoker-iam-disabled'] === 'true', 'INVOKER_POSTURE_CHANGED');
  const requested = routeMap(service.spec.traffic, service.status.latestReadyRevisionName, allowDynamicTags);
  const observed = routeMap(service.status.traffic, service.status.latestReadyRevisionName, true);
  check(equal(requested, observed), 'TRAFFIC_NOT_RECONCILED');
  const extraSpec = copy(service.spec);
  delete extraSpec.template;
  delete extraSpec.traffic;
  return { metadata, traffic: requested, config: { metadata, extraSpec } };
}
function singleRevision(traffic) {
  const entries = Object.entries(traffic.percentages);
  check(entries.length === 1 && entries[0][1] === 100, 'TRAFFIC_NOT_SINGLE_100');
  return entries[0][0];
}
function templateView(template) {
  return { metadata: configurationMetadata(template.metadata), spec: copy(template.spec) };
}
function specWithoutTraffic(spec) {
  const result = copy(spec);
  delete result.traffic;
  result.template = { name: spec.template.metadata?.name, ...templateView(spec.template) };
  return result;
}
function requireAbsentDeployEnvironment(template) {
  check(Array.isArray(template.spec?.containers), 'DEPLOY_ENVIRONMENT_PRESTATE_INVALID');
  for (const container of template.spec.containers) {
    check(container.env === undefined || Array.isArray(container.env), 'DEPLOY_ENVIRONMENT_PRESTATE_INVALID');
    check(!(container.env ?? []).some((entry) => entry?.name === deployEnvironmentKey),
      'DEPLOY_ENVIRONMENT_PRESTATE_NOT_ABSENT');
  }
}
function plannedCandidate(auth, previousTemplate, preServiceSpec) {
  validateRepairAuthorization(auth.deployEnvironmentRepair);
  check(object(previousTemplate?.spec) && object(preServiceSpec?.template), 'CANDIDATE_PRESTATE_MISSING');
  const target = runtimeContainer(previousTemplate);
  if (auth.deployEnvironmentRepair.enabled) {
    requireAbsentDeployEnvironment(previousTemplate);
    requireAbsentDeployEnvironment(preServiceSpec.template);
  }
  const template = copy(previousTemplate);
  const container = template.spec.containers[target.index];
  container.image = auth.image;
  const env = container.env ?? [];
  const release = env.find((entry) => entry.name === 'TOCA_RELEASE_SHA');
  if (release) { delete release.valueFrom; release.value = auth.sourceSha; }
  else env.push({ name: 'TOCA_RELEASE_SHA', value: auth.sourceSha });
  if (auth.deployEnvironmentRepair.enabled) env.push({ name: deployEnvironmentKey, value: 'production' });
  container.env = env;
  return template;
}
function candidatePlan(state, template) {
  return {
    schemaVersion: 1, authorizationHash: hash(state.auth),
    serviceUid: state.serviceUid, preRevision: state.preRevision, preRevisionUid: state.preRevisionUid,
    candidate: state.candidate, tag: state.tag,
    previousTemplateHash: hash(state.preRevisionTemplate), preServiceSpecHash: hash(state.preServiceSpec),
    candidateTemplateHash: hash(template), deployEnvironmentRepair: copy(state.auth.deployEnvironmentRepair),
  };
}
function assertCandidatePlan(state, auth, fresh = false) {
  check(object(state.candidatePlan) && object(state.preRevisionTemplate), 'CANDIDATE_PLAN_REQUIRED');
  validateRepairAuthorization(state.auth.deployEnvironmentRepair, fresh);
  if (auth !== undefined || state.auth.deployEnvironmentRepair.enabled) {
    check(object(auth) && equal(auth, state.auth), 'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED');
  }
  check(state.candidate === state.auth.candidate && state.tag === state.auth.tag &&
    state.preRevision === state.auth.expectedWebhookRevision, 'CANDIDATE_INSTANCE_CHANGED');
  const expected = plannedCandidate(state.auth, state.preRevisionTemplate, state.preServiceSpec);
  check(equal(state.candidatePlan, candidatePlan(state, expected)), 'CANDIDATE_PLAN_CHANGED');
  check(equal(state.candidateTemplate, expected), 'CANDIDATE_CONFIGURATION_CHANGED');
  return expected;
}
function assertRepairPrestate(state, previous) {
  if (!state.auth.deployEnvironmentRepair.enabled) return;
  check(previous?.metadata?.uid === state.preRevisionUid, 'DEPLOY_ENVIRONMENT_PRESTATE_CHANGED');
  validateRevision(previous, state.preRevision, state.auth.expectedWebhookDigest);
  check(equal(templateView(previous), state.preRevisionTemplate), 'DEPLOY_ENVIRONMENT_PRESTATE_CHANGED');
}
function runtimeContainer(revision) {
  const containers = revision.spec?.containers;
  check(Array.isArray(containers) && containers.length > 0, 'CONTAINERS_MISSING');
  for (const container of containers) {
    const names = new Set();
    for (const entry of container.env ?? []) {
      check(typeof entry.name === 'string' && !names.has(entry.name), 'ENV_NAME_DUPLICATE');
      names.add(entry.name);
    }
  }
  const matches = containers.map((container, index) => ({ container, index })).filter(({ container }) =>
    equal(container.command, ['node']) && equal(container.args, ['dist/src/http-instagram-engagement.js']));
  check(matches.length === 1, 'WEBHOOK_CONTAINER_AMBIGUOUS');
  const result = matches[0];
  const env = Object.fromEntries((result.container.env ?? []).map((entry) => [entry.name, entry.value]));
  check(env.TOCA_SERVICE_ROLE === 'webhook' && env.MCP_ENABLED === 'false', 'WEBHOOK_ROLE_INVALID');
  for (const key of ['META_WEBHOOK_ENABLED', 'META_WEBHOOK_PERSISTENCE_ENABLED', 'INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED']) {
    check(env[key] === 'true', 'WEBHOOK_CONFIGURATION_INVALID');
  }
  check((env.INSTAGRAM_ENGAGEMENT_WRITES_ENABLED ?? 'false') === 'false' &&
    (env.INSTAGRAM_PUBLICATION_WRITES_ENABLED ?? 'false') === 'false', 'WEBHOOK_WRITES_ENABLED');
  check(revision.spec.serviceAccountName === runtimeIdentity, 'RUNTIME_IDENTITY_MISMATCH');
  return result;
}
function revisionImage(revision, container) {
  const image = container.image;
  check(typeof image === 'string' && image.startsWith(imagePrefix) &&
    digestPattern.test(image.slice(imagePrefix.length)), 'REVISION_IMAGE_NOT_IMMUTABLE');
  return image.slice(imagePrefix.length);
}
function validateRevision(revision, name, digest, requireReady = true) {
  check(revision.metadata?.name === name &&
    revision.metadata?.labels?.['serving.knative.dev/service'] === serviceName, 'REVISION_IDENTITY_MISMATCH');
  if (requireReady) check(revision.status?.conditions?.some((entry) => entry.type === 'Ready' && entry.status === 'True'), 'REVISION_NOT_READY');
  check(typeof revision.metadata.uid === 'string' && revision.metadata.uid.length > 0, 'REVISION_UID_MISSING');
  const target = runtimeContainer(revision);
  check(revisionImage(revision, target.container) === digest, 'REVISION_IMAGE_MISMATCH');
  return target;
}
function serviceUrl(value, tag) {
  const url = new URL(value);
  check(url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' &&
    url.search === '' && url.hash === '' && url.pathname === '/' && url.hostname.endsWith('.run.app'), 'SERVICE_URL_INVALID');
  const prefix = (tag ? tag + '---' : '') + serviceName + '-';
  check(url.hostname.startsWith(prefix), 'SERVICE_URL_SCOPE_MISMATCH');
  return url.origin;
}
function auxiliary(input) {
  check(input.daemon.metadata?.name === daemonName &&
    typeof input.daemon.metadata.uid === 'string', 'DAEMON_IDENTITY_MISMATCH');
  const traffic = input.daemon.status?.traffic ?? [];
  const positiveRoutes = traffic.filter((entry) => (entry.percent ?? 0) > 0);
  check(positiveRoutes.length === 1 && positiveRoutes[0].percent === 100 &&
    positiveRoutes[0].revisionName === input.auth.expectedDaemonRevision, 'DAEMON_PRESTATE_MISMATCH');
  check(input.daemonRevision.metadata?.name === input.auth.expectedDaemonRevision &&
    input.daemonRevision.metadata?.labels?.['serving.knative.dev/service'] === daemonName &&
    input.daemonRevision.spec?.containers?.some((entry) =>
      entry.image === imagePrefix + input.auth.expectedDaemonDigest), 'DAEMON_IMAGE_MISMATCH');
  check(!input.iam.bindings?.some((binding) => binding.role === 'roles/run.invoker' &&
    binding.members?.some((member) => member === 'allUsers' || member === 'allAuthenticatedUsers')), 'LEGACY_PUBLIC_IAM_BINDING');
  check(input.scheduler.name === 'projects/' + project + '/locations/southamerica-east1/jobs/toca-managed-instagram-tick', 'SCHEDULER_IDENTITY_MISMATCH');
  return {
    daemonHash: hash({ uid: input.daemon.metadata.uid, spec: input.daemon.spec, traffic }),
    daemonRevisionHash: hash({ uid: input.daemonRevision.metadata.uid, spec: input.daemonRevision.spec }),
    iamHash: hash(input.iam),
    schedulerHash: hash({ state: input.scheduler.state, schedule: input.scheduler.schedule,
      timeZone: input.scheduler.timeZone, httpTarget: input.scheduler.httpTarget }),
  };
}
function requestBody(service, spec) {
  return {
    apiVersion: 'serving.knative.dev/v1', kind: 'Service',
    metadata: { name: service.metadata.name, namespace: service.metadata.namespace,
      resourceVersion: service.metadata.resourceVersion, ...configurationMetadata(service.metadata) },
    spec,
  };
}
function explicitTraffic(traffic) {
  return [
    ...Object.entries(traffic.percentages).map(([revisionName, percent]) => ({ revisionName, percent })),
    ...Object.entries(traffic.tags).map(([tag, revisionName]) => ({ revisionName, percent: 0, tag })),
  ];
}
function changePercentages(entries, revision) {
  return [{ revisionName: revision, percent: 100 },
    ...entries.filter((entry) => entry.tag !== undefined).map((entry) => {
      const result = copy(entry); delete result.url; result.percent = 0; return result;
    })];
}
function assertContext(state, service, view) {
  check(state.schemaVersion === 1 && service.metadata.uid === state.serviceUid, 'SERVICE_UID_CHANGED');
  check(equal(view.config, state.serviceConfig), 'SERVICE_CONFIGURATION_CHANGED');
  check(serviceUrl(service.status.url) === state.baseUrl, 'BASE_URL_CHANGED');
}
function candidateContext(input) {
  const { state, service, candidate } = input;
  assertCandidatePlan(state, input.auth);
  const view = serviceView(service);
  assertContext(state, service, view);
  validateRevision(candidate, state.candidate, state.auth.digest);
  if (state.candidateUid) check(candidate.metadata.uid === state.candidateUid, 'CANDIDATE_UID_CHANGED');
  check(equal(templateView(candidate), state.candidateTemplate) &&
    equal(templateView(service.spec.template), state.candidateTemplate) &&
    service.spec.template.metadata?.name === state.candidate, 'CANDIDATE_CONFIGURATION_CHANGED');
  return view;
}
try {
  const action = process.argv[2];
  const input = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  let result;
  if (action === 'authorize') {
    check(input.repository === repo && input.owner === 'luizanunciostoca', 'REPOSITORY_SCOPE_MISMATCH');
    check(shaPattern.test(input.sha) && shaPattern.test(input.tree) &&
      input.main.commit?.sha === input.sha && input.checkoutSha === input.sha, 'CURRENT_MAIN_MISMATCH');
    check(positive.test(String(input.runId)) && String(input.runAttempt) === '1', 'NEW_AUTHORIZATION_REQUIRED_FOR_RERUN');
    const issue = input.issue;
    check(issue.state === 'open' && issue.user?.login === input.owner &&
      issue.title?.startsWith('PRODUCTION AUTHORIZATION — Instagram webhook runtime alignment AUTO'), 'OWNER_AUTHORIZATION_INVALID');
    const get = lines(issue.body);
    requireMarkers(get, {
      AUTHORIZED_CONTROLLER_SHA: input.sha, AUTHORIZATION_STATE: 'ACTIVE',
      INSTAGRAM_WEBHOOK_RUNTIME_ALIGNMENT: 'AUTHORIZED', RUNTIME_SOURCE_SHA: input.sha,
      RUNTIME_TREE_SHA: input.tree, SERVICE_MUTATION_AUTHORIZED: 'true',
      WEBHOOK_IMAGE_MUTATION_AUTHORIZED: 'true', WEBHOOK_RELEASE_SHA_MUTATION_AUTHORIZED: 'true',
      WEBHOOK_TRAFFIC_MUTATION_AUTHORIZED: 'true', WEBHOOK_TEMPORARY_TAG_AUTHORIZED: 'true',
      DAEMON_MUTATION_AUTHORIZED: 'false', DATABASE_MUTATIONS_AUTHORIZED: 'false',
      PROVIDER_READS_AUTHORIZED: 'true', PROVIDER_METHODS: 'GET_ONLY',
      PROVIDER_WRITES_AUTHORIZED: 'false', EXTERNAL_REPLY_WRITES_AUTHORIZED: 'false',
      IAM_MUTATIONS_AUTHORIZED: 'false', NEW_PAID_RESOURCES_AUTHORIZED: 'false',
      GENERAL_AUTONOMY_AUTHORIZED: 'false', ZERO_TRAFFIC_STAGE_REQUIRED: 'true',
      ZERO_TRAFFIC_HTTP_PROBES_REQUIRED: 'true', ROLLBACK_REQUIRED: 'true',
    });
    const expectedWebhookRevision = get('EXPECTED_WEBHOOK_REVISION');
    const expectedDaemonRevision = get('EXPECTED_DAEMON_REVISION');
    check(/^toca-webhook-next-production-[a-z0-9-]+$/.test(expectedWebhookRevision) &&
      /^toca-managed-instagram-daemon-[a-z0-9-]+$/.test(expectedDaemonRevision), 'EXPECTED_REVISION_INVALID');
    const expectedWebhookDigest = get('EXPECTED_WEBHOOK_IMAGE_DIGEST');
    const expectedDaemonDigest = get('EXPECTED_DAEMON_IMAGE_DIGEST');
    const digest = get('RUNTIME_IMAGE_DIGEST');
    check([expectedWebhookDigest, expectedDaemonDigest, digest].every((entry) => digestPattern.test(entry)), 'EXPECTED_DIGEST_INVALID');
    const buildRun = get('RUNTIME_BUILD_RUN_ID');
    const ledgerComment = get('RUNTIME_BUILD_LEDGER_COMMENT_ID');
    check(positive.test(buildRun) && positive.test(ledgerComment), 'BUILD_REFERENCE_INVALID');
    check(input.control.state === 'open' && input.control.user?.login === input.owner, 'CONTROL_OWNER_INVALID');
    requireMarkers(lines(input.control.body), {
      PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION: '2',
      CONTROL_PLANE_ROLE: 'INTEGRATION_QUEUE_AND_MAIN_STABILITY',
      MAIN_STABILITY: 'PASS', EVALUATED_MAIN_SHA: input.sha, MERGE_RESERVATION: 'NONE',
    });
    result = { repository: repo, sourceSha: input.sha, treeSha: input.tree, digest,
      image: imagePrefix + digest, buildRun, ledgerComment, issue: issue.number,
      issueBodyHash: hash(issue.body), consumedBodyHash: hash(consumedBody(issue.body)),
      deployEnvironmentRepair: repairAuthorization(issue), expectedWebhookRevision, expectedWebhookDigest,
      expectedDaemonRevision, expectedDaemonDigest,
      runId: String(input.runId), runAttempt: String(input.runAttempt),
      candidate: serviceName + '-wr' + input.runId + 'a' + input.runAttempt,
      tag: 'wrec-' + input.runId + '-' + input.runAttempt };
    check(result.candidate.length <= 63 && positive.test(String(result.issue)), 'INSTANCE_ID_INVALID');
  } else if (action === 'receipt') {
    const { auth, comment, run, commit } = input;
    check(String(comment.id) === auth.ledgerComment &&
      comment.user?.login === 'github-actions[bot]' &&
      comment.issue_url === 'https://api.github.com/repos/' + repo + '/issues/641', 'BUILD_LEDGER_ORIGIN_INVALID');
    requireMarkers(lines(comment.body), {
      EVIDENCE_ID: 'runtime-build:' + auth.treeSha + ':SERVER_IMAGE_V1',
      EVIDENCE_TYPE: 'IMMUTABLE_RUNTIME_BUILD', SOURCE_SHA: auth.sourceSha,
      TREE_SHA: auth.treeSha, RUNTIME_CONTRACT: 'SERVER_IMAGE_V1',
      RUNTIME_IMAGE_DIGEST: auth.digest, WORKFLOW_RUN_ID: auth.buildRun,
      RESULT: 'PASS', VALIDITY: 'VALID', DATABASE_MUTATIONS: 'false',
      SERVICE_MUTATIONS: 'false', EXTERNAL_SIDE_EFFECTS: 'false',
    });
    check(String(run.id) === auth.buildRun && run.run_attempt === 1 &&
      run.repository?.full_name === repo && run.actor?.login === 'luizanunciostoca' &&
      run.path === '.github/workflows/instagram-engagement-shadow-runtime-build.yml' &&
      run.event === 'issues' && run.head_branch === 'main' && run.head_sha === auth.sourceSha &&
      run.status === 'completed' && run.conclusion === 'success', 'BUILD_RUN_NOT_CERTIFIED');
    const created = Date.parse(comment.created_at);
    check(Number.isFinite(created) && created >= Date.parse(run.created_at) &&
      created <= Date.parse(run.updated_at), 'BUILD_RECEIPT_TIME_MISMATCH');
    check(commit.sha === auth.sourceSha && commit.tree?.sha === auth.treeSha, 'BUILD_TREE_MISMATCH');
    result = { ...auth, provenanceVerified: true, buildRunAttempt: run.run_attempt };
  } else if (action === 'prestate') {
    const { auth, service, revision } = input;
    check(auth.provenanceVerified === true, 'BUILD_PROVENANCE_REQUIRED');
    const view = serviceView(service);
    check(singleRevision(view.traffic) === auth.expectedWebhookRevision, 'WEBHOOK_PRESTATE_MISMATCH');
    check(view.traffic.tags[auth.tag] === undefined &&
      service.spec.template.metadata?.name !== auth.candidate &&
      service.status.latestCreatedRevisionName !== auth.candidate, 'INSTANCE_ALREADY_EXISTS');
    validateRevision(revision, auth.expectedWebhookRevision, auth.expectedWebhookDigest);
    validateRepairAuthorization(auth.deployEnvironmentRepair, true);
    const preRevisionTemplate = templateView(revision);
    const candidateTemplate = plannedCandidate(auth, preRevisionTemplate, service.spec);
    result = { schemaVersion: 1, auth, candidate: auth.candidate, tag: auth.tag,
      serviceUid: service.metadata.uid, preRevision: revision.metadata.name,
      preRevisionUid: revision.metadata.uid, baseUrl: serviceUrl(service.status.url),
      serviceConfig: view.config, preServiceSpec: copy(service.spec), preTraffic: view.traffic,
      preRevisionTemplate, candidateTemplate, auxiliary: auxiliary(input), capturedAt: new Date().toISOString() };
    result.candidatePlan = candidatePlan(result, candidateTemplate);
  } else if (action === 'auxiliary') {
    result = { preserved: equal(auxiliary({ ...input, auth: input.state.auth }), input.state.auxiliary) };
    check(result.preserved, 'AUXILIARY_CONFIGURATION_CHANGED');
  } else if (action === 'stage') {
    const { state, service } = input;
    assertCandidatePlan(state, input.auth, true);
    assertRepairPrestate(state, input.previous);
    const view = serviceView(service);
    assertContext(state, service, view);
    check(singleRevision(view.traffic) === state.preRevision &&
      equal(view.traffic, state.preTraffic) && equal(service.spec, state.preServiceSpec), 'PRESTATE_CHANGED');
    const spec = copy(service.spec);
    spec.template = { metadata: { name: state.candidate, ...copy(state.candidateTemplate.metadata) },
      spec: copy(state.candidateTemplate.spec) };
    spec.traffic = explicitTraffic({ percentages: view.traffic.percentages,
      tags: { ...view.traffic.tags, [state.tag]: state.candidate } });
    result = { request: requestBody(service, spec) };
  } else if (action === 'candidate') {
    const view = candidateContext(input);
    const expectedTags = { ...input.state.preTraffic.tags, [input.state.tag]: input.state.candidate };
    check(singleRevision(view.traffic) === input.state.preRevision &&
      equal(view.traffic.tags, expectedTags), 'ZERO_TRAFFIC_STAGE_NOT_PROVEN');
    const tagged = input.service.status.traffic.filter((entry) => entry.tag === input.state.tag);
    check(tagged.length === 1 && tagged[0].revisionName === input.state.candidate, 'CANDIDATE_TAG_NOT_PROVEN');
    result = { candidateUid: input.candidate.metadata.uid,
      candidateUrl: serviceUrl(tagged[0].url, input.state.tag), stageVerified: true };
  } else if (action === 'promote') {
    const { state, service, probes } = input;
    const view = candidateContext(input);
    validateRepairAuthorization(state.auth.deployEnvironmentRepair, true);
    assertRepairPrestate(state, input.previous);
    check(state.stageVerified === true && typeof state.candidateUid === 'string', 'STAGE_CONTEXT_INCOMPLETE');
    check(singleRevision(view.traffic) === state.preRevision &&
      equal(view.traffic.tags, { ...state.preTraffic.tags, [state.tag]: state.candidate }), 'PRE_PROMOTION_TRAFFIC_CHANGED');
    check(probes.candidate === state.candidate && probes.candidateUid === state.candidateUid &&
      probes.health === 200 && probes.ready === 200 && probes.bodyVerified === true &&
      Date.now() - Date.parse(probes.checkedAt) >= 0 &&
      Date.now() - Date.parse(probes.checkedAt) <= 300000, 'CANDIDATE_HTTP_PROOF_REQUIRED');
    const spec = copy(service.spec);
    spec.traffic = changePercentages(spec.traffic, state.candidate);
    result = { request: requestBody(service, spec) };
  } else if (action === 'promoted') {
    const view = candidateContext(input);
    check(singleRevision(view.traffic) === input.state.candidate &&
      equal(view.traffic.tags, { ...input.state.preTraffic.tags, [input.state.tag]: input.state.candidate }),
      'PROMOTION_NOT_PROVEN');
    result = { promoted: true };
  } else if (action === 'accepted') {
    const view = candidateContext(input);
    check(singleRevision(view.traffic) === input.state.candidate &&
      equal(view.traffic.tags, input.state.preTraffic.tags), 'FINAL_ACCEPTANCE_NOT_PROVEN');
    result = { accepted: true };
  } else if (action === 'stage-write-gate' || action === 'promote-write-gate') {
    const { state, request } = input;
    const template = assertCandidatePlan(state, input.auth, true);
    const expectedSpec = copy(state.preServiceSpec);
    expectedSpec.template = { metadata: { name: state.candidate, ...copy(template.metadata) }, spec: copy(template.spec) };
    check(request.apiVersion === 'serving.knative.dev/v1' && request.kind === 'Service' &&
      request.metadata?.name === serviceName &&
      [project, '990081828836'].includes(request.metadata.namespace) &&
      typeof request.metadata.resourceVersion === 'string' && request.metadata.resourceVersion.length > 0 &&
      equal(configurationMetadata(request.metadata), state.serviceConfig.metadata) &&
      equal(specWithoutTraffic(request.spec), specWithoutTraffic(expectedSpec)), 'FORWARD_REQUEST_PLAN_CHANGED');
    const serving = action === 'stage-write-gate' ? state.preRevision : state.candidate;
    check(request.spec.traffic.every((entry) => entry.latestRevision !== true) &&
      equal(routeMap(request.spec.traffic, undefined, false), {
        percentages: { [serving]: 100 }, tags: { ...state.preTraffic.tags, [state.tag]: state.candidate },
      }), 'FORWARD_REQUEST_TRAFFIC_CHANGED');
    result = { verified: true };
  } else if (action === 'rollback') {
    const { state, service } = input;
    const view = serviceView(service, true);
    check(service.metadata.uid === state.serviceUid, 'SERVICE_UID_CHANGED');
    const serving = singleRevision(view.traffic);
    if (serving === state.preRevision) result = { decision: 'NOOP_ALREADY_RESTORED' };
    else if (serving !== state.candidate) result = { decision: 'NOOP_SUPERSEDED' };
    else {
      assertContext(state, service, view);
      check(state.stageVerified === true && state.candidateUid === input.candidate?.metadata?.uid, 'ROLLBACK_CONTEXT_INCOMPLETE');
      // An unhealthy own candidate is precisely a reason to restore the ready prestate.
      validateRevision(input.candidate, state.candidate, state.auth.digest, false);
      check(service.spec.template.metadata?.name === state.candidate &&
        equal(templateView(service.spec.template), state.candidateTemplate) &&
        equal(templateView(input.candidate), state.candidateTemplate), 'ROLLBACK_CANDIDATE_CHANGED');
      check(input.previous?.metadata?.uid === state.preRevisionUid, 'PREVIOUS_REVISION_UID_CHANGED');
      validateRevision(input.previous, state.preRevision, state.auth.expectedWebhookDigest);
      const spec = copy(service.spec);
      spec.traffic = changePercentages(spec.traffic, state.preRevision);
      result = { decision: 'RESTORE_OWN_CANDIDATE', request: requestBody(service, spec),
        expectedTraffic: { percentages: { [state.preRevision]: 100 }, tags: view.traffic.tags } };
    }
  } else if (action === 'cleanup') {
    const { state, service } = input;
    const view = serviceView(service, true);
    check(service.metadata.uid === state.serviceUid, 'SERVICE_UID_CHANGED');
    const target = view.traffic.tags[state.tag];
    if (target === undefined) result = { decision: 'NOOP_TAG_ABSENT' };
    else {
      check(target === state.candidate, 'OWN_TAG_REASSIGNED');
      const spec = copy(service.spec);
      spec.traffic = spec.traffic.flatMap((entry) => {
        if (entry.tag !== state.tag) return [entry];
        if ((entry.percent ?? 0) === 0) return [];
        const retained = copy(entry); delete retained.tag; return [retained];
      });
      const tags = { ...view.traffic.tags }; delete tags[state.tag];
      result = { decision: 'REMOVE_OWN_TAG', request: requestBody(service, spec),
        expectedTraffic: { percentages: view.traffic.percentages, tags } };
    }
  } else if (action === 'transition-readback') {
    const { state, service, transition } = input;
    const view = serviceView(service, true);
    check(service.metadata.uid === state.serviceUid, 'SERVICE_UID_CHANGED');
    const proposed = transition.request;
    check(equal(view.traffic, transition.expectedTraffic) &&
      equal(specWithoutTraffic(service.spec), specWithoutTraffic(proposed.spec)) &&
      equal(view.metadata, configurationMetadata(proposed.metadata)), 'TRANSITION_NOT_PROVEN');
    result = { verified: true };
  } else if (action === 'main-stable') {
    check(input.main.commit?.sha === input.auth.sourceSha &&
      input.control.state === 'open' && input.control.user?.login === 'luizanunciostoca',
      'CURRENT_MAIN_MISMATCH');
    requireMarkers(lines(input.control.body), {
      PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION: '2',
      CONTROL_PLANE_ROLE: 'INTEGRATION_QUEUE_AND_MAIN_STABILITY',
      MAIN_STABILITY: 'PASS', EVALUATED_MAIN_SHA: input.auth.sourceSha, MERGE_RESERVATION: 'NONE',
    });
    result = { verified: true };
  } else if (action === 'consume') {
    const { auth, issue } = input;
    check(issue.number === auth.issue && issue.state === 'open' &&
      issue.user?.login === 'luizanunciostoca' && hash(issue.body) === auth.issueBodyHash, 'AUTHORIZATION_CHANGED');
    lines(issue.body)('AUTHORIZATION_STATE', 'ACTIVE');
    check(equal(repairAuthorization(issue), auth.deployEnvironmentRepair), 'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED');
    result = { state: 'closed', state_reason: 'completed',
      body: consumedBody(issue.body) };
    check(hash(result.body) === auth.consumedBodyHash, 'AUTHORIZATION_CHANGED');
  } else if (action === 'consumed') {
    check(input.issue.number === input.auth.issue && input.issue.state === 'closed' &&
      input.issue.user?.login === 'luizanunciostoca' &&
      input.issue.body === input.consumed.body && hash(input.issue.body) === input.auth.consumedBodyHash,
      'AUTHORIZATION_CONSUMPTION_NOT_PROVEN');
    lines(input.issue.body)('AUTHORIZATION_STATE', 'CONSUMED_AND_CLOSED');
    check(equal(repairAuthorization(input.issue), input.auth.deployEnvironmentRepair), 'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED');
    result = { verified: true };
  } else if (action === 'probe-diagnostics') {
    const checks = input?.checks;
    const valid = object(input) && ['ready', 'not_ready'].includes(input.status) &&
      Array.isArray(checks) && checks.length > 0 && checks.length <= readinessNames.size &&
      checks.every((entry) => object(entry) && readinessNames.has(entry.name) &&
        typeof entry.ok === 'boolean') &&
      new Set(checks.map((entry) => entry.name)).size === checks.length &&
      (input.status === 'ready') === checks.every((entry) => entry.ok);
    result = { status: valid ? (input.status === 'ready' ? 'OBSERVED_READY' : 'OBSERVED_NOT_READY') :
      'NOT_PROVEN', failedChecks: valid ? checks.filter((entry) => !entry.ok).map((entry) => entry.name).sort() : [],
      diagnosticOnly: true };
  } else if (action === 'log-diagnostics') {
    check(Array.isArray(input.logs) && input.logs.length <= 300 &&
      typeof input.revision === 'string' && input.revision.length <= 63 &&
      /^toca-webhook-next-production-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.revision),
      'READINESS_LOG_INPUT_INVALID');
    const failed = new Set();
    let matchedWarnings = 0;
    for (const entry of input.logs) {
      const labels = entry?.resource?.labels;
      if (entry?.resource?.type !== 'cloud_run_revision' || labels?.project_id !== project ||
          labels?.location !== 'southamerica-east1' || labels?.service_name !== serviceName ||
          labels?.revision_name !== input.revision) continue;
      for (const message of [entry.textPayload, entry.jsonPayload?.message]) {
        if (typeof message !== 'string') continue;
        for (const line of message.split(/\r?\n/)) {
          const match = /^TOCA_READINESS_NOT_READY failed_checks=([a-z_]+(?:,[a-z_]+)*)$/.exec(line);
          if (!match) continue;
          const names = match[1].split(',');
          if (!names.every((name) => readinessNames.has(name)) || new Set(names).size !== names.length) continue;
          matchedWarnings++;
          for (const name of names) failed.add(name);
        }
      }
    }
    result = { status: matchedWarnings ? 'OBSERVED_NOT_READY' : 'NOT_PROVEN',
      failedChecks: [...failed].sort(), matchedWarnings, diagnosticOnly: true };
  } else if (action === 'probe-body') {
    check(input.healthStatus === '200' && input.readyStatus === '200', 'HTTP_PROBE_NON200');
    const checks = input.ready?.checks;
    check(input.health?.status === 'ok' && input.ready?.status === 'ready' &&
      Array.isArray(checks) && checks.every((entry) => typeof entry.name === 'string' && entry.ok === true),
      'HTTP_PROBE_BODY_INVALID');
    const names = new Set(checks.map((entry) => entry.name));
    check(names.size === checks.length &&
      ['db', 'migrations', 'schema', 'meta', 'provider_credentials', 'critical_configuration']
        .every((name) => names.has(name)), 'HTTP_PROBE_BODY_INVALID');
    result = { candidate: input.state.candidate, candidateUid: input.state.candidateUid,
      health: 200, ready: 200, bodyVerified: true, checkedAt: new Date().toISOString() };
  } else throw new Error('COMMAND_INVALID');
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ?
    error.message : 'INVALID_OR_UNSUPPORTED_INPUT';
  process.stderr.write('WEBHOOK_RECOVERY_' + code + '\n');
  process.exitCode = 1;
}
NODE
}

if [[ "${1:-}" == model ]]; then
  shift
  model "$@"
  exit
fi

readonly PROJECT='toca-mcp-production'
readonly REGION='southamerica-east1'
readonly SERVICE='toca-webhook-next-production'
readonly DAEMON='toca-managed-instagram-daemon'
readonly REPOSITORY='luizanunciostoca/toca-mcp-server'
readonly API="https://southamerica-east1-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/$PROJECT"
[[ "${GITHUB_REPOSITORY:-}" == "$REPOSITORY" &&
   "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ &&
   "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]*$ &&
   -n "${RUNNER_TEMP:-}" ]] || { echo 'WEBHOOK_RECOVERY_EXECUTION_CONTEXT_INVALID' >&2; exit 64; }
readonly STATE="$RUNNER_TEMP/webhook-runtime-align-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
readonly PHASE="${1:-}"

fail() {
  local code="$1"
  [[ "$code" =~ ^[A-Z][A-Z0-9_]+$ ]] || code='UNCLASSIFIED_FAILURE'
  if [[ -d "$STATE" && ! -f "$STATE/failure-code" ]]; then
    printf '%s\n' "$code" > "$STATE/failure-code"
  fi
  printf 'WEBHOOK_RECOVERY_%s\n' "$code" >&2
  exit 1
}
json_read() {
  local output="$1"; shift
  timeout --kill-after=5s 35s "$@" > "$output" 2> "$STATE/command-error" ||
    return 1
  jq -e 'type=="object"' "$output" > /dev/null 2> "$STATE/command-error"
}
github_read() {
  local output="$1" route="$2"
  json_read "$output" gh api "$route" || fail 'GITHUB_READ_FAILED'
}
cloud_read() {
  local output="$1"; shift
  json_read "$output" gcloud "$@" --project "$PROJECT" --region "$REGION" --format=json
}
input_json() {
  local output="$1"; shift
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const value = {};
    for (const entry of process.argv.slice(1)) {
      const separator = entry.indexOf("=");
      const name = entry.slice(0, separator);
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) process.exit(64);
      value[name] = JSON.parse(readFileSync(entry.slice(separator + 1), "utf8"));
    }
    process.stdout.write(JSON.stringify(value));
  ' "$@" > "$output" 2> "$STATE/model-error"
}
run_model() {
  local action="$1" output="$2"; shift 2
  input_json "$STATE/model-input.json" "$@" || return 1
  model "$action" "$STATE/model-input.json" > "$output" 2> "$STATE/model-error"
}
require_model() {
  if ! run_model "$@"; then
    local code
    code="$(tail -1 "$STATE/model-error" | sed -n 's/^WEBHOOK_RECOVERY_//p')"
    fail "${code:-MODEL_REJECTED}"
  fi
}
load_auth() {
  [[ -f "$STATE/auth.json" ]] || fail 'AUTHORIZATION_CONTEXT_MISSING'
  ISSUE="$(jq -er '.issue' "$STATE/auth.json")"
  CANDIDATE="$(jq -er '.candidate' "$STATE/auth.json")"
  PREVIOUS="$(jq -er '.expectedWebhookRevision' "$STATE/auth.json")"
}
stable_main() {
  github_read "$STATE/main-live.json" "repos/$REPOSITORY/branches/main"
  github_read "$STATE/control-live.json" "repos/$REPOSITORY/issues/640"
  require_model main-stable "$STATE/stability.json" "auth=$STATE/auth.json" \
    "main=$STATE/main-live.json" "control=$STATE/control-live.json"
}
consumed_authorization() {
  github_read "$STATE/issue-live.json" "repos/$REPOSITORY/issues/$ISSUE"
  require_model consumed "$STATE/consumption-readback.json" "auth=$STATE/auth.json" \
    "issue=$STATE/issue-live.json" "consumed=$STATE/consumed-request.json"
}
live_service() {
  cloud_read "$STATE/service-live.json" run services describe "$SERVICE"
}
live_candidate() {
  cloud_read "$STATE/candidate-live.json" run revisions describe "$CANDIDATE"
}
live_repair_prestate() {
  if [[ "$(jq -r '.deployEnvironmentRepair.enabled' "$STATE/auth.json")" == true ]]; then
    cloud_read "$STATE/repair-previous-live.json" run revisions describe "$PREVIOUS" ||
      fail 'DEPLOY_ENVIRONMENT_PRESTATE_READ_FAILED'
  else
    printf '{}\n' > "$STATE/repair-previous-live.json"
  fi
}
live_auxiliary() {
  cloud_read "$STATE/daemon-live.json" run services describe "$DAEMON" ||
    fail 'DAEMON_READ_FAILED'
  local revision
  revision="$(jq -er '.expectedDaemonRevision' "$STATE/auth.json")"
  cloud_read "$STATE/daemon-revision-live.json" run revisions describe "$revision" ||
    fail 'DAEMON_REVISION_READ_FAILED'
  cloud_read "$STATE/iam-live.json" run services get-iam-policy "$SERVICE" ||
    fail 'IAM_READ_FAILED'
  json_read "$STATE/scheduler-live.json" gcloud scheduler jobs describe toca-managed-instagram-tick \
    --project "$PROJECT" --location "$REGION" --format=json || fail 'SCHEDULER_READ_FAILED'
}
verify_auxiliary() {
  live_auxiliary
  require_model auxiliary "$STATE/auxiliary-readback.json" "state=$STATE/state.json" \
    "daemon=$STATE/daemon-live.json" "daemonRevision=$STATE/daemon-revision-live.json" \
    "iam=$STATE/iam-live.json" "scheduler=$STATE/scheduler-live.json"
}
api_request() {
  local method="$1" url="$2" output="$3" body="${4:-}" forward_phase="${5:-}"
  local token status
  token="$(gcloud auth print-access-token 2> "$STATE/command-error")" ||
    fail 'ACCESS_TOKEN_UNAVAILABLE'
  [[ -n "$token" && "$token" != *$'\n'* && "$token" != *$'\r'* ]] ||
    fail 'ACCESS_TOKEN_INVALID'
  # Forward writes recheck the exact local plan and deadline after token acquisition.
  # Compensation deliberately does not enter this gate, including after expiry.
  if [[ "$method" == PUT && ( "$forward_phase" == stage || "$forward_phase" == promote ) ]]; then
    require_model "$forward_phase-write-gate" "$STATE/$forward_phase-write-gate.json" \
      "auth=$STATE/auth.json" "state=$STATE/state.json" "request=$body"
  fi
  printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$token" > "$STATE/request-headers"
  unset token
  local args=(--silent --show-error --proto '=https' --connect-timeout 5 --max-time 35
    --request "$method" --header "@$STATE/request-headers" --output "$output" --write-out '%{http_code}')
  [[ -z "$body" ]] || args+=(--data-binary "@$body")
  # Deliberately no curl retry: a timed-out PUT can already have been applied.
  status="$(curl "${args[@]}" "$url" 2> "$STATE/command-error")" || status="${status:-000}"
  rm -f "$STATE/request-headers"
  [[ "$status" =~ ^[0-9]{3}$ ]] || status=000
  printf '%s' "$status"
}
put_once() {
  local phase="$1" transition="$2"
  jq -e '.request | .metadata.resourceVersion | type=="string" and length>0' "$transition" > /dev/null ||
    fail 'CAS_RESOURCE_VERSION_REQUIRED'
  jq '.request' "$transition" > "$STATE/request-$phase.json"
  printf 'ATTEMPTED\n' > "$STATE/$phase-attempted"
  local status
  status="$(api_request PUT "$API/services/$SERVICE" "$STATE/response-$phase.json" "$STATE/request-$phase.json" "$phase")"
  printf '%s\n' "$status" > "$STATE/$phase-http-status"
  case "$status" in
    409|412) fail 'CAS_CONFLICT' ;;
    200|201|202|000|500|502|503|504) ;;
    *) fail 'SERVICE_UPDATE_REJECTED' ;;
  esac
}
wait_candidate() {
  local action="$1" output="$2"
  for attempt in $(seq 1 12); do
    if live_service && live_candidate &&
       run_model "$action" "$output" "state=$STATE/state.json" \
         "auth=$STATE/auth.json" "service=$STATE/service-live.json" "candidate=$STATE/candidate-live.json"; then
      return 0
    fi
    [[ "$attempt" == 12 ]] || sleep 5
  done
  fail 'CANDIDATE_READBACK_NOT_PROVEN'
}
wait_transition() {
  local phase="$1" transition="$2"
  for attempt in $(seq 1 12); do
    if live_service && run_model transition-readback "$STATE/$phase-readback.json" \
        "state=$STATE/state.json" "service=$STATE/service-live.json" "transition=$transition"; then
      printf 'APPLIED_CONFIRMED_BY_READBACK\n' > "$STATE/$phase-status"
      return 0
    fi
    [[ "$attempt" == 12 ]] || sleep 5
  done
  fail 'TRANSITION_OUTCOME_UNKNOWN'
}
http_probes() {
  local url="$1" output="$2" prefix="$3"
  local health ready
  health="$(curl --silent --show-error --proto '=https' --connect-timeout 5 --max-time 20 \
    --output "$STATE/$prefix-health.json" --write-out '%{http_code}' "$url/health" \
    2> "$STATE/command-error")" || health=000
  ready="$(curl --silent --show-error --proto '=https' --connect-timeout 5 --max-time 25 \
    --output "$STATE/$prefix-ready.json" --write-out '%{http_code}' "$url/ready" \
    2> "$STATE/command-error")" || ready=000
  printf '%s\n' "$health" > "$STATE/$prefix-health-status"
  printf '%s\n' "$ready" > "$STATE/$prefix-ready-status"
  # A 503 is a failed acceptance gate, but its bounded check names explain the failure.
  # Only the model's fixed vocabulary is retained; response bodies never enter reports.
  if ! model probe-diagnostics "$STATE/$prefix-ready.json" > "$STATE/$prefix-ready-diagnostic.json" 2> "$STATE/model-error"; then
    printf '%s\n' '{"status":"NOT_PROVEN","failedChecks":[],"diagnosticOnly":true}' > "$STATE/$prefix-ready-diagnostic.json"
  fi
  jq -er '.status' "$STATE/$prefix-ready-diagnostic.json" > "$STATE/$prefix-ready-diagnostic-status"
  jq -er 'if .status == "NOT_PROVEN" then "NOT_PROVEN" elif (.failedChecks | length) == 0 then "NONE" else .failedChecks | join(",") end' \
    "$STATE/$prefix-ready-diagnostic.json" > "$STATE/$prefix-failed-readiness-checks"
  [[ "$health" == 200 && "$ready" == 200 ]] || fail 'HTTP_PROBE_NON200'
  jq -n --slurpfile state "$STATE/state.json" --slurpfile health "$STATE/$prefix-health.json" \
    --slurpfile ready "$STATE/$prefix-ready.json" --arg hs "$health" --arg rs "$ready" \
    '{state:$state[0],health:$health[0],ready:$ready[0],healthStatus:$hs,readyStatus:$rs}' \
    > "$STATE/probe-input.json" 2> "$STATE/model-error" || fail 'HTTP_PROBE_BODY_INVALID'
  model probe-body "$STATE/probe-input.json" > "$output" 2> "$STATE/model-error" ||
    fail 'HTTP_PROBE_BODY_INVALID'
}

case "$PHASE" in
  authorize)
    mkdir "$STATE" || fail 'INSTANCE_STATE_ALREADY_EXISTS'
    [[ "$GITHUB_REF" == refs/heads/main && "$GITHUB_RUN_ATTEMPT" == 1 ]] ||
      fail 'NEW_AUTHORIZATION_REQUIRED_FOR_RERUN'
    ISSUE="$(jq -er '.issue.number' "$GITHUB_EVENT_PATH")"
    [[ "$ISSUE" =~ ^[1-9][0-9]*$ ]] || fail 'AUTHORIZATION_ISSUE_INVALID'
    github_read "$STATE/issue-live.json" "repos/$REPOSITORY/issues/$ISSUE"
    github_read "$STATE/main-live.json" "repos/$REPOSITORY/branches/main"
    github_read "$STATE/control-live.json" "repos/$REPOSITORY/issues/640"
    CHECKOUT="$(git rev-parse HEAD)"
    TREE="$(git rev-parse 'HEAD^{tree}')"
    jq -n --slurpfile issue "$STATE/issue-live.json" --slurpfile main "$STATE/main-live.json" \
      --slurpfile control "$STATE/control-live.json" --arg repository "$REPOSITORY" \
      --arg owner "$GITHUB_REPOSITORY_OWNER" --arg sha "$GITHUB_SHA" --arg checkout "$CHECKOUT" \
      --arg tree "$TREE" --arg run "$GITHUB_RUN_ID" --arg attempt "$GITHUB_RUN_ATTEMPT" \
      '{issue:$issue[0],main:$main[0],control:$control[0],repository:$repository,owner:$owner,
        sha:$sha,checkoutSha:$checkout,tree:$tree,runId:$run,runAttempt:$attempt}' > "$STATE/authorize-input.json"
    model authorize "$STATE/authorize-input.json" > "$STATE/auth-initial.json" 2> "$STATE/model-error" ||
      fail 'OWNER_AUTHORIZATION_OR_STABILITY_REJECTED'
    BUILD_RUN="$(jq -er '.buildRun' "$STATE/auth-initial.json")"
    LEDGER_COMMENT="$(jq -er '.ledgerComment' "$STATE/auth-initial.json")"
    github_read "$STATE/build-comment.json" "repos/$REPOSITORY/issues/comments/$LEDGER_COMMENT"
    github_read "$STATE/build-run.json" "repos/$REPOSITORY/actions/runs/$BUILD_RUN"
    github_read "$STATE/build-commit.json" "repos/$REPOSITORY/git/commits/$GITHUB_SHA"
    require_model receipt "$STATE/auth.json" "auth=$STATE/auth-initial.json" \
      "comment=$STATE/build-comment.json" "run=$STATE/build-run.json" "commit=$STATE/build-commit.json"
    printf 'authorization_issue=%s\n' "$ISSUE" >> "$GITHUB_OUTPUT"
    ;;
  prestate)
    load_auth
    [[ ! -e "$STATE/state.json" ]] || fail 'PRESTATE_ALREADY_CAPTURED'
    IMAGE="$(jq -er '.image' "$STATE/auth.json")"
    DIGEST="$(bash scripts/resolve-artifact-registry-digest.sh "$IMAGE" 2> "$STATE/command-error")" ||
      fail 'IMMUTABLE_IMAGE_READ_FAILED'
    [[ "$DIGEST" == "$(jq -er '.digest' "$STATE/auth.json")" ]] || fail 'IMMUTABLE_IMAGE_MISMATCH'
    live_service || fail 'SERVICE_READ_FAILED'
    cloud_read "$STATE/previous-live.json" run revisions describe "$PREVIOUS" || fail 'PREVIOUS_REVISION_READ_FAILED'
    live_auxiliary
    require_model prestate "$STATE/state.json" "auth=$STATE/auth.json" \
      "service=$STATE/service-live.json" "revision=$STATE/previous-live.json" \
      "daemon=$STATE/daemon-live.json" "daemonRevision=$STATE/daemon-revision-live.json" \
      "iam=$STATE/iam-live.json" "scheduler=$STATE/scheduler-live.json"
    jq '{
      schemaVersion, repository:.auth.repository, controllerSha:.auth.sourceSha,
      runtimeSourceSha:.auth.sourceSha, runtimeTreeSha:.auth.treeSha, imageDigest:.auth.digest,
      buildRunId:.auth.buildRun, buildLedgerCommentId:.auth.ledgerComment,
      runId:.auth.runId, runAttempt:.auth.runAttempt, authorizationIssue:.auth.issue,
      serviceUid, preRevision, preRevisionUid, previousImageDigest:.auth.expectedWebhookDigest,
      candidate, tag, capturedAt, plannedCandidateTrafficPercent:0, rollbackOnlyOwnCandidate:true,
      deployEnvironmentRepair:.auth.deployEnvironmentRepair,
      candidatePlanSha256:.candidatePlan.candidateTemplateHash,
      rawRuntimePayloadIncluded:false
    }' "$STATE/state.json" > "$STATE/sanitized-context.json"
    ;;
  consume)
    load_auth
    [[ -s "$STATE/state.json" ]] || fail 'PRESTATE_REQUIRED'
    stable_main
    github_read "$STATE/issue-live.json" "repos/$REPOSITORY/issues/$ISSUE"
    require_model consume "$STATE/consumed-request.json" "auth=$STATE/auth.json" "issue=$STATE/issue-live.json"
    gh api --method PATCH "repos/$REPOSITORY/issues/$ISSUE" --input "$STATE/consumed-request.json" \
      > "$STATE/consume-response.json" 2> "$STATE/command-error" || true
    github_read "$STATE/issue-live.json" "repos/$REPOSITORY/issues/$ISSUE"
    require_model consumed "$STATE/consumption-readback.json" "auth=$STATE/auth.json" \
      "issue=$STATE/issue-live.json" "consumed=$STATE/consumed-request.json"
    ;;
  stage)
    load_auth
    [[ -f "$STATE/consumption-readback.json" ]] || fail 'AUTHORIZATION_CONSUMPTION_REQUIRED'
    stable_main
    consumed_authorization
    verify_auxiliary
    live_service || fail 'SERVICE_READ_FAILED'
    live_repair_prestate
    require_model stage "$STATE/stage-transition.json" "state=$STATE/state.json" \
      "auth=$STATE/auth.json" "service=$STATE/service-live.json" "previous=$STATE/repair-previous-live.json"
    [[ "$(api_request GET "$API/revisions/$CANDIDATE" "$STATE/candidate-absence.json")" == 404 ]] ||
      fail 'CANDIDATE_ABSENCE_NOT_PROVEN'
    put_once stage "$STATE/stage-transition.json"
    wait_candidate candidate "$STATE/stage-readback.json"
    jq -s '.[0] + .[1]' "$STATE/state.json" "$STATE/stage-readback.json" > "$STATE/state-next.json"
    mv "$STATE/state-next.json" "$STATE/state.json"
    printf 'APPLIED_CONFIRMED_BY_READBACK\n' > "$STATE/stage-status"
    ;;
  probe)
    load_auth
    [[ "$(jq -r '.stageVerified // false' "$STATE/state.json")" == true ]] || fail 'STAGE_CONTEXT_INCOMPLETE'
    http_probes "$(jq -er '.candidateUrl' "$STATE/state.json")" "$STATE/candidate-probes.json" candidate
    ;;
  promote)
    load_auth
    stable_main
    consumed_authorization
    verify_auxiliary
    live_service && live_candidate || fail 'PRE_PROMOTION_READ_FAILED'
    live_repair_prestate
    require_model promote "$STATE/promote-transition.json" "state=$STATE/state.json" \
      "auth=$STATE/auth.json" "service=$STATE/service-live.json" "candidate=$STATE/candidate-live.json" \
      "previous=$STATE/repair-previous-live.json" "probes=$STATE/candidate-probes.json"
    put_once promote "$STATE/promote-transition.json"
    wait_candidate promoted "$STATE/promote-readback.json"
    printf 'APPLIED_CONFIRMED_BY_READBACK\n' > "$STATE/promote-status"
    ;;
  verify)
    load_auth
    wait_candidate promoted "$STATE/production-readback.json"
    http_probes "$(jq -er '.baseUrl' "$STATE/state.json")" "$STATE/base-probes.json" base
    export GCP_PROJECT_ID="$PROJECT" GCP_REGION="$REGION" WEBHOOK_SERVICE_NAME="$SERVICE"
    export RUNTIME_IMAGE
    RUNTIME_IMAGE="$(jq -er '.image' "$STATE/auth.json")"
    bash scripts/verify-instagram-engagement-webhook-ingress.sh > "$STATE/provider-readback.log" \
      2> "$STATE/command-error" || fail 'CALLBACK_PROVIDER_GET_READBACK_FAILED'
    verify_auxiliary
    printf 'PASS\n' > "$STATE/runtime-acceptance-status"
    ;;
  rollback)
    [[ -s "$STATE/state.json" ]] || exit 0
    load_auth
    live_service || fail 'ROLLBACK_SERVICE_READ_FAILED'
    live_candidate || printf '{}\n' > "$STATE/candidate-live.json"
    cloud_read "$STATE/previous-live.json" run revisions describe "$PREVIOUS" ||
      printf '{}\n' > "$STATE/previous-live.json"
    require_model rollback "$STATE/rollback-transition.json" "state=$STATE/state.json" \
      "service=$STATE/service-live.json" "candidate=$STATE/candidate-live.json" "previous=$STATE/previous-live.json"
    DECISION="$(jq -er '.decision' "$STATE/rollback-transition.json")"
    printf '%s\n' "$DECISION" > "$STATE/rollback-status"
    if [[ "$DECISION" == RESTORE_OWN_CANDIDATE ]]; then
      put_once rollback "$STATE/rollback-transition.json"
      wait_transition rollback "$STATE/rollback-transition.json"
    fi
    ;;
  cleanup)
    [[ -s "$STATE/state.json" ]] || exit 0
    load_auth
    live_service || fail 'CLEANUP_SERVICE_READ_FAILED'
    require_model cleanup "$STATE/cleanup-transition.json" "state=$STATE/state.json" "service=$STATE/service-live.json"
    DECISION="$(jq -er '.decision' "$STATE/cleanup-transition.json")"
    printf '%s\n' "$DECISION" > "$STATE/cleanup-status"
    if [[ "$DECISION" == REMOVE_OWN_TAG ]]; then
      put_once cleanup "$STATE/cleanup-transition.json"
      wait_transition cleanup "$STATE/cleanup-transition.json"
    fi
    if [[ -f "$STATE/runtime-acceptance-status" &&
          "$(cat "$STATE/runtime-acceptance-status")" == PASS ]]; then
      live_service && live_candidate || fail 'FINAL_ACCEPTANCE_READ_FAILED'
      require_model accepted "$STATE/final-readback.json" "state=$STATE/state.json" \
        "auth=$STATE/auth.json" "service=$STATE/service-live.json" "candidate=$STATE/candidate-live.json"
      verify_auxiliary
    fi
    ;;
  report)
    [[ -s "$STATE/auth.json" ]] || exit 0
    load_auth
    value() { if [[ -f "$STATE/$1" ]]; then cat "$STATE/$1"; else printf 'NOT_PROVEN'; fi; }
    STATUS=FAIL
    if [[ "$(value runtime-acceptance-status)" == PASS &&
          "$(value cleanup-status)" =~ ^(APPLIED_CONFIRMED_BY_READBACK|NOOP_TAG_ABSENT)$ &&
          ! -f "$STATE/failure-code" ]]; then STATUS=PASS; fi
    {
      printf 'INSTAGRAM_WEBHOOK_RUNTIME_ALIGNMENT_STATUS=%s\n' "$STATUS"
      printf 'CONTROLLER_SHA=%s\n' "$GITHUB_SHA"
      printf 'RUNTIME_SOURCE_SHA=%s\n' "$(jq -er '.sourceSha' "$STATE/auth.json")"
      printf 'RUNTIME_TREE_SHA=%s\n' "$(jq -er '.treeSha' "$STATE/auth.json")"
      printf 'RUNTIME_IMAGE_DIGEST=%s\n' "$(jq -er '.digest' "$STATE/auth.json")"
      printf 'RUNTIME_BUILD_RUN_ID=%s\n' "$(jq -er '.buildRun' "$STATE/auth.json")"
      printf 'RUNTIME_BUILD_LEDGER_COMMENT_ID=%s\n' "$(jq -er '.ledgerComment' "$STATE/auth.json")"
      printf 'WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_ENABLED=%s\n' \
        "$(jq -r 'if (.deployEnvironmentRepair.enabled | type) == "boolean" then .deployEnvironmentRepair.enabled | tostring else "NOT_PROVEN" end' "$STATE/auth.json")"
      printf 'PREVIOUS_WEBHOOK_REVISION=%s\nCANDIDATE_REVISION=%s\n' "$PREVIOUS" "$CANDIDATE"
      printf 'STAGE_STATUS=%s\nPROMOTION_STATUS=%s\n' "$(value stage-status)" "$(value promote-status)"
      printf 'CANDIDATE_HEALTH_HTTP_STATUS=%s\nCANDIDATE_READY_HTTP_STATUS=%s\n' "$(value candidate-health-status)" "$(value candidate-ready-status)"
      printf 'PUBLIC_HEALTH_HTTP_STATUS=%s\nPUBLIC_READY_HTTP_STATUS=%s\n' "$(value base-health-status)" "$(value base-ready-status)"
      printf 'CANDIDATE_READY_DIAGNOSTIC_STATUS=%s\nCANDIDATE_FAILED_READINESS_CHECKS=%s\n' \
        "$(value candidate-ready-diagnostic-status)" "$(value candidate-failed-readiness-checks)"
      printf 'PUBLIC_READY_DIAGNOSTIC_STATUS=%s\nPUBLIC_FAILED_READINESS_CHECKS=%s\n' \
        "$(value base-ready-diagnostic-status)" "$(value base-failed-readiness-checks)"
      printf 'RUNTIME_ACCEPTANCE_STATUS=%s\nROLLBACK_STATUS=%s\nOWN_TAG_CLEANUP_STATUS=%s\nFAILURE_CODE=%s\n' \
        "$(value runtime-acceptance-status)" "$(value rollback-status)" "$(value cleanup-status)" "$(value failure-code)"
      printf '%s\n' 'EXACT_SOURCE_AND_TREE_REQUIRED=true' 'DAEMON_MUTATION=false' \
        'DATABASE_MUTATIONS=false' 'IAM_MUTATIONS=false' 'PROVIDER_METHODS=GET_ONLY' \
        'PROVIDER_WRITES=false' 'EXTERNAL_REPLY_WRITES=false' 'NEW_PAID_RESOURCES=false' \
        'GENERAL_AUTONOMY=false' 'RAW_RUNTIME_PAYLOAD_PUBLISHED=false'
    } > "$STATE/sanitized-report.env"
    gh issue comment "$ISSUE" --repo "$REPOSITORY" --body-file "$STATE/sanitized-report.env" \
      > /dev/null 2> "$STATE/command-error" || fail 'REPORT_PUBLICATION_FAILED'
    cat "$STATE/sanitized-report.env" >> "$GITHUB_STEP_SUMMARY"
    ;;
  *) fail 'COMMAND_INVALID' ;;
esac
