import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PostgresContentItemStore } from '../src/persistence/postgres-content-item-store.js';

const currentItemRow = {
  content_item_id: 'content-1',
  content_key: 'content:key:1',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  organization_id: 'organization-1',
  assigned_route_id: 'R29',
  product_ref: null,
  slot_ref: null,
  channel: 'INSTAGRAM',
  format: 'REEL',
  language: 'pt-BR',
  state: 'PLANNED',
  current_content_version: 2,
  current_version_id: 'version-2',
  event_id: null,
  experiment_id: null,
  record_version: 2,
  created_at: '2026-08-15T05:00:00.000Z',
  updated_at: '2026-08-15T05:01:00.000Z',
};

const existingVersionRow = {
  version_id: 'version-2',
  content_item_id: 'content-1',
  version_number: 2,
  idempotency_key: 'version:idem:2',
  derivation_type: 'VERSION',
  parent_version_id: 'version-1',
  source_version_id: 'version-1',
  lineage_root_version_id: 'version-1',
  variant_key: null,
  channel: 'INSTAGRAM',
  format: 'REEL',
  language: 'pt-BR',
  source_asset_ids: ['asset-original'],
  derived_asset_ids: ['asset-v2'],
  payload: { headline: 'Version 2' },
  source_refs: ['drive:canonical'],
  evidence: ['test:idempotent-version'],
  created_at: '2026-08-15T05:01:00.000Z',
};

function versionInput(payload: { readonly headline: string } = { headline: 'Version 2' }) {
  return {
    versionId: 'version-2',
    contentItemId: 'content-1',
    expectedRecordVersion: 1,
    derivationType: 'VERSION' as const,
    sourceVersionId: 'version-1',
    derivedAssetIds: ['asset-v2'],
    payload,
    sourceRefs: ['drive:canonical'],
    idempotencyKey: 'version:idem:2',
    correlationId: 'corr-version-2',
    evidence: ['test:idempotent-version'],
    now: '2026-08-15T05:02:00.000Z',
  };
}

function createStore() {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback')
        return { rows: [], rowCount: 0 };
      if (sql.includes('select * from content_items') && sql.includes('for update')) {
        return { rows: [currentItemRow], rowCount: 1 };
      }
      if (sql.includes('select * from content_item_versions') && sql.includes('idempotency_key')) {
        return { rows: [existingVersionRow], rowCount: 1 };
      }
      throw new Error(`UNEXPECTED_QUERY:${sql}`);
    },
    release() {},
  };
  const pool = {
    connect: async () => client,
  } as unknown as pg.Pool;
  const store = new PostgresContentItemStore(pool, {
    outbox: { enqueue: async () => {} } as never,
  });
  return { store, queries };
}

describe('PostgresContentItemStore version idempotency', () => {
  it('returns the existing version for an exact retry even after record_version advanced', async () => {
    const { store, queries } = createStore();

    const result = await store.createVersion(versionInput());

    expect(result.versionId).toBe('version-2');
    expect(result.idempotencyKey).toBe('version:idem:2');
    expect(queries.some((query) => query.startsWith('update content_items'))).toBe(false);
    expect(queries.at(-1)).toBe('commit');
  });

  it('fails closed when the same idempotency key is reused for a different intent', async () => {
    const { store, queries } = createStore();

    await expect(
      store.createVersion(versionInput({ headline: 'Different intent' })),
    ).rejects.toThrow('CONTENT_VERSION_IDEMPOTENCY_CONFLICT');

    expect(queries.some((query) => query.startsWith('update content_items'))).toBe(false);
    expect(queries.at(-1)).toBe('rollback');
  });
});
