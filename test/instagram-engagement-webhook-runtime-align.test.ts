import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const helper = resolve('.github/scripts/instagram-engagement-webhook-runtime-align.sh');
const workflow = readFileSync(
  '.github/workflows/instagram-engagement-webhook-runtime-align.yml',
  'utf8',
);
const builder = readFileSync(
  '.github/workflows/instagram-engagement-shadow-runtime-build.yml',
  'utf8',
);
const sha = '1'.repeat(40);
const tree = '2'.repeat(40);
const previousDigest = 'sha256:' + '3'.repeat(64);
const digest = 'sha256:' + '4'.repeat(64);
const daemonDigest = 'sha256:' + '5'.repeat(64);
const imagePrefix = 'southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/server@';
const serviceName = 'toca-webhook-next-production';
const previous = serviceName + '-old';
const candidateName = serviceName + '-wr123456a1';
const tag = 'wrec-123456-1';
const daemonName = 'toca-managed-instagram-daemon';
const daemonRevisionName = daemonName + '-current';
const repository = 'luizanunciostoca/toca-mcp-server';
const owner = 'luizanunciostoca';
const readinessChecks = [
  'db',
  'migrations',
  'schema',
  'meta',
  'provider_credentials',
  'critical_configuration',
].map((name) => ({ name, ok: true }));
const directories = new Set<string>();

function tempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'webhook-recovery-test-'));
  directories.add(path);
  return path;
}

afterEach(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
  directories.clear();
});

function runCaptured(
  args: string[],
  options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv } = {},
) {
  const root = tempDirectory();
  const stdoutPath = join(root, 'stdout');
  const stderrPath = join(root, 'stderr');
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  try {
    const result = spawnSync('bash', args, {
      ...options,
      stdio: ['ignore', stdout, stderr],
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
    };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function clockEnvironment(now: number): NodeJS.ProcessEnv {
  const path = join(tempDirectory(), 'clock.mjs');
  writeFileSync(path, 'Date.now = () => ' + String(now) + ';\n');
  return { ...process.env, NODE_OPTIONS: '--import=' + pathToFileURL(path).href };
}

function invokeModel(action: string, input: unknown, now?: number) {
  const path = join(tempDirectory(), 'input.json');
  writeFileSync(path, JSON.stringify(input));
  return runCaptured([helper, 'model', action, path], {
    ...(now === undefined ? {} : { env: clockEnvironment(now) }),
  });
}

function model<T>(action: string, input: unknown, now?: number): T {
  const result = invokeModel(action, input, now);
  if (result.status !== 0) throw new Error(result.stderr || 'Model failed');
  return JSON.parse(result.stdout) as T;
}

function rejects(action: string, input: unknown, code: string, now?: number): void {
  const result = invokeModel(action, input, now);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr.trim()).toBe('WEBHOOK_RECOVERY_' + code);
}

interface Metadata {
  name: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  generation?: number;
  creationTimestamp?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

describe('allowlisted readiness diagnostics', () => {
  it.each([
    {
      status: 'not_ready',
      checks: [
        { name: 'db', ok: false },
        { name: 'migrations', ok: true },
      ],
    },
    {
      status: 'not_ready',
      checks: [{ name: 'db', ok: false }],
      private: 'SECRET_CUSTOMER_VALUE',
    },
  ])('retains bounded failure names and discards all other fields', (input) => {
    expect(model('probe-diagnostics', input)).toEqual({
      status: 'OBSERVED_NOT_READY',
      failedChecks: ['db'],
      diagnosticOnly: true,
    });
  });

  it.each([
    null,
    {},
    { status: 'not_ready', checks: [] },
    { status: 'ready', checks: [{ name: 'db', ok: false }] },
    { status: 'not_ready', checks: [{ name: 'db', ok: true }] },
    { status: 'not_ready', checks: [{ name: 'customer_secret', ok: false }] },
    {
      status: 'not_ready',
      checks: [
        { name: 'db', ok: false },
        { name: 'db', ok: false },
      ],
    },
    { status: 'not_ready', checks: [{ name: 'db', ok: 'false' }] },
  ])('never promotes malformed or unknown check bodies into diagnostic evidence', (input) => {
    expect(model('probe-diagnostics', input)).toEqual({
      status: 'NOT_PROVEN',
      failedChecks: [],
      diagnosticOnly: true,
    });
  });

  const logEntry = (textPayload: string, revision = candidateName) => ({
    resource: {
      type: 'cloud_run_revision',
      labels: {
        project_id: 'toca-mcp-production',
        location: 'southamerica-east1',
        service_name: serviceName,
        revision_name: revision,
      },
    },
    textPayload,
  });

  it('reads only exact authorized revision warnings and never returns arbitrary log strings', () => {
    const result = model('log-diagnostics', {
      revision: candidateName,
      logs: [
        logEntry('TOCA_READINESS_NOT_READY failed_checks=migrations,db'),
        logEntry('TOCA_READINESS_NOT_READY failed_checks=outbox'),
        logEntry('TOCA_READINESS_NOT_READY failed_checks=meta', previous),
        logEntry('TOCA_READINESS_NOT_READY failed_checks=customer_secret'),
        logEntry('TOCA_READINESS_NOT_READY failed_checks=db,db'),
        logEntry('TOCA_READINESS_NOT_READY failed_checks=privacy private_customer_value'),
        logEntry('SECRET_CUSTOMER_VALUE'),
      ],
    });
    expect(result).toEqual({
      status: 'OBSERVED_NOT_READY',
      failedChecks: ['db', 'migrations', 'outbox'],
      matchedWarnings: 2,
      diagnosticOnly: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|customer|private/);
  });

  it('does not interpret absent log warnings as readiness success', () => {
    expect(model('log-diagnostics', { revision: candidateName, logs: [] })).toEqual({
      status: 'NOT_PROVEN',
      failedChecks: [],
      matchedWarnings: 0,
      diagnosticOnly: true,
    });
    rejects(
      'log-diagnostics',
      { revision: candidateName, logs: Array(301).fill({}) },
      'READINESS_LOG_INPUT_INVALID',
    );
  });
});

interface Container {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  env?: Array<{ name: string; value?: string; valueFrom?: unknown }>;
  [key: string]: unknown;
}

interface RevisionSpec {
  serviceAccountName: string;
  containers: Container[];
  [key: string]: unknown;
}

interface Template {
  metadata: Pick<Metadata, 'labels' | 'annotations'> & { name?: string };
  spec: RevisionSpec;
}

interface Route {
  revisionName?: string;
  latestRevision?: boolean;
  percent?: number;
  tag?: string;
  url?: string;
}

interface Service {
  apiVersion: string;
  kind: string;
  metadata: Metadata;
  spec: {
    template: Template;
    traffic: Route[];
    [key: string]: unknown;
  };
  status: {
    url: string;
    observedGeneration: number;
    latestCreatedRevisionName: string;
    latestReadyRevisionName: string;
    conditions: Array<{ type: string; status: string }>;
    traffic: Route[];
  };
}

interface Revision {
  metadata: Metadata;
  spec: RevisionSpec;
  status: { conditions: Array<{ type: string; status: string }> };
}

type DeployEnvironmentRepair =
  | { enabled: false }
  | {
      enabled: true;
      key: 'TOCA_DEPLOY_ENVIRONMENT';
      before: 'ABSENT';
      value: 'production';
      issueCreatedAt: string;
      expiresAt: string;
    };

interface Authorization {
  repository: string;
  sourceSha: string;
  treeSha: string;
  digest: string;
  image: string;
  buildRun: string;
  ledgerComment: string;
  issue: number;
  issueBodyHash: string;
  consumedBodyHash: string;
  deployEnvironmentRepair: DeployEnvironmentRepair;
  expectedWebhookRevision: string;
  expectedWebhookDigest: string;
  expectedDaemonRevision: string;
  expectedDaemonDigest: string;
  runId: string;
  runAttempt: string;
  candidate: string;
  tag: string;
  provenanceVerified?: boolean;
}

interface RecoveryState {
  schemaVersion: number;
  auth: Authorization;
  candidate: string;
  tag: string;
  serviceUid: string;
  preRevision: string;
  preRevisionUid: string;
  baseUrl: string;
  preServiceSpec: Service['spec'];
  preRevisionTemplate: Template;
  preTraffic: {
    percentages: Record<string, number>;
    tags: Record<string, string>;
  };
  candidateTemplate: Template;
  candidatePlan?: Record<string, unknown>;
  candidateUid?: string;
  candidateUrl?: string;
  stageVerified?: boolean;
}

interface Transition {
  decision?: string;
  request: Pick<Service, 'apiVersion' | 'kind' | 'metadata' | 'spec'>;
  expectedTraffic?: RecoveryState['preTraffic'];
}

function authorizationInput() {
  const markers = {
    AUTHORIZED_CONTROLLER_SHA: sha,
    AUTHORIZATION_STATE: 'ACTIVE',
    INSTAGRAM_WEBHOOK_RUNTIME_ALIGNMENT: 'AUTHORIZED',
    RUNTIME_SOURCE_SHA: sha,
    RUNTIME_TREE_SHA: tree,
    EXPECTED_WEBHOOK_REVISION: previous,
    EXPECTED_WEBHOOK_IMAGE_DIGEST: previousDigest,
    EXPECTED_DAEMON_REVISION: daemonRevisionName,
    EXPECTED_DAEMON_IMAGE_DIGEST: daemonDigest,
    RUNTIME_IMAGE_DIGEST: digest,
    RUNTIME_BUILD_RUN_ID: '98765',
    RUNTIME_BUILD_LEDGER_COMMENT_ID: '43210',
    SERVICE_MUTATION_AUTHORIZED: 'true',
    WEBHOOK_IMAGE_MUTATION_AUTHORIZED: 'true',
    WEBHOOK_RELEASE_SHA_MUTATION_AUTHORIZED: 'true',
    WEBHOOK_TRAFFIC_MUTATION_AUTHORIZED: 'true',
    WEBHOOK_TEMPORARY_TAG_AUTHORIZED: 'true',
    DAEMON_MUTATION_AUTHORIZED: 'false',
    DATABASE_MUTATIONS_AUTHORIZED: 'false',
    PROVIDER_READS_AUTHORIZED: 'true',
    PROVIDER_METHODS: 'GET_ONLY',
    PROVIDER_WRITES_AUTHORIZED: 'false',
    EXTERNAL_REPLY_WRITES_AUTHORIZED: 'false',
    IAM_MUTATIONS_AUTHORIZED: 'false',
    NEW_PAID_RESOURCES_AUTHORIZED: 'false',
    GENERAL_AUTONOMY_AUTHORIZED: 'false',
    ZERO_TRAFFIC_STAGE_REQUIRED: 'true',
    ZERO_TRAFFIC_HTTP_PROBES_REQUIRED: 'true',
    ROLLBACK_REQUIRED: 'true',
  };
  return {
    repository,
    owner,
    sha,
    tree,
    main: { commit: { sha } },
    checkoutSha: sha,
    runId: '123456',
    runAttempt: '1',
    issue: {
      number: 9999,
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      state: 'open',
      user: { login: owner },
      title: 'PRODUCTION AUTHORIZATION — Instagram webhook runtime alignment AUTO test',
      body: Object.entries(markers)
        .map(([key, value]) => key + '=' + value)
        .join('\n'),
    },
    control: {
      state: 'open',
      user: { login: owner },
      body: [
        'PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION=2',
        'CONTROL_PLANE_ROLE=INTEGRATION_QUEUE_AND_MAIN_STABILITY',
        'MAIN_STABILITY=PASS',
        'EVALUATED_MAIN_SHA=' + sha,
        'MERGE_RESERVATION=NONE',
      ].join('\n'),
    },
  };
}

function receiptInput(auth: Authorization) {
  return {
    auth,
    comment: {
      id: 43210,
      user: { login: 'github-actions[bot]' },
      issue_url: 'https://api.github.com/repos/' + repository + '/issues/641',
      created_at: '2026-10-19T05:01:00Z',
      body: [
        'EVIDENCE_ID=runtime-build:' + tree + ':SERVER_IMAGE_V1',
        'EVIDENCE_TYPE=IMMUTABLE_RUNTIME_BUILD',
        'SOURCE_SHA=' + sha,
        'TREE_SHA=' + tree,
        'RUNTIME_CONTRACT=SERVER_IMAGE_V1',
        'RUNTIME_IMAGE_DIGEST=' + digest,
        'WORKFLOW_RUN_ID=98765',
        'RESULT=PASS',
        'VALIDITY=VALID',
        'DATABASE_MUTATIONS=false',
        'SERVICE_MUTATIONS=false',
        'EXTERNAL_SIDE_EFFECTS=false',
      ].join('\n'),
    },
    run: {
      id: 98765,
      run_attempt: 1,
      repository: { full_name: repository },
      actor: { login: owner },
      path: '.github/workflows/instagram-engagement-shadow-runtime-build.yml',
      event: 'issues',
      head_branch: 'main',
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-10-19T05:00:00Z',
      updated_at: '2026-10-19T05:02:00Z',
    },
    commit: { sha, tree: { sha: tree } },
  };
}

function repairAuthorizationInput(now = Date.now()) {
  const input = authorizationInput();
  input.issue.created_at = new Date(now - 5 * 60_000).toISOString();
  input.issue.body +=
    '\n' +
    [
      'WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZED=true',
      'WEBHOOK_DEPLOY_ENVIRONMENT_PRESTATE=ABSENT',
      'WEBHOOK_DEPLOY_ENVIRONMENT_VALUE=production',
      'WEBHOOK_DEPLOY_ENVIRONMENT_OTHER_CHANGES_AUTHORIZED=false',
      'WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_EXPIRES_AT=' + new Date(now + 5 * 60_000).toISOString(),
    ].join('\n');
  return input;
}

function fixtures(input = authorizationInput()) {
  const auth = model<Authorization>('authorize', input);
  const certified = model<Authorization>('receipt', receiptInput(auth));
  const revision: Revision = {
    metadata: {
      name: previous,
      namespace: '990081828836',
      uid: 'previous-uid',
      creationTimestamp: '2026-10-01T00:00:00Z',
      labels: {
        'serving.knative.dev/service': serviceName,
        'serving.knative.dev/configurationGeneration': '7',
        'cloud.googleapis.com/location': 'southamerica-east1',
        'team.example.com/role': 'webhook',
      },
      annotations: {
        'run.googleapis.com/operation-id': 'old-output-operation',
        'serving.knative.dev/creator': 'deployer@example.invalid',
        'run.googleapis.com/cloudsql-instances':
          'toca-mcp-production:southamerica-east1:toca-mcp-db',
        'run.googleapis.com/secrets':
          'secret-alias:projects/990081828836/secrets/toca-database-url',
        'run.googleapis.com/vpc-access-connector': 'connector-preserved',
        'run.googleapis.com/vpc-access-egress': 'private-ranges-only',
        'run.googleapis.com/execution-environment': 'gen2',
        'autoscaling.knative.dev/maxScale': '3',
        'team.example.com/contract': 'preserved',
      },
    },
    spec: {
      serviceAccountName: 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
      timeoutSeconds: 300,
      containerConcurrency: 80,
      containers: [
        {
          name: 'server',
          image: imagePrefix + previousDigest,
          command: ['node'],
          args: ['dist/src/http-instagram-engagement.js'],
          ports: [{ name: 'http1', containerPort: 8080 }],
          resources: { limits: { cpu: '1000m', memory: '512Mi' } },
          startupProbe: { tcpSocket: { port: 8080 }, periodSeconds: 240 },
          env: [
            { name: 'TOCA_SERVICE_ROLE', value: 'webhook' },
            { name: 'MCP_ENABLED', value: 'false' },
            { name: 'META_WEBHOOK_ENABLED', value: 'true' },
            { name: 'META_WEBHOOK_PERSISTENCE_ENABLED', value: 'true' },
            { name: 'INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED', value: 'true' },
            { name: 'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED', value: 'false' },
            { name: 'INSTAGRAM_PUBLICATION_WRITES_ENABLED', value: 'false' },
            { name: 'TOCA_RELEASE_SHA', value: '6'.repeat(40) },
            {
              name: 'DATABASE_URL',
              valueFrom: {
                secretKeyRef: { name: 'secret-alias', key: 'latest' },
              },
            },
            {
              name: 'META_APP_SECRET',
              valueFrom: {
                secretKeyRef: { name: 'toca-meta-app-secret', key: 'latest' },
              },
            },
            {
              name: 'PRIVATE_TEST_MARKER',
              value: 'DO_NOT_PUBLISH_RUNTIME_VALUE',
            },
          ],
        },
        {
          name: 'observer',
          image: 'example.invalid/observer@' + daemonDigest,
          env: [{ name: 'SIDECAR', value: 'preserved' }],
        },
      ],
      volumes: [
        {
          name: 'mount',
          secret: {
            secretName: 'existing-mount',
            items: [{ key: '1', path: 'value' }],
          },
        },
      ],
    },
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  };
  const failedTemplate: Template = {
    metadata: {
      name: serviceName + '-failed-latest',
      labels: { 'attempt.example.com/wrong': 'true' },
      annotations: {},
    },
    spec: structuredClone(revision.spec),
  };
  failedTemplate.spec.containers[0]!.image = imagePrefix + daemonDigest;
  failedTemplate.spec.containers[0]!.env?.push({
    name: 'FAILED_TEMPLATE_ONLY',
    value: 'must-not-copy',
  });
  const service: Service = {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: {
      name: serviceName,
      namespace: '990081828836',
      uid: 'service-uid',
      resourceVersion: 'opaque/A==',
      generation: 8,
      creationTimestamp: '2026-10-01T00:00:00Z',
      labels: {
        'cloud.googleapis.com/location': 'southamerica-east1',
        'team.example.com/service': 'preserved',
      },
      annotations: {
        'run.googleapis.com/ingress': 'all',
        'run.googleapis.com/default-url-disabled': 'false',
        'run.googleapis.com/invoker-iam-disabled': 'true',
        'run.googleapis.com/operation-id': 'output-only-operation',
        'run.googleapis.com/urls': '["output-only"]',
      },
    },
    spec: {
      template: failedTemplate,
      traffic: [
        { revisionName: previous, percent: 100 },
        { revisionName: previous, percent: 0, tag: 'support' },
      ],
    },
    status: {
      url: 'https://' + serviceName + '-abc.sa-east1.run.app',
      observedGeneration: 8,
      latestCreatedRevisionName: serviceName + '-failed-latest',
      latestReadyRevisionName: previous,
      conditions: [{ type: 'Ready', status: 'False' }],
      traffic: [
        { revisionName: previous, percent: 100 },
        {
          revisionName: previous,
          percent: 0,
          tag: 'support',
          url: 'https://support---' + serviceName + '-abc.sa-east1.run.app',
        },
      ],
    },
  };
  return {
    auth: certified,
    service,
    revision,
    daemon: {
      metadata: { name: daemonName, uid: 'daemon-uid' },
      spec: { preserved: true },
      status: { traffic: [{ revisionName: daemonRevisionName, percent: 100 }] },
    },
    daemonRevision: {
      metadata: {
        name: daemonRevisionName,
        uid: 'daemon-revision-uid',
        labels: { 'serving.knative.dev/service': daemonName },
      },
      spec: { containers: [{ image: imagePrefix + daemonDigest }] },
    },
    iam: {
      version: 3,
      etag: 'opaque-iam',
      bindings: [
        {
          role: 'roles/run.admin',
          members: ['serviceAccount:deployer@example.invalid'],
        },
      ],
    },
    scheduler: {
      name: 'projects/toca-mcp-production/locations/southamerica-east1/jobs/toca-managed-instagram-tick',
      state: 'ENABLED',
      schedule: '*/5 * * * *',
      timeZone: 'UTC',
      httpTarget: {
        uri: 'https://example.invalid/existing',
        httpMethod: 'POST',
        oidcToken: { serviceAccountEmail: 'existing@example.invalid' },
      },
    },
  };
}

function applyRequest(current: Service, transition: Transition, latest: string): Service {
  const next = structuredClone(current);
  next.metadata = {
    ...transition.request.metadata,
    uid: current.metadata.uid!,
    resourceVersion: 'opaque/' + String((current.metadata.generation ?? 0) + 1),
    generation: (current.metadata.generation ?? 0) + 1,
  };
  next.spec = structuredClone(transition.request.spec);
  next.status.observedGeneration = next.metadata.generation!;
  next.status.latestCreatedRevisionName = latest;
  next.status.latestReadyRevisionName = latest;
  next.status.conditions = [{ type: 'Ready', status: 'True' }];
  next.status.traffic = next.spec.traffic.map((route) => {
    const observed = {
      ...route,
      revisionName: route.latestRevision ? latest : route.revisionName!,
    };
    delete observed.latestRevision;
    if (route.tag)
      observed.url = 'https://' + route.tag + '---' + serviceName + '-abc.sa-east1.run.app';
    return observed;
  });
  return next;
}

function stagedFixture(input = fixtures()) {
  const state = model<RecoveryState>('prestate', input);
  const stage = model<Transition>('stage', {
    state,
    auth: input.auth,
    service: input.service,
    previous: input.revision,
  });
  const service = applyRequest(input.service, stage, state.candidate);
  const candidate: Revision = {
    metadata: {
      ...structuredClone(state.candidateTemplate.metadata),
      name: state.candidate,
      uid: 'candidate-uid',
      labels: {
        ...state.candidateTemplate.metadata.labels,
        'serving.knative.dev/service': serviceName,
      },
    },
    spec: structuredClone(state.candidateTemplate.spec),
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  };
  Object.assign(state, model('candidate', { state, auth: input.auth, service, candidate }));
  const probes = model('probe-body', {
    state,
    healthStatus: '200',
    readyStatus: '200',
    health: { status: 'ok' },
    ready: { status: 'ready', checks: readinessChecks },
  });
  return {
    input,
    auth: input.auth,
    previous: input.revision,
    state,
    stage,
    service,
    candidate,
    probes,
  };
}

function promotedFixture(input = fixtures()) {
  const fixture = stagedFixture(input);
  const transition = model<Transition>('promote', fixture);
  fixture.service = applyRequest(fixture.service, transition, fixture.state.candidate);
  return fixture;
}

describe('webhook authorization and exact artifact provenance', () => {
  it('binds a fresh owner authorization to current main, tree and successful build ledger', () => {
    const auth = model<Authorization>('authorize', authorizationInput());
    const certified = model<Authorization>('receipt', receiptInput(auth));
    expect(certified).toMatchObject({
      sourceSha: sha,
      treeSha: tree,
      digest,
      image: imagePrefix + digest,
      candidate: candidateName,
      tag,
      provenanceVerified: true,
    });
    expect(certified.digest).not.toBe(certified.expectedDaemonDigest);
  });

  it.each([
    ['owner', 'OWNER_AUTHORIZATION_INVALID'],
    ['closed', 'OWNER_AUTHORIZATION_INVALID'],
    ['rerun', 'NEW_AUTHORIZATION_REQUIRED_FOR_RERUN'],
    ['main', 'CURRENT_MAIN_MISMATCH'],
    ['tree', 'MARKER_MISMATCH_RUNTIME_TREE_SHA'],
    ['duplicate', 'MARKER_NOT_UNIQUE_PROVIDER_METHODS'],
    ['writes', 'MARKER_MISMATCH_PROVIDER_WRITES_AUTHORIZED'],
    ['reservation', 'MARKER_MISMATCH_MERGE_RESERVATION'],
  ])('rejects invalid authority: %s', (change, code) => {
    const input = authorizationInput();
    if (change === 'owner') input.issue.user.login = 'another-user';
    if (change === 'closed') input.issue.state = 'closed';
    if (change === 'rerun') input.runAttempt = '2';
    if (change === 'main') input.main.commit.sha = 'a'.repeat(40);
    if (change === 'tree') input.tree = 'b'.repeat(40);
    if (change === 'duplicate') input.issue.body += '\nPROVIDER_METHODS=GET_ONLY';
    if (change === 'writes')
      input.issue.body = input.issue.body.replace(
        'PROVIDER_WRITES_AUTHORIZED=false',
        'PROVIDER_WRITES_AUTHORIZED=true',
      );
    if (change === 'reservation')
      input.control.body = input.control.body.replace(
        'MERGE_RESERVATION=NONE',
        'MERGE_RESERVATION=HELD',
      );
    rejects('authorize', input, code);
  });

  it.each([
    'failed',
    'wrong-sha',
    'wrong-tree',
    'wrong-workflow',
    'wrong-ledger',
    'wrong-digest',
    'rerun',
    'outside-run',
  ])('rejects uncertified build receipts: %s', (change) => {
    const auth = model<Authorization>('authorize', authorizationInput());
    const input = receiptInput(auth);
    let code = 'BUILD_RUN_NOT_CERTIFIED';
    if (change === 'failed') input.run.conclusion = 'failure';
    if (change === 'wrong-sha') input.run.head_sha = 'a'.repeat(40);
    if (change === 'wrong-workflow') input.run.path = '.github/workflows/other.yml';
    if (change === 'rerun') input.run.run_attempt = 2;
    if (change === 'wrong-tree') {
      input.commit.tree.sha = 'b'.repeat(40);
      code = 'BUILD_TREE_MISMATCH';
    }
    if (change === 'wrong-ledger') {
      input.comment.issue_url += '-other';
      code = 'BUILD_LEDGER_ORIGIN_INVALID';
    }
    if (change === 'wrong-digest') {
      input.comment.body = input.comment.body.replace(digest, daemonDigest);
      code = 'MARKER_MISMATCH_RUNTIME_IMAGE_DIGEST';
    }
    if (change === 'outside-run') {
      input.comment.created_at = '2026-10-19T04:59:00Z';
      code = 'BUILD_RECEIPT_TIME_MISMATCH';
    }
    rejects('receipt', input, code);
  });

  it('requires exact live consumption and rejects a later changed authorization', () => {
    const input = authorizationInput();
    const auth = model<Authorization>('authorize', input);
    const consumed = model<{ body: string }>('consume', {
      auth,
      issue: input.issue,
    });
    expect(consumed.body).toContain('AUTHORIZATION_STATE=CONSUMED_AND_CLOSED');
    const issue = { ...input.issue, state: 'closed', body: consumed.body };
    expect(model('consumed', { auth, issue, consumed })).toEqual({
      verified: true,
    });
    issue.body += '\nREVOKED=true';
    rejects('consumed', { auth, issue, consumed }, 'AUTHORIZATION_CONSUMPTION_NOT_PROVEN');
    input.issue.body += '\nCHANGED=true';
    rejects('consume', { auth, issue: input.issue }, 'AUTHORIZATION_CHANGED');
  });

  it('consumes CRLF input with an explicit consumed marker before accepting readback', () => {
    const input = authorizationInput();
    input.issue.body = input.issue.body.replaceAll('\n', '\r\n');
    const auth = model<Authorization>('authorize', input);
    const consumed = model<{ body: string }>('consume', {
      auth,
      issue: input.issue,
    });
    const issue = { ...input.issue, state: 'closed', body: consumed.body };
    expect(model('consumed', { auth, issue, consumed })).toEqual({
      verified: true,
    });
    expect(consumed.body).not.toContain('AUTHORIZATION_STATE=ACTIVE');
  });
});

describe('explicit absent-only production environment repair', () => {
  it.each(['absent', 'false'])(
    'keeps opt-in %s restricted to the existing image/release change',
    (mode) => {
      const authorization = authorizationInput();
      if (mode === 'false')
        authorization.issue.body += '\nWEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZED=false';
      const input = fixtures(authorization);
      input.revision.spec.containers[0]!.env!.push({
        name: 'TOCA_DEPLOY_ENVIRONMENT',
        valueFrom: { secretKeyRef: { name: 'existing-environment', key: '1' } },
      });
      const state = model<RecoveryState>('prestate', input);
      const expected = structuredClone(input.revision.spec);
      expected.containers[0]!.image = imagePrefix + digest;
      expected.containers[0]!.env!.find((entry) => entry.name === 'TOCA_RELEASE_SHA')!.value = sha;
      expect(state.auth.deployEnvironmentRepair).toEqual({ enabled: false });
      expect(state.candidateTemplate.spec).toEqual(expected);
    },
  );

  it('adds exactly one production literal from the serving prestate and binds the complete plan to this instance', () => {
    const input = fixtures(repairAuthorizationInput());
    const state = model<RecoveryState>('prestate', input);
    const expected = structuredClone(input.revision.spec);
    expected.containers[0]!.image = imagePrefix + digest;
    expected.containers[0]!.env!.find((entry) => entry.name === 'TOCA_RELEASE_SHA')!.value = sha;
    expected.containers[0]!.env!.push({ name: 'TOCA_DEPLOY_ENVIRONMENT', value: 'production' });
    expect(state.candidateTemplate.spec).toEqual(expected);
    expect(state.candidateTemplate.metadata).toEqual(state.preRevisionTemplate.metadata);
    expect(state.candidatePlan).toMatchObject({
      schemaVersion: 1,
      serviceUid: 'service-uid',
      preRevision: previous,
      preRevisionUid: 'previous-uid',
      candidate: candidateName,
      tag,
      deployEnvironmentRepair: input.auth.deployEnvironmentRepair,
    });
    expect(state.candidatePlan!.candidateTemplateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(input.revision.spec.containers[0]!.env).not.toContainEqual({
      name: 'TOCA_DEPLOY_ENVIRONMENT',
      value: 'production',
    });
    expect(readFileSync('.github/workflows/deploy-gcp.yml', 'utf8')).toContain(
      '"TOCA_DEPLOY_ENVIRONMENT=${{ inputs.environment }}"',
    );
  });

  it.each([
    ['no-opt-in', 'DEPLOY_ENVIRONMENT_REPAIR_OPT_IN_REQUIRED'],
    ['false-opt-in', 'DEPLOY_ENVIRONMENT_REPAIR_OPT_IN_REQUIRED'],
    ['invalid-opt-in', 'DEPLOY_ENVIRONMENT_REPAIR_OPT_IN_INVALID'],
    ['duplicate-opt-in', 'MARKER_NOT_UNIQUE_WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZED'],
    ['duplicate-value', 'MARKER_NOT_UNIQUE_WEBHOOK_DEPLOY_ENVIRONMENT_VALUE'],
    ['no-prestate', 'MARKER_NOT_UNIQUE_WEBHOOK_DEPLOY_ENVIRONMENT_PRESTATE'],
    ['existing-prestate', 'MARKER_MISMATCH_WEBHOOK_DEPLOY_ENVIRONMENT_PRESTATE'],
    ['other-value', 'MARKER_MISMATCH_WEBHOOK_DEPLOY_ENVIRONMENT_VALUE'],
    ['other-changes', 'MARKER_MISMATCH_WEBHOOK_DEPLOY_ENVIRONMENT_OTHER_CHANGES_AUTHORIZED'],
    ['no-deadline', 'MARKER_NOT_UNIQUE_WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_EXPIRES_AT'],
    ['unknown-key', 'DEPLOY_ENVIRONMENT_REPAIR_UNKNOWN_MARKER'],
    ['spaced-marker', 'DEPLOY_ENVIRONMENT_REPAIR_UNKNOWN_MARKER'],
    ['indented-marker', 'DEPLOY_ENVIRONMENT_REPAIR_UNKNOWN_MARKER'],
  ])('rejects incomplete or ambiguous live opt-in: %s', (change, code) => {
    const input = repairAuthorizationInput();
    const remove = (key: string) => {
      input.issue.body = input.issue.body
        .split('\n')
        .filter((line) => !line.startsWith(key + '='))
        .join('\n');
    };
    if (change === 'no-opt-in') remove('WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZED');
    if (change === 'false-opt-in')
      input.issue.body = input.issue.body.replace(
        'REPAIR_AUTHORIZED=true',
        'REPAIR_AUTHORIZED=false',
      );
    if (change === 'invalid-opt-in')
      input.issue.body = input.issue.body.replace(
        'REPAIR_AUTHORIZED=true',
        'REPAIR_AUTHORIZED=TRUE',
      );
    if (change === 'duplicate-opt-in')
      input.issue.body += '\nWEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZED=true';
    if (change === 'duplicate-value')
      input.issue.body += '\nWEBHOOK_DEPLOY_ENVIRONMENT_VALUE=production';
    if (change === 'no-prestate') remove('WEBHOOK_DEPLOY_ENVIRONMENT_PRESTATE');
    if (change === 'existing-prestate')
      input.issue.body = input.issue.body.replace('PRESTATE=ABSENT', 'PRESTATE=production');
    if (change === 'other-value')
      input.issue.body = input.issue.body.replace('VALUE=production', 'VALUE=staging');
    if (change === 'other-changes')
      input.issue.body = input.issue.body.replace(
        'OTHER_CHANGES_AUTHORIZED=false',
        'OTHER_CHANGES_AUTHORIZED=true',
      );
    if (change === 'no-deadline') remove('WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_EXPIRES_AT');
    if (change === 'unknown-key')
      input.issue.body += '\nWEBHOOK_DEPLOY_ENVIRONMENT_ANY_ENV_ALLOWED=true';
    if (change === 'spaced-marker')
      input.issue.body = input.issue.body.replace(
        'REPAIR_AUTHORIZED=true',
        'REPAIR_AUTHORIZED =true',
      );
    if (change === 'indented-marker')
      input.issue.body = input.issue.body.replace(
        '\nWEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZED=',
        '\n WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_AUTHORIZED=',
      );
    rejects('authorize', input, code);
  });

  it.each([
    ['expired', 'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED'],
    ['over-one-hour', 'DEPLOY_ENVIRONMENT_REPAIR_WINDOW_INVALID'],
    ['before-creation', 'DEPLOY_ENVIRONMENT_REPAIR_WINDOW_INVALID'],
    ['future-creation', 'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED'],
    ['missing-creation', 'DEPLOY_ENVIRONMENT_REPAIR_TIME_INVALID'],
    ['invalid-date', 'DEPLOY_ENVIRONMENT_REPAIR_TIME_INVALID'],
    ['offset-time', 'DEPLOY_ENVIRONMENT_REPAIR_TIME_INVALID'],
  ])(
    'requires an unambiguous UTC deadline within one hour of issue creation: %s',
    (change, code) => {
      const now = Date.now();
      const input = repairAuthorizationInput(now);
      let deadline = new Date(now + 5 * 60_000).toISOString();
      if (change === 'expired') deadline = new Date(now - 1_000).toISOString();
      if (change === 'over-one-hour') deadline = new Date(now + 60 * 60_000).toISOString();
      if (change === 'before-creation') deadline = new Date(now - 6 * 60_000).toISOString();
      if (change === 'future-creation')
        input.issue.created_at = new Date(now + 60_000).toISOString();
      if (change === 'missing-creation')
        delete (input.issue as Partial<typeof input.issue>).created_at;
      if (change === 'invalid-date') deadline = '2026-02-30T00:00:00Z';
      if (change === 'offset-time') deadline = '2026-10-19T21:00:00-03:00';
      input.issue.body = input.issue.body.replace(
        /WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_EXPIRES_AT=.*/,
        'WEBHOOK_DEPLOY_ENVIRONMENT_REPAIR_EXPIRES_AT=' + deadline,
      );
      rejects('authorize', input, code, now);
    },
  );

  it('binds consumed live markers and issue creation time to both authorization hashes, including CRLF', () => {
    const input = repairAuthorizationInput();
    input.issue.body = input.issue.body.replaceAll('\n', '\r\n');
    const auth = model<Authorization>('authorize', input);
    const consumed = model<{ body: string }>('consume', { auth, issue: input.issue });
    const issue = { ...input.issue, state: 'closed', body: consumed.body };
    expect(model('consumed', { auth, issue, consumed })).toEqual({ verified: true });
    const changedAuth = { ...auth, deployEnvironmentRepair: { enabled: false } };
    rejects(
      'consumed',
      { auth: changedAuth, issue, consumed },
      'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED',
    );
    issue.created_at = new Date(Date.parse(issue.created_at) - 1_000).toISOString();
    rejects('consumed', { auth, issue, consumed }, 'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED');
    const changed = { body: consumed.body.replace('VALUE=production', 'VALUE=staging') };
    rejects(
      'consumed',
      { auth, issue: { ...issue, body: changed.body }, consumed: changed },
      'AUTHORIZATION_CONSUMPTION_NOT_PROVEN',
    );
  });

  it.each(['production', 'staging', 'empty', 'secret', 'duplicate', 'sidecar', 'service-template'])(
    'rejects an existing or ambiguous environment prestate: %s',
    (change) => {
      const input = fixtures(repairAuthorizationInput());
      const container =
        change === 'service-template'
          ? input.service.spec.template.spec.containers[0]!
          : input.revision.spec.containers[change === 'sidecar' ? 1 : 0]!;
      const entry =
        change === 'secret'
          ? {
              name: 'TOCA_DEPLOY_ENVIRONMENT',
              valueFrom: { secretKeyRef: { name: 'existing', key: '1' } },
            }
          : { name: 'TOCA_DEPLOY_ENVIRONMENT', value: change === 'empty' ? '' : change };
      container.env!.push(entry);
      if (change === 'duplicate') container.env!.push(structuredClone(entry));
      rejects(
        'prestate',
        input,
        change === 'duplicate' ? 'ENV_NAME_DUPLICATE' : 'DEPLOY_ENVIRONMENT_PRESTATE_NOT_ABSENT',
      );
    },
  );

  it.each(['stage', 'candidate', 'promote', 'promoted', 'accepted'])(
    'rejects an omitted plan before %s can use a candidate',
    (action) => {
      const fixture = stagedFixture(fixtures(repairAuthorizationInput()));
      delete fixture.state.candidatePlan;
      rejects(action, fixture, 'CANDIDATE_PLAN_REQUIRED');
    },
  );

  it.each(['plan', 'prestate', 'candidate', 'instance', 'auth', 'missing-auth'])(
    'reconstructs the candidate and rejects drift in %s',
    (change) => {
      const fixture = stagedFixture(fixtures(repairAuthorizationInput()));
      let code = 'CANDIDATE_PLAN_CHANGED';
      if (change === 'plan') fixture.state.candidatePlan!.candidateTemplateHash = '0'.repeat(64);
      if (change === 'prestate')
        fixture.state.preRevisionTemplate.spec.containers[1]!.env![0]!.value = 'changed';
      if (change === 'candidate') {
        fixture.state.candidateTemplate.spec.containers[0]!.env!.push({
          name: 'EXTRA_WRITE',
          value: 'true',
        });
        code = 'CANDIDATE_CONFIGURATION_CHANGED';
      }
      if (change === 'instance') {
        fixture.state.tag = 'another-instance';
        code = 'CANDIDATE_INSTANCE_CHANGED';
      }
      if (change === 'auth') {
        fixture.auth = { ...fixture.auth, runId: '999999' };
        code = 'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED';
      }
      if (change === 'missing-auth') {
        delete (fixture as Partial<typeof fixture>).auth;
        code = 'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED';
      }
      rejects('candidate', fixture, code);
    },
  );

  it.each(['uid', 'config'])(
    'checks the actual previous revision again before stage and promotion: %s',
    (change) => {
      const fixture = stagedFixture(fixtures(repairAuthorizationInput()));
      if (change === 'uid') fixture.previous.metadata.uid = 'recreated-revision';
      else fixture.previous.spec.containers[1]!.env![0]!.value = 'changed';
      rejects(
        'stage',
        { ...fixture, service: fixture.input.service },
        'DEPLOY_ENVIRONMENT_PRESTATE_CHANGED',
      );
      rejects('promote', fixture, 'DEPLOY_ENVIRONMENT_PRESTATE_CHANGED');
    },
  );

  it.each(['stage', 'promote'])(
    'validates the exact request immediately before the %s PUT',
    (phase) => {
      const fixture = stagedFixture(fixtures(repairAuthorizationInput()));
      const transition = phase === 'stage' ? fixture.stage : model<Transition>('promote', fixture);
      const input = { state: fixture.state, auth: fixture.auth, request: transition.request };
      expect(model(phase + '-write-gate', input)).toEqual({ verified: true });
      const extraEnv = structuredClone(input);
      extraEnv.request.spec.template.spec.containers[0]!.env!.push({
        name: 'EXTRA_ENV',
        value: 'not-authorized',
      });
      rejects(phase + '-write-gate', extraEnv, 'FORWARD_REQUEST_PLAN_CHANGED');
      const secret = structuredClone(input);
      secret.request.spec.template.spec.containers[0]!.env!.find(
        (entry) => entry.name === 'DATABASE_URL',
      )!.valueFrom = { secretKeyRef: { name: 'changed-secret', key: '1' } };
      rejects(phase + '-write-gate', secret, 'FORWARD_REQUEST_PLAN_CHANGED');
      const sidecar = structuredClone(input);
      sidecar.request.spec.template.spec.containers[1]!.image = 'changed-sidecar';
      rejects(phase + '-write-gate', sidecar, 'FORWARD_REQUEST_PLAN_CHANGED');
      const traffic = structuredClone(input);
      traffic.request.spec.traffic[0] = { latestRevision: true, percent: 100 };
      rejects(phase + '-write-gate', traffic, 'FORWARD_REQUEST_TRAFFIC_CHANGED');
    },
  );

  it('does not allow a default-off request to smuggle in the environment repair', () => {
    const fixture = stagedFixture();
    fixture.stage.request.spec.template.spec.containers[0]!.env!.push({
      name: 'TOCA_DEPLOY_ENVIRONMENT',
      value: 'production',
    });
    rejects(
      'stage-write-gate',
      { state: fixture.state, auth: fixture.auth, request: fixture.stage.request },
      'FORWARD_REQUEST_PLAN_CHANGED',
    );
  });

  it('rejects a saved authorization downgrade against the independent live authorization context', () => {
    const fixture = stagedFixture(fixtures(repairAuthorizationInput()));
    fixture.state.auth.deployEnvironmentRepair = { enabled: false };
    rejects(
      'stage',
      { ...fixture, service: fixture.input.service },
      'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED',
    );
    rejects('promote', fixture, 'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED');
    rejects(
      'stage-write-gate',
      { ...fixture, request: fixture.stage.request },
      'DEPLOY_ENVIRONMENT_AUTH_CONTEXT_CHANGED',
    );
  });

  it('rejects a changed current service prestate before an opted-in stage', () => {
    const fixture = stagedFixture(fixtures(repairAuthorizationInput()));
    fixture.input.service.spec.template.spec.containers[0]!.env!.push({
      name: 'TOCA_DEPLOY_ENVIRONMENT',
      value: 'staging',
    });
    rejects('stage', { ...fixture, service: fixture.input.service }, 'PRESTATE_CHANGED');
  });

  it('expires every forward mutation gate while allowing factual readback after expiry', () => {
    const authorization = repairAuthorizationInput();
    const fixture = stagedFixture(fixtures(authorization));
    if (!fixture.auth.deployEnvironmentRepair.enabled) throw new Error('Repair expected');
    const expires = Date.parse(fixture.auth.deployEnvironmentRepair.expiresAt);
    const transition = model<Transition>('promote', fixture);
    const promoted = {
      ...fixture,
      service: applyRequest(fixture.service, transition, candidateName),
    };
    const consumed = model<{ body: string }>('consume', {
      auth: fixture.auth,
      issue: authorization.issue,
    });
    const closed = { ...authorization.issue, state: 'closed', body: consumed.body };
    rejects('authorize', authorization, 'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED', expires);
    rejects('prestate', fixture.input, 'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED', expires);
    rejects(
      'consume',
      { auth: fixture.auth, issue: authorization.issue },
      'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED',
      expires,
    );
    rejects(
      'consumed',
      { auth: fixture.auth, issue: closed, consumed },
      'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED',
      expires,
    );
    rejects(
      'stage',
      { ...fixture, service: fixture.input.service },
      'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED',
      expires,
    );
    rejects('promote', fixture, 'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED', expires);
    rejects(
      'stage-write-gate',
      { ...fixture, request: fixture.stage.request },
      'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED',
      expires,
    );
    rejects(
      'promote-write-gate',
      { ...fixture, request: transition.request },
      'DEPLOY_ENVIRONMENT_REPAIR_EXPIRED',
      expires,
    );
    expect(model('candidate', fixture, expires)).toMatchObject({ stageVerified: true });
    expect(model('promoted', promoted, expires)).toEqual({ promoted: true });
    const cleanup = model<Transition>('cleanup', promoted, expires);
    promoted.service = applyRequest(promoted.service, cleanup, candidateName);
    expect(model('accepted', promoted, expires)).toEqual({ accepted: true });
  });
});

describe('serving revision clone and zero traffic gates', () => {
  it('clones the actual serving spec, changing only the image and release SHA', () => {
    const input = fixtures();
    const state = model<RecoveryState>('prestate', input);
    const expected = structuredClone(input.revision.spec);
    expected.containers[0]!.image = imagePrefix + digest;
    expected.containers[0]!.env!.find((entry) => entry.name === 'TOCA_RELEASE_SHA')!.value = sha;
    expect(state.candidateTemplate.spec).toEqual(expected);
    expect(state.candidateTemplate.spec).not.toEqual(input.service.spec.template.spec);
    expect(state.candidateTemplate.metadata.labels).toEqual({
      'team.example.com/role': 'webhook',
    });
    expect(state.candidateTemplate.metadata.annotations).toEqual({
      'run.googleapis.com/cloudsql-instances':
        input.revision.metadata.annotations['run.googleapis.com/cloudsql-instances'],
      'run.googleapis.com/secrets':
        input.revision.metadata.annotations['run.googleapis.com/secrets'],
      'run.googleapis.com/vpc-access-connector': 'connector-preserved',
      'run.googleapis.com/vpc-access-egress': 'private-ranges-only',
      'run.googleapis.com/execution-environment': 'gen2',
      'autoscaling.knative.dev/maxScale': '3',
      'team.example.com/contract': 'preserved',
    });
  });

  it('uses the fresh opaque resourceVersion and strips output-only fields from the PUT', () => {
    const input = fixtures();
    const state = model<RecoveryState>('prestate', input);
    input.service.metadata.resourceVersion = 'fresh/opaque+/==';
    const transition = model<Transition>('stage', {
      state,
      service: input.service,
    });
    expect(transition.request.metadata.resourceVersion).toBe('fresh/opaque+/==');
    expect(transition.request.metadata).not.toHaveProperty('uid');
    expect(transition.request.metadata).not.toHaveProperty('generation');
    expect(transition.request.metadata).not.toHaveProperty('creationTimestamp');
    expect(transition.request.metadata.annotations).not.toHaveProperty(
      'run.googleapis.com/operation-id',
    );
    expect(transition.request).not.toHaveProperty('status');
    expect(transition.request.spec.traffic).toEqual([
      { revisionName: previous, percent: 100 },
      { revisionName: previous, percent: 0, tag: 'support' },
      { revisionName: candidateName, percent: 0, tag },
    ]);
  });

  it('pins an untagged latest target to the old revision before candidate creation', () => {
    const input = fixtures();
    input.service.spec.traffic[0] = { latestRevision: true, percent: 100 };
    const state = model<RecoveryState>('prestate', input);
    const transition = model<Transition>('stage', {
      state,
      service: input.service,
    });
    expect(transition.request.spec.traffic[0]).toEqual({
      revisionName: previous,
      percent: 100,
    });
    expect(transition.request.spec.traffic.every((route) => !route.latestRevision)).toBe(true);
    input.service.spec.traffic[1] = {
      latestRevision: true,
      percent: 0,
      tag: 'support',
    };
    rejects('prestate', input, 'THIRD_PARTY_DYNAMIC_TAG');
  });

  it('aggregates same-revision percentages and preserves the combined tag target', () => {
    const input = fixtures();
    input.service.spec.traffic = [{ revisionName: previous, percent: 100, tag: 'support' }];
    input.service.status.traffic = structuredClone(input.service.spec.traffic);
    const state = model<RecoveryState>('prestate', input);
    expect(state.preTraffic).toEqual({
      percentages: { [previous]: 100 },
      tags: { support: previous },
    });
  });

  it.each([
    'stale-generation',
    'pending',
    'split',
    'wrong-image',
    'duplicate-env',
    'unknown-annotation',
    'writer',
  ])('rejects unsafe prestates: %s', (change) => {
    const input = fixtures();
    let code = 'SERVICE_NOT_RECONCILED';
    if (change === 'stale-generation') input.service.status.observedGeneration--;
    if (change === 'pending')
      input.service.status.conditions = [{ type: 'Ready', status: 'Unknown' }];
    if (change === 'split') {
      input.service.spec.traffic = [
        { revisionName: previous, percent: 99 },
        { revisionName: serviceName + '-other', percent: 1 },
      ];
      input.service.status.traffic = structuredClone(input.service.spec.traffic);
      code = 'TRAFFIC_NOT_SINGLE_100';
    }
    if (change === 'wrong-image') {
      input.revision.spec.containers[0]!.image = imagePrefix + daemonDigest;
      code = 'REVISION_IMAGE_MISMATCH';
    }
    if (change === 'duplicate-env') {
      input.revision.spec.containers[0]!.env!.push({
        name: 'MCP_ENABLED',
        value: 'true',
      });
      code = 'ENV_NAME_DUPLICATE';
    }
    if (change === 'unknown-annotation') {
      input.revision.metadata.annotations['run.googleapis.com/unknown-future-option'] = 'yes';
      code = 'UNKNOWN_RESERVED_ANNOTATION';
    }
    if (change === 'writer') {
      input.revision.spec.containers[0]!.env!.find(
        (entry) => entry.name === 'INSTAGRAM_ENGAGEMENT_WRITES_ENABLED',
      )!.value = 'true';
      code = 'WEBHOOK_WRITES_ENABLED';
    }
    rejects('prestate', input, code);
  });

  it('rejects service, IAM, daemon or scheduler drift without producing a request', () => {
    const input = fixtures();
    const state = model<RecoveryState>('prestate', input);
    const service = structuredClone(input.service);
    service.metadata.uid = 'replacement-service-uid';
    rejects('stage', { state, service }, 'SERVICE_UID_CHANGED');
    service.metadata.uid = input.service.metadata.uid!;
    service.spec.template.spec.timeoutSeconds = 301;
    rejects('stage', { state, service }, 'PRESTATE_CHANGED');
    for (const key of ['iam', 'daemon', 'scheduler'] as const) {
      const changed = structuredClone(input);
      if (key === 'iam') changed.iam.etag = 'changed';
      if (key === 'daemon') changed.daemon.spec.preserved = false;
      if (key === 'scheduler') changed.scheduler.schedule = '* * * * *';
      rejects('auxiliary', { ...changed, state }, 'AUXILIARY_CONFIGURATION_CHANGED');
    }
  });

  it('requires reconciled candidate identity and real fresh HTTP proof before promotion', () => {
    const fixture = stagedFixture();
    const promoted = model<Transition>('promote', fixture);
    expect(promoted.request.spec.traffic[0]).toEqual({
      revisionName: candidateName,
      percent: 100,
    });
    expect(promoted.request.metadata.resourceVersion).toBe(
      fixture.service.metadata.resourceVersion,
    );
    const stale = {
      ...fixture,
      probes: {
        ...(fixture.probes as object),
        checkedAt: '2000-01-01T00:00:00Z',
      },
    };
    rejects('promote', stale, 'CANDIDATE_HTTP_PROOF_REQUIRED');
    fixture.candidate.metadata.uid = 'foreign-revision';
    rejects('promote', fixture, 'CANDIDATE_UID_CHANGED');
  });

  it('does not promote after another tag or traffic writer changes the staged state', () => {
    const fixture = stagedFixture();
    fixture.service.spec.traffic.push({
      revisionName: previous,
      percent: 0,
      tag: 'new-support',
    });
    fixture.service.status.traffic.push({
      revisionName: previous,
      percent: 0,
      tag: 'new-support',
    });
    rejects('promote', fixture, 'PRE_PROMOTION_TRAFFIC_CHANGED');
  });

  it.each([
    ['500', '200', { status: 'ready', checks: [] }, 'HTTP_PROBE_NON200'],
    ['200', '503', { status: 'not_ready', checks: [] }, 'HTTP_PROBE_NON200'],
    ['302', '200', { status: 'ready', checks: [] }, 'HTTP_PROBE_NON200'],
    [
      '200',
      '200',
      { status: 'ready', checks: [{ name: 'database', ok: false }] },
      'HTTP_PROBE_BODY_INVALID',
    ],
  ])('rejects unhealthy candidate proof (%s/%s)', (healthStatus, readyStatus, ready, code) => {
    rejects(
      'probe-body',
      {
        state: { candidate: candidateName },
        healthStatus,
        readyStatus,
        health: { status: 'ok' },
        ready,
      },
      String(code),
    );
  });

  it('requires database, schema and provider readiness checks rather than an empty ready body', () => {
    const input = {
      state: {},
      healthStatus: '200',
      readyStatus: '200',
      health: { status: 'ok' },
      ready: {
        status: 'ready',
        checks: [] as Array<{ name: string; ok: boolean }>,
      },
    };
    rejects('probe-body', input, 'HTTP_PROBE_BODY_INVALID');
    input.ready.checks = readinessChecks.filter((entry) => entry.name !== 'migrations');
    rejects('probe-body', input, 'HTTP_PROBE_BODY_INVALID');
  });
});

describe('ownership-aware compensation and final acceptance', () => {
  it.each(['False', 'Unknown'])('restores its own unhealthy candidate with Ready=%s', (status) => {
    const fixture = promotedFixture();
    fixture.candidate.status.conditions = [{ type: 'Ready', status }];
    fixture.service.status.conditions = [{ type: 'Ready', status: 'False' }];
    const rollback = model<Transition>('rollback', {
      ...fixture,
      previous: fixture.input.revision,
    });
    expect(rollback.decision).toBe('RESTORE_OWN_CANDIDATE');
    expect(rollback.request.metadata.resourceVersion).toBe(
      fixture.service.metadata.resourceVersion,
    );
    expect(rollback.expectedTraffic).toMatchObject({
      percentages: { [previous]: 100 },
    });
    expect(rollback.request.spec.template).toEqual(fixture.service.spec.template);
  });

  it.each(['False', 'Unknown'])(
    'denies rollback to an unhealthy previous revision with Ready=%s',
    (status) => {
      const fixture = promotedFixture();
      fixture.input.revision.status.conditions = [{ type: 'Ready', status }];
      rejects('rollback', { ...fixture, previous: fixture.input.revision }, 'REVISION_NOT_READY');
    },
  );

  it.each(['candidate', 'promote', 'promoted', 'accepted'])(
    'keeps an unhealthy candidate ineligible for %s',
    (action) => {
      const fixture = promotedFixture();
      fixture.candidate.status.conditions = [{ type: 'Ready', status: 'False' }];
      rejects(action, fixture, 'REVISION_NOT_READY');
    },
  );

  it('restores only its own 100% candidate, retaining current third-party tags', () => {
    const fixture = promotedFixture();
    fixture.service.spec.traffic.push({
      revisionName: previous,
      percent: 0,
      tag: 'added-later',
    });
    fixture.service.status.traffic.push({
      revisionName: previous,
      percent: 0,
      tag: 'added-later',
    });
    fixture.service.metadata.resourceVersion = 'fresh-rollback-version';
    const rollback = model<Transition>('rollback', {
      ...fixture,
      previous: fixture.input.revision,
    });
    expect(rollback.decision).toBe('RESTORE_OWN_CANDIDATE');
    expect(rollback.request.metadata.resourceVersion).toBe('fresh-rollback-version');
    expect(rollback.request.spec.template).toEqual(fixture.service.spec.template);
    expect(rollback.expectedTraffic).toMatchObject({
      percentages: { [previous]: 100 },
      tags: { 'added-later': previous, [tag]: candidateName },
    });
  });

  it('performs no traffic write when already restored or superseded', () => {
    const fixture = stagedFixture();
    expect(model('rollback', { state: fixture.state, service: fixture.service })).toEqual({
      decision: 'NOOP_ALREADY_RESTORED',
    });
    fixture.service.spec.traffic[0] = {
      revisionName: serviceName + '-other-owner',
      percent: 100,
    };
    fixture.service.status.traffic[0] = {
      revisionName: serviceName + '-other-owner',
      percent: 100,
    };
    expect(model('rollback', { state: fixture.state, service: fixture.service })).toEqual({
      decision: 'NOOP_SUPERSEDED',
    });
  });

  it.each(['split', 'service-uid', 'candidate-uid', 'previous-uid', 'template'])(
    'refuses rollback for conflicting identity or configuration: %s',
    (change) => {
      const fixture = promotedFixture();
      let code = 'TRAFFIC_NOT_SINGLE_100';
      if (change === 'split') {
        fixture.service.spec.traffic[0]!.percent = 99;
        fixture.service.spec.traffic.push({
          revisionName: previous,
          percent: 1,
        });
        fixture.service.status.traffic = structuredClone(fixture.service.spec.traffic);
      }
      if (change === 'service-uid') {
        fixture.service.metadata.uid = 'other-service';
        code = 'SERVICE_UID_CHANGED';
      }
      if (change === 'candidate-uid') {
        fixture.candidate.metadata.uid = 'other-candidate';
        code = 'ROLLBACK_CONTEXT_INCOMPLETE';
      }
      if (change === 'previous-uid') {
        fixture.input.revision.metadata.uid = 'other-previous';
        code = 'PREVIOUS_REVISION_UID_CHANGED';
      }
      if (change === 'template') {
        fixture.service.spec.template.spec.timeoutSeconds = 301;
        code = 'ROLLBACK_CANDIDATE_CHANGED';
      }
      rejects('rollback', { ...fixture, previous: fixture.input.revision }, code);
    },
  );

  it('removes only its tag, including a combined 100% entry, preserving all percentages', () => {
    const fixture = promotedFixture();
    fixture.service.spec.traffic = [
      { revisionName: candidateName, percent: 100, tag },
      { revisionName: previous, percent: 0, tag: 'support' },
    ];
    fixture.service.status.traffic = structuredClone(fixture.service.spec.traffic);
    const cleanup = model<Transition>('cleanup', fixture);
    expect(cleanup.request.spec.traffic).toEqual([
      { revisionName: candidateName, percent: 100 },
      { revisionName: previous, percent: 0, tag: 'support' },
    ]);
    expect(cleanup.request.spec.template).toEqual(fixture.service.spec.template);
    const cleaned = applyRequest(fixture.service, cleanup, candidateName);
    expect(
      model('transition-readback', {
        state: fixture.state,
        service: cleaned,
        transition: cleanup,
      }),
    ).toEqual({ verified: true });
    expect(model('accepted', { ...fixture, service: cleaned })).toEqual({
      accepted: true,
    });
  });

  it('will not remove a reassigned tag or certify a different final serving revision', () => {
    const fixture = promotedFixture();
    const own = fixture.service.spec.traffic.find((route) => route.tag === tag)!;
    own.revisionName = previous;
    fixture.service.status.traffic = structuredClone(fixture.service.spec.traffic);
    rejects('cleanup', fixture, 'OWN_TAG_REASSIGNED');
    fixture.service.spec.traffic = [
      { revisionName: previous, percent: 100 },
      { revisionName: previous, percent: 0, tag: 'support' },
    ];
    fixture.service.status.traffic = structuredClone(fixture.service.spec.traffic);
    expect(model('cleanup', fixture)).toEqual({ decision: 'NOOP_TAG_ABSENT' });
    rejects('accepted', fixture, 'FINAL_ACCEPTANCE_NOT_PROVEN');
  });
});

function runtimeHarness(
  service: Service,
  state: RecoveryState,
  candidate?: Revision,
  previousRevision?: Revision,
) {
  const root = tempDirectory();
  const bin = join(root, 'bin');
  const runner = join(root, 'runner');
  const statePath = join(runner, 'webhook-runtime-align-123456-1');
  mkdirSync(bin);
  mkdirSync(statePath, { recursive: true });
  writeFileSync(join(statePath, 'auth.json'), JSON.stringify(state.auth));
  writeFileSync(join(statePath, 'state.json'), JSON.stringify(state));
  writeFileSync(join(root, 'service.json'), JSON.stringify(service));
  writeFileSync(join(root, 'candidate.json'), JSON.stringify(candidate ?? {}));
  writeFileSync(join(root, 'previous.json'), JSON.stringify(previousRevision ?? {}));
  const executable = (name: string, source: string) => {
    const path = join(bin, name);
    writeFileSync(path, '#!' + process.execPath + '\n' + source);
    chmodSync(path, 0o700);
  };
  executable(
    'gcloud',
    String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.MOCK_ROOT;
if (args.join(' ') === 'auth print-access-token') {
  process.stdout.write('FAKE_TOKEN_MUST_STAY_PRIVATE');
} else if (args.slice(0, 3).join(' ') === 'run services describe') {
  process.stdout.write(fs.readFileSync(path.join(root, 'service.json')));
} else if (args.slice(0, 3).join(' ') === 'run revisions describe') {
  process.stdout.write(fs.readFileSync(path.join(root, args[3].endsWith('-old') ? 'previous.json' : 'candidate.json')));
} else {
  process.stderr.write('UNEXPECTED_MOCK_GCLOUD');
  process.exit(65);
}
`,
  );
  executable(
    'curl',
    String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.MOCK_ROOT;
const output = args[args.indexOf('--output') + 1];
const method = args.includes('--request') ? args[args.indexOf('--request') + 1] : 'GET';
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({ method, url: args.at(-1) }) + '\n');
if (method === 'PUT') {
  const requestFile = args[args.indexOf('--data-binary') + 1].slice(1);
  const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  fs.writeFileSync(path.join(root, 'put-request.json'), JSON.stringify(request));
  fs.writeFileSync(output, '{"private":"DO_NOT_PUBLISH_PROVIDER_VALUE"}');
  if (process.env.MOCK_MODE === 'conflict') {
    process.stdout.write('409');
    process.exit(0);
  }
  if (process.env.MOCK_MODE !== 'unknown') {
    const current = JSON.parse(fs.readFileSync(path.join(root, 'service.json'), 'utf8'));
    if (request.metadata.resourceVersion !== current.metadata.resourceVersion) process.exit(67);
    current.metadata = { ...request.metadata, uid: current.metadata.uid,
      resourceVersion: 'after-cas', generation: current.metadata.generation + 1 };
    current.spec = request.spec;
    current.status.observedGeneration = current.metadata.generation;
    current.status.traffic = request.spec.traffic.map((entry) => ({ ...entry }));
    fs.writeFileSync(path.join(root, 'service.json'), JSON.stringify(current));
  }
  process.stdout.write(process.env.MOCK_MODE === 'success' ? '200' : '000');
  process.exit(process.env.MOCK_MODE === 'success' ? 0 : 28);
}
if (method !== 'GET') process.exit(66);
const health = args.at(-1).endsWith('/health');
const status = health ? (process.env.MOCK_HEALTH || '200') : (process.env.MOCK_READY || '200');
fs.writeFileSync(output, !health && process.env.MOCK_READY_BODY ? process.env.MOCK_READY_BODY : status === '200' ? JSON.stringify(health ? { status: 'ok' } :
  { status: 'ready', checks: ['db', 'migrations', 'schema', 'meta', 'provider_credentials', 'critical_configuration']
    .map((name) => ({ name, ok: true })) }) : '{"private":"DO_NOT_PUBLISH_PROVIDER_VALUE"}');
process.stdout.write(status);
`,
  );
  executable('sleep', 'process.exit(0);');
  executable(
    'gh',
    String.raw`
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] !== 'issue' || args[1] !== 'comment' || !args.includes('--body-file')) process.exit(66);
fs.copyFileSync(args[args.indexOf('--body-file') + 1], path.join(process.env.MOCK_ROOT, 'report.env'));
`,
  );
  const run = (phase: string, env: Record<string, string> = {}) =>
    runCaptured([helper, phase], {
      cwd: dirname(dirname(dirname(helper))),
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: bin + ':' + process.env.PATH,
        GITHUB_REPOSITORY: repository,
        GITHUB_SHA: sha,
        GITHUB_RUN_ID: '123456',
        GITHUB_RUN_ATTEMPT: '1',
        RUNNER_TEMP: runner,
        GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
        MOCK_ROOT: root,
        MOCK_MODE: 'success',
        ...env,
      },
    });
  const calls = () =>
    existsSync(join(root, 'calls.jsonl'))
      ? readFileSync(join(root, 'calls.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { method: string; url: string })
      : [];
  return { root, statePath, run, calls };
}

describe('actual controller phases with isolated mocked cloud transport', () => {
  it('cleans the tag and restores traffic even after repair expiry with no forward plan or repair context', () => {
    const fixture = promotedFixture(fixtures(repairAuthorizationInput()));
    if (!fixture.auth.deployEnvironmentRepair.enabled) throw new Error('Repair expected');
    const expires = Date.parse(fixture.auth.deployEnvironmentRepair.expiresAt);
    const env = { NODE_OPTIONS: clockEnvironment(expires + 1_000).NODE_OPTIONS! };
    delete fixture.state.candidatePlan;
    delete (fixture.state.auth as Partial<Authorization>).deployEnvironmentRepair;
    const harness = runtimeHarness(
      fixture.service,
      fixture.state,
      fixture.candidate,
      fixture.previous,
    );
    const cleanup = harness.run('cleanup', env);
    expect(cleanup.status, cleanup.stderr).toBe(0);
    const rollback = harness.run('rollback', env);
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(2);
    const restored = JSON.parse(
      readFileSync(join(harness.root, 'service.json'), 'utf8'),
    ) as Service;
    expect(restored.spec.template).toEqual(fixture.service.spec.template);
    expect(restored.spec.traffic).toEqual([
      { revisionName: previous, percent: 100 },
      { revisionName: previous, percent: 0, tag: 'support' },
    ]);
    expect(existsSync(join(harness.statePath, 'stage-write-gate.json'))).toBe(false);
    expect(existsSync(join(harness.statePath, 'promote-write-gate.json'))).toBe(false);
    expect(existsSync(join(harness.statePath, 'request-headers'))).toBe(false);
  });

  it('retains only failing check names on a real 503 probe and still rejects promotion', () => {
    const fixture = promotedFixture();
    const harness = runtimeHarness(fixture.service, fixture.state);
    const ready = {
      status: 'not_ready',
      checks: readinessChecks.map((entry) => ({
        ...entry,
        ok: entry.name !== 'db',
      })),
      private: 'DO_NOT_PUBLISH_PROVIDER_VALUE',
    };
    const result = harness.run('probe', {
      MOCK_READY: '503',
      MOCK_READY_BODY: JSON.stringify(ready),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('WEBHOOK_RECOVERY_HTTP_PROBE_NON200');
    expect(existsSync(join(harness.statePath, 'candidate-probes.json'))).toBe(false);
    expect(harness.calls().every((call) => call.method === 'GET')).toBe(true);
    expect(
      readFileSync(join(harness.statePath, 'candidate-failed-readiness-checks'), 'utf8').trim(),
    ).toBe('db');
    const report = harness.run('report');
    expect(report.status, report.stderr).toBe(0);
    const body = readFileSync(join(harness.root, 'report.env'), 'utf8');
    expect(body).toContain('INSTAGRAM_WEBHOOK_RUNTIME_ALIGNMENT_STATUS=FAIL');
    expect(body).toContain('CANDIDATE_READY_DIAGNOSTIC_STATUS=OBSERVED_NOT_READY');
    expect(body).toContain('CANDIDATE_FAILED_READINESS_CHECKS=db');
    expect(body).not.toContain('DO_NOT_PUBLISH_PROVIDER_VALUE');
  });

  it('keeps malformed 503 bodies unproven without hiding the original failure', () => {
    const fixture = promotedFixture();
    const harness = runtimeHarness(fixture.service, fixture.state);
    const result = harness.run('probe', {
      MOCK_READY: '503',
      MOCK_READY_BODY: '<html>private</html>',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('WEBHOOK_RECOVERY_HTTP_PROBE_NON200');
    expect(
      readFileSync(join(harness.statePath, 'candidate-failed-readiness-checks'), 'utf8').trim(),
    ).toBe('NOT_PROVEN');
    expect(existsSync(join(harness.statePath, 'candidate-probes.json'))).toBe(false);
  });

  it('does exactly one CAS PUT on conflict, never retries or overwrites another writer', () => {
    const fixture = promotedFixture();
    const harness = runtimeHarness(fixture.service, fixture.state);
    writeFileSync(join(harness.statePath, 'failure-code'), 'PRIMARY_HTTP_FAILURE\n');
    const result = harness.run('cleanup', { MOCK_MODE: 'conflict' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('WEBHOOK_RECOVERY_CAS_CONFLICT');
    expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(harness.root, 'service.json'), 'utf8'))).toEqual(
      fixture.service,
    );
    expect(existsSync(join(harness.statePath, 'request-headers'))).toBe(false);
    expect(readFileSync(join(harness.statePath, 'failure-code'), 'utf8')).toBe(
      'PRIMARY_HTTP_FAILURE\n',
    );
  });

  it('confirms an applied PUT with a lost response through reads without a second mutation', () => {
    const fixture = promotedFixture();
    const harness = runtimeHarness(fixture.service, fixture.state);
    const result = harness.run('cleanup', { MOCK_MODE: 'lost-response' });
    expect(result.status, result.stderr).toBe(0);
    expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(readFileSync(join(harness.statePath, 'cleanup-status'), 'utf8').trim()).toBe(
      'APPLIED_CONFIRMED_BY_READBACK',
    );
    const current = JSON.parse(readFileSync(join(harness.root, 'service.json'), 'utf8')) as Service;
    expect(current.spec.traffic.filter((route) => route.tag === tag)).toHaveLength(0);
    expect(current.spec.traffic[0]).toEqual({
      revisionName: candidateName,
      percent: 100,
    });
  });

  it('leaves an unknown PUT outcome unproven after bounded GET reconciliation', () => {
    const fixture = promotedFixture();
    const harness = runtimeHarness(
      fixture.service,
      fixture.state,
      fixture.candidate,
      fixture.input.revision,
    );
    const result = harness.run('cleanup', { MOCK_MODE: 'unknown' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('WEBHOOK_RECOVERY_TRANSITION_OUTCOME_UNKNOWN');
    expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(readFileSync(join(harness.statePath, 'failure-code'), 'utf8').trim()).toBe(
      'TRANSITION_OUTCOME_UNKNOWN',
    );
    const compensation = harness.run('rollback');
    expect(compensation.status, compensation.stderr).toBe(0);
    expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(2);
    expect(readFileSync(join(harness.statePath, 'cleanup-http-status'), 'utf8').trim()).toBe('000');
    expect(readFileSync(join(harness.statePath, 'rollback-http-status'), 'utf8').trim()).toBe(
      '200',
    );
    const current = JSON.parse(readFileSync(join(harness.root, 'service.json'), 'utf8')) as Service;
    expect(current.spec.traffic[0]).toEqual({
      revisionName: previous,
      percent: 100,
    });
    expect(current.spec.traffic.find((route) => route.tag === tag)?.revisionName).toBe(
      candidateName,
    );
  });

  it.each(['False', 'Unknown'])(
    'compensates after post-cleanup acceptance finds its candidate Ready=%s without repeating cleanup',
    (status) => {
      const fixture = promotedFixture();
      fixture.candidate.status.conditions = [{ type: 'Ready', status }];
      const harness = runtimeHarness(
        fixture.service,
        fixture.state,
        fixture.candidate,
        fixture.input.revision,
      );
      writeFileSync(join(harness.statePath, 'runtime-acceptance-status'), 'PASS\n');
      const cleanup = harness.run('cleanup');
      expect(cleanup.status).toBe(1);
      expect(cleanup.stderr).toContain('WEBHOOK_RECOVERY_REVISION_NOT_READY');
      expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(1);
      expect(readFileSync(join(harness.statePath, 'cleanup-status'), 'utf8').trim()).toBe(
        'APPLIED_CONFIRMED_BY_READBACK',
      );
      const compensation = harness.run('rollback');
      expect(compensation.status, compensation.stderr).toBe(0);
      expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(2);
      const current = JSON.parse(
        readFileSync(join(harness.root, 'service.json'), 'utf8'),
      ) as Service;
      expect(current.spec.traffic[0]).toEqual({
        revisionName: previous,
        percent: 100,
      });
      expect(current.spec.traffic.some((route) => route.tag === tag)).toBe(false);
      expect(current.spec.template).toEqual(fixture.service.spec.template);
      const report = harness.run('report');
      expect(report.status, report.stderr).toBe(0);
      const text = readFileSync(join(harness.root, 'report.env'), 'utf8');
      expect(text).toContain('INSTAGRAM_WEBHOOK_RUNTIME_ALIGNMENT_STATUS=FAIL');
      expect(text).toContain('ROLLBACK_STATUS=APPLIED_CONFIRMED_BY_READBACK');
      expect(text).not.toMatch(/DO_NOT_PUBLISH|FAKE_TOKEN|valueFrom|secretKeyRef/);
    },
  );

  it('does not undo a new owner after post-cleanup acceptance fails', () => {
    const fixture = promotedFixture();
    fixture.candidate.status.conditions = [{ type: 'Ready', status: 'False' }];
    const harness = runtimeHarness(
      fixture.service,
      fixture.state,
      fixture.candidate,
      fixture.input.revision,
    );
    writeFileSync(join(harness.statePath, 'runtime-acceptance-status'), 'PASS\n');
    expect(harness.run('cleanup').status).toBe(1);
    const current = JSON.parse(readFileSync(join(harness.root, 'service.json'), 'utf8')) as Service;
    current.spec.traffic[0] = {
      revisionName: serviceName + '-another-owner',
      percent: 100,
    };
    current.status.traffic = structuredClone(current.spec.traffic);
    writeFileSync(join(harness.root, 'service.json'), JSON.stringify(current));
    const compensation = harness.run('rollback');
    expect(compensation.status, compensation.stderr).toBe(0);
    expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(readFileSync(join(harness.statePath, 'rollback-status'), 'utf8').trim()).toBe(
      'NOOP_SUPERSEDED',
    );
    expect(JSON.parse(readFileSync(join(harness.root, 'service.json'), 'utf8'))).toEqual(current);
  });

  it('uses the same guarded transport for rollback and performs no PUT when superseded', () => {
    const fixture = promotedFixture();
    const harness = runtimeHarness(
      fixture.service,
      fixture.state,
      fixture.candidate,
      fixture.input.revision,
    );
    const result = harness.run('rollback');
    expect(result.status, result.stderr).toBe(0);
    expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(1);
    const current = JSON.parse(readFileSync(join(harness.root, 'service.json'), 'utf8')) as Service;
    expect(current.spec.traffic[0]).toEqual({
      revisionName: previous,
      percent: 100,
    });
    current.spec.traffic[0]!.revisionName = serviceName + '-another-owner';
    current.status.traffic = structuredClone(current.spec.traffic);
    writeFileSync(join(harness.root, 'service.json'), JSON.stringify(current));
    const second = harness.run('rollback');
    expect(second.status, second.stderr).toBe(0);
    expect(harness.calls().filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(readFileSync(join(harness.statePath, 'rollback-status'), 'utf8').trim()).toBe(
      'NOOP_SUPERSEDED',
    );
  });

  it.each([
    ['500', '200'],
    ['200', '503'],
    ['302', '200'],
  ])(
    'refuses actual probe HTTP %s/%s before any service mutation and publishes only sanitized evidence',
    (health, ready) => {
      const fixture = stagedFixture();
      const harness = runtimeHarness(fixture.service, fixture.state);
      const result = harness.run('probe', {
        MOCK_HEALTH: health,
        MOCK_READY: ready,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('WEBHOOK_RECOVERY_HTTP_PROBE_NON200');
      expect(harness.calls().map((call) => call.method)).toEqual(['GET', 'GET']);
      const report = harness.run('report');
      expect(report.status, report.stderr).toBe(0);
      const text = readFileSync(join(harness.root, 'report.env'), 'utf8');
      expect(text).toContain('INSTAGRAM_WEBHOOK_RUNTIME_ALIGNMENT_STATUS=FAIL');
      expect(text).toContain('FAILURE_CODE=HTTP_PROBE_NON200');
      expect(text).not.toMatch(/DO_NOT_PUBLISH|FAKE_TOKEN|valueFrom|secretKeyRef/);
      expect(result.stdout).not.toMatch(/DO_NOT_PUBLISH|FAKE_TOKEN/);
    },
  );
});

describe('governed workflow wiring', () => {
  it('serializes callback writers and preserves stage, health, CAS and compensation ordering', () => {
    expect(workflow).toContain("'instagram-engagement-webhook-callback-control'");
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('actions: read');
    const phases = [
      'authorize',
      'prestate',
      'consume',
      'stage',
      'probe',
      'promote',
      'verify',
      'cleanup',
      'rollback',
      'report',
    ];
    let previousPosition = -1;
    for (const phase of phases) {
      const current = workflow.indexOf('runtime-align.sh ' + phase);
      expect(current).toBeGreaterThan(previousPosition);
      previousPosition = current;
    }
    const context = workflow.indexOf('Persist sanitized recovery context');
    expect(context).toBeGreaterThan(workflow.indexOf('runtime-align.sh prestate'));
    expect(context).toBeLessThan(workflow.indexOf('runtime-align.sh consume'));
    expect(workflow).toContain('/sanitized-context.json');
    expect(workflow).not.toContain('/state.json');
    expect(workflow).toContain(
      "if: (failure() || cancelled()) && steps.prestate.outcome == 'success'",
    );
    expect(workflow).toContain("if: always() && steps.prestate.outcome == 'success'");
  });

  it('uses the existing digest reader for all shadow artifact paths without deploying a service', () => {
    for (const image of ['CANDIDATE_IMAGE', 'IMAGE_TAG', 'IMMUTABLE_IMAGE']) {
      expect(builder).toContain(
        'bash scripts/resolve-artifact-registry-digest.sh "$' + image + '"',
      );
    }
    expect(builder).not.toContain('value(image_summary.digest)');
    expect(builder).not.toContain('gcloud run ');
    const script = readFileSync(helper, 'utf8');
    expect(script).toContain('bash scripts/verify-instagram-engagement-webhook-ingress.sh');
    expect(script).not.toContain('gcloud run deploy');
    expect(script).not.toContain('gcloud run services update-traffic');
    expect(script).not.toContain('set-iam-policy');
    expect(script).not.toContain('--retry');
  });
});
