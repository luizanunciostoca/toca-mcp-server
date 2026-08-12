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

const businessesResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).optional(),
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
    const pages = await this.listViaAccountsEdge(userToken);
    if (pages.length > 0) return this.normalize(pages);

    const expandedPages = await this.listViaUserFieldExpansion(userToken);
    if (expandedPages.length > 0) return this.normalize(expandedPages);

    if (!state.grantedScopes.includes('business_management')) return [];

    const businessPages = await this.listViaBusinessPortfolios(userToken);
    return this.normalize(businessPages);
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

  private async listViaBusinessPortfolios(userToken: string) {
    const businessesUrl = new URL(
      `${this.graphConfig.graphBaseUrl.replace(/\/$/, '')}/${this.graphConfig.apiVersion}/me/businesses`,
    );
    businessesUrl.searchParams.set('fields', 'id,name');
    businessesUrl.searchParams.set('limit', '100');

    const businessesResponse = await this.http.get(businessesUrl.toString(), {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/json',
    });
    if (!businessesResponse.ok) {
      throw new Error(`META_BUSINESS_DISCOVERY_HTTP_${businessesResponse.status}`);
    }

    const businesses = businessesResponseSchema.safeParse(await businessesResponse.json());
    if (!businesses.success) {
      throw new Error('META_BUSINESS_DISCOVERY_RESPONSE_INVALID');
    }

    const pages = new Map<string, z.infer<typeof managedPageSchema>>();
    for (const business of businesses.data.data) {
      for (const edge of ['owned_pages', 'client_pages'] as const) {
        const edgePages = await this.listBusinessPages(userToken, business.id, edge);
        for (const page of edgePages) pages.set(page.id, page);
      }
    }

    return [...pages.values()];
  }

  private async listBusinessPages(
    userToken: string,
    businessId: string,
    edge: 'owned_pages' | 'client_pages',
  ) {
    const url = new URL(
      `${this.graphConfig.graphBaseUrl.replace(/\/$/, '')}/${this.graphConfig.apiVersion}/${businessId}/${edge}`,
    );
    url.searchParams.set('fields', 'id,name,instagram_business_account');
    url.searchParams.set('limit', '100');

    const response = await this.http.get(url.toString(), {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/json',
    });
    if (!response.ok) {
      throw new Error(`META_BUSINESS_PAGE_DISCOVERY_HTTP_${response.status}`);
    }

    const parsed = managedPagesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('META_BUSINESS_PAGE_DISCOVERY_RESPONSE_INVALID');
    }

    return parsed.data.data;
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
