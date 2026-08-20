import { createHash } from 'node:crypto';

export type WhatsAppMessageContentType =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'STICKER'
  | 'LOCATION'
  | 'CONTACT'
  | 'INTERACTIVE'
  | 'UNKNOWN';

export type WhatsAppDeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsAppInboundAttachment {
  readonly providerMediaId: string;
  readonly mimeType: string | null;
  readonly sha256: string | null;
  readonly fileName: string | null;
  readonly caption: string | null;
}

export interface WhatsAppInboundMessageEvent {
  readonly kind: 'MESSAGE';
  readonly eventId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly displayPhoneNumber: string | null;
  readonly providerMessageId: string;
  readonly senderWaId: string;
  readonly contactName: string | null;
  readonly occurredAt: string;
  readonly contentType: WhatsAppMessageContentType;
  readonly text: string | null;
  readonly replyToProviderMessageId: string | null;
  readonly attachments: readonly WhatsAppInboundAttachment[];
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WhatsAppDeliveryStatusEvent {
  readonly kind: 'STATUS';
  readonly eventId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly providerMessageId: string;
  readonly recipientWaId: string | null;
  readonly status: WhatsAppDeliveryStatus;
  readonly observedAt: string;
  readonly errorCode: string | null;
  readonly errorTitle: string | null;
}

export type WhatsAppWebhookEvent = WhatsAppInboundMessageEvent | WhatsAppDeliveryStatusEvent;
export type WhatsAppPreferenceCommand = 'OPT_IN' | 'OPT_OUT' | 'NONE';

export function parseWhatsAppWebhookEvents(rawBody: Buffer): readonly WhatsAppWebhookEvent[] {
  const root = asRecord(JSON.parse(rawBody.toString('utf8')));
  if (stringValue(root.object) !== 'whatsapp_business_account') return [];

  const events: WhatsAppWebhookEvent[] = [];
  for (const entryValue of arrayValue(root.entry)) {
    const entry = asRecord(entryValue);
    const wabaId = stringValue(entry.id);
    if (!wabaId) continue;

    for (const changeValue of arrayValue(entry.changes)) {
      const change = asRecord(changeValue);
      if (stringValue(change.field) !== 'messages') continue;
      const value = asRecord(change.value);
      const metadata = asRecord(value.metadata);
      const phoneNumberId = stringValue(metadata.phone_number_id);
      if (!phoneNumberId) continue;
      const displayPhoneNumber = stringValue(metadata.display_phone_number) ?? null;
      const names = contactNames(value.contacts);

      for (const messageValue of arrayValue(value.messages)) {
        const event = normalizeInboundMessage({
          wabaId,
          phoneNumberId,
          displayPhoneNumber,
          names,
          raw: asRecord(messageValue),
        });
        if (event) events.push(event);
      }

      for (const statusValue of arrayValue(value.statuses)) {
        const event = normalizeStatus({
          wabaId,
          phoneNumberId,
          raw: asRecord(statusValue),
        });
        if (event) events.push(event);
      }
    }
  }

  const deduplicated = new Map<string, WhatsAppWebhookEvent>();
  for (const event of events) {
    if (!deduplicated.has(event.eventId)) deduplicated.set(event.eventId, event);
  }
  return [...deduplicated.values()];
}

export function classifyWhatsappPreferenceCommand(text: string | null): WhatsAppPreferenceCommand {
  if (!text) return 'NONE';
  const normalized = normalizeCommand(text);
  const optOut = new Set([
    'STOP',
    'STOPALL',
    'UNSUBSCRIBE',
    'CANCEL',
    'END',
    'QUIT',
    'PARAR',
    'SAIR',
    'CANCELAR',
    'ENCERRAR',
  ]);
  if (optOut.has(normalized)) return 'OPT_OUT';
  const optIn = new Set(['START', 'SUBSCRIBE', 'INICIAR', 'ASSINAR', 'VOLTAR']);
  return optIn.has(normalized) ? 'OPT_IN' : 'NONE';
}

export function requestsHumanHandoff(text: string | null): boolean {
  if (!text) return false;
  const normalized = normalizeCommand(text);
  return new Set([
    'ATENDENTE',
    'HUMANO',
    'PESSOA',
    'FALAR COM ATENDENTE',
    'FALAR COM HUMANO',
    'FALAR COM UMA PESSOA',
  ]).has(normalized);
}

function normalizeInboundMessage(input: {
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly displayPhoneNumber: string | null;
  readonly names: ReadonlyMap<string, string>;
  readonly raw: Record<string, unknown>;
}): WhatsAppInboundMessageEvent | undefined {
  const providerMessageId = stringValue(input.raw.id);
  const senderWaId = stringValue(input.raw.from);
  const occurredAt = providerTimestamp(input.raw.timestamp);
  if (!providerMessageId || !senderWaId || !occurredAt) return undefined;

  const providerType = stringValue(input.raw.type) ?? 'unknown';
  const contentType = toContentType(providerType);
  const context = asRecord(input.raw.context);
  const replyToProviderMessageId = stringValue(context.id) ?? null;
  const { text, attachments, payload } = normalizeMessageContent(providerType, input.raw);

  return {
    kind: 'MESSAGE',
    eventId: deterministicId('message', input.phoneNumberId, providerMessageId),
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayPhoneNumber: input.displayPhoneNumber,
    providerMessageId,
    senderWaId,
    contactName: input.names.get(senderWaId) ?? null,
    occurredAt,
    contentType,
    text,
    replyToProviderMessageId,
    attachments,
    payload,
  };
}

function normalizeStatus(input: {
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly raw: Record<string, unknown>;
}): WhatsAppDeliveryStatusEvent | undefined {
  const providerMessageId = stringValue(input.raw.id);
  const status = toDeliveryStatus(stringValue(input.raw.status));
  const observedAt = providerTimestamp(input.raw.timestamp);
  if (!providerMessageId || !status || !observedAt) return undefined;

  const firstError = arrayValue(input.raw.errors).map(asRecord)[0];
  const errorCode = firstError ? scalarString(firstError.code) : null;
  const errorTitle = firstError
    ? (stringValue(firstError.title) ?? stringValue(firstError.message) ?? null)
    : null;
  const providerEventId = deterministicId(
    'status',
    input.phoneNumberId,
    providerMessageId,
    status,
    observedAt,
    errorCode ?? '',
  );

  return {
    kind: 'STATUS',
    eventId: providerEventId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    providerMessageId,
    recipientWaId: stringValue(input.raw.recipient_id) ?? null,
    status,
    observedAt,
    errorCode,
    errorTitle,
  };
}

function normalizeMessageContent(
  providerType: string,
  raw: Record<string, unknown>,
): {
  readonly text: string | null;
  readonly attachments: readonly WhatsAppInboundAttachment[];
  readonly payload: Readonly<Record<string, unknown>>;
} {
  if (providerType === 'text') {
    return { text: stringValue(asRecord(raw.text).body) ?? null, attachments: [], payload: {} };
  }

  if (providerType === 'button') {
    const button = asRecord(raw.button);
    return {
      text: stringValue(button.text) ?? null,
      attachments: [],
      payload: compactObject({ buttonPayload: stringValue(button.payload) ?? null }),
    };
  }

  if (providerType === 'interactive') {
    const interactive = asRecord(raw.interactive);
    const buttonReply = asRecord(interactive.button_reply);
    const listReply = asRecord(interactive.list_reply);
    const reply = Object.keys(buttonReply).length > 0 ? buttonReply : listReply;
    return {
      text: stringValue(reply.title) ?? stringValue(reply.description) ?? null,
      attachments: [],
      payload: compactObject({
        interactiveType: stringValue(interactive.type) ?? null,
        replyId: stringValue(reply.id) ?? null,
      }),
    };
  }

  if (['image', 'audio', 'video', 'document', 'sticker'].includes(providerType)) {
    const media = asRecord(raw[providerType]);
    const providerMediaId = stringValue(media.id);
    const attachment: WhatsAppInboundAttachment | undefined = providerMediaId
      ? {
          providerMediaId,
          mimeType: stringValue(media.mime_type) ?? null,
          sha256: validSha256(stringValue(media.sha256)) ?? null,
          fileName: stringValue(media.filename) ?? null,
          caption: stringValue(media.caption) ?? null,
        }
      : undefined;
    return {
      text: stringValue(media.caption) ?? null,
      attachments: attachment ? [attachment] : [],
      payload: {},
    };
  }

  if (providerType === 'location') {
    const location = asRecord(raw.location);
    return {
      text: stringValue(location.name) ?? stringValue(location.address) ?? null,
      attachments: [],
      payload: compactObject({
        latitude: finiteNumber(location.latitude) ?? null,
        longitude: finiteNumber(location.longitude) ?? null,
        name: stringValue(location.name) ?? null,
        address: stringValue(location.address) ?? null,
      }),
    };
  }

  if (providerType === 'contacts') {
    return { text: null, attachments: [], payload: { contactCount: arrayValue(raw.contacts).length } };
  }

  return { text: null, attachments: [], payload: { providerType } };
}

function contactNames(value: unknown): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const contactValue of arrayValue(value)) {
    const contact = asRecord(contactValue);
    const waId = stringValue(contact.wa_id);
    const name = stringValue(asRecord(contact.profile).name);
    if (waId && name) names.set(waId, name);
  }
  return names;
}

function toContentType(value: string): WhatsAppMessageContentType {
  const mapping: Readonly<Record<string, WhatsAppMessageContentType>> = {
    text: 'TEXT',
    image: 'IMAGE',
    audio: 'AUDIO',
    video: 'VIDEO',
    document: 'DOCUMENT',
    sticker: 'STICKER',
    location: 'LOCATION',
    contacts: 'CONTACT',
    interactive: 'INTERACTIVE',
    button: 'INTERACTIVE',
  };
  return mapping[value] ?? 'UNKNOWN';
}

function toDeliveryStatus(value: string | undefined): WhatsAppDeliveryStatus | undefined {
  if (value === 'sent') return 'SENT';
  if (value === 'delivered') return 'DELIVERED';
  if (value === 'read') return 'READ';
  if (value === 'failed') return 'FAILED';
  return undefined;
}

function providerTimestamp(value: unknown): string | undefined {
  const seconds = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}

function deterministicId(...parts: readonly string[]): string {
  return `wa_${createHash('sha256').update(parts.join('|')).digest('hex')}`;
}

function normalizeCommand(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function validSha256(value: string | undefined): string | undefined {
  return value && /^[A-Fa-f0-9]{64}$/.test(value) ? value : undefined;
}

function compactObject(
  input: Readonly<Record<string, string | number | boolean | null>>,
): Readonly<Record<string, string | number | boolean>> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] !== null,
    ),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function scalarString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
