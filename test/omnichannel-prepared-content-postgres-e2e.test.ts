import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PostgresOmnichannelPreparedContentStore } from '../src/persistence/postgres-omnichannel-prepared-content-store.js';
import { createPostgresPool } from '../src/persistence/postgres.js';

const DATABASE_URL = process.env.DATABASE_URL;
const postgresDescribe = DATABASE_URL ? describe : describe.skip;

function databaseUrl(): string {
  if (!DATABASE_URL) throw new Error('OMNICHANNEL_PREPARED_DATABASE_URL_REQUIRED');
  return DATABASE_URL;
}

postgresDescribe('Omnichannel prepared content PostgreSQL E2E', () => {
  it('persists immutably, reuses identical content and fails closed across tenant scope', async () => {
    const pool = createPostgresPool({ connectionString: databaseUrl() });
    const suffix = randomUUID();
    const tenantA = `prepared-a-${suffix}`;
    const tenantB = `prepared-b-${suffix}`;
    try {
      await pool.query(
        `insert into tenants (tenant_id, status, display_name, evidence)
         values ($1, 'ACTIVE', $1, '["test:prepared-content"]'::jsonb),
                ($2, 'ACTIVE', $2, '["test:prepared-content"]'::jsonb)`,
        [tenantA, tenantB],
      );
      const store = new PostgresOmnichannelPreparedContentStore(pool);
      const scopeA = { tenantId: tenantA, workspaceId: 'workspace-a', organizationId: 'org-a' };
      const created = await store.put({
        ...scopeA,
        contentKind: 'WHATSAPP_MESSAGE',
        payload: { kind: 'TEXT', to: 'opaque-recipient', text: 'Olá' },
        evidence: ['test:prepared-content:create'],
        now: '2026-08-21T04:00:00.000Z',
      });
      const reused = await store.put({
        ...scopeA,
        contentKind: 'WHATSAPP_MESSAGE',
        payload: { text: 'Olá', to: 'opaque-recipient', kind: 'TEXT' },
        evidence: ['test:prepared-content:retry'],
        now: '2026-08-21T04:01:00.000Z',
      });
      expect(reused.preparedContentRef).toBe(created.preparedContentRef);
      expect(reused.createdAt).toBe(created.createdAt);

      const sameTenant = await store.get({
        ...scopeA,
        preparedContentRef: created.preparedContentRef,
        contentKind: 'WHATSAPP_MESSAGE',
      });
      expect(sameTenant?.contentSha256).toBe(created.contentSha256);

      const crossTenant = await store.get({
        tenantId: tenantB,
        workspaceId: 'workspace-a',
        organizationId: 'org-a',
        preparedContentRef: created.preparedContentRef,
        contentKind: 'WHATSAPP_MESSAGE',
      });
      expect(crossTenant).toBeUndefined();

      await expect(
        pool.query(
          `update omnichannel_prepared_content set content_sha256 = repeat('0', 64)
           where prepared_content_ref = $1`,
          [created.preparedContentRef],
        ),
      ).resolves.toBeDefined();
      await expect(
        store.get({
          ...scopeA,
          preparedContentRef: created.preparedContentRef,
          contentKind: 'WHATSAPP_MESSAGE',
        }),
      ).rejects.toThrow('OMNICHANNEL_PREPARED_CONTENT_HASH_MISMATCH');
    } finally {
      await pool.query(`delete from omnichannel_prepared_content where tenant_id in ($1, $2)`, [
        tenantA,
        tenantB,
      ]);
      await pool.query(`delete from tenants where tenant_id in ($1, $2)`, [tenantA, tenantB]);
      await pool.end();
    }
  });
});
