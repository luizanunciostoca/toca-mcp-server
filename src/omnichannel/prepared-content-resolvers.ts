import type { CrmScope } from '../crm/crm-records.js';
import type {
  SendGridAttachmentPayload,
  SendGridPreparedCampaignResolver,
  SendGridPreparedEmail,
} from '../providers/sendgrid/email-provider.js';
import type {
  PreparedWhatsAppMessage,
  PreparedWhatsAppPayloadResolver,
  WhatsAppTemplateVariable,
} from '../providers/whatsapp/whatsapp-cloud-adapter.js';
import type { OmnichannelPreparedContentStore } from './prepared-content.js';

export class StoredSendGridPreparedCampaignResolver implements SendGridPreparedCampaignResolver {
  constructor(
    private readonly store: OmnichannelPreparedContentStore,
    private readonly scope: CrmScope,
  ) {}

  async resolve(preparedCampaignRef: string): Promise<SendGridPreparedEmail> {
    const record = await this.store.get({
      ...this.scope,
      preparedContentRef: requireText(preparedCampaignRef, 'EMAIL_PREPARED_CAMPAIGN_REF_REQUIRED'),
      contentKind: 'EMAIL_CAMPAIGN',
    });
    if (!record) throw new Error('EMAIL_PREPARED_CAMPAIGN_NOT_FOUND');
    return emailPayload(record.payload);
  }
}

export class StoredWhatsAppPreparedPayloadResolver implements PreparedWhatsAppPayloadResolver {
  constructor(
    private readonly store: OmnichannelPreparedContentStore,
    private readonly scope: CrmScope,
  ) {}

  async resolve(preparedPayloadRef: string): Promise<PreparedWhatsAppMessage | undefined> {
    const record = await this.store.get({
      ...this.scope,
      preparedContentRef: requireText(preparedPayloadRef, 'WHATSAPP_PREPARED_PAYLOAD_REF_REQUIRED'),
      contentKind: 'WHATSAPP_MESSAGE',
    });
    return record ? whatsappPayload(record.payload) : undefined;
  }
}

function emailPayload(payload: Readonly<Record<string, unknown>>): SendGridPreparedEmail {
  const result: SendGridPreparedEmail = {
    to: stringArray(payload.to, 'EMAIL_PREPARED_TO_REQUIRED'),
    subject: requireTextValue(payload.subject, 'EMAIL_PREPARED_SUBJECT_REQUIRED'),
    internetMessageId: requireTextValue(
      payload.internet_message_id,
      'EMAIL_PREPARED_INTERNET_MESSAGE_ID_REQUIRED',
    ),
    customArgs: stringMap(payload.metadata ?? {}, 'EMAIL_PREPARED_METADATA_INVALID'),
    openTrackingRequested: booleanValue(
      payload.open_tracking_requested,
      'EMAIL_PREPARED_OPEN_TRACKING_REQUIRED',
    ),
    clickTrackingRequested: booleanValue(
      payload.click_tracking_requested,
      'EMAIL_PREPARED_CLICK_TRACKING_REQUIRED',
    ),
    privacyTrackingAllowed: booleanValue(
      payload.privacy_tracking_allowed,
      'EMAIL_PREPARED_PRIVACY_TRACKING_REQUIRED',
    ),
    policyTrackingAllowed: booleanValue(
      payload.policy_tracking_allowed,
      'EMAIL_PREPARED_POLICY_TRACKING_REQUIRED',
    ),
    ...(optionalStringArray(payload.cc, 'EMAIL_PREPARED_CC_INVALID') as readonly string[] | undefined
      ? { cc: optionalStringArray(payload.cc, 'EMAIL_PREPARED_CC_INVALID') }
      : {}),
    ...(optionalStringArray(payload.bcc, 'EMAIL_PREPARED_BCC_INVALID') as readonly string[] | undefined
      ? { bcc: optionalStringArray(payload.bcc, 'EMAIL_PREPARED_BCC_INVALID') }
      : {}),
    ...(nullableString(payload.text, 'EMAIL_PREPARED_TEXT_INVALID') !== undefined
      ? { text: nullableString(payload.text, 'EMAIL_PREPARED_TEXT_INVALID') }
      : {}),
    ...(nullableString(payload.html, 'EMAIL_PREPARED_HTML_INVALID') !== undefined
      ? { html: nullableString(payload.html, 'EMAIL_PREPARED_HTML_INVALID') }
      : {}),
    ...(nullableString(payload.in_reply_to, 'EMAIL_PREPARED_IN_REPLY_TO_INVALID') !== undefined
      ? { inReplyTo: nullableString(payload.in_reply_to, 'EMAIL_PREPARED_IN_REPLY_TO_INVALID') }
      : {}),
    ...(optionalStringArray(payload.references, 'EMAIL_PREPARED_REFERENCES_INVALID')
      ? { references: optionalStringArray(payload.references, 'EMAIL_PREPARED_REFERENCES_INVALID') }
      : {}),
    ...(optionalPositiveInteger(payload.suppression_group_id, 'EMAIL_PREPARED_SUPPRESSION_GROUP_INVALID') !==
    undefined
      ? {
          unsubscribeGroupId: optionalPositiveInteger(
            payload.suppression_group_id,
            'EMAIL_PREPARED_SUPPRESSION_GROUP_INVALID',
          ),
        }
      : {}),
    ...(payload.attachments !== undefined
      ? { attachments: attachments(payload.attachments) }
      : {}),
  };
  if (!result.text?.trim() && !result.html?.trim()) throw new Error('EMAIL_PREPARED_CONTENT_REQUIRED');
  return result;
}

function whatsappPayload(payload: Readonly<Record<string, unknown>>): PreparedWhatsAppMessage {
  const kind = requireTextValue(payload.kind, 'WHATSAPP_PREPARED_KIND_REQUIRED');
  const to = requireTextValue(payload.to, 'WHATSAPP_PREPARED_TO_REQUIRED');
  if (kind === 'TEXT') {
    return {
      kind,
      to,
      text: requireTextValue(payload.text, 'WHATSAPP_PREPARED_TEXT_REQUIRED'),
      ...(typeof payload.preview_url === 'boolean' ? { previewUrl: payload.preview_url } : {}),
      ...(nullableString(payload.reply_to_provider_message_id, 'WHATSAPP_PREPARED_REPLY_INVALID') !==
      undefined
        ? {
            replyToProviderMessageId: nullableString(
              payload.reply_to_provider_message_id,
              'WHATSAPP_PREPARED_REPLY_INVALID',
            ),
          }
        : {}),
    };
  }
  if (kind === 'TEMPLATE') {
    return {
      kind,
      to,
      templateKey: requireTextValue(payload.template_key, 'WHATSAPP_PREPARED_TEMPLATE_KEY_REQUIRED'),
      locale: requireTextValue(payload.locale, 'WHATSAPP_PREPARED_TEMPLATE_LOCALE_REQUIRED'),
      variables: templateVariables(payload.variables),
    };
  }
  if (kind === 'MEDIA') {
    const mediaType = requireTextValue(payload.media_type, 'WHATSAPP_PREPARED_MEDIA_TYPE_REQUIRED');
    if (!['image', 'audio', 'video', 'document'].includes(mediaType)) {
      throw new Error('WHATSAPP_PREPARED_MEDIA_TYPE_INVALID');
    }
    return {
      kind,
      to,
      mediaType: mediaType as 'image' | 'audio' | 'video' | 'document',
      ...(nullableString(payload.media_id, 'WHATSAPP_PREPARED_MEDIA_ID_INVALID') !== undefined
        ? { mediaId: nullableString(payload.media_id, 'WHATSAPP_PREPARED_MEDIA_ID_INVALID') }
        : {}),
      ...(nullableString(payload.link, 'WHATSAPP_PREPARED_LINK_INVALID') !== undefined
        ? { link: nullableString(payload.link, 'WHATSAPP_PREPARED_LINK_INVALID') }
        : {}),
      ...(nullableString(payload.caption, 'WHATSAPP_PREPARED_CAPTION_INVALID') !== undefined
        ? { caption: nullableString(payload.caption, 'WHATSAPP_PREPARED_CAPTION_INVALID') }
        : {}),
      ...(nullableString(payload.file_name, 'WHATSAPP_PREPARED_FILE_NAME_INVALID') !== undefined
        ? { fileName: nullableString(payload.file_name, 'WHATSAPP_PREPARED_FILE_NAME_INVALID') }
        : {}),
      ...(nullableString(payload.reply_to_provider_message_id, 'WHATSAPP_PREPARED_REPLY_INVALID') !==
      undefined
        ? {
            replyToProviderMessageId: nullableString(
              payload.reply_to_provider_message_id,
              'WHATSAPP_PREPARED_REPLY_INVALID',
            ),
          }
        : {}),
    };
  }
  throw new Error('WHATSAPP_PREPARED_KIND_INVALID');
}

function attachments(value: unknown): readonly SendGridAttachmentPayload[] {
  if (!Array.isArray(value)) throw new Error('EMAIL_PREPARED_ATTACHMENTS_INVALID');
  return value.map((entry) => {
    const item = objectValue(entry, 'EMAIL_PREPARED_ATTACHMENT_INVALID');
    const disposition = requireTextValue(item.disposition, 'EMAIL_PREPARED_ATTACHMENT_DISPOSITION_REQUIRED');
    if (disposition !== 'attachment' && disposition !== 'inline') {
      throw new Error('EMAIL_PREPARED_ATTACHMENT_DISPOSITION_INVALID');
    }
    return {
      contentBase64: requireTextValue(item.content_base64, 'EMAIL_PREPARED_ATTACHMENT_CONTENT_REQUIRED'),
      fileName: requireTextValue(item.file_name, 'EMAIL_PREPARED_ATTACHMENT_NAME_REQUIRED'),
      contentType: requireTextValue(item.content_type, 'EMAIL_PREPARED_ATTACHMENT_TYPE_REQUIRED'),
      disposition,
      ...(nullableString(item.content_id, 'EMAIL_PREPARED_ATTACHMENT_CONTENT_ID_INVALID') !== undefined
        ? { contentId: nullableString(item.content_id, 'EMAIL_PREPARED_ATTACHMENT_CONTENT_ID_INVALID') }
        : {}),
    };
  });
}

function templateVariables(value: unknown): readonly WhatsAppTemplateVariable[] {
  if (!Array.isArray(value)) throw new Error('WHATSAPP_PREPARED_TEMPLATE_VARIABLES_INVALID');
  return value.map((entry) => {
    const item = objectValue(entry, 'WHATSAPP_PREPARED_TEMPLATE_VARIABLE_INVALID');
    return {
      name: requireTextValue(item.name, 'WHATSAPP_PREPARED_TEMPLATE_VARIABLE_NAME_REQUIRED'),
      value: requireTextValue(item.value, 'WHATSAPP_PREPARED_TEMPLATE_VARIABLE_VALUE_REQUIRED'),
    };
  });
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, code: string): readonly string[] {
  const result = optionalStringArray(value, code);
  if (!result || result.length === 0) throw new Error(code);
  return result;
}

function optionalStringArray(value: unknown, code: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(code);
  }
  return value.map((entry) => (entry as string).trim());
}

function stringMap(value: unknown, code: string): Readonly<Record<string, string>> {
  const object = objectValue(value, code);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== 'string') throw new Error(code);
    result[key] = item;
  }
  return result;
}

function booleanValue(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') throw new Error(code);
  return value;
}

function nullableString(value: unknown, code: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim();
  return normalized || null;
}

function optionalPositiveInteger(value: unknown, code: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(code);
  return value as number;
}

function requireTextValue(value: unknown, code: string): string {
  if (typeof value !== 'string') throw new Error(code);
  return requireText(value, code);
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
