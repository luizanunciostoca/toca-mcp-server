import type { SecretReference, SecretResolver } from '../../core/secrets.js';
import type { SpreadsheetValuesClient } from './media-assets.js';

export interface GoogleSheetsRestClientOptions {
  readonly tokenReference: SecretReference;
  readonly baseUrl?: string;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface GoogleSheetsValuesResponse {
  readonly values?: readonly (readonly unknown[])[];
}

const DEFAULT_GOOGLE_SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4';

export class GoogleSheetsRestClient implements SpreadsheetValuesClient {
  private readonly baseUrl: string;

  constructor(
    private readonly secrets: SecretResolver,
    private readonly options: GoogleSheetsRestClientOptions,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_GOOGLE_SHEETS_BASE_URL).replace(/\/$/, '');
  }

  async readRange(
    spreadsheetId: string,
    range: string,
  ): Promise<readonly (readonly unknown[])[]> {
    const token = await this.secrets.resolve(this.options.tokenReference);
    const url = new URL(
      `${this.baseUrl}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    );
    url.searchParams.set('majorDimension', 'ROWS');
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');

    const response = await this.fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    await assertGoogleSheetsResponse(response, 'read range');

    const payload = (await response.json()) as GoogleSheetsValuesResponse;
    return payload.values ?? [];
  }

  async appendRow(spreadsheetId: string, range: string, values: readonly unknown[]): Promise<void> {
    const token = await this.secrets.resolve(this.options.tokenReference);
    const url = new URL(
      `${this.baseUrl}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
    );
    url.searchParams.set('valueInputOption', 'USER_ENTERED');
    url.searchParams.set('insertDataOption', 'INSERT_ROWS');

    const response = await this.fetcher(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ majorDimension: 'ROWS', values: [values] }),
    });
    await assertGoogleSheetsResponse(response, 'append row');
  }
}

async function assertGoogleSheetsResponse(response: Response, operation: string): Promise<void> {
  if (response.ok) return;

  let providerMessage = '';
  try {
    const payload = (await response.json()) as { error?: { message?: unknown } };
    if (typeof payload.error?.message === 'string') providerMessage = payload.error.message;
  } catch {
    providerMessage = '';
  }

  const suffix = providerMessage ? `: ${providerMessage}` : '';
  throw new Error(`Google Sheets ${operation} failed with HTTP ${response.status}${suffix}`);
}
