import { createHash } from 'node:crypto';
import type { EngagementIntent } from '../policy/engagement-policy.js';
import type {
  InstagramEngagementKnowledgeMatch,
  InstagramEngagementKnowledgeSource,
} from './knowledge.js';

const ALLOWED_INTENTS = new Set<EngagementIntent>([
  'FAQ_OPERATIONAL',
  'EVENT_INFO',
  'TICKET_INFO',
  'LOCATION_HOURS',
]);
const DEFAULT_METADATA_IDENTITY_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_OPEN_MS = 60_000;

interface Ag01KnowledgeHttpResponse {
  readonly status?: unknown;
  readonly answer?: unknown;
  readonly confidence?: unknown;
  readonly citedResourceIds?: unknown;
  readonly evidence?: unknown;
  readonly modelResponseId?: unknown;
  readonly model?: unknown;
}

export interface Ag01GroundedInstagramKnowledgeOptions {
  readonly serviceUrl: string;
  readonly audience?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: typeof fetch;
  readonly metadataIdentityUrl?: string;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly circuitFailureThreshold?: number;
  readonly circuitOpenMs?: number;
}

export class Ag01GroundedInstagramKnowledgeSource
  implements InstagramEngagementKnowledgeSource
{
  readonly #fetch: typeof fetch;
  readonly #serviceUrl: string;
  readonly #audience: string;
  readonly #timeoutMs: number;
  readonly #metadataIdentityUrl: string;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #circuitFailureThreshold: number;
  readonly #circuitOpenMs: number;
  #identityToken: { readonly token: string; readonly expiresAtMs: number } | undefined;
  #failureCount = 0;
  #openedUntilMs = 0;

  constructor(options: Ag01GroundedInstagramKnowledgeOptions) {
    this.#serviceUrl = options.serviceUrl.trim().replace(/\/$/, '');
    if (!this.#serviceUrl.startsWith('https://')) {
      throw new Error('INSTAGRAM_AG01_SERVICE_URL_HTTPS_REQUIRED');
    }
    this.#audience = (options.audience ?? this.#serviceUrl).trim();
    if (!this.#audience.startsWith('https://')) {
      throw new Error('INSTAGRAM_AG01_AUDIENCE_HTTPS_REQUIRED');
    }
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 30_000) {
      throw new Error('INSTAGRAM_AG01_TIMEOUT_INVALID');
    }
    this.#fetch = options.fetchFn ?? fetch;
    this.#metadataIdentityUrl = options.metadataIdentityUrl ?? DEFAULT_METADATA_IDENTITY_URL;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#circuitFailureThreshold =
      options.circuitFailureThreshold ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD;
    this.#circuitOpenMs = options.circuitOpenMs ?? DEFAULT_CIRCUIT_OPEN_MS;
  }

  async resolve(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    if (!ALLOWED_INTENTS.has(expectedIntent)) return null;
    if (this.#openedUntilMs > this.#now()) {
      this.#log('instagram.ag01_grounded.circuit_open', { expectedIntent });
      return null;
    }

    try {
      const result = await this.#request(text, expectedIntent);
      this.#failureCount = 0;
      this.#openedUntilMs = 0;
      return result;
    } catch (error) {
      this.#failureCount += 1;
      if (this.#failureCount >= this.#circuitFailureThreshold) {
        this.#openedUntilMs = this.#now() + this.#circuitOpenMs;
      }
      this.#log('instagram.ag01_grounded.failed', {
        expectedIntent,
        errorCode: normalizeErrorCode(error),
        failureCount: this.#failureCount,
        circuitOpened: this.#openedUntilMs > this.#now(),
      });
      return null;
    }
  }

  async #request(
    text: string,
    expectedIntent: EngagementIntent,
  ): Promise<InstagramEngagementKnowledgeMatch | null> {
    const token = await this.#getIdentityToken();
    const idempotencyKey = `instagram-ag01-grounded:${digest(`${expectedIntent}:${text}`)}`;
    const correlationId = `instagram-ag01-${digest(text).slice(0, 24)}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.#fetch(`${this.#serviceUrl}/v1/knowledge/answer`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            idempotencyKey,
            message: text,
            expectedIntent,
            correlationId,
          }),
        });
        if (!response.ok) {
          const error = new Error(`INSTAGRAM_AG01_HTTP_ERROR:${response.status}`);
          if ((response.status === 408 || response.status === 429 || response.status >= 500) && attempt === 0) {
            lastError = error;
            await this.#sleep(250);
            continue;
          }
          throw error;
        }
        const body = (await response.json()) as Ag01KnowledgeHttpResponse;
        return validateResponse(body, expectedIntent);
      } catch (error) {
        const normalized =
          error instanceof Error && error.name === 'AbortError'
            ? new Error('INSTAGRAM_AG01_TIMEOUT')
            : error instanceof Error
              ? error
              : new Error('INSTAGRAM_AG01_REQUEST_FAILED');
        if (attempt === 0 && isRetryableNetworkError(normalized)) {
          lastError = normalized;
          await this.#sleep(250);
          continue;
        }
        throw normalized;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error('INSTAGRAM_AG01_REQUEST_FAILED');
  }

  async #getIdentityToken(): Promise<string> {
    const now = this.#now();
    if (this.#identityToken && this.#identityToken.expiresAtMs - 60_000 > now) {
      return this.#identityToken.token;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.#timeoutMs, 5_000));
    try {
      const url = new URL(this.#metadataIdentityUrl);
      url.searchParams.set('audience', this.#audience);
      url.searchParams.set('format', 'full');
      const response = await this.#fetch(url, {
        headers: { 'Metadata-Flavor': 'Google', accept: 'text/plain' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`INSTAGRAM_AG01_ID_TOKEN_HTTP_ERROR:${response.status}`);
      }
      const token = (await response.text()).trim();
      if (!token || token.split('.').length !== 3) {
        throw new Error('INSTAGRAM_AG01_ID_TOKEN_INVALID');
      }
      const expiresAtMs = jwtExpiryMs(token) ?? now + 5 * 60_000;
      this.#identityToken = { token, expiresAtMs };
      return token;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('INSTAGRAM_AG01_ID_TOKEN_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  #log(event: string, fields: Readonly<Record<string, unknown>>): void {
    console.log(
      JSON.stringify({
        severity: event.endsWith('.failed') ? 'WARNING' : 'INFO',
        event,
        timestamp: new Date(this.#now()).toISOString(),
        ...fields,
      }),
    );
  }
}

function validateResponse(
  body: Ag01KnowledgeHttpResponse,
  expectedIntent: EngagementIntent,
): InstagramEngagementKnowledgeMatch | null {
  if (body.status === 'NO_GROUNDED_ANSWER') return null;
  if (body.status !== 'GROUNDED') throw new Error('INSTAGRAM_AG01_RESPONSE_STATUS_INVALID');
  if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 1_200) {
    throw new Error('INSTAGRAM_AG01_RESPONSE_ANSWER_INVALID');
  }
  if (typeof body.confidence !== 'number' || body.confidence < 0.85 || body.confidence > 1) {
    return null;
  }
  if (!Array.isArray(body.citedResourceIds) || body.citedResourceIds.length === 0) return null;
  const citedResourceIds = body.citedResourceIds.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  if (citedResourceIds.length !== body.citedResourceIds.length) {
    throw new Error('INSTAGRAM_AG01_RESPONSE_CITATIONS_INVALID');
  }
  if (!Array.isArray(body.evidence)) return null;
  const evidence = body.evidence.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  if (evidence.length !== body.evidence.length) {
    throw new Error('INSTAGRAM_AG01_RESPONSE_EVIDENCE_INVALID');
  }
  if (!evidence.includes('ag01:grounded-knowledge:drive-active-canonical-only')) return null;
  for (const resourceId of citedResourceIds) {
    if (!evidence.includes(`toca-os:resource:${resourceId}`)) return null;
  }
  return {
    faqId: `AG01-GROUNDED:${citedResourceIds[0]}`,
    intent: expectedIntent,
    answer: body.answer.trim(),
    source: `AG01_TOCA_OS_DRIVE:${citedResourceIds.join(',')}`,
    confidence: body.confidence,
    factsVerified: true,
    tier: 'KNOWLEDGE_BASE',
    chunkId: `ag01:${digest(citedResourceIds.join('|')).slice(0, 24)}`,
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function jwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof decoded.exp === 'number' && Number.isFinite(decoded.exp) ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isRetryableNetworkError(error: Error): boolean {
  return (
    error.message === 'INSTAGRAM_AG01_TIMEOUT' ||
    error.name === 'TypeError' ||
    error.name === 'FetchError' ||
    error.name === 'NetworkError'
  );
}

function normalizeErrorCode(error: unknown): string {
  return error instanceof Error ? error.message.split(':')[0] || error.name : 'UNKNOWN';
}
