import { z } from 'zod/v4';
import type { SecretResolver } from '../../core/secrets.js';
import type { MetaConnectionState } from './meta-connection.js';
import type { MetaGraphConfig, MetaHttpTransport } from './meta-graph.js';

export interface MetaManagedAsset {
  readonly pageId: string;
  readonly pageName: string;
  readonly tasks: readonly string[];
  readonly instagramBusinessAccountId?: string;
}

export interface MetaManagedAssetDiscovery {
  list(state: MetaConnectionState): Promise<readonly MetaManagedAsset[]>;
}

const managedPagesResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      tasks: z.array(z.string()).default([]),
      instagram_business_account: z.object({ id: z.string().min(1) }).optional(),
    }),
  ),
});

export class MetaGraphManagedAssetDiscovery implements MetaManagedAssetDiscovery {
  constructor(
    private readonly graphConfig: MetaGraphConfig,
    private readonly secrets: SecretResolver,
    private readonly http: MetaHttpTransport,
  ) {}

  async list(state: MetaConnectionState): Promise<readonly MetaManagedAsset[]> {
    const userToken = await this.secrets.resolve(state.accessToken);
    const url = new URL(
      `${this.graphConfig.graphBaseUrl.replace(/\/$/, '')}/${this.graphConfig.apiVersion}/me/accounts`,
    );
    url.searchParams.set('fields', 'id,name,tasks,instagram_business_account');

    const response = await this.http.get(url.toString(), {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/json',
    });

    if (!response.ok) {
      throw new Error(`META_ASSET_DISCOVERY_HTTP_${response.status}`);
    }

    const parsed = managedPagesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('META_ASSET_DISCOVERY_RESPONSE_INVALID');
    }

    return parsed.data.data
      .map((page) => ({
        pageId: page.id,
        pageName: page.name,
        tasks: [...page.tasks].sort(),
        ...(page.instagram_business_account
          ? { instagramBusinessAccountId: page.instagram_business_account.id }
          : {}),
      }))
      .sort((a, b) => a.pageId.localeCompare(b.pageId));
  }
}
