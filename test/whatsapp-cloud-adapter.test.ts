import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from '../src/core/secrets.js';
import type {
  OutboundEligibilityContext,
  ProviderMessageReadback,
} from '../src/omnichannel/contracts.js';
import {
  MetaApiClient,
  type MetaApiResponse,
  type MetaApiTransport,
} from '../src/providers/meta/meta-api-client.js';
import {
  WhatsAppCloudAdapter,
  type PreparedWhatsAppMessage,
  type PreparedWhatsAppPayloadResolver,
  type WhatsAppProviderReadbackStore,
} from '../src/providers/whatsapp/whatsapp-cloud-adapter.js';

class RecordingTransport implements MetaApiTransport {
  readonly requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];

  request(url: string, init: RequestInit): Promise<MetaApiResponse> {
    this.requests.push({ url, init });
    if (init.method === 'GET' && url.includes('/waba-1/message_templates')) {
      return Promise.resolve(
        okResponse({
          data: [
            {
              name: 'booking_update',
              status: 'APPROVED',
              language: 'pt_BR',
              components: [{ type: 'BODY', text: 'Olá {{1}}, reserva {{2}}.' }],
            },
            {
              name: 'named_update',
              status: 'APPROVED',
              language: 'pt_BR',
              components: [{ type: 'BODY', text: 'Olá {{nome}}, reserva {{codigo}}.' }],
            },
          ],
        }),
      );
    }
    if (init.method === 'GET' && url.endsWith('/v23.0/media-1')) {
      return Promise.resolve(
        okResponse({
          id: 'media-1',
          url: 'https://lookaside.example.test/media-1',
          mime_type: 'image/jpeg',
          sha256: 'b'.repeat(64),
          file_size: 42,
        }),
      );
    }
    if (init.method === 'POST' && url.endsWith('/v23.0/phone-1/messages')) {
      return Promise.resolve(okResponse({ messages: [{ id: 'wamid.provider-1' }] }));
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: 100 } }),
    });
  }
}

function okResponse(value: unknown): MetaApiResponse {
  return { ok: true, status: 200, json: () => Promise.resolve(value) };
}

class Payloads implements PreparedWhatsAppPayloadResolver {
  constructor(private readonly values: Readonly<Record<string, PreparedWhatsAppMessage>>) {}

  resolve(ref: string): Promise<PreparedWhatsAppMessage | undefined> {
    return Promise.resolve(this.values[ref]);
  }
}

class Readbacks implements WhatsAppProviderReadbackStore {
  constructor(private readonly value?: ProviderMessageReadback) {}

  latest(): Promise<ProviderMessageReadback | undefined> {
    return Promise.resolve(this.value);
  }
}

function eligibility(): OutboundEligibilityContext {
  const scope = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    organizationId: 'org-1',
    correlationId: 'corr-1',
  } as const;
  return {
    ...scope,
    channel: 'WHATSAPP',
    contact: {
      ...scope,
      contactRecordId: 'contact-1',
      resolutionId: 'resolution-1',
      status: 'RESOLVED',
    },
    privacy: {
      ...scope,
      executionId: 'privacy-1',
      subjectRef: 'subject-1',
      decision: {
        state: 'ALLOWED',
        blocked: false,
        reasons: [],
        purposeId: 'customer-service',
        channel: 'WHATSAPP',
      },
    },
    policy: { ...scope, decisionId: 'policy-1', allowed: true },
    approval: { ...scope, approvalId: 'approval-1', status: 'APPROVED' },
  };
}

async function fixture(
  payloads: Readonly<Record<string, PreparedWhatsAppMessage>>,
  readback?: ProviderMessageReadback,
) {
  const secrets = new InMemorySecretStore();
  const token = await secrets.put('META_ACCESS_TOKEN', 'secret-token-value');
  const transport = new RecordingTransport();
  const api = new MetaApiClient(
    { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v23.0' },
    secrets,
    token,
    transport,
  );
  const adapter = new WhatsAppCloudAdapter(
    api,
    {
      metaAppId: 'app-1',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      binding: {
        providerKey: 'META_WHATSAPP_CLOUD',
        bindingId: 'binding-1',
        state: 'PRODUCTION_VALIDATED',
      },
    },
    new Payloads(payloads),
    new Readbacks(readback),
    () => '2026-08-20T04:00:00.000Z',
  );
  return { adapter, transport };
}

describe('WhatsAppCloudAdapter', () => {
  it('sends text through canonical Meta client with SecretResolver credentials', async () => {
    const { adapter, transport } = await fixture({
      text: { kind: 'TEXT', to: '5511888888888', text: 'Olá', previewUrl: false },
    });

    const receipt = await adapter.send({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      organizationId: 'org-1',
      correlationId: 'corr-1',
      channel: 'WHATSAPP',
      contactRecordId: 'contact-1',
      preparedPayloadRef: 'text',
      idempotencyKey: 'idem-1',
      eligibility: eligibility(),
    });

    expect(receipt).toMatchObject({
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId: 'wamid.provider-1',
      state: 'ACCEPTED',
      evidence: expect.arrayContaining(['meta:app:app-1', 'meta:waba:waba-1']),
    });
    const request = transport.requests.at(-1);
    expect(request?.url).toBe('https://graph.facebook.com/v23.0/phone-1/messages');
    expect(request?.init.headers).toMatchObject({ Authorization: 'Bearer secret-token-value' });
    if (typeof request?.init.body !== 'string') throw new Error('EXPECTED_JSON_BODY');
    const parsedBody = JSON.parse(request.init.body) as unknown;
    expect(parsedBody).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511888888888',
      type: 'text',
      text: { preview_url: false, body: 'Olá' },
    });
  });

  it('validates approved positional and named template variables', async () => {
    const { adapter } = await fixture({});
    await expect(
      adapter.validateTemplate({
        templateKey: 'booking_update',
        locale: 'pt_BR',
        variableNames: ['1', '2'],
      }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      adapter.validateTemplate({
        templateKey: 'booking_update',
        locale: 'pt_BR',
        variableNames: ['1'],
      }),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      adapter.validateTemplate({
        templateKey: 'named_update',
        locale: 'pt_BR',
        variableNames: ['codigo', 'nome'],
      }),
    ).resolves.toMatchObject({ valid: true });
  });

  it('reads media metadata without downloading the media body', async () => {
    const { adapter } = await fixture({});
    await expect(adapter.readMediaMetadata('media-1')).resolves.toEqual({
      id: 'media-1',
      url: 'https://lookaside.example.test/media-1',
      mimeType: 'image/jpeg',
      sha256: 'b'.repeat(64),
      fileSize: 42,
    });
  });

  it('uses callback state for readback and stays UNKNOWN before callback evidence', async () => {
    const observed: ProviderMessageReadback = {
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId: 'wamid.provider-1',
      state: 'DELIVERED',
      observedAt: '2026-08-20T04:00:01.000Z',
      evidence: ['callback:delivered'],
    };
    const withCallback = await fixture({}, observed);
    await expect(withCallback.adapter.readback('wamid.provider-1')).resolves.toEqual(observed);

    const withoutCallback = await fixture({});
    await expect(withoutCallback.adapter.readback('wamid.provider-2')).resolves.toMatchObject({
      state: 'UNKNOWN',
      evidence: ['whatsapp:status-callback:not-observed'],
    });
  });
});
