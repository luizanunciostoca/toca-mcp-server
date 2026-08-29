const developerToken = requiredSecret('TOCA_SECRET_GOOGLE_ADS_DEVELOPER_TOKEN');
const clientId = requiredSecret('TOCA_SECRET_GOOGLE_ADS_CLIENT_ID');
const clientSecret = requiredSecret('TOCA_SECRET_GOOGLE_ADS_CLIENT_SECRET');
const refreshToken = requiredSecret('TOCA_SECRET_GOOGLE_ADS_REFRESH_TOKEN');

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }),
});
const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as {
  access_token?: unknown;
  error?: unknown;
};

if (!tokenResponse.ok || typeof tokenPayload.access_token !== 'string') {
  emit({
    stage: 'OAUTH_REFRESH',
    ok: false,
    httpStatus: tokenResponse.status,
    oauthError: typeof tokenPayload.error === 'string' ? tokenPayload.error : 'UNKNOWN',
    secretValuesExposed: false,
  });
  process.exitCode = 1;
} else {
  const response = await fetch(
    'https://googleads.googleapis.com/v25/customers:listAccessibleCustomers',
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        'developer-token': developerToken,
      },
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    emit({
      stage: 'LIST_ACCESSIBLE_CUSTOMERS',
      ok: false,
      httpStatus: response.status,
      providerStatus: readProviderStatus(payload),
      providerErrorCodes: readProviderErrorCodes(payload),
      providerMessageClass: classifyProviderMessage(payload),
      secretValuesExposed: false,
    });
    process.exitCode = 1;
  } else {
    const resourceNames = Array.isArray(payload.resourceNames)
      ? payload.resourceNames.filter((value): value is string => typeof value === 'string')
      : [];
    emit({
      stage: 'LIST_ACCESSIBLE_CUSTOMERS',
      ok: true,
      httpStatus: response.status,
      accessibleCustomers: resourceNames,
      secretValuesExposed: false,
    });
  }
}

function requiredSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`GOOGLE_ADS_DIAGNOSTIC_SECRET_MISSING:${name}`);
  return value;
}

function emit(value: Record<string, unknown>): void {
  console.log(`GOOGLE_ADS_AUTH_DIAGNOSTIC=${JSON.stringify(value)}`);
}

function readProviderStatus(payload: Record<string, unknown>): string {
  const error = asRecord(payload.error);
  return typeof error?.status === 'string' ? error.status : 'UNKNOWN';
}

function readProviderErrorCodes(payload: Record<string, unknown>): string[] {
  const codes = new Set<string>();
  const error = asRecord(payload.error);
  const details = Array.isArray(error?.details) ? error.details : [];
  for (const detail of details) {
    const detailRecord = asRecord(detail);
    const errors = Array.isArray(detailRecord?.errors) ? detailRecord.errors : [];
    for (const providerError of errors) {
      const providerErrorRecord = asRecord(providerError);
      const errorCode = asRecord(providerErrorRecord?.errorCode);
      if (!errorCode) continue;
      for (const value of Object.values(errorCode)) {
        if (typeof value === 'string' && /^[A-Z0-9_]+$/.test(value)) codes.add(value);
      }
    }
  }
  return [...codes].sort();
}

function classifyProviderMessage(payload: Record<string, unknown>): string {
  const error = asRecord(payload.error);
  const message = typeof error?.message === 'string' ? error.message.toUpperCase() : '';
  if (message.includes('DEVELOPER TOKEN')) return 'DEVELOPER_TOKEN';
  if (message.includes('PERMISSION')) return 'PERMISSION';
  if (message.includes('CUSTOMER')) return 'CUSTOMER_ACCESS';
  if (message.includes('PROJECT')) return 'PROJECT_BINDING';
  return 'UNCLASSIFIED';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
