import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SendGridEventHttpRuntime,
  extractTocaIdempotencyKey,
} from '../src/providers/sendgrid/email-event-http-runtime.js';
import {
  SendGridEmailProvider,
  type SendGridPreparedCampaignResolver,
} from '../src/providers/sendgrid/email-provider.js';

const unusedPreparedResolver: SendGridPreparedCampaignResolver = {
  resolve() {
    return Promise.reject(new Error('TEST_PREPARED_EMAIL_NOT_USED'));
  },
};

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

  it('rejects a webhook whose ECDSA signature does not match the exact raw body', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const provider = new SendGridEmailProvider(
      {
        apiKey: 'SG.test-only',
        sendingDomain: 'example.com',
        fromEmail: 'sender@example.com',
        fromName: 'TOCA',
        bindingId: 'sendgrid-test',
        bindingState: 'INTEGRATION_VALIDATED',
        eventWebhookPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
      unusedPreparedResolver,
    );
    const runtime = new SendGridEventHttpRuntime(
      provider,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    const timestamp = '1787202000';
    const rawBody = Buffer.from(
      '[{"sg_event_id":"event-1","sg_message_id":"sg-msg-1","event":"delivered","timestamp":1787202000}]',
    );
    const signatureForDifferentBody = sign(
      'sha256',
      Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from('different-body')]),
      privateKey,
    ).toString('base64');

    await expect(
      runtime.handleEventWebhook(rawBody, {
        'x-twilio-email-event-webhook-timestamp': timestamp,
        'x-twilio-email-event-webhook-signature': signatureForDifferentBody,
      }),
    ).rejects.toThrow('SENDGRID_EVENT_WEBHOOK_SIGNATURE_INVALID');
  });
});
