import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod/v4';
import type { InstagramWebhookEvent } from '../instagram/instagram-engagement-contracts.js';

const webhookPayloadSchema = z.object({
  object: z.string().min(1),
  entry: z.array(z.unknown()).default([]),
});

export interface MetaWebhookVerificationInput {
  readonly mode?: string | null;
  readonly verifyToken?: string | null;
  readonly challenge?: string | null;
}

export interface MetaWebhookVerificationResult {
  readonly accepted: boolean;
  readonly challenge?: string;
}

export function verifyMetaWebhookChallenge(
  input: MetaWebhookVerificationInput,
  expectedVerifyToken: string,
): MetaWebhookVerificationResult {
  const accepted =
    input.mode === 'subscribe' &&
    typeof input.verifyToken === 'string' &&
    input.verifyToken.length > 0 &&
    safeEqual(input.verifyToken, expectedVerifyToken) &&
    typeof input.challenge === 'string' &&
    input.challenge.length > 0;

  return accepted
    ? { accepted: true, challenge: input.challenge ?? undefined }
    : { accepted: false };
}

export function verifyMetaWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const supplied = signatureHeader.slice('sha256='.length);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;

  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(supplied.toLowerCase(), expected.toLowerCase());
}

export function parseMetaWebhookEvents(rawBody: Buffer): readonly InstagramWebhookEvent[] {
  const payload = webhookPayloadSchema.parse(JSON.parse(rawBody.toString('utf8')));
  const events: InstagramWebhookEvent[] = [];

  for (const entryValue of payload.entry) {
    if (!isRecord(entryValue)) continue;
    const accountId = stringValue(entryValue.id);
    if (!accountId) continue;

    // Meta currently emits Instagram comment webhooks in two supported shapes:
    // 1) entry.changes[] with { field, value }
    // 2) entry-level { field, value }
    // In both shapes the provider event timestamp may live on entry.time rather than value.
    // Normalize all variants through the same path so valid events cannot fail persistence
    // merely because Meta placed their occurrence timestamp on the envelope.
    const entryTimestamp = entryValue.time;
    const entryField = stringValue(entryValue.field);
    const entryValuePayload = isRecord(entryValue.value) ? entryValue.value : undefined;
    if (entryField && entryValuePayload) {
      const event = normalizeChange(
        accountId,
        entryField,
        entryValuePayload,
        entryValue,
        entryTimestamp,
      );
      if (event) events.push(event);
    }

    const changes = Array.isArray(entryValue.changes) ? entryValue.changes : [];
    for (const changeValue of changes) {
      if (!isRecord(changeValue)) continue;
      const field = stringValue(changeValue.field);
      const value = isRecord(changeValue.value) ? changeValue.value : {};
      const event = normalizeChange(accountId, field, value, changeValue, entryTimestamp);
      if (event) events.push(event);
    }

    const messaging = Array.isArray(entryValue.messaging) ? entryValue.messaging : [];
    for (const messagingValue of messaging) {
      if (!isRecord(messagingValue)) continue;
      const event = normalizeMessaging(accountId, messagingValue);
      if (event) events.push(event);
    }
  }

  return deduplicateEvents(events);
}

function normalizeChange(
  accountId: string,
  field: string | undefined,
  value: Record<string, unknown>,
  raw: Record<string, unknown>,
  fallbackTimestamp?: unknown,
): InstagramWebhookEvent | undefined {
  if (!field) return undefined;

  if (field === 'messages') {
    return normalizeDirectValue(accountId, value, raw, field);
  }

  const commentId = stringValue(value.id) ?? stringValue(value.comment_id);
  const mediaId = stringValue(value.media_id) ?? nestedString(value, 'media', 'id');
  const senderId = nestedString(value, 'from', 'id') ?? stringValue(value.from_id);
  const text = stringValue(value.text) ?? stringValue(value.message);
  const occurredAt = normalizeTimestamp(value.created_time ?? value.timestamp ?? fallbackTimestamp);

  if (!commentId && !field.includes('comment')) return undefined;

  return {
    eventId: deterministicEventId(accountId, 'COMMENT', commentId, occurredAt, raw),
    accountId,
    channel: 'COMMENT',
    ...(senderId ? { senderId } : {}),
    ...(commentId ? { commentId } : {}),
    ...(mediaId ? { mediaId } : {}),
    ...(text ? { text } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    rawType: field,
  };
}

function normalizeMessaging(
  accountId: string,
  raw: Record<string, unknown>,
): InstagramWebhookEvent | undefined {
  return normalizeDirectValue(accountId, raw, raw, 'messaging');
}

function normalizeDirectValue(
  accountId: string,
  value: Record<string, unknown>,
  raw: Record<string, unknown>,
  rawType: string,
): InstagramWebhookEvent | undefined {
  const message = isRecord(value.message) ? value.message : undefined;
  if (!message) return undefined;

  const messageId = stringValue(message.mid) ?? stringValue(message.id);
  const senderId = nestedString(value, 'sender', 'id');
  const recipientId = nestedString(value, 'recipient', 'id');
  const text = stringValue(message.text);
  const occurredAt = normalizeTimestamp(value.timestamp);

  return {
    eventId: deterministicEventId(accountId, 'DIRECT', messageId, occurredAt, raw),
    accountId,
    channel: 'DIRECT',
    ...(senderId ? { senderId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(text ? { text } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    rawType: recipientId ? rawType : `${rawType}_unknown_recipient`,
  };
}

function deduplicateEvents(
  events: readonly InstagramWebhookEvent[],
): readonly InstagramWebhookEvent[] {
  const unique = new Map<string, InstagramWebhookEvent>();
  for (const event of events) {
    if (!unique.has(event.eventId)) unique.set(event.eventId, event);
  }
  return [...unique.values()];
}

function deterministicEventId(
  accountId: string,
  channel: 'COMMENT' | 'DIRECT',
  providerId: string | undefined,
  occurredAt: string | undefined,
  raw: Record<string, unknown>,
): string {
  const material = providerId
    ? `${accountId}:${channel}:${providerId}:${occurredAt ?? ''}`
    : `${accountId}:${channel}:${JSON.stringify(raw)}`;
  return createHash('sha256').update(material).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nestedString(
  input: Record<string, unknown>,
  objectKey: string,
  valueKey: string,
): string | undefined {
  const nested = input[objectKey];
  return isRecord(nested) ? stringValue(nested[valueKey]) : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  return undefined;
}
