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

const managedPageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tasks: z.array(z.string()).default([]),
  instagram_business_account: z.object({ id: z.string().min(1) }).optional(),
});

const managedPagesResponseSchema = z.object({
  data: z.array(managedPageSchema),
});

const expandedManagedPagesResponseSchema = z.object({
  accounts: z
    .object({
      data: z.array(managedPageSchema),
    })
    .optional(),
});

export class MetaGraphManagedAssetDiscovery implements MetaManagedAssetDiscovery {
  constructor(
    private readonly graphConfig: MetaGraphConfig,
    private readonly secrets: SecretResolver,
    private readonly http: MetaHttpTransport,
  ) {}

  async list(state: MetaConnectionState): Promise<readonly MetaManagedAsset[]> {
    const userToken = await this.secrets.resolve(state.accessToken);
    const pages = await this.listViaAccountsEdge(userToken);
    if (pages.length > 0) return this.normalize(pages);

    const fallbackPages = await this.listViaUserFieldExpansion(userToken);
    return this.normalize(fallbackPages);
  }

  private async listViaAccountsEdge(userToken: string) {
    const url = new URL(
      `${this.graphConfig.graphBaseUrl.replace(/\/$/, '')}/${this.graphConfig.apiVersion}/me/accounts`,
    );
    url.searchParams.set('fields', 'id,name,tasks,instagram_business_account');
    url.searchParams.set('limit', '100');

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

    return parsed.data.data;
  }

  private async listViaUserFieldExpansion(userToken: string) {
    const url = new URL(
      `${this.graphConfig.graphBaseUrl.replace(/\/$/, '')}/${this.graphConfig.apiVersion}/me`,
    );
    url.searchParams.set('fields', 'accounts.limit(100){id,name,tasks,instagram_business_account}');

    const response = await this.http.get(url.toString(), {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/json',
    });

    if (!response.ok) {
      throw new Error(`META_ASSET_DISCOVERY_FALLBACK_HTTP_${response.status}`);
    }

    const parsed = expandedManagedPagesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('META_ASSET_DISCOVERY_FALLBACK_RESPONSE_INVALID');
    }

    return parsed.data.accounts?.data ?? [];
  }

  private normalize(
    pages: readonly z.infer<typeof managedPageSchema>[],
  ): readonly MetaManagedAsset[] {
    return pages
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
