import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Google Ads bounded retry-after contract', () => {
  it('caps provider Retry-After by the validated request timeout', () => {
    const source = readFileSync('src/providers/google-ads/google-ads-api-client.ts', 'utf8');

    expect(source).toContain(
      'const requestedDelay = Math.max(localDelay, retryAfterMs ?? 0);',
    );
    expect(source).toContain(
      'const delayMs = Math.min(requestedDelay, this.#requestTimeoutMs);',
    );
    expect(source).toContain(
      "const maximumAttempts = retryMode === 'SAFE' ? this.#maxSafeAttempts : 1;",
    );
  });
});
