import { describe, expect, it } from 'vitest';
import { InMemorySecretStore } from '../src/core/secrets.js';
import { MetaApiClient, type MetaApiResponse, type MetaApiTransport } from '../src/providers/meta/meta-api-client.js';
import {
  WhatsAppCloudAdapter,
  type PreparedWhatsAppMessage,
  type PreparedWhatsAppPayloadResolver,
  type WhatsAppProviderReadbackStore,
} from '../src/providers/whatsapp/whatsapp-cloud-adapter.js';
import type { ProviderMessageReadback } from '../src/omnichannel/contracts.js';

class RecordingTransport implements MetaApiTransport {
  readonly requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];

  async request(url: string, init: RequestInit): Promise<MetaApiResponse> {
    this.requests.push({ url, init });
    if (init.method === 'GET' && url.includes('/waba-1/message_templates')) {
      return response({
        data: [
          {
            name: 'booking_update',
            status: 'APPROVED',
            language: 'pt_BR',
            components: [{ type: 'BODY', text: 'Olá {{1}}, sua reserva é {{2}}.' }],
          },
        ],
      });
    }
    if (init.method === 'POST' && url.endsWith('/v23.0/phone-1/messages')) {
      return response({ messages: [{ id: 'wamid.provider-1' }] });
    }
    if (init.method === 'GET' && url.endsWith('/v23.0/media-1')) {
      return response({
        id: 'media-1',
        url: 'https://lookaside.example.test/media-1',
        mime_type: 'image/jpeg',
        sha256: 'b'.repeat(64),
        file_size: 42,
      });
    }
    return { ok: false, status: 404, json: async () => ({ error: { code: 100 } }) };
  }
}

function response(value: unknown): MetaApiResponse {
  return { ok: true, status: 200, json: async () => value };
}

class Payloads implements PreparedWhatsAppPayloadResolver {
  constructor(private readonly values: Readonly<Record<string, PreparedWhatsAppMessage>>) {}
  async resolve(ref: string): Promise<PreparedWhatsAppMessage | undefined> {
    return this.values[ref];
  }
}

class Readbacks implements WhatsAppProviderReadbackStore {
  constructor(private readonly value?: ProviderMessageReadback) {}
  async latest(): Promise<ProviderMessageReadback | undefined> {
    return this.value;
  }
}

async function fixture(payloads: Readonly<Record<string, PreparedWhatsAppMessage>>, readback?: ProviderMessageReadback) {
  const secrets = new InMemorySecretStore();
  const accessToken = await secrets.put('META_ACCESS_TOKEN', 'secret-token-value');
  const transport = new RecordingTransport();
  const api = new MetaApiClient(
    { graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v23.0' },
    secrets,
    accessToken,
    transport,
  );
  const adapter = new WhatsAppCloudAdapter(
    api,
    {
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

describe('WhatsApp Cloud API adapter', () => {
  it('builds a governed text send with bearer credentials resolved from SecretResolver', async () => {
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
      eligibility: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        correlationId: 'corr-1',
        channel: 'WHATSAPP',
        contact: {
          tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1',
          contactRecordId: 'contact-1', resolutionId: 'resolution-1', status: 'RESOLVED',
        },
        privacy: {
          tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1',
          executionId: 'privacy-1', subjectRef: 'subject-1',
          decision: { state: 'ALLOWED', blocked: false, reasons: [], purposeId: 'service', channel: 'WHATSAPP' },
        },
        policy: {
          tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1',
          decisionId: 'policy-1', allowed: true,
        },
        approval: {
          tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1',
          approvalId: 'approval-1', status: 'APPROVED',
        },
      },
    });

    expect(receipt).toMatchObject({
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId: 'wamid.provider-1',
      state: 'ACCEPTED',
    });
    const request = transport.requests.at(-1)!;
    expect(request.url).toBe('https://graph.facebook.com/v23.0/phone-1/messages');
    expect(request.init.headers).toMatchObject({ Authorization: 'Bearer secret-token-value' });
    expect(JSON.parse(String(request.init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511888888888',
      type: 'text',
      text: { preview_url: false, body: 'Olá' },
    });
  });

  it('requires provider-approved templates and emits named template variables', async () => {
    const { adapter, transport } = await fixture({
      template: {
        kind: 'TEMPLATE',
        to: '5511888888888',
        templateKey: 'booking_update',
        locale: 'pt_BR',
        variables: [
          { name: '1', value: 'Luiz' },
          { name: '2', value: '#ABC' },
        ],
      },
    });
    const result = await adapter.validateTemplate({
      templateKey: 'booking_update', locale: 'pt_BR', variableNames: ['1', '2'],
    });
    expect(result.valid).toBe(true);
    expect(transport.requests[0]?.url).toContain('/waba-1/message_templates?');
  });

  it('reads provider media metadata without downloading content', async () => {
    const { adapter } = await fixture({});
    await expect(adapter.readMediaMetadata('media-1')).resolves.toEqual({
      id: 'media-1',
      url: 'https://lookaside.example.test/media-1',
      mimeType: 'image/jpeg',
      sha256: 'b'.repeat(64),
      fileSize: 42,
    });
  });

  it('returns callback-backed readback and stays UNKNOWN before any callback', async () => {
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
      providerMessageId: 'wamid.provider-2',
      state: 'UNKNOWN',
      evidence: ['whatsapp:status-callback:not-observed'],
    });
  });

  it('refuses non-production provider bindings before a side effect', async () => {
    const secrets = new InMemorySecretStore();
    const token = await secrets.put('META_ACCESS_TOKEN', 'secret');
    const transport = new RecordingTransport();
    const adapter = new WhatsAppCloudAdapter(
      new MetaApiClient({ graphBaseUrl: 'https://graph.facebook.com', apiVersion: 'v23.0' }, secrets, token, transport),
      {
        wabaId: 'waba-1', phoneNumberId: 'phone-1',
        binding: { providerKey: 'META_WHATSAPP_CLOUD', bindingId: 'binding-1', state: 'CONNECTED' },
      },
      new Payloads({ text: { kind: 'TEXT', to: '5511888888888', text: 'Olá' } }),
      new Readbacks(),
    );

    await expect(adapter.send({
      tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1',
      channel: 'WHATSAPP', contactRecordId: 'contact-1', preparedPayloadRef: 'text', idempotencyKey: 'idem-1',
      eligibility: {
        tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1', channel: 'WHATSAPP',
        contact: { tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1', contactRecordId: 'contact-1', resolutionId: 'resolution-1', status: 'RESOLVED' },
        privacy: { tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1', executionId: 'privacy-1', subjectRef: 'subject-1', decision: { state: 'ALLOWED', blocked: false, reasons: [], purposeId: 'service', channel: 'WHATSAPP' } },
        policy: { tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1', decisionId: 'policy-1', allowed: true },
        approval: { tenantId: 'tenant-1', workspaceId: 'workspace-1', organizationId: 'org-1', correlationId: 'corr-1', approvalId: 'approval-1', status: 'APPROVED' },
      },
    })).rejects.toThrow('OMNICHANNEL_PROVIDER_NOT_PRODUCTION_VALIDATED');
    expect(transport.requests).toHaveLength(0);
  });
});
