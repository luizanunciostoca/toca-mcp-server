import { createHash } from 'node:crypto';
import {
  PostgresVideoContentRuntime,
  type VideoContentRuntimeInput,
} from '../src/content/runtime.js';
import { createTrustedServiceExecutionIdentity } from '../src/core/identity.js';
import { executeCoreCapability } from '../src/mcp/core-execution.js';
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
const sourceAssetId = `r29-source-${suffix}`;
const evidence = [`production:r29:${sourceSha}`, `validation-run:${validationRunId}`];
const expectedMigrations = [
  '020_content_item_versioning_video.sql',
  '021_r29_video_artifacts.sql',
] as const;

const videoInput: VideoContentRuntimeInput = {
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

const pool = createPostgresPool({ connectionString: databaseUrl, max: 4 });
let failClosed = false;

try {
  const migrationRows = await pool.query<{ readonly version: string }>(
    `select version
       from schema_migrations
      where version = any($1::text[])
      order by version`,
    [expectedMigrations],
  );
  const appliedMigrations = migrationRows.rows.map((row) => row.version);
  assert(
    JSON.stringify(appliedMigrations) === JSON.stringify(expectedMigrations),
    `R29_POST_CLEANUP_MIGRATIONS_MISSING:${JSON.stringify(appliedMigrations)}`,
  );

  const artifacts = await pool.query<{ readonly artifact_ref: string }>(
    `select artifact_ref
       from content_video_artifacts
      where content_item_id = $1 and capability_id = 'video.caption.embed'
      order by created_at,artifact_id`,
    [contentItemId],
  );
  assert(artifacts.rows.length === 1, `R29_POST_CLEANUP_ARTIFACT_COUNT:${artifacts.rows.length}`);
  const artifactRef = artifacts.rows[0]?.artifact_ref;
  assert(Boolean(artifactRef), 'R29_POST_CLEANUP_ARTIFACT_REF_MISSING');

  const runtime = new PostgresVideoContentRuntime(pool);
  const videoReadback = await runtime.readback('video.caption.embed', { artifactRef }, videoInput);
  assert(videoReadback.verified, 'R29_POST_CLEANUP_VIDEO_READBACK_FAILED');
  assert(
    videoReadback.externalResourceId === artifactRef,
    'R29_POST_CLEANUP_VIDEO_RESOURCE_MISMATCH',
  );

  const adaptReadback = await runtime.readback(
    'content_item.channel.adapt',
    { versionId: adaptedVersionId },
    adaptInput,
  );
  assert(adaptReadback.verified, 'R29_POST_CLEANUP_ADAPT_READBACK_FAILED');

  const persistedItem = await new PostgresContentItemStore(pool).get(contentItemId);
  assert(persistedItem !== undefined, 'R29_POST_CLEANUP_CONTENT_ITEM_MISSING');
  assert(
    persistedItem.currentVersionId === adaptedVersionId &&
      persistedItem.currentContentVersion === 2,
    'R29_POST_CLEANUP_CONTENT_VERSION_MISMATCH',
  );

  const registry = createToolRegistry({ videoContentRuntimeEnabled: true });
  const auditSink = new PostgresAuditSink(pool, registry);
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

  const auditRecords = await auditSink.listByCorrelation(correlationId, 100);
  assert(
    auditRecords.some(
      (record) => record.toolName === 'video.caption.embed' && record.status === 'SUCCEEDED',
    ),
    'R29_POST_CLEANUP_VIDEO_AUDIT_MISSING',
  );
  assert(
    auditRecords.some(
      (record) => record.toolName === 'content_item.channel.adapt' && record.status === 'SUCCEEDED',
    ),
    'R29_POST_CLEANUP_ADAPT_AUDIT_MISSING',
  );

  try {
    await executeCoreCapability(
      {
        capabilityId: 'video.caption.embed',
        payload: videoInput,
        correlationId: `${correlationId}:post-cleanup-fail-closed`,
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
  assert(failClosed, 'R29_POST_CLEANUP_FAIL_CLOSED_NOT_VERIFIED');

  const outboxReadback = await pool.query<{ readonly status: string; readonly count: number }>(
    `select status,count(*)::int as count
       from event_outbox
      where evidence @> $1::jsonb and evidence @> $2::jsonb
      group by status order by status`,
    [JSON.stringify([evidence[0]]), JSON.stringify([evidence[1]])],
  );
  const matched = outboxReadback.rows.reduce((sum, row) => sum + Number(row.count), 0);
  const delivered = Number(
    outboxReadback.rows.find((row) => row.status === 'DELIVERED')?.count ?? 0,
  );
  const pending = outboxReadback.rows
    .filter((row) => ['PENDING', 'CLAIMED', 'FAILED_RETRYABLE'].includes(row.status))
    .reduce((sum, row) => sum + Number(row.count), 0);
  assert(matched === 3, `R29_POST_CLEANUP_OUTBOX_MATCHED:${matched}`);
  assert(delivered === 3, `R29_POST_CLEANUP_OUTBOX_DELIVERED:${delivered}`);
  assert(pending === 0, `R29_POST_CLEANUP_OUTBOX_PENDING:${pending}`);

  console.log(
    `R29_POST_CLEANUP_RUNTIME_VERIFY=${JSON.stringify({
      schemaVersion: 1,
      sourceSha,
      validationRunId,
      migrationsVerified: appliedMigrations,
      artifactRows: artifacts.rows.length,
      artifactRef,
      providerReadbackVerified: videoReadback.verified,
      r29ReadbackVerified: adaptReadback.verified,
      durableContentReadbackVerified: true,
      auditReadbackVerified: true,
      failClosed,
      outboxMatched: matched,
      outboxDelivered: delivered,
      outboxPending: pending,
      externalPublicationExecuted: false,
    })}`,
  );
} finally {
  await pool.end();
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`R29_POST_CLEANUP_ENV_REQUIRED:${name}`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
