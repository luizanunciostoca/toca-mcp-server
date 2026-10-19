import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { loadAg01ProductionConfig } from '../src/orchestrator/production-config.js';
import { getRouteDefinition } from '../src/governance/route-catalog.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { InMemoryAuditSink } from '../src/core/audit.js';
import {
  AUDIT_GENESIS_HASH,
  canonicalAuditPayload,
  hashAuditPayload,
  verifyAuditLedger,
  type AuditLedgerRecord,
} from '../src/core/audit-ledger.js';
import { createToolRegistry } from '../src/registry.js';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import { ExistingCoreCapabilityGateway } from '../src/orchestrator/core-gateway.js';
import { Ag01SpecialistMissionCoordinator } from '../src/orchestrator/specialist-missions.js';
import { InMemoryWorkflowStore } from '../src/workflow/in-memory-workflow-store.js';
import { MetaAdsReadProvider } from '../src/providers/meta-ads/meta-ads-read-provider.js';
import type { MetaApiClient } from '../src/providers/meta/meta-api-client.js';

interface Scope {
  sourceSha: string;
  runtimeSourceSha: string;
  runtimeTreeSha: string;
  revision: string;
  digest: string;
  since: string;
  until: string;
  correlationId: string;
  idempotencyKey: string;
  issueNumber: string;
  runId: string;
  runAttempt: string;
  issueBodyHash: string;
  authorizationFingerprint: string;
}
interface Identity {
  tenantId: string;
  workspaceId: string;
  organizationId: string;
  principalId: string;
  roles: string[];
  routeCapabilities: string[];
  account: string;
}
interface Script {
  TITLE: string;
  ACCOUNT: string;
  CAPABILITY: string;
  SERVICE: string;
  INSIGHT_FIELDS: string[];
  REQUIRED_MARKERS: Record<string, string>;
  instanceFromEnv(env: unknown): Record<string, string>;
  authorizationScope(issue: unknown, instance: unknown, now?: Date, consumed?: boolean): Scope;
  requireStableMain(control: unknown, main: string, instance: unknown): void;
  requireExistingExecutionPolicy(policy: unknown): void;
  revisionContext(
    service: unknown,
    revision: unknown,
    iam: unknown,
    scope: Scope,
  ): {
    publicContext: Record<string, unknown>;
    privateContext: Record<string, unknown>;
  };
  runtimeGateEvidence(revision: unknown): Record<string, unknown>;
  configurationScope(config: unknown, routeCapabilities: readonly string[]): Identity;
  requestFor(scope: Scope): Record<string, unknown>;
  verifyMission(
    snapshot: unknown,
    scope: Scope,
    identity: Identity,
    audit: unknown,
    verification: unknown,
  ): Record<string, unknown>;
  readPersistedProof(database: unknown, scope: Scope, identity: Identity): Promise<unknown[]>;
  executeAcceptance(context: unknown, deps: unknown): Promise<Record<string, unknown>>;
  databasePreflight(pool: unknown): Promise<void>;
}
const moduleUrl = pathToFileURL(resolve('scripts/ag09-native-meta-readonly-acceptance.mjs')).href;
const api = (await import(moduleUrl)) as Script;
const NOW = new Date('2026-10-19T06:00:00.000Z');
const SHA = 'a'.repeat(40);
const RUNTIME_SHA = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const DIGEST = 'sha256:' + 'd'.repeat(64);
const SERVICE_PATH =
  'projects/toca-mcp-production/locations/southamerica-east1/services/' + api.SERVICE;
const REVISION = api.SERVICE + '-accepted-fixture';
const env = {
  GITHUB_REPOSITORY: 'luizanunciostoca/toca-mcp-server',
  GITHUB_SHA: SHA,
  GITHUB_RUN_ID: '39200000000',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_ACTOR: 'luizanunciostoca',
  AUTHORIZATION_ISSUE_NUMBER: '1100',
  GITHUB_REF: 'refs/heads/main',
};
const instance = api.instanceFromEnv(env);
function issue(patch: Record<string, string> = {}) {
  return {
    number: 1100,
    state: 'open',
    title: api.TITLE + ' — fixture',
    user: { login: env.GITHUB_ACTOR },
    body: Object.entries({
      AUTHORIZED_CONTROLLER_SHA: SHA,
      AUTHORIZATION_STATE: 'ACTIVE',
      ...api.REQUIRED_MARKERS,
      EXPECTED_RUNTIME_SOURCE_SHA: RUNTIME_SHA,
      EXPECTED_RUNTIME_TREE_SHA: TREE,
      EXPECTED_AG01_REVISION: REVISION,
      EXPECTED_AG01_IMAGE_DIGEST: DIGEST,
      META_ADS_READ_SINCE: '2026-10-17',
      META_ADS_READ_UNTIL: '2026-10-18',
      AUTHORIZATION_EXPIRES_AT: '2026-10-19T08:00:00Z',
      ...patch,
    })
      .map(([key, value]) => key + '=' + value)
      .join('\n'),
  };
}
const scope = api.authorizationScope(issue(), instance, NOW);
const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1/fixture',
  AG01_MODEL_PROVIDER: 'vertex',
  AG01_GOOGLE_AUTH_MODE: 'gcp_metadata',
  AG01_VERTEX_PROJECT_ID: 'toca-mcp-production',
  AG01_TOCA_OS_ROUTING_SPREADSHEET_ID: 'existing-routing-fixture',
  AG01_TOCA_OS_CANONICAL_RESOURCES_SPREADSHEET_ID: 'existing-resources-fixture',
  AG01_ALLOWED_CAPABILITY_IDS: api.CAPABILITY,
  AG01_ALLOWED_TARGET_ACCOUNTS: api.ACCOUNT,
  AG01_ALLOWED_ROUTE_IDS: 'R08',
  AG01_AUTHORIZATION_ROLES: 'READER',
  TOCA_DEFAULT_TENANT_ID: 'verified-tenant',
  TOCA_DEFAULT_WORKSPACE_ID: 'verified-workspace',
  TOCA_DEFAULT_ORGANIZATION_ID: 'verified-organization',
  AG01_SERVICE_PRINCIPAL_ID: 'verified-principal',
  K_SERVICE: api.SERVICE,
};
const routeCapabilities = getRouteDefinition('R08').capabilityIds;
const config = loadAg01ProductionConfig(productionEnv);
const identity = api.configurationScope(config, routeCapabilities);
function cloudFixture() {
  const traffic = [
    { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: REVISION, percent: 100 },
  ];
  const service = {
    name: SERVICE_PATH,
    uid: '11111111-1111-4111-a111-111111111111',
    etag: 'observed-etag',
    generation: '4',
    observedGeneration: '4',
    reconciling: false,
    traffic: structuredClone(traffic),
    trafficStatuses: structuredClone(traffic),
    uri: 'https://' + api.SERVICE + '-fixture.a.run.app',
  };
  const revision = {
    name: SERVICE_PATH + '/revisions/' + REVISION,
    uid: '22222222-2222-4222-a222-222222222222',
    serviceAccount: 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
    conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }],
    containers: [
      {
        image: 'southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/server@' + DIGEST,
        env: [
          ...Object.entries({
            ...productionEnv,
            TOCA_RELEASE_SHA: RUNTIME_SHA,
            TOCA_AG01_INTERNAL_SPECIALISTS_ENABLED: 'true',
            META_ADS_READ_ENABLED: 'true',
            META_ACCESS_TOKEN_ENV_KEY: 'TOCA_SECRET_META_ACCESS_TOKEN',
          })
            .filter(([key]) => key !== 'DATABASE_URL')
            .map(([name, value]) => ({ name, value })),
          {
            name: 'DATABASE_URL',
            valueSource: { secretKeyRef: { secret: 'toca-database-url', version: 'latest' } },
          },
          {
            name: 'TOCA_SECRET_META_ACCESS_TOKEN',
            valueSource: { secretKeyRef: { secret: 'toca-meta-oauth-token', version: '3' } },
          },
        ],
      },
    ],
    volumes: [
      {
        cloudSqlInstance: {
          instances: ['toca-mcp-production:southamerica-east1:existing-sql-fixture'],
        },
      },
    ],
  };
  const iam = {
    bindings: [
      {
        role: 'roles/run.invoker',
        members: ['serviceAccount:toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com'],
      },
    ],
  };
  return { service, revision, iam };
}
function changed<T>(value: T, path: string, replacement: unknown): T {
  const copy = structuredClone(value);
  const parts = path.split('.');
  let target = copy as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = replacement;
  return copy;
}
function publicRuntime() {
  const f = cloudFixture();
  return api.revisionContext(f.service, f.revision, f.iam, scope).publicContext;
}

// Execute the actual specialist coordinator, Core gateway, runtime binding and
// Meta envelope code. Only the external Graph response is replaced locally.
async function actualProof(rows: Record<string, unknown>[] = []) {
  const graphGet = vi.fn().mockResolvedValue({ data: rows });
  const provider = new MetaAdsReadProvider({ get: graphGet } as unknown as MetaApiClient);
  const audit = new InMemoryAuditSink();
  const workflows = new InMemoryWorkflowStore();
  const executionIdentity = createTrustedServiceExecutionIdentity({
    principalId: identity.principalId,
    tenantId: identity.tenantId,
    workspaceId: identity.workspaceId,
    organizationId: identity.organizationId,
    roles: ['READER'],
    allowedRouteIds: ['R08'],
    allowedCapabilityIds: [api.CAPABILITY],
    allowedTargetAccounts: [api.ACCOUNT],
    evidence: ['verified-fixture-runtime'],
    now: NOW.toISOString(),
  });
  const core = new ExistingCoreCapabilityGateway({
    registry: createToolRegistry({ metaAdsReadsEnabled: true }),
    runtimeResolver: createRuntimeCapabilityResolver({ metaAdsRead: provider }),
    auditSink: audit,
    createExecutionId: () => 'actual-core-fixture-execution',
  });
  const coordinator = new Ag01SpecialistMissionCoordinator(workflows, core, () => NOW);
  const mission = await coordinator.dispatch({
    routeId: 'R08',
    capabilityId: api.CAPABILITY,
    payload: {
      adAccountId: api.ACCOUNT,
      currency: 'BRL',
      level: 'account',
      fields: api.INSIGHT_FIELDS,
      since: scope.since,
      until: scope.until,
    },
    owner: 'AG-09',
    priority: 'P1',
    correlationId: scope.correlationId,
    idempotencyKey: scope.idempotencyKey,
    expiresAt: '2026-10-19T07:00:00Z',
    identity: executionIdentity,
  });
  const result = await coordinator.executeOwned(mission.mission_id, 'AG-09', executionIdentity);
  const snapshot = await workflows.get(mission.mission_id);
  const records: AuditLedgerRecord[] = [];
  let previousHash = AUDIT_GENESIS_HASH;
  for (const event of audit.list()) {
    const sequence = records.length + 1;
    const payload = canonicalAuditPayload(event, 'READ', sequence, previousHash);
    const eventHash = hashAuditPayload(payload);
    records.push({
      ...event,
      eventId: 'fixture-event-' + sequence,
      riskClass: 'READ',
      sequence,
      previousHash,
      eventHash,
      evidence: event.evidence ?? [],
      canonicalPayload: payload,
    });
    previousHash = eventHash;
  }
  const verification = verifyAuditLedger(result.executionId, records, {
    executionId: result.executionId,
    correlationId: scope.correlationId,
    tenantId: identity.tenantId,
    lastSequence: records.length,
    headHash: previousHash,
    updatedAt: NOW.toISOString(),
  });
  return {
    snapshot,
    records,
    verification,
    result,
    graphGet,
    view: await coordinator.status(mission.mission_id, executionIdentity),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('AG09 authorization and current certified source', () => {
  it('binds a fresh owner instance and a closed, bounded date window', () => {
    expect(scope.correlationId).toBe('ag09-readonly-1100-39200000000-1');
    expect(scope.idempotencyKey).toBe(scope.correlationId);
    expect(scope.runtimeSourceSha).toBe(RUNTIME_SHA);
    expect(api.requestFor(scope)).toMatchObject({ routeHint: 'R08' });
    expect(api.requestFor(scope).message).toContain(api.ACCOUNT);
  });

  it.each([
    ['GITHUB_RUN_ATTEMPT', '2'],
    ['GITHUB_ACTOR', 'another-user'],
    ['GITHUB_REF', 'refs/heads/feature'],
    ['GITHUB_REPOSITORY', 'someone/else'],
    ['GITHUB_SHA', 'main'],
  ])('denies invalid instance %s', (key, value) => {
    expect(() => api.instanceFromEnv({ ...env, [key]: value })).toThrow(
      'NEW_OWNER_AUTHORIZATION_ON_MAIN_REQUIRED',
    );
  });

  it.each([
    ['AUTHORIZATION_STATE', 'REVOKED'],
    ['PROVIDER_WRITES_AUTHORIZED', 'true'],
    ['AG09_ROUTE_ID', 'R03'],
    ['META_ADS_ACCOUNT_ID', '999'],
    ['AUTHORIZED_CONTROLLER_SHA', RUNTIME_SHA],
    ['EXISTING_DATABASE_SECRET_READ_AUTHORIZED', 'false'],
  ])('denies revoked or widened marker %s', (key, value) => {
    expect(() => api.authorizationScope(issue({ [key]: value }), instance, NOW)).toThrow(
      'MARKER_MISMATCH_' + key,
    );
  });

  it('denies duplicate markers and binds all authorization text', () => {
    const repeated = issue();
    repeated.body += '\nAG09_ROUTE_ID=R08';
    expect(() => api.authorizationScope(repeated, instance, NOW)).toThrow('MARKER_NOT_UNIQUE');
    const altered = issue();
    altered.body += '\nThe owner changed the scope.';
    expect(api.authorizationScope(altered, instance, NOW).authorizationFingerprint).not.toBe(
      scope.authorizationFingerprint,
    );
  });

  it('accepts consumption only by this exact run and rejects replay markers on ACTIVE', () => {
    const consumed = issue({
      AUTHORIZATION_STATE: 'CONSUMED',
      CONSUMED_BY_RUN_ID: env.GITHUB_RUN_ID,
      CONSUMED_BY_RUN_ATTEMPT: '1',
    });
    expect(api.authorizationScope(consumed, instance, NOW, true).authorizationFingerprint).toBe(
      scope.authorizationFingerprint,
    );
    expect(() =>
      api.authorizationScope(
        issue({
          AUTHORIZATION_STATE: 'CONSUMED',
          CONSUMED_BY_RUN_ID: '99',
          CONSUMED_BY_RUN_ATTEMPT: '1',
        }),
        instance,
        NOW,
        true,
      ),
    ).toThrow('MARKER_MISMATCH_CONSUMED_BY_RUN_ID');
    expect(() =>
      api.authorizationScope(issue({ CONSUMED_BY_RUN_ID: env.GITHUB_RUN_ID }), instance, NOW),
    ).toThrow('AUTHORIZATION_REPLAY_MARKERS');
  });

  it.each([
    { META_ADS_READ_UNTIL: '2026-10-19' },
    { META_ADS_READ_SINCE: '2026-10-10' },
    { META_ADS_READ_SINCE: '2026-10-20' },
    { META_ADS_READ_SINCE: '2026-02-30' },
    { AUTHORIZATION_EXPIRES_AT: '2026-10-19T05:59:59Z' },
    { AUTHORIZATION_EXPIRES_AT: '2026-10-21T00:00:00Z' },
  ])('denies open, invalid, too wide or expired windows (%j)', (patch) => {
    expect(() => api.authorizationScope(issue(patch), instance, NOW)).toThrow();
  });

  it('requires current PASS and no merge reservation, while tolerating canonical repeated false autonomy', () => {
    const body =
      Object.entries({
        PRO_PLUS_CONTROL_PLANE_SCHEMA_VERSION: '2',
        CONTROL_PLANE_ROLE: 'INTEGRATION_QUEUE_AND_MAIN_STABILITY',
        MAIN_STABILITY: 'PASS',
        EVALUATED_MAIN_SHA: SHA,
        MERGE_RESERVATION: 'NONE',
        EXTERNAL_SIDE_EFFECTS_AUTHORIZED: 'false',
        PROVIDER_CALLS_AUTHORIZED: 'false',
        DATABASE_MUTATIONS_AUTHORIZED: 'false',
        SERVICE_MUTATIONS_AUTHORIZED: 'false',
      })
        .map(([key, value]) => key + '=' + value)
        .join('\n') + '\nGENERAL_AUTONOMY=false\nGENERAL_AUTONOMY=false';
    expect(() => api.requireStableMain({ body }, SHA, instance)).not.toThrow();
    expect(() => api.requireStableMain({ body }, RUNTIME_SHA, instance)).toThrow(
      'CURRENT_MAIN_CHANGED',
    );
    expect(() =>
      api.requireStableMain(
        { body: body.replace('MAIN_STABILITY=PASS', 'MAIN_STABILITY=BLOCKED') },
        SHA,
        instance,
      ),
    ).toThrow('MARKER_MISMATCH_MAIN_STABILITY');
    expect(() =>
      api.requireStableMain(
        { body: body.replace('MERGE_RESERVATION=NONE', 'MERGE_RESERVATION=HELD') },
        SHA,
        instance,
      ),
    ).toThrow('MARKER_MISMATCH_MERGE_RESERVATION');
    expect(() =>
      api.requireStableMain({ body: body + '\nGENERAL_AUTONOMY=true' }, SHA, instance),
    ).toThrow('GENERAL_AUTONOMY_MUST_REMAIN_FALSE');
  });

  it('requires existing canonical execution authority without granting additional permissions', () => {
    const policy: unknown = JSON.parse(readFileSync('infra/control-plane/policy.json', 'utf8'));
    expect(() => api.requireExistingExecutionPolicy(policy)).not.toThrow();
    expect(() =>
      api.requireExistingExecutionPolicy(
        changed(policy, 'activeRuntime.ag01Orchestrator.executionAuthorized', false),
      ),
    ).toThrow('EXISTING_AG01_EXECUTION_AUTHORITY_REQUIRED');
    expect(() =>
      api.requireExistingExecutionPolicy(
        changed(policy, 'activeRuntime.ag01Orchestrator.directProviderWriteAuthorized', true),
      ),
    ).toThrow('EXISTING_AG01_EXECUTION_AUTHORITY_REQUIRED');
  });
});

describe('LIVE runtime binding and actual production identity parser', () => {
  it('binds exact serving source, image, references and IAM without publishing env', () => {
    const f = cloudFixture();
    const observed = api.revisionContext(f.service, f.revision, f.iam, scope);
    expect(observed.publicContext).toMatchObject({
      serviceUid: f.service.uid,
      revisionUid: f.revision.uid,
      privateInvokerPostureVerified: true,
      metaSecretReferenceVerified: true,
    });
    expect(JSON.stringify(observed.publicContext)).not.toContain('existing-routing-fixture');
    expect(observed.privateContext.cloudSqlInstance).toBe(
      'toca-mcp-production:southamerica-east1:existing-sql-fixture',
    );
  });

  it.each([
    ['service.reconciling', true],
    ['service.uid', 'wrong'],
    ['service.observedGeneration', '3'],
    ['service.trafficStatuses.0.percent', 50],
    ['service.traffic.0.revision', api.SERVICE + '-other'],
    ['service.uri', 'https://external.example/'],
    ['revision.conditions.0.state', 'CONDITION_FAILED'],
    ['revision.serviceAccount', 'other@toca-mcp-production.iam.gserviceaccount.com'],
    ['revision.containers.0.image', 'foreign.registry/image@' + DIGEST],
    ['iam.bindings.0.members', ['allUsers']],
  ])('denies unverifiable runtime %s', (path, value) => {
    const f = changed(cloudFixture(), path, value);
    expect(() => api.revisionContext(f.service, f.revision, f.iam, scope)).toThrow();
  });

  it.each([
    ['TOCA_RELEASE_SHA', SHA],
    ['TOCA_AG01_INTERNAL_SPECIALISTS_ENABLED', 'false'],
    ['META_ADS_READ_ENABLED', 'false'],
    ['META_ACCESS_TOKEN_ENV_KEY', 'UNAPPROVED_TOKEN_REFERENCE'],
  ])('denies disabled or changed runtime env %s', (name, value) => {
    const f = cloudFixture();
    const entry = f.revision.containers[0]!.env.find((item) => item.name === name)!;
    Object.assign(entry, { value });
    expect(() => api.revisionContext(f.service, f.revision, f.iam, scope)).toThrow();
  });

  it('rejects cross-project secrets, plain credentials and duplicate env; diagnostics remain booleans', () => {
    for (const secret of ['projects/another/secrets/toca-meta-oauth-token', 'another-token']) {
      const f = cloudFixture();
      const entry = f.revision.containers[0]!.env.find(
        (item) => item.name === 'TOCA_SECRET_META_ACCESS_TOKEN',
      )!;
      Object.assign(entry, { valueSource: { secretKeyRef: { secret, version: 'latest' } } });
      expect(() => api.revisionContext(f.service, f.revision, f.iam, scope)).toThrow();
    }
    const f = cloudFixture();
    const token = f.revision.containers[0]!.env.find(
      (item) => item.name === 'TOCA_SECRET_META_ACCESS_TOKEN',
    )!;
    Object.assign(token, { value: 'fixture-secret-must-not-appear' });
    expect(() => api.revisionContext(f.service, f.revision, f.iam, scope)).toThrow();
    const diagnostic = api.runtimeGateEvidence(f.revision);
    expect(Object.values(diagnostic).every((value) => typeof value === 'boolean')).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain('fixture-secret');
    f.revision.containers[0]!.env.push({ name: 'META_ADS_READ_ENABLED', value: 'true' });
    expect(() => api.revisionContext(f.service, f.revision, f.iam, scope)).toThrow(
      'RUNTIME_ENV_AMBIGUOUS',
    );
  });

  it('uses actual configured identity and proves empty production grants still deny', () => {
    expect(identity).toMatchObject({
      principalId: 'verified-principal',
      tenantId: 'verified-tenant',
      workspaceId: 'verified-workspace',
      organizationId: 'verified-organization',
    });
    const empty = loadAg01ProductionConfig({ ...productionEnv, AG01_ALLOWED_CAPABILITY_IDS: '' });
    expect(() => api.configurationScope(empty, routeCapabilities)).toThrow(
      'INSIGHTS_CAPABILITY_NOT_AUTHORIZED',
    );
  });

  it('accepts broader grants outside R08 and the four proven account-bound READs', () => {
    const capabilities = [
      api.CAPABILITY,
      'meta_ads.campaigns.list',
      'meta_ads.adsets.list',
      'meta_ads.ads.list',
      'media.scan',
    ];
    expect(
      api.configurationScope({ ...config, allowedCapabilityIds: capabilities }, routeCapabilities)
        .routeCapabilities,
    ).toEqual(capabilities.slice(0, 4).sort());
  });

  it.each([
    { authorizationRoles: ['READER', 'OPERATOR'] },
    { allowedTargetAccounts: [api.ACCOUNT, '999'] },
    { allowedTargetAccounts: [] },
    { allowedRouteIds: ['R03'] },
    { allowedCapabilityIds: [api.CAPABILITY, 'meta_ads.accounts.list'] },
    { allowedCapabilityIds: [api.CAPABILITY, 'meta_ads.audience.inspect'] },
  ])('denies widened or unbound executable scope (%j)', (patch) => {
    expect(() => api.configurationScope({ ...config, ...patch }, routeCapabilities)).toThrow();
  });
});

describe('actual WorkflowStore / specialist / Core / native Meta proof', () => {
  it('verifies real DONE, persisted Core execution and canonical ledger for legitimate NO_ROWS', async () => {
    const f = await actualProof();
    expect(f.view.status).toBe('DONE');
    expect(f.verification.valid).toBe(true);
    expect(api.verifyMission(f.snapshot, scope, identity, f.records, f.verification)).toMatchObject(
      {
        executionId: f.result.executionId,
        observationState: 'NO_ROWS',
        rowCount: 0,
        providerCurrencyVerified: false,
      },
    );
    expect(f.graphGet).toHaveBeenCalledExactlyOnceWith('act_' + api.ACCOUNT + '/insights', {
      level: 'account',
      fields: api.INSIGHT_FIELDS.join(','),
      time_range: JSON.stringify({ since: scope.since, until: scope.until }),
    });
  });

  it('accepts verified account/currency rows but emits only count and digest', async () => {
    const f = await actualProof([
      {
        account_id: api.ACCOUNT,
        account_currency: 'BRL',
        date_start: scope.since,
        date_stop: scope.until,
        spend: 'sensitive-fixture-metric',
      },
    ]);
    const proof = api.verifyMission(f.snapshot, scope, identity, f.records, f.verification);
    expect(proof).toMatchObject({ rowCount: 1, providerCurrencyVerified: true });
    expect(JSON.stringify(proof)).not.toContain('sensitive-fixture-metric');
  });

  it.each([
    ['instance.status', 'RUNNING'],
    ['instance.tenantId', 'another-tenant'],
    ['instance.definitionVersion', '1.0.0'],
    ['instance.input.owner', 'AG-01'],
    ['events', []],
    ['steps.0.claimedBy', 'ag01-internal:AG-01'],
    ['steps.0.attempts', 2],
    ['steps.0.output.executionId', ''],
    ['steps.0.evidence', ['providerReadbackVerified=true']],
    ['steps.0.input.adAccountId', '999'],
    ['steps.0.input.until', '2026-10-19'],
    ['steps.0.input.fields', ['spend']],
    ['steps.0.output.result.source.provider', 'WINDSOR'],
    ['steps.0.output.result.data', undefined],
    ['steps.0.output.result.observationState', 'ROWS_RETURNED'],
  ])('rejects a false or incomplete ACK at %s', async (path, value) => {
    const f = await actualProof();
    expect(() =>
      api.verifyMission(
        changed(f.snapshot, path, value),
        scope,
        identity,
        f.records,
        f.verification,
      ),
    ).toThrow();
  });

  it.each([
    ['connectedAccount', '999'],
    ['requester', 'someone-else'],
    ['riskClass', 'WRITE_EXTERNAL'],
    ['authorizationRoles', ['OPERATOR']],
    ['status', 'FAILED'],
  ])('rejects audit evidence outside the authorized Core scope: %s', async (field, value) => {
    const f = await actualProof();
    expect(() =>
      api.verifyMission(
        f.snapshot,
        scope,
        identity,
        changed(f.records, '1.' + field, value),
        f.verification,
      ),
    ).toThrow();
  });

  it('rejects an invalid ledger regardless of providerReadbackVerified=true', async () => {
    const f = await actualProof();
    expect(f.result.providerReadbackVerified).toBe(true);
    expect(() =>
      api.verifyMission(f.snapshot, scope, identity, f.records, {
        ...f.verification,
        valid: false,
      }),
    ).toThrow('CORE_AUDIT_CHAIN_NOT_VERIFIED');
  });

  it.each([{ account_id: '999' }, { account_currency: 'USD' }, { date_stop: '2026-10-19' }])(
    'rejects native rows outside account, currency or read window (%j)',
    async (patch) => {
      const f = await actualProof([
        {
          account_id: api.ACCOUNT,
          account_currency: 'BRL',
          date_start: scope.since,
          date_stop: scope.until,
          ...patch,
        },
      ]);
      expect(() =>
        api.verifyMission(f.snapshot, scope, identity, f.records, f.verification),
      ).toThrow('META_ROW_ACCOUNT_CURRENCY_OR_WINDOW_MISMATCH');
    },
  );
});

async function acceptanceHarness() {
  const f = await actualProof();
  let sent = false;
  const events: string[] = [];
  const context = { scope, identity, runtime: publicRuntime() };
  const database = {
    preflight: vi.fn(() => {
      events.push('sql-preflight');
      return Promise.resolve();
    }),
    findMissions: vi.fn(() => {
      events.push('find');
      return Promise.resolve(sent ? [f.view.mission_id] : []);
    }),
    auditByCorrelation: vi.fn(() => {
      events.push('audit');
      return Promise.resolve(sent ? f.records : []);
    }),
    workflow: vi.fn(() => Promise.resolve(f.snapshot)),
    verifyAudit: vi.fn(() => Promise.resolve(f.verification)),
    close: vi.fn(() => Promise.resolve()),
  };
  const deps = {
    liveContext: vi.fn(() =>
      Promise.resolve({
        publicContext: structuredClone(context.runtime),
        privateContext: {},
        identity: structuredClone(identity),
      }),
    ),
    openDatabase: vi.fn(() => Promise.resolve(database)),
    health: vi.fn(() => {
      events.push('health');
      return Promise.resolve();
    }),
    authorize: vi.fn((_scope: unknown, consumed: boolean) => {
      events.push(consumed ? 'auth-consumed' : 'auth-active');
      return Promise.resolve();
    }),
    consume: vi.fn(() => {
      events.push('consume');
      return Promise.resolve();
    }),
    markRequestStarted: vi.fn(() => {
      events.push('mark');
      return Promise.resolve();
    }),
    post: vi.fn(() => {
      sent = true;
      events.push('post');
      return Promise.resolve({
        status: 200,
        body: {
          orchestration: {
            status: 'SUCCEEDED',
            routeId: 'R08',
            primaryAgent: 'AG-09',
            correlationId: scope.correlationId,
            duplicate: false,
          },
        },
      });
    }),
  };
  return {
    f,
    events,
    context,
    database,
    deps,
    markSent: () => {
      sent = true;
    },
  };
}

describe('single POST, LIVE gates and read-only recovery', () => {
  it('preflights reads, revalidates and consumes before exactly one POST', async () => {
    const h = await acceptanceHarness();
    const result = await api.executeAcceptance(h.context, h.deps);
    expect(result.result).toBe('PASS');
    expect(result.classification).toBe('DURABLE_AG09_META_READ_VERIFIED');
    expect(h.events.slice(0, 10)).toEqual([
      'sql-preflight',
      'find',
      'audit',
      'health',
      'auth-active',
      'consume',
      'auth-consumed',
      'mark',
      'post',
      'find',
    ]);
    expect(h.deps.post).toHaveBeenCalledOnce();
    expect(h.database.close).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      providerWrites: false,
      databaseReadbackReadOnly: true,
      rawProviderRowsPublished: false,
    });
  });

  it.each(['preflight', 'health', 'authorize'] as const)(
    'does not POST when %s fails',
    async (gate) => {
      const h = await acceptanceHarness();
      const mock = gate === 'preflight' ? h.database.preflight : h.deps[gate];
      mock.mockRejectedValue(new Error('existing-access-or-state-denied'));
      await expect(api.executeAcceptance(h.context, h.deps)).rejects.toThrow();
      expect(h.deps.post).not.toHaveBeenCalled();
      expect(h.deps.consume).not.toHaveBeenCalled();
      expect(h.database.close).toHaveBeenCalledOnce();
    },
  );

  it('does not consume or POST when existing database access is unavailable', async () => {
    const h = await acceptanceHarness();
    h.deps.openDatabase.mockRejectedValue(new Error('existing-database-reader-denied'));
    await expect(api.executeAcceptance(h.context, h.deps)).rejects.toThrow(
      'existing-database-reader-denied',
    );
    expect(h.deps.post).not.toHaveBeenCalled();
    expect(h.deps.consume).not.toHaveBeenCalled();
  });

  it('rejects persisted replay before consuming or posting', async () => {
    const h = await acceptanceHarness();
    h.markSent();
    await expect(api.executeAcceptance(h.context, h.deps)).rejects.toThrow(
      'MISSION_AUTHORIZATION_REPLAY',
    );
    expect(h.deps.post).not.toHaveBeenCalled();
    expect(h.deps.consume).not.toHaveBeenCalled();
  });

  it('rejects runtime drift immediately before consumption', async () => {
    const h = await acceptanceHarness();
    h.deps.liveContext
      .mockResolvedValueOnce({
        publicContext: structuredClone(h.context.runtime),
        privateContext: {},
        identity,
      })
      .mockResolvedValueOnce({
        publicContext: { ...h.context.runtime, serviceEtag: 'changed' },
        privateContext: {},
        identity,
      });
    await expect(api.executeAcceptance(h.context, h.deps)).rejects.toThrow('AG01_PRESTATE_CHANGED');
    expect(h.deps.post).not.toHaveBeenCalled();
    expect(h.deps.consume).not.toHaveBeenCalled();
  });

  it('reconciles a lost POST response using only the persisted mission, never retries POST', async () => {
    const h = await acceptanceHarness();
    h.deps.post.mockImplementation(() => {
      h.markSent();
      return Promise.reject(new Error('connection-lost'));
    });
    const result = await api.executeAcceptance(h.context, h.deps);
    expect(result).toMatchObject({
      result: 'PASS',
      httpStatus: null,
      classification: 'DURABLE_ACK_VERIFIED_HTTP_RESPONSE_UNCERTAIN',
    });
    expect(h.deps.post).toHaveBeenCalledOnce();
  });

  it('leaves an uncertain missing ACK unproven without retrying the mission', async () => {
    const h = await acceptanceHarness();
    h.deps.post.mockRejectedValue(new Error('connection-lost'));
    await expect(api.executeAcceptance(h.context, h.deps)).rejects.toThrow(
      'SPECIALIST_MISSION_NOT_FOUND_OR_UNBOUNDED',
    );
    expect(h.deps.post).toHaveBeenCalledOnce();
    expect(h.database.close).toHaveBeenCalledOnce();
  });

  it('rejects unexpected Core execution in the same correlation', async () => {
    const h = await acceptanceHarness();
    h.markSent();
    h.database.auditByCorrelation.mockResolvedValue([
      ...h.f.records,
      {
        ...h.f.records[0]!,
        executionId: 'unexpected-execution',
      },
    ]);
    await expect(api.readPersistedProof(h.database, scope, identity)).rejects.toThrow(
      'UNEXPECTED_CORE_EXECUTION_IN_CORRELATION',
    );
  });

  it.each(['on', 'off'])(
    'verifies SQL transaction_read_only=%s before any evidence read',
    async (mode) => {
      const queries: string[] = [];
      const client = {
        query: vi.fn((sql: string) => {
          queries.push(sql);
          return Promise.resolve({
            rows: sql.startsWith('show') ? [{ transaction_read_only: mode }] : [],
          });
        }),
        release: vi.fn(),
      };
      const result = api.databasePreflight({ connect: () => Promise.resolve(client) });
      if (mode === 'on') {
        await result;
        expect(queries).toEqual([
          'begin isolation level repeatable read read only',
          'show transaction_read_only',
          'select 1 from workflow_instances limit 0',
          'select 1 from workflow_steps limit 0',
          'select 1 from workflow_dependencies limit 0',
          'select 1 from workflow_events limit 0',
          'select 1 from workflow_human_tasks limit 0',
          'select 1 from workflow_timers limit 0',
          'select 1 from workflow_compensations limit 0',
          'select 1 from audit_ledger_events limit 0',
          'select 1 from audit_ledger_heads limit 0',
          'commit',
        ]);
      } else {
        await expect(result).rejects.toThrow('DATABASE_READ_ONLY_MODE_REQUIRED');
        expect(queries).toEqual([
          'begin isolation level repeatable read read only',
          'show transaction_read_only',
          'rollback',
        ]);
      }
      expect(client.release).toHaveBeenCalledOnce();
    },
  );
});

describe('controller integration boundary', () => {
  it('shares the AG01 activation mutex and pins all actions and the existing SQL client', () => {
    const workflow = readFileSync(
      '.github/workflows/ag09-native-meta-readonly-acceptance.yml',
      'utf8',
    );
    expect(workflow).toContain("'ag01-grounded-runtime-activation'");
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('environment: production');
    for (const match of workflow.matchAll(/uses: (\S+)/g))
      expect(match[1]).toMatch(/@[a-f0-9]{40}$/);
    expect(workflow).toContain('v2.24.1/cloud-sql-proxy.linux.amd64');
    expect(workflow).toContain('fae2766aac9d614a2bdef2f2a7778f3d054f3acd5ff07a81a9e300bd471512eb');
    expect(workflow).not.toContain('workflow_dispatch');
    expect(workflow).not.toMatch(
      /gcloud (?:run (?:deploy|services update)|projects add-iam|secrets (?:create|add-version))/,
    );
    expect(workflow.indexOf('mjs preflight')).toBeLessThan(workflow.indexOf('mjs execute'));
    expect(workflow.indexOf('mjs execute')).toBeLessThan(workflow.indexOf('mjs finish'));
  });

  it('uses canonical read stores, readonly connection defaults and sanitized artifact allowlist', () => {
    const script = readFileSync('scripts/ag09-native-meta-readonly-acceptance.mjs', 'utf8');
    const workflow = readFileSync(
      '.github/workflows/ag09-native-meta-readonly-acceptance.yml',
      'utf8',
    );
    expect(script).toContain('new PostgresWorkflowStore(pool)');
    expect(script).toContain('new PostgresAuditSink(pool, new ToolRegistry())');
    expect(script).toContain('default_transaction_read_only=on');
    expect(script).toContain('statement_timeout=5000');
    expect(script).toContain("method = 'GET'");
    expect(script).not.toMatch(
      /\b(?:insert into|update workflow_|delete from|create table|grant select)\b/i,
    );
    const artifactPaths = [...workflow.matchAll(/env.AG09_ACCEPTANCE_DIR.*\/(\S+\.json)/g)].map(
      (match) => match[1],
    );
    expect(artifactPaths).toEqual(['context.json', 'result.json', 'finalization.json']);
    expect(workflow).not.toContain('/authorization.json');
    expect(workflow).not.toContain('/**');
  });
});
