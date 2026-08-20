import { describe, expect, it } from 'vitest';
import { extractTocaIdempotencyKey } from '../src/providers/sendgrid/email-event-http-runtime.js';

describe('SendGrid Event Webhook correlation', () => {
  it('reads canonical idempotency key returned as a top-level custom argument', () => {
    expect(extractTocaIdempotencyKey({ toca_idempotency_key: 'email-send-123' })).toBe(
      'email-send-123',
    );
  });

  it('accepts nested custom_args for defensive provider normalization', () => {
    expect(
      extractTocaIdempotencyKey({ custom_args: { toca_idempotency_key: 'email-send-456' } }),
    ).toBe('email-send-456');
  });

  it('fails closed when no canonical correlation argument is present', () => {
    expect(extractTocaIdempotencyKey({ sg_message_id: 'provider-only-id' })).toBeNull();
  });
});
