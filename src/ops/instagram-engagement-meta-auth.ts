export type MetaFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ResolveMetaPageAccessTokenOptions {
  readonly rootToken: string;
  readonly expectedPageId: string;
  readonly graphBaseUrl: string;
  readonly apiVersion: string;
  readonly fetchImpl?: MetaFetch;
}

export async function resolveMetaPageAccessToken(
  options: ResolveMetaPageAccessTokenOptions,
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const graphBaseUrl = options.graphBaseUrl.replace(/\/$/, '');

  const accountsUrl = new URL(`${graphBaseUrl}/${options.apiVersion}/me/accounts`);
  accountsUrl.searchParams.set('fields', 'id,access_token');
  accountsUrl.searchParams.set('limit', '100');
  accountsUrl.searchParams.set('access_token', options.rootToken);

  const accountsResponse = await fetchImpl(accountsUrl);
  if (accountsResponse.ok) {
    const json = (await accountsResponse.json()) as {
      data?: readonly { id?: unknown; access_token?: unknown }[];
    };
    const match = (json.data ?? []).find(
      (item) =>
        safeScalarString(item.id) === options.expectedPageId &&
        safeScalarString(item.access_token),
    );
    const resolved = safeScalarString(match?.access_token);
    if (resolved) return resolved;
  }

  const pageUrl = new URL(`${graphBaseUrl}/${options.apiVersion}/${options.expectedPageId}`);
  pageUrl.searchParams.set('fields', 'id');
  pageUrl.searchParams.set('access_token', options.rootToken);
  const pageResponse = await fetchImpl(pageUrl);
  if (!pageResponse.ok) {
    throw new Error(`META_PAGE_ACCESS_TOKEN_RESOLUTION_FAILED:${pageResponse.status}`);
  }
  const page = (await pageResponse.json()) as { id?: unknown };
  if (safeScalarString(page.id) !== options.expectedPageId) {
    throw new Error('META_PAGE_ACCESS_TOKEN_RESOLUTION_ID_MISMATCH');
  }
  return options.rootToken;
}

function safeScalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return '';
}
