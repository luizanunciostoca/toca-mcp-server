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
if (
  coreToolNames.size !== CORE_MCP_TOOL_NAMES.length ||
  !coreToolNames.has('toca.execute')
) {
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
    source_version_id: rootVersionId,
    version_id: adaptedVersionId,
    source_asset_ids: [sourceAssetId],
    motion_profile: 'SUBTLE',
    aspect_ratio: '9:16',
    duration_seconds: 6,
    loop: false,
    transition_style: 'CUT',
    output_format: 'MP4',
    provider: 'TOCA_INTERNAL',
    idempotency_key: `r29:production:video:${suffix}`,
    correlation_id: correlationId,
    evidence,
  };

  const execution = await executeCoreCapability(
    {
      capabilityId: 'video.photo.motion.generate',
      payload: videoInput,
      correlationId,
    },
    identity,
    { registry, runtimeResolver, auditSink },
  );
  videoExecutionId = execution.executionId;
  videoResult = execution.result;
  if (
    !videoResult ||
    typeof videoResult !== 'object' ||
    !('artifact_external_resource_id' in videoResult) ||
    typeof videoResult.artifact_external_resource_id !== 'string'
  ) {
    throw new Error('R29_PRODUCTION_ARTIFACT_RESOURCE_ID_MISSING');
  }
  artifactExternalResourceId = videoResult.artifact_external_resource_id;

  const artifactCount = await pool1.query<{ count: string }>(
    `select count(*)::text as count
       from media_artifacts
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and external_resource_id = $4`,
    [tenantId, workspaceId, organizationId, artifactExternalResourceId],
  );
  artifactRows = Number.parseInt(artifactCount.rows[0]?.count ?? '0', 10);

  const outboxCount = await pool1.query<{ count: string }>(
    `select count(*)::text as count
       from outbox_events
      where tenant_id = $1
        and aggregate_type = 'CONTENT_ITEM'
        and aggregate_id = $2`,
    [tenantId, contentItemId],
  );
  outboxRows = Number.parseInt(outboxCount.rows[0]?.count ?? '0', 10);

  const audit = await auditSink.verifyExecution(videoExecutionId);
  auditValid = audit.valid;

  try {
    await executeCoreCapability(
      {
        capabilityId: 'video.photo.motion.generate',
        payload: { ...videoInput, idempotency_key: `r29:production:invalid:${suffix}` },
        correlationId: `${correlationId}:invalid`,
      },
      identity,
      {
        registry,
        runtimeResolver: () => undefined,
        auditSink,
      },
    );
  } catch (error) {
    failClosed =
      error instanceof Error &&
      (error.message.includes('CAPABILITY_NOT_EXECUTABLE') ||
        error.message.includes('Runtime binding'));
  }
} finally {
  await pool1.end();
}

if (
  !videoExecutionId ||
  !artifactExternalResourceId ||
  artifactRows !== 1 ||
  outboxRows < 1 ||
  !auditValid ||
  !failClosed
) {
  throw new Error(
    `R29_PRODUCTION_RUNTIME_ASSERTION_FAILED:${JSON.stringify({
      videoExecutionId: Boolean(videoExecutionId),
      artifactExternalResourceId: Boolean(artifactExternalResourceId),
      artifactRows,
      outboxRows,
      auditValid,
      failClosed,
    })}`,
  );
}

const pool2 = createPostgresPool({ connectionString: databaseUrl, max: 4 });
let restartedArtifactRows = 0;
let restartedOutboxRows = 0;
try {
  const artifactCount = await pool2.query<{ count: string }>(
    `select count(*)::text as count
       from media_artifacts
      where tenant_id = $1
        and workspace_id = $2
        and organization_id = $3
        and external_resource_id = $4`,
    [tenantId, workspaceId, organizationId, artifactExternalResourceId],
  );
  restartedArtifactRows = Number.parseInt(artifactCount.rows[0]?.count ?? '0', 10);

  const outboxCount = await pool2.query<{ count: string }>(
    `select count(*)::text as count
       from outbox_events
      where tenant_id = $1
        and aggregate_type = 'CONTENT_ITEM'
        and aggregate_id = $2`,
    [tenantId, contentItemId],
  );
  restartedOutboxRows = Number.parseInt(outboxCount.rows[0]?.count ?? '0', 10);
} finally {
  await pool2.end();
}

if (restartedArtifactRows !== 1 || restartedOutboxRows < 1) {
  throw new Error(
    `R29_PRODUCTION_RESTART_READBACK_FAILED:${JSON.stringify({
      restartedArtifactRows,
      restartedOutboxRows,
    })}`,
  );
}

console.log(
  `R29_PRODUCTION_RUNTIME_RESULT=${JSON.stringify({
    schemaVersion: 1,
    sourceSha,
    validationRunId,
    executionSurface: 'toca.execute',
    executionId: videoExecutionId,
    externalResourceId: artifactExternalResourceId,
    artifactRows,
    outboxRows,
    auditValid,
    failClosed,
    restartedArtifactRows,
    restartedOutboxRows,
    externalPublicationExecuted: false,
  })}`,
);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
