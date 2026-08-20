import { describe, expect, it } from 'vitest';
import {
  classifyWhatsappPreferenceCommand,
  parseWhatsAppWebhookEvents,
  requestsHumanHandoff,
} from '../src/providers/whatsapp/whatsapp-cloud-webhook.js';

function webhookBody(): Buffer {
  return Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: {
                  display_phone_number: '5511999999999',
                  phone_number_id: 'phone-1',
                },
                contacts: [{ wa_id: '5511888888888', profile: { name: 'Cliente' } }],
                messages: [
                  {
                    from: '5511888888888',
                    id: 'wamid.inbound-1',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Olá' },
                  },
                  {
                    from: '5511888888888',
                    id: 'wamid.inbound-2',
                    timestamp: '1700000001',
                    type: 'image',
                    context: { id: 'wamid.previous' },
                    image: {
                      id: 'media-1',
                      mime_type: 'image/jpeg',
                      sha256: 'a'.repeat(64),
                      caption: 'Foto',
                    },
                  },
                ],
                statuses: [
                  {
                    id: 'wamid.outbound-1',
                    recipient_id: '5511888888888',
                    status: 'delivered',
                    timestamp: '1700000002',
                  },
                  {
                    id: 'wamid.outbound-2',
                    recipient_id: '5511888888888',
                    status: 'failed',
                    timestamp: '1700000003',
                    errors: [{ code: 131000, title: 'Generic provider failure' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  );
}

describe('WhatsApp Cloud webhook parser', () => {
  it('normalizes inbound text, media and delivery callbacks', () => {
    const events = parseWhatsAppWebhookEvents(webhookBody());
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      kind: 'MESSAGE',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      providerMessageId: 'wamid.inbound-1',
      senderWaId: '5511888888888',
      contactName: 'Cliente',
      contentType: 'TEXT',
      text: 'Olá',
      occurredAt: '2023-11-14T22:13:20.000Z',
    });
    expect(events[1]).toMatchObject({
      kind: 'MESSAGE',
      providerMessageId: 'wamid.inbound-2',
      contentType: 'IMAGE',
      text: 'Foto',
      replyToProviderMessageId: 'wamid.previous',
      attachments: [
        {
          providerMediaId: 'media-1',
          mimeType: 'image/jpeg',
          sha256: 'a'.repeat(64),
          caption: 'Foto',
        },
      ],
    });
    expect(events[2]).toMatchObject({
      kind: 'STATUS',
      providerMessageId: 'wamid.outbound-1',
      status: 'DELIVERED',
      observedAt: '2023-11-14T22:13:22.000Z',
    });
    expect(events[3]).toMatchObject({
      kind: 'STATUS',
      providerMessageId: 'wamid.outbound-2',
      status: 'FAILED',
      errorCode: '131000',
      errorTitle: 'Generic provider failure',
    });
  });

  it('deduplicates duplicate callbacks deterministically', () => {
    const first = parseWhatsAppWebhookEvents(webhookBody());
    const second = parseWhatsAppWebhookEvents(webhookBody());
    expect(first.map((event) => event.eventId)).toEqual(second.map((event) => event.eventId));

    const duplicated = JSON.parse(webhookBody().toString('utf8')) as {
      entry: Array<{ changes: Array<{ value: { messages: unknown[] } }> }>;
    };
    const messages = duplicated.entry[0]?.changes[0]?.value.messages;
    if (!messages?.[0]) throw new Error('TEST_MESSAGE_MISSING');
    messages.push(messages[0]);
    expect(parseWhatsAppWebhookEvents(Buffer.from(JSON.stringify(duplicated)))).toHaveLength(4);
  });

  it('does not cross-route non-WhatsApp Meta objects', () => {
    expect(
      parseWhatsAppWebhookEvents(Buffer.from(JSON.stringify({ object: 'instagram', entry: [] }))),
    ).toEqual([]);
  });
});

describe('WhatsApp preference and handoff commands', () => {
  it('recognizes only narrow explicit preference commands', () => {
    expect(classifyWhatsappPreferenceCommand('PARAR')).toBe('OPT_OUT');
    expect(classifyWhatsappPreferenceCommand(' sair ')).toBe('OPT_OUT');
    expect(classifyWhatsappPreferenceCommand('INICIAR')).toBe('OPT_IN');
    expect(classifyWhatsappPreferenceCommand('quero saber o horário')).toBe('NONE');
  });

  it('recognizes explicit human requests without fuzzy substring matching', () => {
    expect(requestsHumanHandoff('atendente')).toBe(true);
    expect(requestsHumanHandoff('falar com uma pessoa')).toBe(true);
    expect(requestsHumanHandoff('qual o valor por pessoa?')).toBe(false);
  });
});
