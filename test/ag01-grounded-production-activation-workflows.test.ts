import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
const ag01 = readFileSync('.github/workflows/ag01-grounded-runtime-activation.yml', 'utf8');
const instagram = readFileSync(
  '.github/workflows/instagram-engagement-ag01-fallback-limited-activation.yml',
  'utf8',
);
const guardian = readFileSync(
  '.github/workflows/ag01-grounded-activation-rollback-guardian.yml',
  'utf8',
);
const startupDiagnostics = readFileSync(
  '.github/workflows/ag01-grounded-startup-failure-diagnostics.yml',
  'utf8',
);
const startupCloudReadback = readFileSync(
  '.github/workflows/ag01-grounded-startup-cloud-readback.yml',
  'utf8',
);
describe('grounded production activation workflows', () => {
  it('keeps AG-01 private, zero-traffic first and provider-write free', () => {
    expect(ag01).toContain('AG01_GROUNDED_RUNTIME_ACTIVATION=AUTHORIZED');
    expect(ag01).toContain('DIRECT_PROVIDER_WRITE_AUTHORIZED=false');
    expect(ag01).toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED=false');
    expect(ag01).toContain('select(.name=="INSTAGRAM_PUBLICATION_WRITES_ENABLED") | .value');
    expect(ag01).toContain('EXTERNAL_BUSINESS_SIDE_EFFECTS_AUTHORIZED=false');
    expect(ag01).toContain('--no-traffic --no-allow-unauthenticated');
    expect(ag01).toContain('/v1/knowledge/answer');
    expect(ag01).toContain('.confidence>=0.85');
    expect(ag01).toContain('DRIVE_SCOPE=READ_ONLY');
    expect(ag01).toContain('roles/run.invoker');
    expect(ag01).toContain('PROMOTION_ATTEMPTED=true');
    expect(ag01).toContain("if: failure() && steps.promote.outputs.promotion_attempted == 'true'");
    expect(ag01).toContain('sanitized-evidence.env');
    expect(ag01).not.toContain('--allow-unauthenticated');
    expect(ag01).not.toContain('service-before.json');
    expect(ag01).not.toContain('ag01-grounded-evidence/grounded-answer.json');
  });
  it('requires explicit owner opt-in for internal READ-only specialists and proves effective revision configuration', () => {
    expect(ag01).toContain('SPECIALISTS_ENABLED=false');
    expect(ag01).toContain('AG01_INTERNAL_SPECIALISTS_ACTIVATION=AUTHORIZED');
    expect(ag01).toContain('AG01_INTERNAL_SPECIALISTS_MODE=READ_ONLY');
    expect(ag01).toContain('AG01_INTERNAL_SPECIALISTS_SIDE_EFFECTS_AUTHORIZED=false');
    expect(ag01).toContain('AG01_INTERNAL_SPECIALISTS_WORKFLOWSTORE_EXISTING_SCHEMA_ONLY=true');
    expect(ag01).toContain('AG01_INTERNAL_SPECIALISTS_CHATGPT_TASKS_DISPATCH=false');
    expect(ag01).toContain('AG01_SPECIALIST_OPTIN_INCOMPLETE');
    expect(ag01).toContain('echo "specialists_enabled=$SPECIALISTS_ENABLED"');
    expect(ag01).toContain('SPECIALISTS_ENABLED: ${{ steps.authz.outputs.specialists_enabled }}');
    expect(ag01).toContain('TOCA_AG01_INTERNAL_SPECIALISTS_ENABLED=$SPECIALISTS_ENABLED');
    expect(ag01).toContain('select(.name=="TOCA_AG01_INTERNAL_SPECIALISTS_ENABLED") | .value');
    expect(ag01).toContain('CURRENT_REVISION_JSON="$(gcloud run revisions describe "$CURRENT"');
    expect(ag01).toContain('SPECIALIST_READONLY_FLAG_VERIFIED=$SPECIALISTS_ENABLED');
    expect(ag01).toContain('SPECIALIST_CORE_PRODUCER_ACK=NOT_PROVEN_BY_GROUNDED_PROBE');
    const authorization = ag01.indexOf('AG01_INTERNAL_SPECIALISTS_ACTIVATION=AUTHORIZED');
    const staging = ag01.indexOf('Stage private AG-01 candidate at zero traffic');
    const promotion = ag01.indexOf('Promote exact candidate transactionally');
    const productionReadback = ag01.indexOf(
      'CURRENT_REVISION_JSON="$(gcloud run revisions describe "$CURRENT"',
    );
    expect(authorization).toBeGreaterThan(0);
    expect(staging).toBeGreaterThan(authorization);
    expect(promotion).toBeGreaterThan(staging);
    expect(productionReadback).toBeGreaterThan(promotion);
    expect(ag01).toContain('--no-traffic --no-allow-unauthenticated');
    expect(ag01).toContain("if: failure() && steps.promote.outputs.promotion_attempted == 'true'");
  });
  it('rejects duplicate, contradictory, partial and conflicting opt-in lines', () => {
    const start = ag01.indexOf('          SPECIALISTS_ENABLED=false');
    const end = ag01.indexOf('          PREVIOUS="$(grep', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const script = ag01
      .slice(start, end)
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n');
    const valid = [
      'AG01_INTERNAL_SPECIALISTS_ACTIVATION=AUTHORIZED',
      'AG01_INTERNAL_SPECIALISTS_MODE=READ_ONLY',
      'AG01_INTERNAL_SPECIALISTS_SIDE_EFFECTS_AUTHORIZED=false',
      'AG01_INTERNAL_SPECIALISTS_WORKFLOWSTORE_EXISTING_SCHEMA_ONLY=true',
      'AG01_INTERNAL_SPECIALISTS_CHATGPT_TASKS_DISPATCH=false',
    ];
    const checked = (body: string) =>
      spawnSync(
        'bash',
        [
          '-c',
          `set -euo pipefail
BODY="$1"
${script}
printf 'SPECIALISTS=%s' "$SPECIALISTS_ENABLED"`,
          '_',
          body,
        ],
        { encoding: 'utf8' },
      );
    const off = checked('OTHER_AUTHORIZATION_STATE=ACTIVE');
    expect(off.status).toBe(0);
    expect(off.stdout).toContain('SPECIALISTS=false');
    const enabled = checked(valid.join('\n'));
    expect(enabled.status).toBe(0);
    expect(enabled.stdout).toContain('SPECIALISTS=true');
    const invalidCases = [
      [...valid, 'AG01_INTERNAL_SPECIALISTS_ACTIVATION=FORBIDDEN'],
      [...valid, 'AG01_INTERNAL_SPECIALISTS_MODE=WRITE'],
      [...valid, valid[0]],
      [...valid, valid[1]],
      valid.slice(1),
      valid.slice(0, -1),
      ['AG01_INTERNAL_SPECIALISTS_ACTIVATION=AUTHORIZED'],
      ['AG01_INTERNAL_SPECIALISTS_MODE=READ_ONLY'],
      ['AG01_INTERNAL_SPECIALISTS_MODE=WRITE'],
    ];
    for (const lines of invalidCases) {
      const result = checked(lines.join('\n'));
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('SPECIALISTS=true');
      expect(result.stderr).toContain('AG01_SPECIALIST_OPTIN_INCOMPLETE');
    }
  });
  it('captures github-only sanitized startup diagnostics without production credentials', () => {
    expect(startupDiagnostics).toContain('AG-01 Grounded Runtime Activation');
    expect(startupDiagnostics).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(startupDiagnostics).toContain('actions: read');
    expect(startupDiagnostics).toContain('gh run view');
    expect(startupDiagnostics).toContain('AG01_PERSISTENCE_NOT_READY');
    expect(startupDiagnostics).toContain('CLOUD_RUN_STARTUP_PROBE_FAILURE');
    expect(startupDiagnostics).toContain('APPROVED_ERROR_TOKENS=');
    expect(startupDiagnostics).toContain('RAW_LOG_PAYLOAD_PUBLISHED=false');
    expect(startupDiagnostics).toContain('GCP_CREDENTIALS_USED=false');
    expect(startupDiagnostics).toContain('TRAFFIC_MUTATION=false');
    expect(startupDiagnostics).toContain('PROVIDER_CALLS=false');
    expect(startupDiagnostics).toContain('DATABASE_MUTATION=false');
    expect(startupDiagnostics).not.toContain('google-github-actions/auth');
    expect(startupDiagnostics).not.toContain('gcloud ');
    expect(startupDiagnostics).not.toContain('READY_REASON=');
    expect(startupDiagnostics).not.toContain("grep -Eo 'AG01_");
    expect(startupDiagnostics).not.toContain('update-traffic');
    expect(startupDiagnostics).not.toContain('run deploy');
  });
  it('performs bounded cloud startup readback without production mutation or raw log publication', () => {
    expect(startupCloudReadback).toContain('AG01_STARTUP_CLOUD_READBACK=AUTHORIZED');
    expect(startupCloudReadback).toContain('NO_TRAFFIC_MUTATION=true');
    expect(startupCloudReadback).toContain('NO_SERVICE_MUTATION=true');
    expect(startupCloudReadback).toContain('NO_IAM_MUTATION=true');
    expect(startupCloudReadback).toContain('NO_DATABASE_MUTATION=true');
    expect(startupCloudReadback).toContain('NO_PROVIDER_CALLS=true');
    expect(startupCloudReadback).toContain('RAW_LOG_PAYLOAD_PUBLISHED=false');
    expect(startupCloudReadback).toContain(
      'toca-ag01-diagnostic-reader@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(startupCloudReadback).not.toContain(
      'toca-mcp-deployer@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(startupCloudReadback).toContain('LIVE_ISSUE=');
    expect(startupCloudReadback).toContain('.state == "open"');
    expect(startupCloudReadback).toContain('gcloud run revisions describe');
    expect(startupCloudReadback).toContain('gcloud logging read');
    expect(startupCloudReadback).toContain('STARTUP_PROBE_TYPE=');
    expect(startupCloudReadback).toContain('startupProbe.tcpSocket');
    expect(startupCloudReadback).toContain('startupProbe.grpc');
    expect(startupCloudReadback).toContain('select(type == "string")');
    expect(startupCloudReadback).toContain('ENV_PRESENCE=');
    expect(startupCloudReadback).toContain('APPROVED_ERROR_TOKENS=');
    expect(startupCloudReadback).toContain('AUTHORIZATION_STATE=CONSUMED');
    expect(startupCloudReadback).not.toContain('gcloud run deploy');
    expect(startupCloudReadback).not.toContain('update-traffic');
    expect(startupCloudReadback).not.toContain('services update');
    expect(startupCloudReadback).not.toContain('scheduler jobs update');
    expect(startupCloudReadback).not.toContain('sql connect');
  });
  it('activates Instagram fallback without widening autonomy or changing scheduler', () => {
    expect(instagram).toContain('INSTAGRAM_AG01_GROUNDED_FALLBACK_LIMITED_ACTIVATION=AUTHORIZED');
    expect(instagram).toContain('AUTO_REPLY_CHANNELS=DIRECT,COMMENT');
    expect(instagram).toContain('GENERAL_AUTONOMY_PROMOTION_AUTHORIZED=false');
    expect(instagram).toContain('DATABASE_MUTATIONS_AUTHORIZED=false');
    expect(instagram).toContain('SCHEDULER_MUTATION_AUTHORIZED=false');
    expect(instagram).toContain('PROVIDER_CONFIG_MUTATION_AUTHORIZED=false');
    expect(instagram).toContain('INSTAGRAM_ENGAGEMENT_AG01_GROUNDED_FALLBACK_ENABLED=true');
    expect(instagram).toContain('--no-traffic --quiet');
    expect(instagram).toContain('DIRECT,COMMENT');
    expect(instagram).toContain('GENERAL_AUTONOMY=false');
    expect(instagram).toContain('roles/run.invoker');
    expect(instagram).toContain('PROMOTION_ATTEMPTED=true');
    expect(instagram).toContain(
      "if: failure() && steps.promote.outputs.promotion_attempted == 'true'",
    );
  });
  it('uses verified instance context and the producers shared writer mutexes', () => {
    expect(guardian).toContain('AG-01 Grounded Runtime Activation');
    expect(guardian).toContain('Instagram Engagement AG-01 Fallback LIMITED Activation');
    expect(guardian).toContain(
      'contains(fromJSON(\'["failure","cancelled","timed_out"]\'), github.event.workflow_run.conclusion)',
    );
    expect(guardian).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(guardian).toContain('actions: read');
    expect(guardian).toContain('guardian-context');
    expect(guardian).toContain("if: steps.context.outputs.context_verified == 'true'");
    expect(guardian).toContain('ag01-grounded-runtime-activation');
    expect(guardian).toContain('instagram-engagement-webhook-callback-control');
    expect(instagram).toContain('instagram-engagement-webhook-callback-control');
    expect(ag01).toContain("'ag01-grounded-runtime-activation'");
    expect(guardian.indexOf('guardian-context')).toBeLessThan(
      guardian.indexOf('Authenticate bounded rollback identity'),
    );
    expect(guardian).not.toContain('historicalVerification.canonicalProductionRevision');
    expect(guardian).not.toContain('ENGAGEMENT_PROMOTED_REVISION=');
    expect(guardian).not.toContain('update-traffic');
    expect(guardian).not.toContain('scheduler jobs update');
  });
  it.each([
    ['ag01', ag01, 'Stage private AG-01 candidate at zero traffic'],
    ['fallback', instagram, 'Stage daemon candidate with grounded fallback at zero traffic'],
  ])('persists and uploads context before the stage for %s', (kind, workflow, stageName) => {
    const prepare = workflow.indexOf('ag01-activation-rollback-guard.mjs prepare ' + kind);
    const upload = workflow.indexOf('Upload required immutable rollback context before stage');
    const stage = workflow.indexOf(stageName);
    expect(prepare).toBeGreaterThan(0);
    expect(upload).toBeGreaterThan(prepare);
    expect(stage).toBeGreaterThan(upload);
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).toContain('CONTEXT_ARTIFACT_ID:');
    expect(workflow).toContain('ag01-activation-rollback-guard.mjs validate-stage ' + kind);
    expect(workflow).toContain('ag01-activation-rollback-guard.mjs authorize ' + kind);
    expect(workflow).toContain('TOCA_ACTIVATION_RUN_ID=$GITHUB_RUN_ID');
    expect(workflow).toContain('TOCA_ACTIVATION_RUN_ATTEMPT=$GITHUB_RUN_ATTEMPT');
    expect(workflow).toContain('TOCA_ACTIVATION_CONTROLLER_SHA=$GITHUB_SHA');
    expect(workflow).toContain(
      'ISSUE_JSON="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${ISSUE_NUMBER}")"',
    );
    expect(workflow).toContain('trap rollback ERR');
    expect(workflow).not.toContain('gcloud run services update-traffic');
  });
  it('probes the official ticket calendar separately on candidate and base', () => {
    expect(ag01).toContain('Em quais dias funciona o Pôr do Sol?');
    expect(ag01).toContain('expectedIntent:"LOCATION_HOURS"');
    expect(ag01).toContain('calendar-evidence candidate');
    expect(ag01).toContain('calendar-evidence base');
    expect(ag01).toContain('SUNSET_TICKET_CALENDAR_SEMANTIC_REVIEW=REQUIRED');
    expect(ag01).toContain('ag01-grounded-evidence/calendar-*.json');
    expect(ag01).toContain('SPECIALIST_CORE_PRODUCER_ACK=NOT_PROVEN_BY_GROUNDED_PROBE');
  });
});
const simulation = String.raw`
const kind = input.kind ?? 'ag01';
const identity = guard.instanceIdentity({
  kind, repository: 'luizanunciostoca/toca-mcp-server', sourceSha: '1'.repeat(40),
  runId: '12345678901', runAttempt: '1', authorizationIssue: '100',
});
const policy = 'e'.repeat(64);
const prefix = 'projects/toca-mcp-production/locations/southamerica-east1/services/' + identity.service;
const previous = identity.service + '-previous';
const other = identity.service + '-newer-owner';
const previousDigest = 'sha256:' + 'b'.repeat(64);
const candidateDigest = 'sha256:' + 'a'.repeat(64);
const workflow = guard.WORKFLOWS[kind];
const scopeLines = Object.entries({
  AUTHORIZED_CONTROLLER_SHA: identity.sourceSha, ...workflow.required,
  EXPECTED_PREVIOUS_REVISION: previous,
  ...(kind === 'fallback' ? {
    RUNTIME_IMAGE_DIGEST: candidateDigest,
    AG01_SERVICE_URL: input.liveAg01Url ?? 'https://toca-ag01-orchestrator-example.a.run.app',
    AG01_AUDIENCE: input.liveAg01Url ?? 'https://toca-ag01-orchestrator-example.a.run.app',
  } : {}),
}).map(([key,value]) => key + '=' + value);
if (input.specialistsAuthorized) scopeLines.push(
  'AG01_INTERNAL_SPECIALISTS_ACTIVATION=AUTHORIZED',
  'AG01_INTERNAL_SPECIALISTS_MODE=READ_ONLY',
  'AG01_INTERNAL_SPECIALISTS_SIDE_EFFECTS_AUTHORIZED=false',
  'AG01_INTERNAL_SPECIALISTS_WORKFLOWSTORE_EXISTING_SCHEMA_ONLY=true',
  'AG01_INTERNAL_SPECIALISTS_CHATGPT_TASKS_DISPATCH=false',
);
let issue = {
  number: 100, user: { login: 'luizanunciostoca' }, title: workflow.title,
  state: input.consumed ? 'closed' : 'open',
  body: ['AUTHORIZATION_STATE=' + (input.consumed ? 'CONSUMED' : 'ACTIVE'), ...scopeLines].join('\n'),
};
const fingerprint = guard.sha256(JSON.stringify(guard.authorizationScope(issue, identity, true)));
let context = {
  schemaVersion: 1, ...identity,
  serviceUid: '00000000-0000-4000-8000-000000000001',
  preRevision: previous, preRevisionUid: '00000000-0000-4000-8000-000000000002',
  preRevisionImageDigest: previousDigest,
  baseUrl: 'https://toca-ag01-orchestrator-example.a.run.app',
  authorizationFingerprint: fingerprint,
  capturedAt: '2026-10-19T00:01:00.000Z',
  candidateImage: 'southamerica-east1-docker.pkg.dev/toca-mcp-production/toca-mcp/' + workflow.image + '@' + candidateDigest,
  candidateImageDigest: candidateDigest,
  policySha256: policy, prestateVerified: true, zeroTrafficStageRequired: true, rollbackOnFailure: true,
};
const deployInputs = {
  image: input.deployImage ?? context.candidateImage,
  specialistsEnabled: input.deploySpecialists ?? (input.specialistsAuthorized ? 'true' : 'false'),
  ag01Url: input.deployAg01Url ?? input.liveAg01Url ?? 'https://toca-ag01-orchestrator-example.a.run.app',
  ag01Audience: input.deployAg01Audience ?? input.liveAg01Url ?? 'https://toca-ag01-orchestrator-example.a.run.app',
};
const revisionType = 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
let service = {
  name: prefix, uid: context.serviceUid, etag: 'etag-1', generation: '1', observedGeneration: '1',
  reconciling: false, invokerIamDisabled: false, uri: context.baseUrl,
};
function setTraffic(rows) {
  service.traffic = rows.map(([revision,percent,tag]) => ({
    type: revisionType, revision, percent, ...(tag ? {tag} : {}),
  }));
  service.trafficStatuses = structuredClone(service.traffic);
}
setTraffic([[previous,100],[identity.candidateRevision,0,identity.candidateTag]]);
const ready = [{type:'Ready',state:'CONDITION_SUCCEEDED'}];
let oldRevision = {
  name: prefix + '/revisions/' + previous, uid: context.preRevisionUid,
  serviceAccount: 'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
  conditions: ready,
  containers: [{image: 'registry/old@' + previousDigest}],
};
let candidate = {
  name: prefix + '/revisions/' + identity.candidateRevision,
  uid: '00000000-0000-4000-8000-000000000003',
  serviceAccount: oldRevision.serviceAccount, conditions: ready,
  createTime: '2026-10-19T00:03:00.000Z',
  containers: [{ image: context.candidateImage, env: [
    {name:'TOCA_ACTIVATION_RUN_ID',value:identity.runId},
    {name:'TOCA_ACTIVATION_RUN_ATTEMPT',value:identity.runAttempt},
    {name:'TOCA_ACTIVATION_CONTROLLER_SHA',value:identity.sourceSha},
  ]}],
};
if (input.traffic === 'own') setTraffic([[identity.candidateRevision,100,identity.candidateTag],[previous,0]]);
if (input.traffic === 'other') setTraffic([[other,100],[identity.candidateRevision,0,identity.candidateTag]]);
if (input.traffic === 'split') setTraffic([[identity.candidateRevision,20],[other,80]]);
if (input.traffic === 'empty') { service.traffic = []; service.trafficStatuses = []; }
if (input.traffic === 'mismatch') service.trafficStatuses = [{type:revisionType,revision:other,percent:100}];
if (input.reconciling) service.reconciling = true;
if (input.invalidReconcilingType) service.reconciling = 'false';
if (input.invalidIamType) service.invokerIamDisabled = 'false';
if (input.uidMismatch) service.uid = '00000000-0000-4000-8000-000000000009';
if (input.noEtag) delete service.etag;
if (input.previousUidMismatch) oldRevision.uid = '00000000-0000-4000-8000-000000000009';
if (input.previousNotReady) oldRevision.conditions = [{type:'Ready',state:'CONDITION_FAILED'}];
if (input.candidateNotReady) candidate.conditions = [{type:'Ready',state:'CONDITION_FAILED'}];
if (input.saMismatch) oldRevision.serviceAccount = 'wrong-sa@example.com';
if (input.candidateWrongRun) candidate.containers[0].env[0].value = '999';
if (input.candidateWrongDigest) candidate.containers[0].image = 'registry/wrong@sha256:' + 'c'.repeat(64);
if (input.noBaseUrl) delete service.uri;
if (input.invokerDisabled) service.invokerIamDisabled = true;
if (input.numericProject) {
  service.name = service.name.replace('toca-mcp-production', '990081828836');
  oldRevision.name = oldRevision.name.replace('toca-mcp-production', '990081828836');
  candidate.name = candidate.name.replace('toca-mcp-production', '990081828836');
}
const repository = { full_name: identity.repository, id: 7 };
const run = {
  id: Number(identity.runId), run_attempt: 1, head_sha: identity.sourceSha,
  head_branch: 'main', repository, head_repository: repository, path: identity.workflowPath,
  name: identity.workflowName, event: 'issues', actor: {login:'luizanunciostoca'},
  triggering_actor: {login:'luizanunciostoca'}, status:input.runStatus ?? 'completed',conclusion:input.conclusion ?? 'failure',
  run_started_at: '2026-10-19T00:00:00.000Z',
};
const event = {repository, workflow_run: structuredClone(run)};
let artifactContext = structuredClone(context);
if (input.uploadedContextMismatch) artifactContext.preRevisionUid = '00000000-0000-4000-8000-000000000007';
if (input.invalidContext) artifactContext.secret = 'secret-must-not-be-published';
if (input.wrongContextRun) artifactContext.runId = '999';
if (input.sameSecondCapture) artifactContext.capturedAt = '2026-10-19T00:02:00.900Z';
if (input.futureContext) artifactContext.capturedAt = '2026-10-19T00:03:00.000Z';
const bytes = Buffer.from(JSON.stringify(artifactContext));
const artifact = {
  id: 300, name: guard.artifactName(identity), expired: false, size_in_bytes: bytes.length,
  digest: 'sha256:' + guard.sha256(bytes),
  created_at:'2026-10-19T00:02:00.000Z', expires_at:'2026-10-20T00:02:00.000Z',
  workflow_run: {
    id: run.id, head_sha: run.head_sha, head_branch: run.head_branch,
    repository_id: 7, head_repository_id: 7,
  },
};
if (input.badArtifactDigest) artifact.digest = 'sha256:' + '0'.repeat(64);
if (input.wrongArtifactRun) artifact.workflow_run.id = 999;
if (input.expiredArtifact) artifact.expired = true;
if (input.changedAuthorization) issue.body = issue.body.replace('EXPECTED_PREVIOUS_REVISION=' + previous, 'EXPECTED_PREVIOUS_REVISION=' + other);
if (input.revokedAuthorization) issue.body = issue.body.replace('AUTHORIZATION_STATE=ACTIVE','AUTHORIZATION_STATE=REVOKED');
if (input.duplicateScope) issue.body += '\nSERVICE_MUTATION_AUTHORIZED=false';
if (input.duplicateConsistentScope) issue.body += '\nSERVICE_MUTATION_AUTHORIZED=true';
if (input.wrongRepo) run.head_repository = {full_name:'other/repo',id:8};
let serviceReads = 0, mutations = 0, downloads = 0, cloudReads = 0;
const patches = [], outputs = [], events = [], evidence = [];
const deps = {
  now: () => new Date('2026-10-19T00:10:00.000Z'),
  wait: () => Promise.resolve(),
  output: (key,value) => { outputs.push([key,value]); events.push(key + '=' + value); },
  evidence: (value) => evidence.push(value),
  github: async (path) => {
    if (path === 'issues/100') return structuredClone(issue);
    if (path === 'branches/main') return {commit:{sha:input.mainChanged ? '9'.repeat(40) : identity.sourceSha}};
    if (path === 'issues/640') return {body:[
      'MAIN_STABILITY=PASS','EVALUATED_MAIN_SHA=' + identity.sourceSha,
      'MERGE_RESERVATION=NONE',
      ...(input.controlAutonomy ?? ['false']).map((value) => 'GENERAL_AUTONOMY=' + value),
      ...(input.duplicateControlStability ? ['MAIN_STABILITY=PASS'] : []),
      'ENGAGEMENT_AUTONOMY_STAGE=LIMITED','ENGAGEMENT_AUTO_REPLY_CHANNELS=DIRECT,COMMENT',
      'DIRECT_LIMITED_RUNTIME_ACTIVE=true','COMMENT_LIMITED_RUNTIME_ACTIVE=true',
    ].join('\n')};
    if (path === 'actions/runs/' + run.id) return {...run,run_attempt:input.staleAttempt ? 2 : 1};
    if (path === 'actions/runs/' + run.id + '/attempts/1') return structuredClone(run);
    if (path === 'actions/artifacts/300') return structuredClone(artifact);
    if (path.includes('/artifacts?')) {
      const artifacts = input.noArtifact ? [] : input.duplicateArtifact ? [artifact, {...artifact,id:301}] : [artifact];
      return {total_count:artifacts.length,artifacts};
    }
    throw new Error('Unexpected GitHub fixture route: ' + path);
  },
  iam: async () => {
    if (input.iamFailure) throw new Error('secret-must-not-be-published');
    return {bindings:input.publicIam ? [{role:'roles/run.invoker',members:['allUsers']}] : []};
  },
  cloud: async (path, options = {}) => {
    if (options.method === 'PATCH') {
      patches.push(structuredClone(options.body));
      events.push('PATCH');
      if (input.rollbackCasConflict && mutations === 1) throw new guard.GuardError('SERVICE_ETAG_CONFLICT',409);
      if (input.casConflict) throw new guard.GuardError('SERVICE_ETAG_CONFLICT',409);
      if (options.body.etag !== service.etag) throw new guard.GuardError('SERVICE_ETAG_CONFLICT',409);
      service.traffic = structuredClone(options.body.traffic);
      service.trafficStatuses = structuredClone(options.body.traffic);
      mutations += 1;
      service.generation = String(mutations+1); service.observedGeneration = service.generation;
      service.etag = 'etag-' + (mutations+1);
      if (input.appliedError && mutations === 1) throw new guard.GuardError('REQUEST_OUTCOME_UNKNOWN');
      return {name:'projects/toca-mcp-production/locations/southamerica-east1/operations/operation-123',done:true};
    }
    cloudReads += 1;
    if (path === prefix) {
      if (input.serviceFailure) throw new Error('secret-must-not-be-published');
      serviceReads += 1;
      if (input.newOwnerDuringCheck && serviceReads === 2) setTraffic([[other,100],[identity.candidateRevision,0]]);
      return structuredClone(service);
    }
    if (path === prefix + '/revisions/' + previous) {
      if (input.revisionFailure) throw new Error('secret-must-not-be-published');
      return structuredClone(oldRevision);
    }
    if (path === prefix + '/revisions/' + identity.candidateRevision) {
      if (input.noCandidate) throw new guard.GuardError('HTTP_REQUEST_FAILED',404);
      return structuredClone(candidate);
    }
    throw new Error('Unexpected Cloud fixture route: ' + path);
  },
  downloadArtifact: async () => { downloads += 1; return bytes; },
  extractContext: () => JSON.parse(bytes.toString()),
};
let result = null, error = null;
try {
  if (input.action === 'guardian') result = await guard.guardianContext(event, policy, deps);
  else if (input.action === 'guardian-rollback') {
    result = await guard.guardianContext(event, policy, deps);
    if (result.context) result = await guard.executeRollback(result.context, deps);
  }
  else if (input.action === 'stability') result = await guard.liveAuthorization(identity, deps, {stability:true});
  else if (input.action === 'stage') result = await guard.validateStageContext(context, policy, '300', deps, deployInputs);
  else if (input.action === 'prestate') result = await guard.capturePrestate(identity, deps);
  else if (input.action === 'prepare') result = await guard.prepareContext(identity, context, context.candidateImage, policy, deps);
  else if (input.action === 'promote') result = await guard.executePromotion(context, deps);
  else if (input.action === 'identity') result = [
    identity,
    guard.instanceIdentity({...identity,runId:'12345678902'}),
    guard.instanceIdentity({...identity,runAttempt:'2'}),
  ];
  else if (input.action === 'auth') {
    result = await guard.liveAuthorization({...identity,runAttempt:input.attempt ?? '1'}, deps);
  }
  else if (input.action === 'calendar') result = guard.calendarProbeEvidence(input.answer, 'candidate', identity.sourceSha);
  else result = await guard.executeRollback(context, deps);
} catch (failure) {
  error = failure.code ?? failure.message;
}
const traffic = service.traffic.filter((entry) => entry.percent > 0).map(({revision,percent}) => ({revision,percent}));
return {result,error,patches,mutations,outputs,events,evidence,downloads,cloudReads,traffic};
`;
type SimulationResult = {
  result: Record<string, unknown> | null;
  error: string | null;
  patches: Array<Record<string, unknown>>;
  mutations: number;
  outputs: string[][];
  events: string[];
  downloads: number;
  evidence: Array<Record<string, unknown>>;
  cloudReads: number;
  traffic: Array<{
    revision: string;
    percent: number;
  }>;
};
// Only this static fixture program is evaluated. Provider artifacts remain JSON data.
const guardModule: unknown = await import(
  pathToFileURL(resolve('scripts/ag01-activation-rollback-guard.mjs')).href
);
async function simulate(input: Record<string, unknown>): Promise<SimulationResult> {
  return await (runInNewContext('(async () => {' + simulation + '})()', {
    guard: guardModule,
    input,
    Buffer,
    structuredClone,
  }) as Promise<SimulationResult>);
}
describe('instance rollback guard behavioral execution', () => {
  it.each(['ag01', 'fallback'])(
    'restores the own candidate for %s with traffic-only CAS',
    async (kind) => {
      const result = await simulate({ kind, traffic: 'own', consumed: true });
      expect(result.error).toBeNull();
      expect(result.result).toMatchObject({
        decision: 'INSTANCE_PRESTATE_RESTORED',
        trafficMutation: true,
      });
      expect(result.patches).toHaveLength(1);
      expect(Object.keys(result.patches[0] ?? {}).sort()).toEqual(['etag', 'name', 'traffic']);
      expect(result.patches[0]?.etag).toBe('etag-1');
      expect(result.mutations).toBe(1);
      expect(result.traffic).toEqual([
        {
          revision:
            kind === 'ag01'
              ? 'toca-ag01-orchestrator-previous'
              : 'toca-managed-instagram-daemon-previous',
          percent: 100,
        },
      ]);
    },
  );
  it.each([
    ['no stage or candidate', { noCandidate: true }],
    ['zero traffic', {}],
    ['newer owner', { traffic: 'other' }],
    ['owner changes during validation', { traffic: 'own', newOwnerDuringCheck: true }],
  ])('performs no mutation for %s', async (_name, options) => {
    const result = await simulate(options);
    expect(result.error).toBeNull();
    expect(result.patches).toHaveLength(0);
    expect(result.mutations).toBe(0);
    expect(result.result).toMatchObject({ trafficMutation: false });
  });
  it.each([
    ['split', { traffic: 'split' }, 'SPLIT_TRAFFIC_NOT_OWNED_BY_INSTANCE'],
    ['empty', { traffic: 'empty' }, 'INVALID_TRAFFIC'],
    ['transient', { traffic: 'mismatch' }, 'TRAFFIC_RECONCILIATION_MISMATCH'],
    ['reconciling', { traffic: 'own', reconciling: true }, 'SERVICE_NOT_STABLE'],
    [
      'malformed reconciling',
      { traffic: 'own', invalidReconcilingType: true },
      'SERVICE_NOT_STABLE',
    ],
    ['recreated service', { traffic: 'own', uidMismatch: true }, 'SERVICE_RECREATED'],
    ['missing etag', { traffic: 'own', noEtag: true }, 'MISSING_SERVICE_ETAG'],
    ['previous recreated', { traffic: 'own', previousUidMismatch: true }, 'REVISION_RECREATED'],
    ['previous not ready', { traffic: 'own', previousNotReady: true }, 'REVISION_NOT_READY'],
    [
      'candidate different instance',
      { traffic: 'own', candidateWrongRun: true },
      'CANDIDATE_INSTANCE_MISMATCH',
    ],
    [
      'candidate different digest',
      { traffic: 'own', candidateWrongDigest: true },
      'REVISION_IMAGE_DIGEST_MISMATCH',
    ],
    [
      'authorization changed',
      { traffic: 'own', changedAuthorization: true },
      'AUTHORIZATION_CHANGED',
    ],
  ])('blocks %s before any write', async (_name, options, error) => {
    const result = await simulate(options);
    expect(result.error).toBe(error);
    expect(result.patches).toHaveLength(0);
    expect(result.mutations).toBe(0);
  });
  it('can roll back its unhealthy candidate while requiring a healthy previous revision', async () => {
    const result = await simulate({ traffic: 'own', candidateNotReady: true });
    expect(result.error).toBeNull();
    expect(result.mutations).toBe(1);
  });
  it('accepts the provider canonical project-number resource spelling', async () => {
    const result = await simulate({ traffic: 'own', numericProject: true });
    expect(result.error).toBeNull();
    expect(result.mutations).toBe(1);
    expect(result.patches[0]?.name).toContain('projects/990081828836/');
  });
  it('does not retry a compare-and-set conflict', async () => {
    const result = await simulate({ traffic: 'own', casConflict: true });
    expect(result.error).toBe('SERVICE_ETAG_CONFLICT');
    expect(result.patches).toHaveLength(1);
    expect(result.mutations).toBe(0);
  });
  it('records promotion intent before a write and restores an applied promotion with error response', async () => {
    const result = await simulate({ action: 'promote', appliedError: true });
    expect(result.error).toBe('PROMOTION_FAILED_RECOVERY_INSTANCE_PRESTATE_RESTORED');
    expect(result.events.indexOf('promotion_attempted=true')).toBeLessThan(
      result.events.indexOf('PATCH'),
    );
    expect(result.patches).toHaveLength(2);
    expect(result.patches[0]?.etag).toBe('etag-1');
    expect(result.patches[1]?.etag).toBe('etag-2');
    expect(result.mutations).toBe(2);
    expect(result.traffic).toEqual([{ revision: 'toca-ag01-orchestrator-previous', percent: 100 }]);
  });
  it('does not restore on a rejected promotion and does not promote an unhealthy candidate', async () => {
    const conflict = await simulate({ action: 'promote', casConflict: true });
    expect(conflict.patches).toHaveLength(1);
    expect(conflict.mutations).toBe(0);
    expect(conflict.error).toBe('PROMOTION_FAILED_RECOVERY_NOOP_ALREADY_RESTORED');
    const unhealthy = await simulate({ action: 'promote', candidateNotReady: true });
    expect(unhealthy.error).toBe('CANDIDATE_NOT_READY');
    expect(unhealthy.patches).toHaveLength(0);
  });
  it('prevents a new stage without preserved prestate or with an already existing candidate', async () => {
    const exists = await simulate({ action: 'prepare' });
    expect(exists.error).toBe('CANDIDATE_ALREADY_EXISTS');
    expect(exists.patches).toHaveLength(0);
    const ready = await simulate({ action: 'prepare', noCandidate: true });
    expect(ready.error).toBeNull();
    expect(ready.result).toMatchObject({
      schemaVersion: 1,
      prestateVerified: true,
      zeroTrafficStageRequired: true,
    });
  });
  it('uses different candidate and tag identities across runs and attempts', async () => {
    const result = await simulate({ action: 'identity' });
    const identities = result.result as unknown as Array<{
      service: string;
      candidateRevision: string;
      candidateTag: string;
    }>;
    expect(new Set(identities.map((value) => value.candidateRevision)).size).toBe(3);
    expect(new Set(identities.map((value) => value.candidateTag)).size).toBe(3);
    expect(identities.every((value) => value.candidateRevision.length <= 63)).toBe(true);
    expect(
      identities.every((value) => value.service.length + value.candidateTag.length <= 46),
    ).toBe(true);
  });
  it.each(['ag01', 'fallback'])(
    'fits the real Cloud Run service/tag budget for %s without truncating instance IDs',
    (kind) => {
      const guard = guardModule as {
        instanceIdentity(input: Record<string, string>): {
          service: string;
          candidateRevision: string;
          candidateTag: string;
          runId: string;
          runAttempt: string;
          sourceSha: string;
        };
      };
      const sourceSha = '8c0a7bac7baf2cb6815861a5dc2c724be8a5af27';
      const inputs = [
        ['39199426972', '1'],
        ['39199426973', '1'],
        ['39199426972', '2'],
        ['999999999999999', '1'],
        ['999999999999999', '999'],
      ];
      const tags = inputs.map(([runId, runAttempt]) => {
        const identity = guard.instanceIdentity({
          kind,
          repository: 'luizanunciostoca/toca-mcp-server',
          sourceSha,
          runId: runId!,
          runAttempt: runAttempt!,
          authorizationIssue: '1078',
        });
        expect(identity.service.length + identity.candidateTag.length).toBeLessThanOrEqual(46);
        expect(identity.candidateTag).toMatch(/^[a-z]-[0-9a-z]+-[0-9a-z]+$/);
        expect(identity.candidateRevision.length).toBeLessThanOrEqual(63);
        expect(identity.runId).toBe(runId);
        expect(identity.runAttempt).toBe(runAttempt);
        expect(identity.sourceSha).toBe(sourceSha);
        const [, encodedRun, encodedAttempt] = identity.candidateTag.split('-');
        expect(BigInt(parseInt(encodedRun!, 36)).toString()).toBe(runId);
        expect(BigInt(parseInt(encodedAttempt!, 36)).toString()).toBe(runAttempt);
        return identity.candidateTag;
      });
      expect(new Set(tags).size).toBe(inputs.length);
    },
  );
});
describe('authenticated recovery artifacts and live single-use authorization', () => {
  it.each(['ag01', 'fallback'])(
    'validates the exact failed producer artifact for %s before cloud credentials',
    async (kind) => {
      const result = await simulate({ kind, action: 'guardian', consumed: true });
      expect(result.error).toBeNull();
      expect(result.result).toMatchObject({ decision: 'CONTEXT_VERIFIED' });
      expect(result.downloads).toBe(1);
      expect(result.cloudReads).toBe(0);
      expect(result.mutations).toBe(0);
    },
  );
  it.each([
    ['legacy or no stage', { noArtifact: true }, 'NOOP_LEGACY_OR_NO_STAGE_CONTEXT'],
    ['old callback after a new attempt', { staleAttempt: true }, 'NOOP_STALE_ATTEMPT'],
  ])('returns an explicit no-op for %s', async (_name, options, decision) => {
    const result = await simulate({ action: 'guardian', ...options });
    expect(result.error).toBeNull();
    expect(result.result).toMatchObject({ decision });
    expect(result.downloads).toBe(0);
    expect(result.cloudReads).toBe(0);
  });
  it.each([
    ['duplicate', { duplicateArtifact: true }, 'DUPLICATE_CONTEXT_ARTIFACT'],
    ['digest mismatch', { badArtifactDigest: true }, 'ARTIFACT_DIGEST_MISMATCH'],
    ['wrong artifact run', { wrongArtifactRun: true }, 'ARTIFACT_ORIGIN_MISMATCH'],
    ['expired', { expiredArtifact: true }, 'INVALID_ARTIFACT_METADATA'],
    ['extra payload', { invalidContext: true }, 'INVALID_CONTEXT_FIELDS'],
    ['wrong context instance', { wrongContextRun: true }, 'CONTEXT_IDENTITY_MISMATCH'],
    ['future capture', { futureContext: true }, 'CONTEXT_CAPTURE_TIME_MISMATCH'],
    ['different repository', { wrongRepo: true }, 'RUN_ORIGIN_MISMATCH'],
    ['new main', { mainChanged: true }, 'MAIN_SHA_CHANGED'],
    [
      'revoked authorization',
      { revokedAuthorization: true },
      'AUTHORIZATION_NOT_ACTIVE_OR_CONSUMED',
    ],
    ['contradictory scope', { duplicateScope: true }, 'AUTHORIZATION_MARKER_COUNT'],
  ])('rejects %s without a cloud read or write', async (_name, options, error) => {
    const result = await simulate({ action: 'guardian', ...options });
    expect(result.error).toBe(error);
    expect(result.cloudReads).toBe(0);
    expect(result.patches).toHaveLength(0);
  });
  it('rejects a consumed issue and a reused attempt before a new activation', async () => {
    expect((await simulate({ action: 'auth', consumed: true })).error).toBe(
      'AUTHORIZATION_NOT_ACTIVE_OR_CONSUMED',
    );
    expect((await simulate({ action: 'auth', attempt: '2' })).error).toBe(
      'AUTHORIZATION_ATTEMPT_REUSE_FORBIDDEN',
    );
  });
});
describe('sanitized prestate diagnosis and public calendar evidence', () => {
  it.each([
    [{ serviceFailure: true }, 'SERVICE_READ_FAILED'],
    [{ iamFailure: true }, 'IAM_READ_FAILED'],
    [{ traffic: 'other' }, 'PRE_REVISION_MISMATCH'],
    [{ traffic: 'split' }, 'TRAFFIC_NOT_SINGLE_100'],
    [{ noBaseUrl: true }, 'BASE_URL_MISSING'],
    [{ publicIam: true }, 'PRIVATE_IAM_FAILED'],
    [{ invokerDisabled: true }, 'PRIVATE_IAM_FAILED'],
    [{ revisionFailure: true }, 'REVISION_READ_FAILED'],
    [{ previousNotReady: true }, 'REVISION_NOT_READY'],
    [{ saMismatch: true }, 'RUNTIME_SERVICE_ACCOUNT_MISMATCH'],
  ])('publishes a distinct failure code for %s', async (options, failureCode) => {
    const result = await simulate({ action: 'prestate', ...options });
    expect(result.result).toMatchObject({
      prestate: null,
      diagnostic: { status: 'BLOCKED', failureCode },
    });
    expect(JSON.stringify(result.result)).not.toContain('secret-must-not-be-published');
    expect(result.patches).toHaveLength(0);
  });
  it('keeps unobserved checks UNKNOWN instead of reporting false or pass', async () => {
    const result = await simulate({ action: 'prestate', serviceFailure: true });
    expect(result.result).toMatchObject({
      diagnostic: {
        serviceRead: 'UNKNOWN',
        iamRead: 'UNKNOWN',
        revisionReady: 'UNKNOWN',
        runtimeServiceAccountMatch: 'UNKNOWN',
      },
    });
  });
  const url = 'https://tocadomorcego.com.br/produtos/experiencia-por-do-sol-3822.html';
  const grounded = {
    status: 'GROUNDED',
    confidence: 0.95,
    citedResourceIds: ['TOCA_OS_FAQ'],
    evidence: ['verified'],
    answer:
      'Para consultar as datas e os horários disponíveis do Pôr do Sol e comprar seu ingresso, acesse a página oficial: ' +
      url,
  };
  it('keeps a short public answer and citations separate from semantic acceptance and specialist ACK', async () => {
    const result = await simulate({ action: 'calendar', answer: grounded });
    expect(result.error).toBeNull();
    expect(result.result).toMatchObject({
      probeStatus: 'GROUNDED_URL_CITATIONS_VERIFIED',
      semanticReview: 'REQUIRED_NO_FIXED_DAYS_OR_UNREQUESTED_HOURS',
      answer: grounded.answer,
      citedResourceIds: ['TOCA_OS_FAQ'],
      specialistMissionAck: 'NOT_PROVEN_BY_KNOWLEDGE_PROBE',
    });
  });
  it.each([
    { ...grounded, status: 'NO_GROUNDED_ANSWER' },
    { ...grounded, answer: 'Todos os dias às 16:30.' },
    { ...grounded, citedResourceIds: [] },
    { ...grounded, confidence: 0.2 },
    { ...grounded, answer: url + 'x'.repeat(1100) },
  ])('does not certify an unverified calendar answer', async (answer) => {
    const result = await simulate({ action: 'calendar', answer });
    expect(result.result).toMatchObject({ probeStatus: 'BLOCKED' });
    expect(String(result.result?.answer).length).toBeLessThanOrEqual(1000);
  });
});

describe('durable context at the exact stage boundary', () => {
  it('compares GitHub artifact timestamps at their published second precision', async () => {
    const result = await simulate({ action: 'guardian', sameSecondCapture: true });
    expect(result.error).toBeNull();
    expect(result.result).toMatchObject({ decision: 'CONTEXT_VERIFIED' });
  });
  it.each(['ag01', 'fallback'])(
    'verifies the durable artifact and current prestate for %s',
    async (kind) => {
      const result = await simulate({ action: 'stage', kind, noCandidate: true });
      expect(result.error).toBeNull();
      expect(result.downloads).toBe(1);
      expect(result.mutations).toBe(0);
      expect(result.result).toMatchObject({ decision: 'LIVE_STAGE_PRECONDITIONS_VERIFIED' });
    },
  );
  it.each([
    [{ badArtifactDigest: true }, 'ARTIFACT_DIGEST_MISMATCH'],
    [{ uploadedContextMismatch: true }, 'CONTEXT_ORIGIN_MISMATCH'],
    [{ previousUidMismatch: true }, 'REVISION_RECREATED'],
    [{ traffic: 'other' }, 'PRESTATE_CHANGED_BEFORE_STAGE'],
    [{ publicIam: true }, 'PRIVATE_IAM_FAILED'],
    [{ invalidIamType: true }, 'INVALID_IAM_READBACK'],
    [{ noCandidate: false }, 'CANDIDATE_ALREADY_EXISTS'],
  ])('rejects changed or unproven context %j before stage', async (options, code) => {
    const result = await simulate({ action: 'stage', noCandidate: true, ...options });
    expect(result.error).toBe(code);
    expect(result.patches).toEqual([]);
  });
});

const archiveGuard = guardModule as {
  extractContextArchive: (bytes: Buffer) => unknown;
  downloadArtifactArchive: (
    id: number,
    headers: Record<string, string>,
    request: (url: string | URL, options?: RequestInit) => Promise<Response>,
  ) => Promise<Buffer>;
};
function zipFixture(entries: Array<[string, string]>) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      [
        'import io, json, sys, zipfile',
        'output = io.BytesIO()',
        'with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:',
        '    for name, value in json.loads(sys.argv[1]): archive.writestr(name, value)',
        'sys.stdout.buffer.write(output.getvalue())',
      ].join('\n'),
      JSON.stringify(entries),
    ],
    {
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  expect(result.status).toBe(0);
  return result.stdout;
}
describe('real ZIP parser and bounded artifact download', () => {
  it.each(['listing-overflow', 'body-overflow', 'stalled'] as const)(
    'rejects a SIGTERM-resistant unzip without hanging the runner: %s',
    (mode) => {
      const folder = mkdtempSync(join(tmpdir(), 'ag01-unzip-boundary-'));
      try {
        const executable = join(folder, 'unzip');
        writeFileSync(
          executable,
          [
            '#!/usr/bin/env node',
            "process.on('SIGTERM', () => {});",
            'const mode = process.env.AG01_UNZIP_TEST_MODE;',
            "if (mode === 'body-overflow' && process.argv.includes('-Z1')) {",
            "  process.stdout.write('rollback-context.json\\n');",
            '} else {',
            "  if (mode !== 'stalled') process.stdout.write('x'.repeat(65536));",
            '  setInterval(() => {}, 1000);',
            '}',
          ].join('\n') + '\n',
        );
        chmodSync(executable, 0o700);
        const script = [
          'const guard = await import(process.argv[1]);',
          'try {',
          "  guard.extractContextArchive(Buffer.from('fixture-only'));",
          "  process.stdout.write('UNEXPECTED_ACCEPTANCE');",
          '  process.exitCode = 1;',
          '} catch (error) {',
          "  process.stdout.write(error.code === 'INVALID_ARTIFACT_ARCHIVE' ? error.code : 'UNEXPECTED_ERROR');",
          "  if (error.code !== 'INVALID_ARTIFACT_ARCHIVE') process.exitCode = 2;",
          '}',
        ].join('\n');
        // GNU timeout kills this isolated process group on regression, including
        // a child that ignores SIGTERM. Vitest's own timer cannot interrupt a
        // synchronous execFileSync blocked inside the tested module.
        const stdoutPath = join(folder, 'stdout');
        const stderrPath = join(folder, 'stderr');
        const stdout = openSync(stdoutPath, 'w');
        const stderr = openSync(stderrPath, 'w');
        let result;
        try {
          result = spawnSync(
            'timeout',
            [
              '--signal=KILL',
              '8s',
              process.execPath,
              '--input-type=module',
              '-e',
              script,
              pathToFileURL(resolve('scripts/ag01-activation-rollback-guard.mjs')).href,
            ],
            {
              encoding: 'utf8',
              timeout: 9000,
              killSignal: 'SIGKILL',
              stdio: ['ignore', stdout, stderr],
              env: {
                ...process.env,
                PATH: folder + delimiter + (process.env.PATH ?? ''),
                AG01_UNZIP_TEST_MODE: mode,
              },
            },
          );
        } finally {
          closeSync(stdout);
          closeSync(stderr);
        }
        expect(result.error).toBeUndefined();
        expect(result.status, readFileSync(stderrPath, 'utf8')).toBe(0);
        expect(readFileSync(stdoutPath, 'utf8')).toBe('INVALID_ARTIFACT_ARCHIVE');
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
    12000,
  );

  it('reads a single JSON member without executing or extracting it', () => {
    const payload = { proof: 'example-only', text: '$(touch /tmp/untrusted)' };
    const bytes = zipFixture([['rollback-context.json', JSON.stringify(payload)]]);
    expect(archiveGuard.extractContextArchive(bytes)).toEqual(payload);
  });
  it.each([
    [['../rollback-context.json', '{}']],
    [
      ['rollback-context.json', '{}'],
      ['extra.json', '{}'],
    ],
    [
      ['rollback-context.json', '{}'],
      ['rollback-context.json', '{}'],
    ],
    [['rollback-context.json', 'not JSON']],
    [['rollback-context.json', JSON.stringify({ oversized: 'x'.repeat(40000) })]],
  ] satisfies Array<Array<[string, string]>>)('rejects invalid archive case %#', (...entries) => {
    expect(() => archiveGuard.extractContextArchive(zipFixture(entries))).toThrow(
      'INVALID_ARTIFACT_ARCHIVE',
    );
  });
  it('rejects malformed bytes and oversized archives', () => {
    expect(() => archiveGuard.extractContextArchive(Buffer.from('invalid ZIP'))).toThrow(
      'INVALID_ARTIFACT_ARCHIVE',
    );
    expect(() => archiveGuard.extractContextArchive(Buffer.alloc(1024 * 1024 + 1))).toThrow(
      'INVALID_ARTIFACT_ARCHIVE',
    );
  });
  it('uses authenticated GitHub metadata and strips credentials from storage requests', async () => {
    const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
    const request = (url: string | URL, options?: RequestInit) => {
      calls.push({ url: String(url), options });
      return Promise.resolve(
        calls.length === 1
          ? new Response(null, {
              status: 302,
              headers: {
                location: 'https://artifacts.blob.core.windows.net/context.zip?sig=example',
              },
            })
          : new Response(new Uint8Array([1, 2, 3])),
      );
    };
    expect(
      await archiveGuard.downloadArtifactArchive(
        300,
        { Authorization: 'Bearer synthetic-test' },
        request,
      ),
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/luizanunciostoca/toca-mcp-server/actions/artifacts/300/zip',
    );
    expect(calls[0]?.options?.redirect).toBe('manual');
    expect(calls[1]?.options?.headers).toBeUndefined();
    expect(calls[1]?.options?.redirect).toBe('error');
  });
  it.each([
    'http://artifacts.blob.core.windows.net/context.zip',
    'https://blob.core.windows.net.attacker.invalid/context.zip',
    'https://attacker.invalid/context.zip',
    'https://user:password@artifacts.blob.core.windows.net/context.zip',
    'https://artifacts.blob.core.windows.net:8443/context.zip',
  ])('rejects an unauthorized artifact destination %s', async (location) => {
    let calls = 0;
    const request = () => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 302, headers: { location } }));
    };
    await expect(archiveGuard.downloadArtifactArchive(300, {}, request)).rejects.toThrow(
      'ARTIFACT_HOST_INVALID',
    );
    expect(calls).toBe(1);
  });
  it('sanitizes transport failure without publishing its payload', async () => {
    const request = () => Promise.reject(new Error('synthetic-secret'));
    await expect(archiveGuard.downloadArtifactArchive(300, {}, request)).rejects.toThrow(
      'ARTIFACT_DOWNLOAD_FAILED',
    );
  });
});

describe('uncertain rollback responses preserve the first failure', () => {
  it('accepts only provider readback of the restored prestate without retrying a failed rollback call', async () => {
    const result = await simulate({ traffic: 'own', appliedError: true });
    expect(result.error).toBeNull();
    expect(result.patches).toHaveLength(1);
    expect(result.result).toMatchObject({
      decision: 'INSTANCE_PRESTATE_RESTORED_AFTER_UNCERTAIN_RESPONSE',
      trafficMutation: 'UNKNOWN',
      prestateRestored: true,
    });
    expect(result.traffic).toEqual([{ revision: 'toca-ag01-orchestrator-previous', percent: 100 }]);
  });
  it('retains both the promotion failure and blocked compensation while making no blind retry', async () => {
    const result = await simulate({
      action: 'promote',
      appliedError: true,
      rollbackCasConflict: true,
    });
    expect(result.error).toBe(
      'PROMOTION_FAILED_REQUEST_OUTCOME_UNKNOWN_RECOVERY_BLOCKED_SERVICE_ETAG_CONFLICT',
    );
    expect(result.patches).toHaveLength(2);
    expect(result.mutations).toBe(1);
    expect(result.evidence).toContainEqual({
      promotionStatus: 'FAILED',
      failureCode: 'REQUEST_OUTCOME_UNKNOWN',
      recovery: { status: 'BLOCKED', failureCode: 'SERVICE_ETAG_CONFLICT' },
    });
  });
});

describe('canonical control duplicates and completed non-success recovery', () => {
  it('accepts the canonical repeated GENERAL_AUTONOMY=false control facts', async () => {
    const result = await simulate({ action: 'stability', controlAutonomy: ['false', 'false'] });
    expect(result.error).toBeNull();
  });
  it.each([[], ['false', 'true'], ['true', 'false'], ['true']])(
    'rejects absent or conflicting autonomy controls %#',
    async (...controlAutonomy) => {
      const result = await simulate({ action: 'stability', controlAutonomy });
      expect(result.error).toBe('MAIN_STABILITY_BLOCKED');
      expect(result.patches).toEqual([]);
    },
  );
  it('retains unique authorization and all other unique control markers', async () => {
    expect((await simulate({ action: 'stability', duplicateConsistentScope: true })).error).toBe(
      'AUTHORIZATION_MARKER_COUNT',
    );
    expect((await simulate({ action: 'stability', duplicateControlStability: true })).error).toBe(
      'AUTHORIZATION_MARKER_COUNT',
    );
  });
  it.each(['cancelled', 'timed_out'])(
    'recovers %s only through verified context and own traffic',
    async (conclusion) => {
      const result = await simulate({ action: 'guardian-rollback', conclusion, traffic: 'own' });
      expect(result.error).toBeNull();
      expect(result.result).toMatchObject({ decision: 'INSTANCE_PRESTATE_RESTORED' });
      expect(result.patches).toHaveLength(1);
      expect(result.traffic).toEqual([
        { revision: 'toca-ag01-orchestrator-previous', percent: 100 },
      ]);
    },
  );
  it.each(['cancelled', 'timed_out'])(
    'performs no cloud read without an artifact after %s',
    async (conclusion) => {
      const result = await simulate({ action: 'guardian-rollback', conclusion, noArtifact: true });
      expect(result.error).toBeNull();
      expect(result.result).toMatchObject({ decision: 'NOOP_LEGACY_OR_NO_STAGE_CONTEXT' });
      expect(result.cloudReads).toBe(0);
      expect(result.patches).toEqual([]);
    },
  );
  it.each(['success', 'neutral', 'skipped'])(
    'rejects unrelated conclusion %s',
    async (conclusion) => {
      const result = await simulate({ action: 'guardian-rollback', conclusion, traffic: 'own' });
      expect(result.error).toBe('INVALID_GUARDIAN_EVENT');
      expect(result.cloudReads).toBe(0);
    },
  );
  it('rejects a noncompleted run and keeps stale-attempt protection for cancellation', async () => {
    expect(
      (
        await simulate({
          action: 'guardian-rollback',
          conclusion: 'cancelled',
          runStatus: 'in_progress',
        })
      ).error,
    ).toBe('ORIGIN_RUN_NOT_RECOVERABLE');
    const stale = await simulate({
      action: 'guardian-rollback',
      conclusion: 'cancelled',
      staleAttempt: true,
      traffic: 'own',
    });
    expect(stale.result).toMatchObject({ decision: 'NOOP_STALE_ATTEMPT' });
    expect(stale.patches).toEqual([]);
  });
});

describe('effective deploy inputs remain bound to the live authorization scope', () => {
  it('blocks an old enabled flag after all specialist opt-in markers were removed before prestate', async () => {
    const result = await simulate({
      action: 'stage',
      noCandidate: true,
      deploySpecialists: 'true',
    });
    expect(result.error).toBe('EFFECTIVE_SPECIALIST_SCOPE_MISMATCH');
    expect(result.patches).toEqual([]);
    expect(result.cloudReads).toBe(0);
  });
  it('blocks an old disabled flag when the live scope now explicitly requests specialists', async () => {
    const result = await simulate({
      action: 'stage',
      noCandidate: true,
      specialistsAuthorized: true,
      deploySpecialists: 'false',
    });
    expect(result.error).toBe('EFFECTIVE_SPECIALIST_SCOPE_MISMATCH');
    expect(result.cloudReads).toBe(0);
  });
  it.each([false, true])(
    'accepts the effective specialist flag only with its current matching opt-in=%s',
    async (specialistsAuthorized) => {
      const result = await simulate({ action: 'stage', noCandidate: true, specialistsAuthorized });
      expect(result.error).toBeNull();
      expect(result.result).toMatchObject({ decision: 'LIVE_STAGE_PRECONDITIONS_VERIFIED' });
    },
  );
  it.each(['deployAg01Url', 'deployAg01Audience'])(
    'blocks stale fallback input %s after the live scope changed',
    async (key) => {
      const result = await simulate({
        action: 'stage',
        kind: 'fallback',
        noCandidate: true,
        liveAg01Url: 'https://toca-ag01-orchestrator-new.a.run.app',
        [key]: 'https://toca-ag01-orchestrator-example.a.run.app',
      });
      expect(result.error).toBe('EFFECTIVE_FALLBACK_SCOPE_MISMATCH');
      expect(result.patches).toEqual([]);
      expect(result.cloudReads).toBe(0);
    },
  );
  it.each(['ag01', 'fallback'])(
    'rejects an effective image differing from the authenticated context for %s',
    async (kind) => {
      const result = await simulate({
        action: 'stage',
        kind,
        noCandidate: true,
        deployImage: 'unrelated/image@sha256:' + 'a'.repeat(64),
      });
      expect(result.error).toBe('EFFECTIVE_DEPLOY_IMAGE_MISMATCH');
      expect(result.cloudReads).toBe(0);
    },
  );
  it('passes the actual deploy environment into the stage validator', () => {
    const helper = readFileSync('scripts/ag01-activation-rollback-guard.mjs', 'utf8');
    expect(helper).toContain(
      "image: context.kind === 'ag01' ? process.env.IMAGE : process.env.RUNTIME_IMAGE",
    );
    expect(helper).toContain('specialistsEnabled: process.env.SPECIALISTS_ENABLED');
    expect(helper).toContain('ag01Url: process.env.AG01_URL');
    expect(helper).toContain('ag01Audience: process.env.AG01_AUDIENCE');
  });
});
