import { EnvironmentSecretResolver } from './core/secrets.js';
import {
  AG01_GCP_METADATA_REFERENCE_KEY,
  GoogleOAuthRefreshSecretResolver,
} from './orchestrator/google-oauth-secret-resolver.js';

interface GoogleErrorPayload {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly status?: unknown;
    readonly errors?: readonly { readonly reason?: unknown; readonly domain?: unknown }[];
  };
}

const routingSpreadsheetId = process.env.AG01_TOCA_OS_ROUTING_SPREADSHEET_ID?.trim();
const canonicalSpreadsheetId =
  process.env.AG01_TOCA_OS_CANONICAL_RESOURCES_SPREADSHEET_ID?.trim();
if (!routingSpreadsheetId || !canonicalSpreadsheetId) {
  throw new Error('AG01_SHEETS_DIAG_SPREADSHEET_IDS_REQUIRED');
}

const envSecrets = new EnvironmentSecretResolver(process.env);
const metadataRef = { provider: 'env' as const, key: AG01_GCP_METADATA_REFERENCE_KEY };
const resolver = new GoogleOAuthRefreshSecretResolver({
  clientIdReference: metadataRef,
  clientSecretReference: metadataRef,
  refreshTokenReference: metadataRef,
  secrets: envSecrets,
  timeoutMs: 15_000,
});

const token = await resolver.resolve({ provider: 'google-oauth', key: 'sheets-readonly' });

async function probe(label: string, spreadsheetId: string): Promise<void> {
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId%2Cproperties.title%2Csheets.properties.title`;
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!response.ok) {
    let detail: Record<string, unknown> = { statusCode: response.status };
    try {
      const payload = (await response.json()) as GoogleErrorPayload;
      detail = {
        statusCode: response.status,
        googleCode: payload.error?.code ?? null,
        googleStatus: payload.error?.status ?? null,
        googleMessage: payload.error?.message ?? null,
        reasons:
          payload.error?.errors?.map((entry) => ({
            reason: entry.reason ?? null,
            domain: entry.domain ?? null,
          })) ?? [],
      };
    } catch {
      // Deliberately omit raw response bodies from evidence.
    }
    console.error(`AG01_SHEETS_DIAG_FAILED ${label} ${JSON.stringify(detail)}`);
    process.exitCode = 1;
    return;
  }
  const body = (await response.json()) as {
    spreadsheetId?: unknown;
    properties?: { title?: unknown };
    sheets?: readonly { properties?: { title?: unknown } }[];
  };
  console.log(
    `AG01_SHEETS_DIAG_OK ${label} ${JSON.stringify({
      spreadsheetId: body.spreadsheetId ?? spreadsheetId,
      title: body.properties?.title ?? null,
      sheetTitles: body.sheets?.map((sheet) => sheet.properties?.title ?? null) ?? [],
    })}`,
  );
}

await probe('routing', routingSpreadsheetId);
await probe('canonical', canonicalSpreadsheetId);

if (!process.exitCode) {
  console.log(
    `AG01_SHEETS_DIAG_COMPLETE ${JSON.stringify({
      status: 'SHEETS_RUNTIME_READ_VERIFIED',
      authMode: 'gcp_metadata+self_scoped_token',
      scope: 'spreadsheets.readonly',
      externalSideEffectExecuted: false,
    })}`,
  );
}
