import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createRuntimeReadinessChecks } from '../src/health/runtime-readiness.js';

type ObjectValue = Record<string, unknown>;
interface Scope extends Record<string, string> {
  sourceSha: string;
  runtimeSourceSha: string;
  runtimeTreeSha: string;
  issueNumber: string;
  runId: string;
  runAttempt: string;
  actor: string;
  authorizationFingerprint: string;
}
interface Signal extends ObjectValue {
  status: string;
  fields: Record<string, ObjectValue>;
  codes: string[];
  firstFailureCode: string | null;
}
interface Threshold {
  status: string;
  value: number | null;
  defaultApplied: boolean;
  code: string | null;
}
interface Expected {
  runtimeSourceSha: string;
  runtimeTreeSha: string;
  candidateRevision: string;
  candidateDigest: string;
  previousRevision: string;
  previousDigest: string;
  databaseSecret: string;
  cloudSqlInstance: string;
}
interface Metadata {
  privateContext: { databaseSecretVersion: string; cloudSqlInstance: string };
  publicContext: ObjectValue;
  candidate: Revision;
}
interface Script {
  REPOSITORY: string;
  WORKFLOW_PATH: string;
  TITLE: string;
  PROJECT: string;
  REGION: string;
  SERVICE: string;
  SERVICE_PATH: string;
  DEPLOYER: string;
  PROXY_SHA256: string;
  EXPECTED: Expected;
  REQUIRED_MARKERS: Record<string, string>;
  CONTRACT_PATHS: string[];
  OUTBOX_SQL: string;
  DiagnosticError: new (code: string, details?: ObjectValue) => Error;
  hash(value: unknown): string;
  fingerprint(value: unknown): string;
  instanceFromEnv(env: unknown): Scope;
  authorizationScope(issue: unknown, instance: unknown, now?: Date, consumed?: boolean): Scope;
  verifyAuthorizationScope(saved: unknown, issue: unknown, now?: Date, consumed?: boolean): Scope;
  verifyRunBinding(run: unknown, workflow: unknown, event: unknown, scope: Scope): void;
  requireStableMain(control: unknown, mainSha: string, scope: Scope): void;
  criticalConfiguration(revision: unknown, databasePresent?: boolean): Signal;
  outboxThreshold(revision: unknown): Threshold;
  verifyMetadata(service: unknown, candidate: Revision, previous: Revision, scope: Scope): Metadata;
  evaluateOutbox(row: unknown, threshold: Threshold): ObjectValue;
  readOnlyOutbox(pool: unknown, threshold: Threshold): Promise<ObjectValue>;
  runDiagnostic(scope: Scope, deps: unknown): Promise<ObjectValue>;
  publicResult(scope: Scope, input?: unknown): ObjectValue;
  failureResult(error: unknown): ObjectValue;
  sourceCompatibility(scope: Scope, command?: unknown, read?: unknown): Promise<void>;
  cloudMetadataGet(path: string, token: string, request: typeof fetch): Promise<unknown>;
  accessDatabaseSecret(context: unknown, token: string, request: typeof fetch): Promise<string>;
  databaseOptions(raw: string): ObjectValue;
  github(
    path: string,
    method: string | undefined,
    body: unknown,
    request: typeof fetch,
  ): Promise<ObjectValue>;
  consumeAuthorization(scope: Scope, api: unknown): Promise<void>;
  finishAuthorization(
    scope: Scope,
    result: unknown,
    api: unknown,
    now?: Date,
  ): Promise<ObjectValue>;
}
interface EnvEntry {
  name: string;
  value?: string;
  valueSource?: { secretKeyRef: { secret: string; version: string } };
}
interface Revision {
  name: string;
  uid: string;
  serviceAccount: string;
  containers: Array<{ image: string; env: EnvEntry[]; command?: string[]; args?: string[] }>;
  volumes: Array<{ cloudSqlInstance: { instances: string[] } }>;
  conditions: Array<{ type: string; state: string }>;
}
const api = (await import(
  pathToFileURL(resolve('scripts/instagram-webhook-dependency-readonly-diagnostic.mjs')).href
)) as Script;
const NOW = new Date('2026-10-19T08:00:00.000Z');
const SHA = 'a'.repeat(40);
const uid = (digit: string) =>
  digit.repeat(8) + '-' + [4, 4, 4, 12].map((n) => digit.repeat(n)).join('-');
const env = {
  GITHUB_REPOSITORY: api.REPOSITORY,
  GITHUB_SHA: SHA,
  GITHUB_RUN_ID: '39220000000',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_ACTOR: 'luizanunciostoca',
  AUTHORIZATION_ISSUE_NUMBER: '1101',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'issues',
  GITHUB_WORKFLOW_REF: api.REPOSITORY + '/' + api.WORKFLOW_PATH + '@refs/heads/main',
  GITHUB_WORKFLOW_SHA: SHA,
};
function issue() {
  return {
    number: 1101,
    state: 'open',
    user: { login: 'luizanunciostoca' },
    title: api.TITLE + ' — fixture',
    created_at: '2026-10-19T07:59:00.000Z',
    updated_at: '2026-10-19T07:59:00.000Z',
    httpEtag: 'fixture-etag',
    body: Object.entries({
      ...api.REQUIRED_MARKERS,
      AUTHORIZED_CONTROLLER_SHA: SHA,
      AUTHORIZATION_STATE: 'ACTIVE',
      AUTHORIZATION_EXPIRES_AT: '2026-10-19T09:00:00.000Z',
    })
      .map(([key, value]) => key + '=' + value)
      .join('\n'),
  };
}
const scope = () => api.authorizationScope(issue(), api.instanceFromEnv(env), NOW);
function runBinding() {
  return {
    run: {
      id: Number(env.GITHUB_RUN_ID),
      run_attempt: 1,
      event: 'issues',
      head_sha: SHA,
      head_branch: 'main',
      path: api.WORKFLOW_PATH,
      workflow_id: 123,
      actor: { login: env.GITHUB_ACTOR },
      triggering_actor: { login: env.GITHUB_ACTOR },
      status: 'in_progress',
      created_at: '2026-10-19T07:59:10.000Z',
    },
    workflow: { id: 123, path: api.WORKFLOW_PATH, state: 'active' },
    event: {
      action: 'opened',
      sender: { login: env.GITHUB_ACTOR },
      repository: { full_name: api.REPOSITORY },
      issue: issue(),
    },
  };
}
function control() {
  return {
    number: 640,
    state: 'open',
    user: { login: env.GITHUB_ACTOR },
    body: [
      'PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION=2',
      'CONTROL_PLANE_ROLE=INTEGRATION_QUEUE_AND_MAIN_STABILITY',
      'MAIN_STABILITY=PASS',
      'EVALUATED_MAIN_SHA=' + SHA,
      'MERGE_RESERVATION=NONE',
      'EXTERNAL_SIDE_EFFECTS_AUTHORIZED=false',
      'PROVIDER_CALLS_AUTHORIZED=false',
      'DATABASE_MUTATIONS_AUTHORIZED=false',
      'SERVICE_MUTATIONS_AUTHORIZED=false',
      'GENERAL_AUTONOMY=false',
      'GENERAL_AUTONOMY=false',
    ].join('\n'),
  };
}
function revision(name: string, digest: string, digit: string): Revision {
  return {
    name: api.SERVICE_PATH + '/revisions/' + name,
    uid: uid(digit),
    serviceAccount: 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
    containers: [
      {
        image: api.REGION + '-docker.pkg.dev/' + api.PROJECT + '/toca-mcp/server@' + digest,
        env: [
          { name: 'TOCA_RELEASE_SHA', value: api.EXPECTED.runtimeSourceSha },
          { name: 'MCP_ENABLED', value: 'false' },
          { name: 'TOCA_SERVICE_ROLE', value: 'webhook' },
          { name: 'TOCA_DEFAULT_TENANT_ID', value: 'PRIVATE-TENANT' },
          { name: 'TOCA_DEFAULT_WORKSPACE_ID', value: 'PRIVATE-WORKSPACE' },
          { name: 'TOCA_DEFAULT_ORGANIZATION_ID', value: 'PRIVATE-ORGANIZATION' },
          { name: 'TOCA_DEPLOY_ENVIRONMENT', value: 'PRIVATE-DEPLOY-LABEL' },
          {
            name: 'DATABASE_URL',
            valueSource: {
              secretKeyRef: { secret: api.EXPECTED.databaseSecret, version: 'latest' },
            },
          },
        ],
      },
    ],
    volumes: [{ cloudSqlInstance: { instances: [api.EXPECTED.cloudSqlInstance] } }],
    conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }],
  };
}
function metadataFixture() {
  const traffic = [
    {
      type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
      revision: api.EXPECTED.previousRevision,
      percent: 100,
    },
  ];
  return {
    service: {
      name: api.SERVICE_PATH,
      uid: uid('1'),
      generation: '17',
      observedGeneration: '17',
      reconciling: false,
      etag: 'fixture-service-etag',
      traffic,
      trafficStatuses: structuredClone(traffic),
    },
    candidate: revision(api.EXPECTED.candidateRevision, api.EXPECTED.candidateDigest, '2'),
    previous: revision(api.EXPECTED.previousRevision, api.EXPECTED.previousDigest, '3'),
  };
}
function setEnv(rev: Revision, name: string, value?: string) {
  const container = rev.containers[0]!;
  container.env = container.env.filter((item) => item.name !== name);
  if (value !== undefined) container.env.push({ name, value });
}
function metadata() {
  const { service, candidate, previous } = metadataFixture();
  return api.verifyMetadata(service, candidate, previous, scope());
}
function sqlFixture(
  options: {
    mode?: string;
    statement?: string;
    lock?: string;
    sqlState?: string;
    connectState?: string;
    rollbackFailure?: boolean;
    releaseFailure?: boolean;
    row?: ObjectValue;
    empty?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const client = {
    query: vi.fn((input: string | { text: string }) => {
      const text = typeof input === 'string' ? input : input.text;
      calls.push(text);
      if (text === 'rollback' && options.rollbackFailure)
        return Promise.reject(new Error('PRIVATE-ROLLBACK'));
      if (text === api.OUTBOX_SQL && options.sqlState)
        return Promise.reject(
          Object.assign(new Error('PRIVATE-URL token event row'), { code: options.sqlState }),
        );
      let rows: ObjectValue[] = [];
      if (text === 'show transaction_read_only')
        rows = [{ transaction_read_only: options.mode ?? 'on' }];
      if (text === 'show statement_timeout')
        rows = [{ statement_timeout: options.statement ?? '5s' }];
      if (text === 'show lock_timeout') rows = [{ lock_timeout: options.lock ?? '2s' }];
      if (text === api.OUTBOX_SQL && !options.empty)
        rows = [options.row ?? { oldest_pending_age_seconds: '301.75', dead_letter_count: '2' }];
      return Promise.resolve({ rows });
    }),
    release: vi.fn(() => {
      if (options.releaseFailure) throw new Error('PRIVATE-RELEASE');
    }),
  };
  const pool = {
    connect: vi.fn(() =>
      options.connectState
        ? Promise.reject(
            Object.assign(new Error('PRIVATE-CONNECTION'), { code: options.connectState }),
          )
        : Promise.resolve(client),
    ),
  };
  return { pool, client, calls };
}
function diagnosticDeps() {
  const sql = sqlFixture();
  const observed: unknown[] = [];
  const deps = {
    authorize: vi.fn((value: Scope) => Promise.resolve({ ...value })),
    consume: vi.fn(() => Promise.resolve()),
    metadata: vi.fn(() => Promise.resolve(metadata())),
    observation: vi.fn((value: unknown) => {
      observed.push(value);
      return Promise.resolve();
    }),
    databaseSecret: vi.fn(() =>
      Promise.resolve('postgres://PRIVATE-USER:PRIVATE-PASSWORD@PRIVATE-HOST/PRIVATE-DB'),
    ),
    openDatabase: vi.fn(() =>
      Promise.resolve({
        pool: sql.pool,
        close: vi.fn(() => Promise.resolve()),
        runtimeDatabaseEndpointVerified: true,
      }),
    ),
  };
  return { deps, sql, observed };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('one-use owner authority and immutable LIVE scope', () => {
  it('reuses only whitelisted instance fields, then validates a fresh identical LIVE scope', () => {
    const saved = scope();
    expect(api.authorizationScope(issue(), saved, NOW)).toEqual(saved);
    expect(api.verifyAuthorizationScope(saved, issue(), NOW)).toEqual(saved);
    const binding = runBinding();
    expect(() =>
      api.verifyRunBinding(binding.run, binding.workflow, binding.event, saved),
    ).not.toThrow();
    expect(() => api.requireStableMain(control(), SHA, saved)).not.toThrow();
  });
  it.each([
    'sourceSha',
    'runtimeSourceSha',
    'runtimeTreeSha',
    'candidateDigest',
    'previousRevision',
    'issueBodyHash',
    'diagnosticId',
    'expiresAt',
  ])('rejects saved tampering of %s before any LIVE comparison', (key) => {
    expect(() =>
      api.verifyAuthorizationScope({ ...scope(), [key]: 'tampered' }, issue(), NOW),
    ).toThrow('SAVED_AUTHORIZATION_SCOPE_TAMPERED');
  });
  it('rejects an attacker-rehashed derived scope against fresh authority', () => {
    const { authorizationFingerprint: ignored, ...saved } = scope();
    expect(ignored).toMatch(/^[a-f0-9]{64}$/);
    const altered = { ...saved, candidateDigest: 'sha256:' + 'e'.repeat(64) };
    expect(() =>
      api.verifyAuthorizationScope(
        { ...altered, authorizationFingerprint: api.fingerprint(altered) },
        issue(),
        NOW,
      ),
    ).toThrow('LIVE_AUTHORIZATION_CHANGED');
  });
  it.each([
    ['state', 'closed'],
    ['title', 'unrelated'],
    ['created_at', '2026-10-20T01:00:00Z'],
  ])('rejects invalid issue %s', (key, value) => {
    expect(() => api.authorizationScope({ ...issue(), [key]: value }, scope(), NOW)).toThrow();
  });
  it('rejects non-owner, expired, excessive deadline and duplicated markers', () => {
    expect(() =>
      api.authorizationScope({ ...issue(), user: { login: 'other' } }, scope(), NOW),
    ).toThrow();
    for (const deadline of ['2026-10-19T07:59:30Z', '2026-10-21T08:00:00Z']) {
      const modified = {
        ...issue(),
        body: issue().body.replace('2026-10-19T09:00:00.000Z', deadline),
      };
      expect(() => api.authorizationScope(modified, scope(), NOW)).toThrow(
        'AUTHORIZATION_EXPIRED_OR_UNBOUNDED',
      );
    }
    expect(() =>
      api.authorizationScope(
        { ...issue(), body: issue().body + '\nAUTHORIZATION_STATE=ACTIVE' },
        scope(),
        NOW,
      ),
    ).toThrow('AUTHORIZATION_MARKER_NOT_UNIQUE');
  });
  it('rejects an otherwise valid changed LIVE body and consumes only the same run once', () => {
    expect(() =>
      api.verifyAuthorizationScope(
        scope(),
        { ...issue(), body: issue().body + '\nNew owner note' },
        NOW,
      ),
    ).toThrow('LIVE_AUTHORIZATION_CHANGED');
    const consumed = {
      ...issue(),
      body:
        issue().body.replace('AUTHORIZATION_STATE=ACTIVE', 'AUTHORIZATION_STATE=CONSUMED') +
        '\nCONSUMED_BY_RUN_ID=' +
        env.GITHUB_RUN_ID +
        '\nCONSUMED_BY_RUN_ATTEMPT=1\n',
    };
    expect(api.verifyAuthorizationScope(scope(), consumed, NOW, true)).toEqual(scope());
    expect(() => api.verifyAuthorizationScope(scope(), consumed, NOW)).toThrow();
    expect(() =>
      api.verifyAuthorizationScope(
        scope(),
        { ...consumed, body: consumed.body.replace(env.GITHUB_RUN_ID, '39220000001') },
        NOW,
        true,
      ),
    ).toThrow();
  });
  it.each([
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_ACTOR', 'other'],
    ['GITHUB_REF', 'refs/heads/branch'],
    ['GITHUB_EVENT_NAME', 'workflow_dispatch'],
    ['GITHUB_WORKFLOW_SHA', 'b'.repeat(40)],
  ])('rejects replay or changed instance %s', (key, value) => {
    expect(() => api.instanceFromEnv({ ...env, [key]: value })).toThrow();
  });
  it.each(['run_attempt', 'path', 'head_sha', 'triggering_actor'])(
    'binds current run %s',
    (key) => {
      const binding = runBinding();
      expect(() =>
        api.verifyRunBinding(
          { ...binding.run, [key]: key === 'run_attempt' ? 2 : 'other' },
          binding.workflow,
          binding.event,
          scope(),
        ),
      ).toThrow();
    },
  );
  it('requires certified exact main, no reservation and all duplicate autonomy markers false', () => {
    expect(() => api.requireStableMain(control(), 'b'.repeat(40), scope())).toThrow(
      'CURRENT_MAIN_CHANGED',
    );
    for (const body of [
      control().body.replace('MAIN_STABILITY=PASS', 'MAIN_STABILITY=BLOCKED'),
      control().body.replace('MERGE_RESERVATION=NONE', 'MERGE_RESERVATION=OTHER'),
      control().body + '\nGENERAL_AUTONOMY=true',
    ]) {
      expect(() => api.requireStableMain({ ...control(), body }, SHA, scope())).toThrow();
    }
  });
});

describe('actual source and sanitized effective configuration', () => {
  it('uses proven Docker production and real default-enabled MCP semantics', () => {
    expect(loadConfig({}).MCP_ENABLED).toBe(true);
    expect(readFileSync('Dockerfile', 'utf8')).toMatch(/^ENV NODE_ENV=production$/m);
    const candidate = metadataFixture().candidate;
    setEnv(candidate, 'MCP_ENABLED');
    const observed = api.criticalConfiguration(candidate, true);
    expect(observed.fields.NODE_ENV).toMatchObject({
      enumValue: 'production',
      origin: 'VERIFIED_IMAGE_DEFAULT',
    });
    expect(observed.fields.MCP_ENABLED).toMatchObject({
      booleanValue: true,
      origin: 'PARSER_DEFAULT',
    });
    expect(observed.codes).toContain('READINESS_WEBHOOK_ROLE_REQUIRES_MCP_DISABLED');
  });
  const criticalCases: [string, string | undefined, string][] = [
    ['TOCA_DEFAULT_TENANT_ID', undefined, 'READINESS_TENANT_ID_REQUIRED'],
    ['TOCA_DEFAULT_WORKSPACE_ID', ' ', 'READINESS_WORKSPACE_ID_REQUIRED'],
    ['TOCA_DEFAULT_ORGANIZATION_ID', undefined, 'READINESS_ORGANIZATION_ID_REQUIRED'],
    ['TOCA_DEPLOY_ENVIRONMENT', undefined, 'READINESS_DEPLOY_ENVIRONMENT_REQUIRED'],
    ['TOCA_RELEASE_SHA', undefined, 'READINESS_RELEASE_SHA_REQUIRED'],
    ['TOCA_SERVICE_ROLE', undefined, 'READINESS_SERVICE_ROLE_REQUIRED'],
    ['TOCA_SERVICE_ROLE', 'PRIVATE-INVALID-ROLE', 'READINESS_SERVICE_ROLE_INVALID'],
    ['MCP_ENABLED', undefined, 'READINESS_WEBHOOK_ROLE_REQUIRES_MCP_DISABLED'],
    ['TOCA_SERVICE_ROLE', 'mcp', 'READINESS_MCP_ROLE_REQUIRES_MCP_ENABLED'],
  ];
  it.each(criticalCases)(
    'matches actual critical readiness for %s=%s',
    async (name, value, code) => {
      const candidate = metadataFixture().candidate;
      setEnv(candidate, name, value);
      const runtimeEnv: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://fixture:fixture@localhost/fixture',
      };
      for (const item of candidate.containers[0]!.env)
        if (item.value !== undefined) runtimeEnv[item.name] = item.value;
      const check = createRuntimeReadinessChecks({
        config: loadConfig(runtimeEnv),
        env: runtimeEnv,
      }).find((item) => item.name === 'critical_configuration')!;
      await expect(check.check()).rejects.toThrow(code);
      expect(api.criticalConfiguration(candidate, true).firstFailureCode).toBe(code);
    },
  );
  it.each(['', ' ', 'false', 'true'])(
    'matches the real kill switch treatment for %j',
    async (value) => {
      const candidate = metadataFixture().candidate;
      setEnv(candidate, 'TOCA_PLATFORM_KILL_SWITCH', value);
      expect(api.criticalConfiguration(candidate, true).codes).toEqual([]);
      const runtimeEnv: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://fixture:fixture@localhost/fixture',
      };
      for (const item of candidate.containers[0]!.env)
        if (item.value !== undefined) runtimeEnv[item.name] = item.value;
      await expect(
        createRuntimeReadinessChecks({ config: loadConfig(runtimeEnv), env: runtimeEnv })
          .find((item) => item.name === 'critical_configuration')!
          .check(),
      ).resolves.toBeUndefined();
    },
  );
  it('publishes fixed codes only for invalid booleans and never exposes secret references or identifiers', () => {
    const candidate = metadataFixture().candidate;
    setEnv(candidate, 'TOCA_PLATFORM_KILL_SWITCH', ' PRIVATE-INVALID-TOKEN ');
    setEnv(candidate, 'MCP_ENABLED', '');
    const result = api.publicResult(scope(), {
      criticalConfiguration: api.criticalConfiguration(candidate),
    });
    const text = JSON.stringify(result);
    expect(text).toContain('CONFIG_MCP_ENABLED_INVALID');
    expect(text).toContain('READINESS_BOOLEAN_INVALID_TOCA_PLATFORM_KILL_SWITCH');
    expect(text).not.toMatch(/PRIVATE-|secretKeyRef|latest|postgres:/);
    const unresolved = metadataFixture().candidate;
    setEnv(unresolved, 'TOCA_DEFAULT_TENANT_ID');
    unresolved.containers[0]!.env.push({
      name: 'TOCA_DEFAULT_TENANT_ID',
      valueSource: { secretKeyRef: { secret: 'PRIVATE-OTHER-SECRET', version: 'latest' } },
    });
    expect(api.criticalConfiguration(unresolved, true).status).toBe('NOT_PROVEN');
    expect(JSON.stringify(api.criticalConfiguration(unresolved, true))).not.toContain(
      'PRIVATE-OTHER-SECRET',
    );
  });
  it.each([
    [undefined, 300],
    ['', 300],
    ['300ms', 300],
    ['1.9', 1],
    ['1e3', 1],
    [' 900 ', 900],
  ])('matches readiness positiveInteger for %s', (raw, expected) => {
    const candidate = metadataFixture().candidate;
    setEnv(candidate, 'TOCA_READY_OUTBOX_MAX_LAG_SECONDS', raw);
    expect(api.outboxThreshold(candidate).value).toBe(expected);
  });
  it.each(['0', '-1', 'private-text', '9007199254740992'])(
    'rejects invalid threshold %s without exposing its raw text',
    (raw) => {
      const candidate = metadataFixture().candidate;
      setEnv(candidate, 'TOCA_READY_OUTBOX_MAX_LAG_SECONDS', raw);
      expect(api.outboxThreshold(candidate)).toMatchObject({
        status: 'INVALID',
        value: null,
        code: 'READINESS_POSITIVE_INTEGER_INVALID',
      });
    },
  );
  it('binds runtime tree and contract equivalence when controller differs', async () => {
    const calls: string[][] = [];
    const command = vi.fn((_file: string, args: string[]) => {
      calls.push(args);
      return Promise.resolve(
        args[1] === 'HEAD' ? SHA : args[0] === 'rev-parse' ? api.EXPECTED.runtimeTreeSha : '',
      );
    });
    await expect(
      api.sourceCompatibility(scope(), command, () =>
        Promise.resolve('FROM node@sha256:fixture AS runtime\nENV NODE_ENV=production\n'),
      ),
    ).resolves.toBeUndefined();
    expect(calls[2]).toEqual([
      'diff',
      '--quiet',
      api.EXPECTED.runtimeSourceSha,
      SHA,
      '--',
      ...api.CONTRACT_PATHS,
    ]);
    expect(api.CONTRACT_PATHS).toEqual(
      expect.arrayContaining([
        'src/config.ts',
        'src/health/runtime-readiness.ts',
        'Dockerfile',
        'pnpm-lock.yaml',
      ]),
    );
    await expect(api.sourceCompatibility(scope(), () => Promise.resolve('wrong'))).rejects.toThrow(
      'EXACT_CONTROLLER_CHECKOUT_REQUIRED',
    );
    await expect(
      api.sourceCompatibility(scope(), command, () =>
        Promise.resolve('FROM node AS runtime\nENV NODE_ENV=development\n'),
      ),
    ).rejects.toThrow('VERIFIED_IMAGE_NODE_ENV_REQUIRED');
  });
});

describe('strict metadata and existing-secret binding', () => {
  it('allows diagnosis of unready candidate with unchanged previous at 100 percent', () => {
    const { service, candidate, previous } = metadataFixture();
    candidate.conditions[0]!.state = 'CONDITION_FAILED';
    expect(api.verifyMetadata(service, candidate, previous, scope()).publicContext).toMatchObject({
      previousTrafficPercent: 100,
      candidateSourceVerified: true,
    });
  });
  it.each([
    'identity',
    'digest',
    'source',
    'entrypoint',
    'database',
    'instance',
    'previous-ready',
    'service-uid',
    'split',
    'observed-generation',
  ])('refuses mismatched %s', (variant) => {
    const { service, candidate, previous } = metadataFixture();
    if (variant === 'identity') candidate.serviceAccount = 'another-account';
    if (variant === 'digest') candidate.containers[0]!.image += 'tamper';
    if (variant === 'source') setEnv(candidate, 'TOCA_RELEASE_SHA', 'b'.repeat(40));
    if (variant === 'entrypoint') candidate.containers[0]!.command = ['sh', '-c', 'env'];
    if (variant === 'database')
      candidate.containers[0]!.env.find(
        (item) => item.name === 'DATABASE_URL',
      )!.valueSource!.secretKeyRef.secret = 'other-secret';
    if (variant === 'instance')
      candidate.volumes[0]!.cloudSqlInstance.instances = ['other-instance'];
    if (variant === 'previous-ready') previous.conditions[0]!.state = 'CONDITION_FAILED';
    if (variant === 'service-uid') service.uid = 'invalid';
    if (variant === 'observed-generation') service.observedGeneration = '16';
    if (variant === 'split') {
      service.traffic[0]!.percent = 50;
      service.traffic.push({
        type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
        revision: api.EXPECTED.candidateRevision,
        percent: 50,
      });
      service.trafficStatuses = structuredClone(service.traffic);
    }
    expect(() => api.verifyMetadata(service, candidate, previous, scope())).toThrow();
  });
  it('allows GET only to the three exact Cloud Run v2 objects', async () => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ observed: true })));
    for (const path of [
      api.SERVICE_PATH,
      api.SERVICE_PATH + '/revisions/' + api.EXPECTED.candidateRevision,
      api.SERVICE_PATH + '/revisions/' + api.EXPECTED.previousRevision,
    ]) {
      await api.cloudMetadataGet(path, 'PRIVATE-TOKEN', request);
    }
    expect(request).toHaveBeenCalledTimes(3);
    for (const [url, options] of request.mock.calls) {
      expect(url).toMatch(/^https:\/\/run\.googleapis\.com\/v2\//);
      expect(options?.method).toBe('GET');
      expect(options?.redirect).toBe('error');
    }
    await expect(
      api.cloudMetadataGet(api.SERVICE_PATH + ':setIamPolicy', 'PRIVATE-TOKEN', request),
    ).rejects.toThrow('CLOUD_METADATA_PATH_NOT_AUTHORIZED');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each([403, 404])(
    'exposes only status for denied/missing metadata %s without retry',
    async (status) => {
      const request = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('PRIVATE-ERROR-NONJSON', { status })),
      );
      const error = await api
        .cloudMetadataGet(api.SERVICE_PATH, 'PRIVATE-TOKEN', request)
        .catch((reason: unknown) => reason);
      expect(api.failureResult(error)).toMatchObject({
        result: 'NOT_PROVEN',
        code: 'CLOUD_METADATA_READ_NOT_PROVEN',
        httpStatus: status,
      });
      expect(JSON.stringify(api.failureResult(error))).not.toContain('PRIVATE');
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it('reads exactly the authorized secret into memory and never broadens an access denial', async () => {
    const raw = 'postgres://PRIVATE-USER:PRIVATE-PASSWORD@PRIVATE-HOST/PRIVATE-DB';
    const context = metadata().privateContext;
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          name: 'projects/990081828836/secrets/toca-database-url/versions/7',
          payload: { data: Buffer.from(raw).toString('base64') },
        }),
      ),
    );
    expect(await api.accessDatabaseSecret(context, 'PRIVATE-TOKEN', request)).toBe(raw);
    expect(request.mock.calls[0]?.[0]).toBe(
      'https://secretmanager.googleapis.com/v1/projects/toca-mcp-production/secrets/toca-database-url/versions/latest:access',
    );
    expect(request.mock.calls[0]?.[1]?.method).toBe('GET');
    const denied = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({ error: { status: 'PERMISSION_DENIED', message: raw } }, { status: 403 }),
      ),
    );
    const error = await api
      .accessDatabaseSecret(context, 'PRIVATE-TOKEN', denied)
      .catch((reason: unknown) => reason);
    expect(api.failureResult(error)).toMatchObject({
      code: 'EXISTING_DATABASE_SECRET_READ_NOT_PROVEN',
      httpStatus: 403,
      providerStatus: 'PERMISSION_DENIED',
    });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(api.failureResult(error))).not.toContain('PRIVATE');
  });
});

describe('exact readiness aggregation in a bounded read-only transaction', () => {
  it('executes the identical SQL used by the real runtime and reports both aggregate signals', async () => {
    const queries: string[] = [];
    const pool = {
      query: (sql: string) => {
        queries.push(sql);
        return Promise.resolve({
          rows: [{ oldest_pending_age_seconds: 301.75, dead_letter_count: 2 }],
        });
      },
    };
    const actual = createRuntimeReadinessChecks({
      pool: pool as unknown as pg.Pool,
      config: loadConfig({}),
      env: {},
    }).find((item) => item.name === 'outbox')!;
    await expect(actual.check()).rejects.toThrow('READINESS_OUTBOX_LAG_EXCEEDED');
    expect(queries).toEqual([api.OUTBOX_SQL]);
    const sql = sqlFixture();
    const result = await api.readOnlyOutbox(
      sql.pool,
      api.outboxThreshold(metadataFixture().candidate),
    );
    expect(sql.calls).toEqual([
      'begin isolation level repeatable read read only',
      'show transaction_read_only',
      'show statement_timeout',
      'show lock_timeout',
      api.OUTBOX_SQL,
      'rollback',
    ]);
    expect(result).toMatchObject({
      oldestPendingAgeSeconds: 301.75,
      deadLetterCount: 2,
      transactionReadOnlyVerified: true,
      transactionRolledBack: true,
      codes: ['READINESS_OUTBOX_LAG_EXCEEDED', 'READINESS_OUTBOX_DEAD_LETTER_PRESENT'],
    });
    expect(sql.client.release).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ mode: 'off' }, 'DATABASE_READ_ONLY_MODE_REQUIRED'],
    [{ statement: '0' }, 'SQL_STATEMENT_TIMEOUT_NOT_VERIFIED'],
    [{ lock: '0' }, 'SQL_LOCK_TIMEOUT_NOT_VERIFIED'],
  ])('refuses an unverified transaction gate %j before aggregation', async (options, code) => {
    const sql = sqlFixture(options);
    await expect(
      api.readOnlyOutbox(sql.pool, api.outboxThreshold(metadataFixture().candidate)),
    ).rejects.toThrow(code);
    expect(sql.calls).not.toContain(api.OUTBOX_SQL);
    expect(sql.calls.at(-1)).toBe('rollback');
  });
  it.each(['57014', '42501', '42P01', '28P01'])(
    'sanitizes SQL state %s and rolls back without DML/retry',
    async (sqlState) => {
      const sql = sqlFixture({ sqlState });
      const error = await api
        .readOnlyOutbox(sql.pool, api.outboxThreshold(metadataFixture().candidate))
        .catch((reason: unknown) => reason);
      expect(api.failureResult(error)).toMatchObject({
        result: 'NOT_PROVEN',
        sqlState,
        code: sqlState === '57014' ? 'OUTBOX_SQL_TIMEOUT' : 'OUTBOX_SQL_READ_NOT_PROVEN',
      });
      expect(sql.calls.filter((text) => text === api.OUTBOX_SQL)).toHaveLength(1);
      expect(sql.calls.at(-1)).toBe('rollback');
      expect(sql.calls.join('\n')).not.toMatch(
        /\b(update|insert|delete|grant|create|alter|drop|commit)\b/i,
      );
      expect(JSON.stringify(api.failureResult(error))).not.toContain('PRIVATE');
    },
  );
  it('sanitizes connection failures, rejects missing aggregate and requires rollback', async () => {
    const threshold = api.outboxThreshold(metadataFixture().candidate);
    const connection = sqlFixture({ connectState: '28P01' });
    const error = await api
      .readOnlyOutbox(connection.pool, threshold)
      .catch((reason: unknown) => reason);
    expect(api.failureResult(error)).toMatchObject({
      code: 'DATABASE_CONNECTION_NOT_PROVEN',
      sqlState: '28P01',
    });
    expect(connection.calls).toEqual([]);
    await expect(api.readOnlyOutbox(sqlFixture({ empty: true }).pool, threshold)).rejects.toThrow(
      'OUTBOX_AGGREGATE_SHAPE_INVALID',
    );
    await expect(
      api.readOnlyOutbox(sqlFixture({ rollbackFailure: true }).pool, threshold),
    ).rejects.toThrow('READ_ONLY_ROLLBACK_UNCONFIRMED');
    await expect(
      api.readOnlyOutbox(sqlFixture({ sqlState: '42501', rollbackFailure: true }).pool, threshold),
    ).rejects.toThrow('OUTBOX_SQL_READ_NOT_PROVEN');
    await expect(
      api.readOnlyOutbox(sqlFixture({ releaseFailure: true }).pool, threshold),
    ).rejects.toThrow('DATABASE_CLIENT_RELEASE_NOT_PROVEN');
    await expect(
      api.readOnlyOutbox(sqlFixture({ sqlState: '42501', releaseFailure: true }).pool, threshold),
    ).rejects.toThrow('OUTBOX_SQL_READ_NOT_PROVEN');
  });
  it('retains valid negative/future lag semantics and proves the socket before using the fixed proxy', () => {
    const threshold = api.outboxThreshold(metadataFixture().candidate);
    expect(
      api.evaluateOutbox({ oldest_pending_age_seconds: -60, dead_letter_count: 0 }, threshold),
    ).toMatchObject({ status: 'PASS_OBSERVED_AGGREGATE', oldestPendingAgeSeconds: -60 });
    const options = api.databaseOptions(
      'postgres://fixture:fixture@localhost/fixture?host=' +
        encodeURIComponent('/cloudsql/' + api.EXPECTED.cloudSqlInstance),
    );
    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 6543,
      connectionTimeoutMillis: 5000,
      query_timeout: 7000,
      max: 1,
    });
    expect(options.options).toBe(
      '-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=10000',
    );
    for (const key of ['options', 'search_path', 'schema', 'role', 'database']) {
      expect(() =>
        api.databaseOptions(
          'postgres://fixture:fixture@elsewhere/fixture?' + key + '=PRIVATE-OTHER-SCHEMA',
        ),
      ).toThrow('DATABASE_URL_SESSION_OPTIONS_UNSUPPORTED');
    }
    expect(() =>
      api.databaseOptions('postgres://fixture:fixture@elsewhere/fixture?host=elsewhere'),
    ).toThrow('RUNTIME_DATABASE_ENDPOINT_NOT_PROVEN');
  });
  it.each(['query-socket', 'empty-authority-socket', 'encoded-host-socket'])(
    'matches the native pg parser for %s without connecting',
    (variant) => {
      const socket = '/cloudsql/' + api.EXPECTED.cloudSqlInstance;
      const raw =
        variant === 'encoded-host-socket'
          ? 'postgres://fixture:p%40ss@' + encodeURIComponent(socket) + '/fixture%2Fdb'
          : 'postgres://fixture:p%40ss@' +
            (variant === 'empty-authority-socket' ? '' : 'localhost') +
            '/fixture%2Fdb?host=' +
            encodeURIComponent(socket);
      const options = api.databaseOptions(raw);
      const parsed = (
        new pg.Client({ connectionString: raw }) as unknown as {
          connectionParameters: { host: string; user: string; password: string; database: string };
        }
      ).connectionParameters;
      expect(parsed.host).toBe(socket);
      expect(options).toMatchObject({
        user: parsed.user,
        password: parsed.password,
        database: parsed.database,
      });
      expect(options).toMatchObject({
        host: '127.0.0.1',
        user: 'fixture',
        password: 'p@ss',
        database: 'fixture%2Fdb',
      });
    },
  );
  it.each(['host=/cloudsql/other', 'host=127.0.0.1', 'host=a&host=b', 'port=5433'])(
    'rejects datastore endpoint ambiguity %s',
    (query) => {
      expect(() =>
        api.databaseOptions('postgres://fixture:fixture@localhost/fixture?' + query),
      ).toThrow('RUNTIME_DATABASE_ENDPOINT_NOT_PROVEN');
    },
  );
  it.each([
    ['PGOPTIONS', '-c search_path=private'],
    ['PGPORT', '5433'],
  ])('rejects unproven runtime session input %s', (name, value) => {
    const { service, candidate, previous } = metadataFixture();
    setEnv(candidate, name, value);
    expect(() => api.verifyMetadata(service, candidate, previous, scope())).toThrow(
      'RUNTIME_DATABASE_SESSION_BINDING_NOT_PROVEN',
    );
    setEnv(candidate, name);
    candidate.containers[0]!.env.push({
      name,
      valueSource: { secretKeyRef: { secret: 'PRIVATE-SESSION', version: 'latest' } },
    });
    expect(() => api.verifyMetadata(service, candidate, previous, scope())).toThrow(
      'RUNTIME_DATABASE_SESSION_BINDING_NOT_PROVEN',
    );
  });
});

describe('end-to-end controller gates and public proof', () => {
  it('performs one SQL observation between stable LIVE checks without granting production acceptance', async () => {
    const { deps, sql, observed } = diagnosticDeps();
    const result = api.publicResult(scope(), await api.runDiagnostic(scope(), deps));
    expect(result).toMatchObject({
      result: 'PASS_READONLY_DIAGNOSTIC',
      authorizationStableBeforeAndAfter: true,
      runtimeStableBeforeAndAfter: true,
      productionAcceptance: 'NOT_GRANTED',
      historicalFailureCause: 'NOT_ESTABLISHED',
    });
    expect(deps.metadata).toHaveBeenCalledTimes(3);
    expect(deps.authorize).toHaveBeenCalledTimes(6);
    expect(deps.consume).toHaveBeenCalledTimes(1);
    expect(deps.databaseSecret).toHaveBeenCalledTimes(1);
    expect(sql.calls.filter((text) => text === api.OUTBOX_SQL)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|secretKeyRef|payload|postgres:\/\//);
    expect(observed).toHaveLength(3);
  });
  it('does no GCP/SQL work after initial authority rejection', async () => {
    const { deps } = diagnosticDeps();
    deps.authorize.mockRejectedValueOnce(new api.DiagnosticError('LIVE_AUTHORIZATION_CHANGED'));
    await expect(api.runDiagnostic(scope(), deps)).rejects.toThrow('LIVE_AUTHORIZATION_CHANGED');
    expect(deps.consume).not.toHaveBeenCalled();
    expect(deps.metadata).not.toHaveBeenCalled();
    expect(deps.openDatabase).not.toHaveBeenCalled();
  });
  it.each([1, 2])(
    'rejects metadata drift at read %s and never produces a stable PASS',
    async (phase) => {
      const { deps } = diagnosticDeps();
      const stable = metadata();
      const drift = {
        ...stable,
        publicContext: { ...stable.publicContext, runtimeFingerprint: 'e'.repeat(64) },
      };
      deps.metadata
        .mockResolvedValueOnce(stable)
        .mockResolvedValueOnce(phase === 1 ? drift : stable)
        .mockResolvedValueOnce(drift);
      await expect(api.runDiagnostic(scope(), deps)).rejects.toThrow(
        phase === 1 ? 'RUNTIME_CHANGED_BEFORE_SQL_READ' : 'RUNTIME_CHANGED_DURING_SQL_READ',
      );
      if (phase === 1) expect(deps.databaseSecret).not.toHaveBeenCalled();
    },
  );
  it('preserves the first SQL failure if local connection cleanup also fails', async () => {
    const { deps } = diagnosticDeps();
    const sql = sqlFixture({ sqlState: '42501' });
    deps.openDatabase.mockResolvedValue({
      pool: sql.pool,
      close: vi.fn(() => Promise.reject(new Error('PRIVATE-CLOSE'))),
      runtimeDatabaseEndpointVerified: true,
    });
    await expect(api.runDiagnostic(scope(), deps)).rejects.toThrow('OUTBOX_SQL_READ_NOT_PROVEN');
  });
  it('retains observed configuration and performs no SQL when endpoint equivalence is not proved', async () => {
    const { deps, sql, observed } = diagnosticDeps();
    deps.openDatabase.mockRejectedValueOnce(
      new api.DiagnosticError('RUNTIME_DATABASE_ENDPOINT_NOT_PROVEN'),
    );
    await expect(api.runDiagnostic(scope(), deps)).rejects.toThrow(
      'RUNTIME_DATABASE_ENDPOINT_NOT_PROVEN',
    );
    expect(sql.calls).toEqual([]);
    expect(observed.at(-1)).toHaveProperty('criticalConfiguration');
    const partial = api.publicResult(scope(), observed.at(-1));
    expect(partial.result).toBe('NOT_PROVEN');
    expect(JSON.stringify(partial)).not.toContain('PRIVATE-');
  });
  it('rejects incomplete PASS and arbitrary public fields', () => {
    const result = api.publicResult(scope(), {
      result: 'PASS_READONLY_DIAGNOSTIC',
      code: 'BOUNDED_METADATA_AND_OUTBOX_READBACK_COMPLETE',
      env: 'PRIVATE-ENV',
      rows: ['PRIVATE-ROW'],
      error: 'PRIVATE-ERROR',
    });
    expect(result.result).toBe('NOT_PROVEN');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(api.failureResult(new Error('PRIVATE-SQL-URL'))).toMatchObject({
      code: 'NOT_PROVEN_UNCLASSIFIED_FAILURE',
    });
  });
});

describe('guarded one-use receipt and workflow boundaries', () => {
  it('uses supported issue PATCH requests and still verifies consumption and final readback', async () => {
    let current = issue();
    let comment: ObjectValue | undefined;
    const request = vi.fn<typeof fetch>((input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      const headers = new Headers(init?.headers);
      if (headers.has('If-Match'))
        return Promise.resolve(
          Response.json({ message: 'Conditional PATCH is unsupported' }, { status: 400 }),
        );
      const path = url.pathname.replace('/repos/' + api.REPOSITORY + '/', '');
      const payload =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as { body: string; state?: string })
          : undefined;
      if (init?.method === 'PATCH') {
        if (!payload) throw new Error('Expected JSON issue body');
        current = {
          ...current,
          body: payload.body,
          state: payload.state ?? current.state,
          updated_at: NOW.toISOString(),
        };
      } else if (init?.method === 'POST') {
        if (!payload) throw new Error('Expected JSON comment body');
        comment = {
          id: 999,
          body: payload.body,
          user: { login: 'github-actions[bot]' },
        };
        return Promise.resolve(Response.json(comment));
      }
      return Promise.resolve(
        Response.json(path === 'issues/comments/999' ? comment : current, {
          headers: { etag: 'W/"observed-representation"' },
        }),
      );
    });
    const transport = (path: string, method?: string, body?: unknown) =>
      api.github(path, method, body, request);
    await api.consumeAuthorization(scope(), transport);
    expect(current.body).toContain('CONSUMED_BY_RUN_ID=' + env.GITHUB_RUN_ID);
    const result = await api.finishAuthorization(
      scope(),
      api.publicResult(scope()),
      transport,
      NOW,
    );
    expect(result.status).toBe('CLOSED_OWN_AUTHORIZATION');
    expect(current.state).toBe('closed');
    const writes = request.mock.calls.filter(([, options]) => options?.method === 'PATCH');
    expect(writes).toHaveLength(2);
    expect(writes.every(([, options]) => !new Headers(options?.headers).has('If-Match'))).toBe(
      true,
    );
    expect(request.mock.calls.at(-1)?.[1]?.method).toBe('GET');
  });
  function issueApi() {
    let current = issue();
    const comments = new Map<number, { body: string; user: { login: string } }>();
    const transport = vi.fn(
      (path: string, method = 'GET', body?: { body?: string; state?: string }) => {
        if (method === 'PATCH')
          current = { ...current, ...body, updated_at: '2026-10-19T08:00:00.000Z' };
        if (method === 'POST') {
          comments.set(999, { body: body!.body!, user: { login: 'github-actions[bot]' } });
          return Promise.resolve({ id: 999 });
        }
        return Promise.resolve(
          path.includes('/comments/999')
            ? structuredClone(comments.get(999))
            : structuredClone(current),
        );
      },
    );
    return {
      transport,
      read: () => current,
      change: () => {
        current.body += '\nOWNER-CHANGED';
      },
    };
  }
  it('consumes and closes the same body with exact comment/readback, no duplicate requests', async () => {
    const fake = issueApi();
    await api.consumeAuthorization(scope(), fake.transport);
    expect(fake.read().body).toContain('CONSUMED_BY_RUN_ID=' + env.GITHUB_RUN_ID);
    expect(fake.transport.mock.calls.filter((call) => call[1] === 'PATCH')).toHaveLength(1);
    const result = await api.finishAuthorization(
      scope(),
      api.publicResult(scope()),
      fake.transport,
      NOW,
    );
    expect(result.status).toBe('CLOSED_OWN_AUTHORIZATION');
    expect(fake.read().state).toBe('closed');
    expect(fake.transport.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1);
    expect(fake.transport.mock.calls.filter((call) => call[1] === 'PATCH')).toHaveLength(2);
  });
  it('never overwrites changed owner authorization', async () => {
    const fake = issueApi();
    fake.change();
    await expect(api.consumeAuthorization(scope(), fake.transport)).rejects.toThrow(
      'LIVE_AUTHORIZATION_CHANGED',
    );
    expect(fake.transport.mock.calls.every((call) => call[1] === undefined)).toBe(true);
    await expect(api.finishAuthorization(scope(), {}, fake.transport, NOW)).rejects.toThrow(
      'LIVE_AUTHORIZATION_CHANGED',
    );
  });
  it('never retries a consumption response lost after apply', async () => {
    const fake = issueApi();
    const request = vi.fn(async (path: string, method?: string, body?: { body?: string }) => {
      const response = await fake.transport(path, method, body);
      if (method === 'PATCH') throw new Error('PRIVATE-LOST-RESPONSE');
      return response;
    });
    await expect(api.consumeAuthorization(scope(), request)).rejects.toThrow(
      'PRIVATE-LOST-RESPONSE',
    );
    expect(request.mock.calls.filter((call) => call[1] === 'PATCH')).toHaveLength(1);
    expect(fake.read().body).toContain('AUTHORIZATION_STATE=CONSUMED');
  });
  it('uses existing callback mutex, owner event and pinned identity/proxy with no runtime or logging mutation surface', () => {
    const workflow = readFileSync(api.WORKFLOW_PATH, 'utf8');
    const script = readFileSync(
      'scripts/instagram-webhook-dependency-readonly-diagnostic.mjs',
      'utf8',
    );
    expect(workflow).toContain('instagram-engagement-webhook-callback-control');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('types: [opened]');
    expect(workflow).toContain('github.actor == github.repository_owner');
    expect(workflow).toContain('service_account: ' + api.DEPLOYER);
    expect(workflow).toContain('/cloud-sql-proxy/v2.24.1/');
    expect(workflow).toContain(api.PROXY_SHA256);
    expect(workflow.indexOf('.mjs authorize')).toBeLessThan(
      workflow.indexOf('google-github-actions/auth@'),
    );
    expect(workflow).not.toMatch(
      /workflow_dispatch|schedule:|contents: write|logging|id_token|pnpm build|gcloud run|docker (?:build|push)/,
    );
    expect(workflow).not.toContain('/authorization.json');
    expect(workflow).toContain("steps.authorize.outcome == 'success'");
    expect(script).not.toMatch(
      /logging\.googleapis\.com|gcloud[^\n]*logs|setIamPolicy|drain|replay\(/,
    );
    const cloud = script.slice(
      script.indexOf('export async function cloudMetadataGet'),
      script.indexOf('async function currentMetadata'),
    );
    expect(cloud).toContain("method: 'GET'");
    expect(cloud).not.toMatch(/'POST'|'PATCH'|'DELETE'/);
    expect(script).toContain("stdio: 'ignore'");
    expect(script).not.toMatch(
      /console\.(?:log|error)\([^\n]*(?:raw|token|env|payload|stack|message)/,
    );
  });
});
