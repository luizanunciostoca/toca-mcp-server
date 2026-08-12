import { z } from 'zod/v4';
import type pg from 'pg';
import type { MetaApiClient } from '../meta/meta-api-client.js';

const permissionsSchema = z.object({
  data: z.array(
    z.object({
      permission: z.string().min(1),
      status: z.string().min(1),
    }),
  ),
});

const accountsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      tasks: z.array(z.string()).default([]),
      instagram_business_account: z.object({ id: z.string().min(1) }).optional(),
    }),
  ),
});

export interface InstagramPublicationReadinessResult {
  readonly databaseReady: true;
  readonly permissionReady: true;
  readonly accountReady: true;
  readonly pageId: string;
  readonly instagramBusinessAccountId: string;
}

export interface InstagramPublicationReadinessOptions {
  readonly pool: pg.Pool;
  readonly metaClient: MetaApiClient;
  readonly instagramBusinessAccountId: string;
}

export async function checkInstagramPublicationReadiness(
  options: InstagramPublicationReadinessOptions,
): Promise<InstagramPublicationReadinessResult> {
  await options.pool.query('select 1');

  const permissions = permissionsSchema.safeParse(await options.metaClient.get('me/permissions'));
  if (!permissions.success) throw new Error('INSTAGRAM_PUBLICATION_PERMISSIONS_RESPONSE_INVALID');

  const publishPermission = permissions.data.data.find(
    (permission) => permission.permission === 'instagram_content_publish',
  );
  if (publishPermission?.status !== 'granted') {
    throw new Error('INSTAGRAM_CONTENT_PUBLISH_PERMISSION_NOT_GRANTED');
  }

  const accounts = accountsSchema.safeParse(
    await options.metaClient.get('me/accounts', {
      fields: 'id,tasks,instagram_business_account',
      limit: '100',
    }),
  );
  if (!accounts.success) throw new Error('INSTAGRAM_PUBLICATION_ACCOUNTS_RESPONSE_INVALID');

  const matches = accounts.data.data.filter(
    (account) =>
      account.instagram_business_account?.id === options.instagramBusinessAccountId,
  );
  if (matches.length !== 1) {
    throw new Error(`INSTAGRAM_PUBLICATION_ACCOUNT_MATCH_COUNT_${matches.length}`);
  }

  return {
    databaseReady: true,
    permissionReady: true,
    accountReady: true,
    pageId: matches[0]!.id,
    instagramBusinessAccountId: options.instagramBusinessAccountId,
  };
}
