import { describe, expect, it } from 'vitest';
import { discoverSendGridEventWebhookPublicKey } from '../src/providers/sendgrid/event-webhook-discovery.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SendGrid Event Webhook discovery', () => {
  it('selects the only enabled signed webhook using only the API key', async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requests.push(String(input));
      return response({
        webhooks: [
          {
            id: 'hook-1',
            url: 'https://hooks.example.test/webhooks/sendgrid/events',
            enabled: true,
            public_key: '-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----',
          },
        ],
      });
    };

    const result = await discoverSendGridEventWebhookPublicKey({
      apiKey: 'test-api-key',
      fetchImpl,
    });

    expect(result).toMatchObject({
      webhookId: 'hook-1',
      url: 'https://hooks.example.test/webhooks/sendgrid/events',
    });
    expect(result.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(requests[0]).toContain('/v3/user/webhooks/event/settings/all');
  });

  it('uses the expected URL to disambiguate and fails closed otherwise', async () => {
    const fetchImpl: typeof fetch = async () =>
      response({
        webhooks: [
          {
            id: 'hook-a',
            url: 'https://a.example.test/events',
            enabled: true,
            public_key: 'key-a',
          },
          {
            id: 'hook-b',
            url: 'https://b.example.test/events/',
            enabled: true,
            public_key: 'key-b',
          },
        ],
      });

    await expect(
      discoverSendGridEventWebhookPublicKey({ apiKey: 'test-api-key', fetchImpl }),
    ).rejects.toThrow('SENDGRID_SIGNED_EVENT_WEBHOOK_AMBIGUOUS');

    const selected = await discoverSendGridEventWebhookPublicKey({
      apiKey: 'test-api-key',
      expectedUrl: 'https://b.example.test/events',
      fetchImpl,
    });
    expect(selected.webhookId).toBe('hook-b');
    expect(selected.publicKey).toBe('key-b');
  });

  it('does not accept disabled or unsigned webhooks', async () => {
    const fetchImpl: typeof fetch = async () =>
      response({
        webhooks: [
          {
            id: 'disabled',
            url: 'https://example.test/disabled',
            enabled: false,
            public_key: 'key',
          },
          {
            id: 'unsigned',
            url: 'https://example.test/unsigned',
            enabled: true,
            public_key: null,
          },
        ],
      });

    await expect(
      discoverSendGridEventWebhookPublicKey({ apiKey: 'test-api-key', fetchImpl }),
    ).rejects.toThrow('SENDGRID_SIGNED_EVENT_WEBHOOK_NOT_FOUND');
  });
});
