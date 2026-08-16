import { describe, expect, it } from 'vitest';
import type { VideoContentRuntimeInput } from '../src/content/runtime.js';
import { PostgresVideoContentRuntime } from '../src/content/runtime.js';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import { PostgresContentItemStore } from '../src/persistence/postgres-content-item-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('R29_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Video/R29 PostgreSQL execution E2E', () => {
  it('persists idempotent video artifacts and verifies R29 mutations after a pool restart', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tenantId = `r29-tenant-${suffix}`;
    const workspaceId = `r29-workspace-${suffix}`;
    const organizationId = `r29-organization-${suffix}`;
    const contentItemId = `r29-content-${suffix}`;
    const rootVersionId = `r29-version-root-${suffix}`;
    const adaptedVersionId = `r29-version-story-${suffix}`;
    const correlationId = `r29-correlation-${suffix}`;

    const pool1 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    const contentStore = new PostgresContentItemStore(pool1);
    await contentStore.create({
      contentItemId,
      contentKey: `r29:content:${suffix}`,
      tenantId,
      workspaceId,
      organizationId,
      assignedRouteId: 'R29',
      channel: 'INSTAGRAM',
      format: 'REEL',
      language: 'pt-BR',
      initialVersionId: rootVersionId,
      sourceAssetIds: [`asset-source-${suffix}`],
      payload: { headline: 'Celebrar a Vida.' },
      sourceRefs: [`test:r29:source:${suffix}`],
      idempotencyKey: `r29:create:${suffix}`,
      correlationId,
      evidence: [`test:r29:create:${suffix}`],
    });

    const runtime1 = new PostgresVideoContentRuntime(pool1);
    const resolver1 = createRuntimeCapabilityResolver({ videoContent: runtime1 });
    const videoBinding = resolver1('video.caption.embed');
    expect(videoBinding).toBeDefined();

    const videoInput: VideoContentRuntimeInput = {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      organization_id: organizationId,
      content_item_id: contentItemId,
      version_id: rootVersionId,
      correlation_id: correlationId,
      idempotency_key: `r29:caption:${suffix}`,
      evidence: [`test:r29:caption:${suffix}`],
      payload: {
        caption: {
          text: 'Celebrar a Vida.',
          source_asset_id: `asset-source-${suffix}`,
        },
      },
    };
    const parsedVideoInput = videoBinding!.inputSchema.parse(videoInput);
    const firstVideoResult = await videoBinding!.execute(parsedVideoInput);
    const firstVideoReadback = await videoBinding!.providerReadback!(
      firstVideoResult,
      parsedVideoInput,
    );
    expect(firstVideoReadback.verified).toBe(true);
    expect(firstVideoReadback.externalResourceId).toMatch(
      new RegExp(`^toca://r29/content/${contentItemId}/artifacts/r29_`),
    );

    const retriedVideoResult = await videoBinding!.execute(parsedVideoInput);
    expect(retriedVideoResult).toEqual(firstVideoResult);

    const artifactRows = await pool1.query<{ count: number }>(
      `select count(*)::int as count
         from content_video_artifacts
        where content_item_id = $1 and capability_id = 'video.caption.embed'`,
      [contentItemId],
    );
    expect(artifactRows.rows[0]?.count).toBe(1);

    const artifactOutboxRows = await pool1.query<{ count: number }>(
      `select count(*)::int as count
         from event_outbox
        where aggregate_id = $1 and event_type = 'content.video_artifact.created'`,
      [contentItemId],
    );
    expect(artifactOutboxRows.rows[0]?.count).toBe(1);

    const adaptBinding = resolver1('content_item.channel.adapt');
    expect(adaptBinding).toBeDefined();
    const adaptInput: VideoContentRuntimeInput = {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      organization_id: organizationId,
      content_item_id: contentItemId,
      version_id: rootVersionId,
      correlation_id: correlationId,
      idempotency_key: `r29:adapt:${suffix}`,
      evidence: [`test:r29:adapt:${suffix}`],
      target_channel: 'INSTAGRAM',
      target_format: 'STORY',
      payload: {
        new_version_id: adaptedVersionId,
        source_refs: [`test:r29:source:${suffix}`],
        source_asset_ids: [`asset-source-${suffix}`],
      },
    };
    const parsedAdaptInput = adaptBinding!.inputSchema.parse(adaptInput);
    const adaptResult = await adaptBinding!.execute(parsedAdaptInput);
    const adaptReadback = await adaptBinding!.providerReadback!(adaptResult, parsedAdaptInput);
    expect(adaptReadback).toMatchObject({
      verified: true,
      externalResourceId: `toca://r29/content/${contentItemId}/versions/${adaptedVersionId}`,
    });

    const durationBinding = resolver1('video.duration.validate');
    expect(durationBinding).toBeDefined();
    const durationResult = await durationBinding!.execute(
      durationBinding!.inputSchema.parse({
        ...videoInput,
        idempotency_key: `r29:duration:${suffix}`,
        payload: {
          duration_ms: 15_000,
          policy: { minimumMs: 1_000, maximumMs: 90_000 },
        },
      }),
    );
    expect(durationResult).toMatchObject({ status: 'PASS', content_item_id: contentItemId });

    await pool1.end();

    const pool2 = createPostgresPool({ connectionString: databaseUrl(), max: 4 });
    try {
      const runtime2 = new PostgresVideoContentRuntime(pool2);
      const restartedVideoReadback = await runtime2.readback(
        'video.caption.embed',
        firstVideoResult,
        videoInput,
      );
      expect(restartedVideoReadback).toMatchObject({
        verified: true,
        externalResourceId: firstVideoReadback.externalResourceId,
      });

      const persistedItem = await new PostgresContentItemStore(pool2).get(contentItemId);
      expect(persistedItem).toMatchObject({
        contentItemId,
        assignedRouteId: 'R29',
        currentVersionId: adaptedVersionId,
        currentContentVersion: 2,
      });
    } finally {
      await pool2.end();
    }
  });
});
