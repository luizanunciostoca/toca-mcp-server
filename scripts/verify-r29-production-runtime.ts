import { createHash } from 'node:crypto';
import {
  PostgresVideoContentRuntime,
  type VideoContentRuntimeInput,
} from '../src/content/runtime.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { executeCoreCapability } from '../src/mcp/core-execution.js';
import { CORE_MCP_TOOL_NAMES } from '../src/mcp/core-surface.js';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import { PostgresAuditSink } from '../src/persistence/postgres-audit-sink.js';
import { PostgresContentItemStore } from '../src/persistence/postgres-content-item-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';
import { createToolRegistry } from '../src/registry.js';

const sourceSha = requiredEnv('SOURCE_SHA');
const validationRunId = requiredEnv('VALIDATION_RUN_ID');
const databaseUrl = requiredEnv('DATABASE_URL');
const suffix = createHash('sha256')
  .update(`${sourceSha}|${validationRunId}|r29-production-runtime-v1`)
  .digest('hex')
  .slice(0, 20);

const tenantId = `r29-production-${suffix}`;
const workspaceId = tenantId;
const organizationId = tenantId;
const contentItemId = `r29-production-content-${suffix}`;
const rootVersionId = `r29-production-root-${suffix}`;
const adaptedVersionId = `r29-production-story-${suffix}`;
const correlationId = `r29-production-runtime-${suffix}`;
const contentKey = `r29:production-runtime:${suffix}`;
const sourceAssetId = `r29-source-${suffix}`;
const evidence = [`production:r29:${sourceSha}`, `validation-run:${validationRunId}`];

console.log(
  `R29_PRODUCTION_RUNTIME_START=${JSON.stringify({
    schemaVersion: 1,
    sourceSha,
    validationRunId,
    executionSurface: 'toca.execute',
    externalPublicationExecuted: false,
  })}`,
);

const coreToolNames = new Set<string>(CORE_MCP_TOOL_NAMES);
if (coreToolNames.size !== CORE_MCP_TOOL_NAMES.length || !coreToolNames.has('toca.execute')) {
  throw new Error('R29_PRODUCTION_CORE_SURFACE_MISMATCH');
}

const registry = createToolRegistry({ videoContentRuntimeEnabled: true });
const identity = createTrustedServiceExecutionIdentity({
  principalId: 'service:r29-production-verifier',
  tenantId,
  workspaceId,
  organizationId,
  roles: ['OPERATOR'],
  allowedRouteIds: ['R20', 'R29'],
  allowedCapabilityIds: ['video.caption.embed', 'content_item.channel.adapt'],
  allowedTargetAccounts: [],
  evidence,
});

const pool1 = createPostgresPool({ connectionString: databaseUrl, max: 4 });
let videoExecutionId = '';
let videoResult: unknown;
let videoInput: VideoContentRuntimeInput | undefined;
let artifactExternalResourceId = '';
let artifactRows = 0;
let outboxRows = 0;
let auditValid = false;
let failClosed = false;

try {
  const contentStore = new PostgresContentItemStore(pool1);
  await contentStore.create({
    contentItemId,
    contentKey,
    tenantId,
    workspaceId,
    organizationId,
    assignedRouteId: 'R29',
    channel: 'INSTAGRAM',
    format: 'REEL',
    language: 'pt-BR',
    initialVersionId: rootVersionId,
    sourceAssetIds: [sourceAssetId],
    payload: { purpose: 'R29 production runtime verification' },
    sourceRefs: [`toca://verification/r29/${sourceSha}`],
    idempotencyKey: `r29:production:create:${suffix}`,
    correlationId,
    evidence,
  });

  const runtime = new PostgresVideoContentRuntime(pool1);
  const runtimeResolver = createRuntimeCapabilityResolver({ videoContent: runtime });
  const auditSink = new PostgresAuditSink(pool1, registry);

  videoInput = {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    organization_id: organizationId,
    content_item_id: contentItemId,
    version_id: rootVersionId,
    correlation_id: correlationId,
    idempotency_key: `r29:production:caption:${suffix}`,
    evidence,
    payload: {
      caption: {
        text: 'R29 production verification',
        source_asset_id: sourceAssetId,
      },
    },
  };

  const adaptInput: VideoContentRuntimeInput = {
    tenant_id: tenantId,
    workspace_id: workspaceId,
    organization_id: organizationId,
    content_item_id: contentItemId,
    version_id: rootVersionId,
    correlation_id: correlationId,
    idempotency_key: `r29:production:adapt:${suffix}`,
    evidence,
    target_channel: 'INSTAGRAM',
    target_format: 'STORY',
    payload: {
      new_version_id: adaptedVersionId,
      source_refs: [`toca://verification/r29/${sourceSha}`],
      source_asset_ids: [sourceAssetId],
    },
  };

  const providerVideoResult = await runtime.execute('video.caption.embed', videoInput);
  const providerVideoReadback = await runtime.readback(
    'video.caption.embed',
    providerVideoResult,
    videoInput,
  );
  assert(providerVideoReadback.verified, 'R29_PRODUCTION_PROVIDER_VIDEO_READBACK_FAILED');
  const providerArtifactRef = requiredResultText(providerVideoResult, 'artifactRef');

  const providerVideoRetry = await runtime.execute('video.caption.embed', videoInput);
  const providerRetryReadback = await runtime.readback(
    'video.caption.embed',
    providerVideoRetry,
    videoInput,
  );
  assert(providerRetryReadback.verified, 'R29_PRODUCTION_PROVIDER_VIDEO_RETRY_READBACK_FAILED');
  assert(
    requiredResultText(providerVideoRetry, 'artifactRef') === providerArtifactRef,
    'R29_PRODUCTION_PROVIDER_VIDEO_IDEMPOTENCY_FAILED',
  );

  const providerAdaptResult = await runtime.execute('content_item.channel.adapt', adaptInput);
  const providerAdaptReadback = await runtime.readback(
    'content_item.channel.adapt',
    providerAdaptResult,
    adaptInput,
  );
  assert(providerAdaptReadback.verified, 'R29_PRODUCTION_PROVIDER_ADAPT_READBACK_FAILED');

  const preflightArtifactCount = await pool1.query<{ count: number }>(
    `select count(*)::int as count
       from content_video_artifacts
      where content_item_id = $1 and capability_id = 'video.caption.embed'`,
    [contentItemId],
  );
  const preflightArtifactRows = preflightArtifactCount.rows[0]?.count ?? 0;
  assert(preflightArtifactRows === 1, 'R29_PRODUCTION_PROVIDER_ARTIFACT_COUNT_INVALID');

  const preflightOutboxCount = await pool1.query<{ count: number }>(
    `select count(*)::int as count
       from event_outbox
      where aggregate_id = $1 and event_type = 'content.video_artifact.created'`,
    [contentItemId],
  );
  const preflightOutboxRows = preflightOutboxCount.rows[0]?.count ?? 0;
  assert(preflightOutboxRows === 1, 'R29_PRODUCTION_PROVIDER_OUTBOX_COUNT_INVALID');

  console.log(
    `R29_PRODUCTION_PROVIDER_PREFLIGHT=${JSON.stringify({
      schemaVersion: 1,
      sourceSha,
      validationRunId,
      providerRuntime: 'PostgresVideoContentRuntime',
      videoCapability: 'video.caption.embed',
      r29Capability: 'content_item.channel.adapt',
      videoReadbackVerified: providerVideoReadback.verified,
      r29ReadbackVerified: providerAdaptReadback.verified,
      deterministicRetryVerified: providerRetryReadback.verified,
      artifactRows: preflightArtifactRows,
      outboxRows: preflightOutboxRows,
      artifactExternalResourceId: providerArtifactRef,
      externalPublicationExecuted: false,
    })}`,
  );

  const firstVideo = await executeCoreCapability(
    {
      capabilityId: 'video.caption.embed',
      payload: videoInput,
      correlationId,
    },
    identity,
    { registry, runtimeResolver, auditSink },
  );
  assert(firstVideo.providerReadbackVerified, 'R29_PRODUCTION_VIDEO_READBACK_NOT_VERIFIED');
  videoExecutionId = firstVideo.executionId;
  videoResult = firstVideo.result;
  artifactExternalResourceId = requiredResultText(firstVideo.result, 'artifactRef');

  const retriedVideo = await executeCoreCapability(
    {
      capabilityId: 'video.caption.embed',
      payload: videoInput,
      correlationId,
    },
    identity,
    { registry, runtimeResolver, auditSink },
  );
  assert(retriedVideo.providerReadbackVerified, 'R29_PRODUCTION_VIDEO_RETRY_READBACK_NOT_VERIFIED');
  const retriedArtifactRef = requiredResultText(retriedVideo.result, 'artifactRef');
  assert(
    retriedArtifactRef === artifactExternalResourceId,
    'R29_PRODUCTION_VIDEO_IDEMPOTENCY_FAILED',
  );

  const adapted = await executeCoreCapability(
    {
      capabilityId: 'content_item.channel.adapt',
      payload: adaptInput,
      correlationId,
    },
    identity,
    { registry, runtimeResolver, auditSink },
  );
  assert(adapted.providerReadbackVerified, 'R29_PRODUCTION_ADAPT_READBACK_NOT_VERIFIED');

  const artifactCount = await pool1.query<{ count: number }>(
    `select count(*)::int as count
       from content_video_artifacts
      where content_item_id = $1 and capability_id = 'video.caption.embed'`,
    [contentItemId],
  );
  artifactRows = artifactCount.rows[0]?.count ?? 0;
  assert(artifactRows === 1, 'R29_PRODUCTION_ARTIFACT_IDEMPOTENCY_COUNT_INVALID');

  const outboxCount = await pool1.query<{ count: number }>(
    `select count(*)::int as count
       from event_outbox
      where aggregate_id = $1 and event_type = 'content.video_artifact.created'`,
    [contentItemId],
  );
  outboxRows = outboxCount.rows[0]?.count ?? 0;
  assert(outboxRows === 1, 'R29_PRODUCTION_OUTBOX_COUNT_INVALID');

  const auditVerification = await auditSink.verifyExecution(videoExecutionId);
  auditValid = auditVerification.valid;
  assert(auditValid, 'R29_PRODUCTION_AUDIT_CHAIN_INVALID');
  const auditRecords = await auditSink.listByCorrelation(correlationId, 100);
  assert(
    auditRecords.some(
      (record) => record.toolName === 'video.caption.embed' && record.status === 'SUCCEEDED',
    ),
    'R29_PRODUCTION_VIDEO_AUDIT_MISSING',
  );
  assert(
    auditRecords.some(
      (record) => record.toolName === 'content_item.channel.adapt' && record.status === 'SUCCEEDED',
    ),
    'R29_PRODUCTION_ADAPT_AUDIT_MISSING',
  );

  try {
    await executeCoreCapability(
      {
        capabilityId: 'video.caption.embed',
        payload: videoInput,
        correlationId: `${correlationId}:fail-closed`,
      },
      identity,
      {
        registry: createToolRegistry({ videoContentRuntimeEnabled: false }),
        runtimeResolver: createRuntimeCapabilityResolver({}),
        auditSink,
      },
    );
  } catch (error) {
    failClosed = error instanceof Error && error.message.includes('has no active runtime binding');
  }
  assert(failClosed, 'R29_PRODUCTION_FAIL_CLOSED_NOT_VERIFIED');
} finally {
  await pool1.end();
}

assert(videoInput !== undefined, 'R29_PRODUCTION_VIDEO_INPUT_MISSING');
assert(videoResult !== undefined, 'R29_PRODUCTION_VIDEO_RESULT_MISSING');

const pool2 = createPostgresPool({ connectionString: databaseUrl, max: 4 });
let durableReadbackVerified = false;
try {
  const restartedRuntime = new PostgresVideoContentRuntime(pool2);
  const restartedReadback = await restartedRuntime.readback(
    'video.caption.embed',
    videoResult,
    videoInput,
  );
  durableReadbackVerified =
    restartedReadback.verified &&
    restartedReadback.externalResourceId === artifactExternalResourceId;
  assert(durableReadbackVerified, 'R29_PRODUCTION_DURABLE_READBACK_FAILED');

  const persistedItem = await new PostgresContentItemStore(pool2).get(contentItemId);
  assert(persistedItem !== undefined, 'R29_PRODUCTION_CONTENT_ITEM_MISSING');
  assert(
    persistedItem.currentVersionId === adaptedVersionId &&
      persistedItem.currentContentVersion === 2,
    'R29_PRODUCTION_VERSION_READBACK_FAILED',
  );
} finally {
  await pool2.end();
}

console.log(
  `R29_PRODUCTION_RUNTIME_VERIFY=${JSON.stringify({
    schemaVersion: 1,
    sourceSha,
    validationRunId,
    executionSurface: 'toca.execute',
    executionEngine: 'executeCoreCapability',
    publicToolCount: CORE_MCP_TOOL_NAMES.length,
    videoCapability: 'video.caption.embed',
    r29Capability: 'content_item.channel.adapt',
    providerReadbackVerified: true,
    durableReadbackVerified,
    artifactRows,
    outboxRows,
    auditValid,
    failClosed,
    contentItemId,
    artifactExternalResourceId,
    externalPublicationExecuted: false,
  })}`,
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`R29_PRODUCTION_ENV_REQUIRED:${name}`);
  return value;
}

function requiredResultText(value: unknown, key: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`R29_PRODUCTION_RESULT_OBJECT_REQUIRED:${key}`);
  }
  const field = (value as Record<string, unknown>)[key];
  if (typeof field !== 'string' || !field.trim()) {
    throw new Error(`R29_PRODUCTION_RESULT_FIELD_REQUIRED:${key}`);
  }
  return field.trim();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
