import {
  assertProductionProviderBinding,
  type ProviderBindingRef,
  type ProviderMessageReadback,
  type ProviderSendReceipt,
  type ProviderSendRequest,
  type WhatsAppProviderAdapter,
} from '../../omnichannel/contracts.js';
import { MetaApiClient } from '../meta/meta-api-client.js';

export type WhatsAppMediaType = 'image' | 'audio' | 'video' | 'document';

export interface PreparedWhatsAppTextMessage {
  readonly kind: 'TEXT';
  readonly to: string;
  readonly text: string;
  readonly previewUrl?: boolean;
  readonly replyToProviderMessageId?: string | null;
}

export interface PreparedWhatsAppMediaMessage {
  readonly kind: 'MEDIA';
  readonly to: string;
  readonly mediaType: WhatsAppMediaType;
  readonly mediaId?: string | null;
  readonly link?: string | null;
  readonly caption?: string | null;
  readonly fileName?: string | null;
  readonly replyToProviderMessageId?: string | null;
}

export interface WhatsAppTemplateVariable {
  readonly name: string;
  readonly value: string;
}

export interface PreparedWhatsAppTemplateMessage {
  readonly kind: 'TEMPLATE';
  readonly to: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly variables: readonly WhatsAppTemplateVariable[];
}

export type PreparedWhatsAppMessage =
  PreparedWhatsAppTextMessage | PreparedWhatsAppMediaMessage | PreparedWhatsAppTemplateMessage;

export interface PreparedWhatsAppPayloadResolver {
  resolve(preparedPayloadRef: string): Promise<PreparedWhatsAppMessage | undefined>;
}

export interface WhatsAppProviderReadbackStore {
  latest(providerMessageId: string): Promise<ProviderMessageReadback | undefined>;
}

export interface WhatsAppCloudAdapterConfig {
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly binding: ProviderBindingRef;
}

export interface WhatsAppMediaMetadata {
  readonly id: string;
  readonly url: string;
  readonly mimeType: string | null;
  readonly sha256: string | null;
  readonly fileSize: number | null;
}

export class WhatsAppCloudAdapter implements WhatsAppProviderAdapter {
  readonly binding: ProviderBindingRef;

  constructor(
    private readonly api: MetaApiClient,
    private readonly config: WhatsAppCloudAdapterConfig,
    private readonly preparedPayloads: PreparedWhatsAppPayloadResolver,
    private readonly readbacks: WhatsAppProviderReadbackStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.binding = config.binding;
  }

  async validateTemplate(input: {
    readonly templateKey: string;
    readonly locale: string;
    readonly variableNames: readonly string[];
  }): Promise<{ readonly valid: boolean; readonly evidence: readonly string[] }> {
    requireText(input.templateKey, 'WHATSAPP_TEMPLATE_KEY_REQUIRED');
    requireText(input.locale, 'WHATSAPP_TEMPLATE_LOCALE_REQUIRED');
    assertDistinctVariableNames(input.variableNames);

    const response = await this.api.get(`${this.config.wabaId}/message_templates`, {
      name: input.templateKey,
      fields: 'name,status,language,components',
      limit: '50',
    });
    const templates = arrayValue(asRecord(response).data).map(asRecord);
    const candidate = templates.find(
      (template) =>
        stringValue(template.name) === input.templateKey &&
        stringValue(template.language) === input.locale &&
        stringValue(template.status) === 'APPROVED',
    );
    if (!candidate) {
      return {
        valid: false,
        evidence: [
          `meta:waba:${this.config.wabaId}`,
          `whatsapp:template:${input.templateKey}:${input.locale}:not-approved`,
        ],
      };
    }

    const expectedVariables = countTemplateVariables(candidate.components);
    const variableCountMatches =
      expectedVariables === null || expectedVariables === input.variableNames.length;
    return {
      valid: variableCountMatches,
      evidence: [
        `meta:waba:${this.config.wabaId}`,
        `whatsapp:template:${input.templateKey}:${input.locale}:APPROVED`,
        ...(expectedVariables === null
          ? ['whatsapp:template:variables:provider-not-enumerable']
          : [`whatsapp:template:variables:${expectedVariables}`]),
      ],
    };
  }

  async send(request: ProviderSendRequest): Promise<ProviderSendReceipt> {
    assertProductionProviderBinding(this.binding);
    if (request.channel !== 'WHATSAPP') throw new Error('WHATSAPP_CHANNEL_REQUIRED');
    const prepared = await this.preparedPayloads.resolve(request.preparedPayloadRef);
    if (!prepared) throw new Error('WHATSAPP_PREPARED_PAYLOAD_NOT_FOUND');
    validatePreparedMessage(prepared);

    if (prepared.kind === 'TEMPLATE') {
      const validation = await this.validateTemplate({
        templateKey: prepared.templateKey,
        locale: prepared.locale,
        variableNames: prepared.variables.map((variable) => variable.name),
      });
      if (!validation.valid) throw new Error('WHATSAPP_TEMPLATE_NOT_APPROVED');
    }

    const response = await this.api.postJson(
      `${this.config.phoneNumberId}/messages`,
      toCloudApiPayload(prepared),
    );
    const providerMessageId = firstProviderMessageId(response);
    return {
      provider: 'META_WHATSAPP_CLOUD',
      providerMessageId,
      acceptedAt: this.now(),
      state: 'ACCEPTED',
      evidence: [
        `meta:waba:${this.config.wabaId}`,
        `meta:phone-number-id:${this.config.phoneNumberId}`,
        `meta:wamid:${providerMessageId}`,
      ],
    };
  }

  async readback(providerMessageId: string): Promise<ProviderMessageReadback> {
    assertProductionProviderBinding(this.binding);
    requireText(providerMessageId, 'WHATSAPP_PROVIDER_MESSAGE_ID_REQUIRED');
    const observed = await this.readbacks.latest(providerMessageId);
    return (
      observed ?? {
        provider: 'META_WHATSAPP_CLOUD',
        providerMessageId,
        state: 'UNKNOWN',
        observedAt: this.now(),
        evidence: ['whatsapp:status-callback:not-observed'],
      }
    );
  }

  async readMediaMetadata(mediaId: string): Promise<WhatsAppMediaMetadata> {
    assertProductionProviderBinding(this.binding);
    const response = asRecord(
      await this.api.get(requireText(mediaId, 'WHATSAPP_MEDIA_ID_REQUIRED')),
    );
    const id = stringValue(response.id);
    const url = stringValue(response.url);
    if (!id || !url) throw new Error('WHATSAPP_MEDIA_METADATA_INVALID');
    return {
      id,
      url,
      mimeType: stringValue(response.mime_type) ?? null,
      sha256: validSha256(stringValue(response.sha256)) ?? null,
      fileSize: finiteInteger(response.file_size) ?? null,
    };
  }
}

function toCloudApiPayload(message: PreparedWhatsAppMessage): Readonly<Record<string, unknown>> {
  const base = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to,
  } as const;

  if (message.kind === 'TEXT') {
    return {
      ...base,
      type: 'text',
      ...(message.replyToProviderMessageId
        ? { context: { message_id: message.replyToProviderMessageId } }
        : {}),
      text: { preview_url: message.previewUrl ?? false, body: message.text },
    };
  }

  if (message.kind === 'MEDIA') {
    const media: Record<string, unknown> = message.mediaId
      ? { id: message.mediaId }
      : { link: message.link };
    if (message.caption && message.mediaType !== 'audio') media.caption = message.caption;
    if (message.fileName && message.mediaType === 'document') media.filename = message.fileName;
    return {
      ...base,
      type: message.mediaType,
      ...(message.replyToProviderMessageId
        ? { context: { message_id: message.replyToProviderMessageId } }
        : {}),
      [message.mediaType]: media,
    };
  }

  return {
    ...base,
    type: 'template',
    template: {
      name: message.templateKey,
      language: { code: message.locale },
      ...(message.variables.length > 0
        ? {
            components: [
              {
                type: 'body',
                parameters: message.variables.map((variable) => ({
                  type: 'text',
                  parameter_name: variable.name,
                  text: variable.value,
                })),
              },
            ],
          }
        : {}),
    },
  };
}

function validatePreparedMessage(message: PreparedWhatsAppMessage): void {
  if (!/^\d{7,15}$/.test(message.to)) throw new Error('WHATSAPP_RECIPIENT_INVALID');
  if (message.kind === 'TEXT') {
    requireText(message.text, 'WHATSAPP_TEXT_REQUIRED');
    return;
  }
  if (message.kind === 'MEDIA') {
    const hasId = Boolean(message.mediaId?.trim());
    const hasLink = Boolean(message.link?.trim());
    if (hasId === hasLink) throw new Error('WHATSAPP_MEDIA_SOURCE_INVALID');
    if (message.link) {
      const url = new URL(message.link);
      if (url.protocol !== 'https:') throw new Error('WHATSAPP_MEDIA_LINK_HTTPS_REQUIRED');
    }
    return;
  }
  requireText(message.templateKey, 'WHATSAPP_TEMPLATE_KEY_REQUIRED');
  requireText(message.locale, 'WHATSAPP_TEMPLATE_LOCALE_REQUIRED');
  assertDistinctVariableNames(message.variables.map((variable) => variable.name));
  for (const variable of message.variables)
    requireText(variable.value, 'WHATSAPP_TEMPLATE_VARIABLE_VALUE_REQUIRED');
}

function firstProviderMessageId(value: unknown): string {
  const root = asRecord(value);
  const first = asRecord(arrayValue(root.messages)[0]);
  const id = stringValue(first.id);
  if (!id) throw new Error('WHATSAPP_PROVIDER_MESSAGE_ID_MISSING');
  return id;
}

function assertDistinctVariableNames(names: readonly string[]): void {
  const normalized = names.map((name) =>
    requireText(name, 'WHATSAPP_TEMPLATE_VARIABLE_NAME_REQUIRED'),
  );
  if (new Set(normalized).size !== normalized.length)
    throw new Error('WHATSAPP_TEMPLATE_VARIABLE_DUPLICATE');
}

function countTemplateVariables(componentsValue: unknown): number | null {
  const components = arrayValue(componentsValue).map(asRecord);
  let highest = 0;
  let observed = false;
  for (const component of components) {
    const text = stringValue(component.text);
    if (!text) continue;
    for (const match of text.matchAll(/\{\{(\d+)\}\}/g)) {
      const raw = match[1];
      if (!raw) continue;
      const index = Number(raw);
      if (Number.isSafeInteger(index) && index > 0) {
        observed = true;
        highest = Math.max(highest, index);
      }
    }
  }
  return observed ? highest : components.length === 0 ? null : 0;
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
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

function finiteInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function validSha256(value: string | undefined): string | undefined {
  return value && /^[A-Fa-f0-9]{64}$/.test(value) ? value : undefined;
}
