export interface SendGridEventWebhookDiscoveryResult {
  readonly webhookId: string;
  readonly url: string;
  readonly publicKey: string;
  readonly evidence: readonly string[];
}

export interface SendGridEventWebhookDiscoveryOptions {
  readonly apiKey: string;
  readonly apiBaseUrl?: string;
  readonly expectedUrl?: string | null;
  readonly fetchImpl?: typeof fetch;
}

interface EventWebhookCandidate {
  readonly id: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly publicKey: string | null;
}

/**
 * Discovers the signed Event Webhook key from Twilio SendGrid using only the
 * already configured API key. The selection is deliberately fail-closed: a
 * configured expected URL must match exactly after URL normalization; without
 * one, exactly one enabled signed webhook must exist.
 */
export async function discoverSendGridEventWebhookPublicKey(
  options: SendGridEventWebhookDiscoveryOptions,
): Promise<SendGridEventWebhookDiscoveryResult> {
  const apiKey = requireText(options.apiKey, 'SENDGRID_API_KEY_REQUIRED');
  const baseUrl = (options.apiBaseUrl ?? 'https://api.sendgrid.com').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${baseUrl}/v3/user/webhooks/event/settings/all`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`SENDGRID_EVENT_WEBHOOK_DISCOVERY_HTTP_${response.status}`);
  }

  const root = asRecord(await response.json());
  const rawWebhooks = Array.isArray(root.webhooks) ? root.webhooks : [];
  const candidates = rawWebhooks.map(parseCandidate).filter((value): value is EventWebhookCandidate => value !== null);
  const signedEnabled = candidates.filter((candidate) => candidate.enabled && candidate.publicKey);
  const expectedUrl = normalizeOptionalUrl(options.expectedUrl ?? null);
  const matches = expectedUrl
    ? signedEnabled.filter((candidate) => normalizeUrl(candidate.url) === expectedUrl)
    : signedEnabled;

  if (matches.length === 0) {
    throw new Error(
      expectedUrl
        ? 'SENDGRID_SIGNED_EVENT_WEBHOOK_EXPECTED_URL_NOT_FOUND'
        : 'SENDGRID_SIGNED_EVENT_WEBHOOK_NOT_FOUND',
    );
  }
  if (matches.length !== 1) {
    throw new Error('SENDGRID_SIGNED_EVENT_WEBHOOK_AMBIGUOUS');
  }

  const selected = matches[0]!;
  const publicKey = requireText(selected.publicKey ?? undefined, 'SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY_REQUIRED');
  return {
    webhookId: selected.id,
    url: selected.url,
    publicKey,
    evidence: [
      `sendgrid:event-webhook:${selected.id}`,
      `sendgrid:event-webhook:url:${normalizeUrl(selected.url)}`,
      'sendgrid:event-webhook:signature-enabled',
      'sendgrid:event-webhook:public-key-discovered',
    ],
  };
}

function parseCandidate(value: unknown): EventWebhookCandidate | null {
  const row = asRecord(value);
  const id = optionalText(row.id);
  const url = optionalText(row.url);
  if (!id || !url) return null;
  return {
    id,
    url,
    enabled: row.enabled === true,
    publicKey: optionalText(row.public_key),
  };
}

function normalizeOptionalUrl(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalizeUrl(normalized) : null;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(value: string | undefined, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
