import { createHash } from 'node:crypto';
import type { CrmScope } from '../crm/crm-records.js';

export const OMNICHANNEL_PREPARED_CONTENT_KINDS = ['EMAIL_CAMPAIGN', 'WHATSAPP_MESSAGE'] as const;
export type OmnichannelPreparedContentKind = (typeof OMNICHANNEL_PREPARED_CONTENT_KINDS)[number];

export interface OmnichannelPreparedContentRecord extends CrmScope {
  readonly preparedContentRef: string;
  readonly contentKind: OmnichannelPreparedContentKind;
  readonly schemaVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly contentSha256: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

export interface PutOmnichannelPreparedContentInput extends CrmScope {
  readonly contentKind: OmnichannelPreparedContentKind;
  readonly schemaVersion?: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evidence: readonly string[];
  readonly now?: string;
}

export interface GetOmnichannelPreparedContentInput extends CrmScope {
  readonly preparedContentRef: string;
  readonly contentKind: OmnichannelPreparedContentKind;
}

export interface OmnichannelPreparedContentStore {
  put(input: PutOmnichannelPreparedContentInput): Promise<OmnichannelPreparedContentRecord>;
  get(
    input: GetOmnichannelPreparedContentInput,
  ): Promise<OmnichannelPreparedContentRecord | undefined>;
}

export function buildOmnichannelPreparedContentRecord(
  input: PutOmnichannelPreparedContentInput,
): OmnichannelPreparedContentRecord {
  const tenantId = requireText(input.tenantId, 'OMNICHANNEL_PREPARED_TENANT_REQUIRED');
  const workspaceId = requireText(input.workspaceId, 'OMNICHANNEL_PREPARED_WORKSPACE_REQUIRED');
  const organizationId = requireText(
    input.organizationId,
    'OMNICHANNEL_PREPARED_ORGANIZATION_REQUIRED',
  );
  assertKind(input.contentKind);
  const schemaVersion = input.schemaVersion ?? 1;
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('OMNICHANNEL_PREPARED_SCHEMA_VERSION_INVALID');
  }
  const payload = normalizeJsonObject(input.payload);
  const evidence = normalizeEvidence(input.evidence);
  const contentSha256 = sha256(canonicalJson(payload));
  const scopeDigest = sha256(
    [
      tenantId,
      workspaceId,
      organizationId,
      input.contentKind,
      String(schemaVersion),
      contentSha256,
    ].join('\u001f'),
  );
  const createdAt = normalizeTimestamp(input.now ?? new Date().toISOString());
  return {
    tenantId,
    workspaceId,
    organizationId,
    preparedContentRef: `omni-prepared-${scopeDigest.slice(0, 40)}`,
    contentKind: input.contentKind,
    schemaVersion,
    payload,
    contentSha256,
    evidence,
    createdAt,
  };
}

export function assertOmnichannelPreparedContentIntegrity(
  record: OmnichannelPreparedContentRecord,
): void {
  requireText(record.preparedContentRef, 'OMNICHANNEL_PREPARED_REF_REQUIRED');
  requireText(record.tenantId, 'OMNICHANNEL_PREPARED_TENANT_REQUIRED');
  requireText(record.workspaceId, 'OMNICHANNEL_PREPARED_WORKSPACE_REQUIRED');
  requireText(record.organizationId, 'OMNICHANNEL_PREPARED_ORGANIZATION_REQUIRED');
  assertKind(record.contentKind);
  if (!Number.isSafeInteger(record.schemaVersion) || record.schemaVersion < 1) {
    throw new Error('OMNICHANNEL_PREPARED_SCHEMA_VERSION_INVALID');
  }
  const expected = sha256(canonicalJson(normalizeJsonObject(record.payload)));
  if (record.contentSha256 !== expected)
    throw new Error('OMNICHANNEL_PREPARED_CONTENT_HASH_MISMATCH');
  normalizeEvidence(record.evidence);
  normalizeTimestamp(record.createdAt);
}

export function assertPreparedContentScope(
  record: OmnichannelPreparedContentRecord,
  scope: CrmScope,
): void {
  if (
    record.tenantId !== scope.tenantId ||
    record.workspaceId !== scope.workspaceId ||
    record.organizationId !== scope.organizationId
  ) {
    throw new Error('OMNICHANNEL_PREPARED_CONTENT_SCOPE_MISMATCH');
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('OMNICHANNEL_PREPARED_PAYLOAD_INVALID');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object') throw new Error('OMNICHANNEL_PREPARED_PAYLOAD_INVALID');
  const object = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    const item = object[key];
    if (item === undefined) throw new Error('OMNICHANNEL_PREPARED_PAYLOAD_INVALID');
    normalized[key] = canonicalize(item);
  }
  return normalized;
}

function normalizeJsonObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const normalized = canonicalize(value);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('OMNICHANNEL_PREPARED_PAYLOAD_OBJECT_REQUIRED');
  }
  return normalized as Readonly<Record<string, unknown>>;
}

function normalizeEvidence(value: readonly string[]): readonly string[] {
  const normalized = [...new Set(value.map((item) => item.trim()).filter(Boolean))].sort();
  if (normalized.length === 0) throw new Error('OMNICHANNEL_PREPARED_EVIDENCE_REQUIRED');
  return normalized;
}

function assertKind(value: string): asserts value is OmnichannelPreparedContentKind {
  if (!(OMNICHANNEL_PREPARED_CONTENT_KINDS as readonly string[]).includes(value)) {
    throw new Error('OMNICHANNEL_PREPARED_CONTENT_KIND_INVALID');
  }
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('OMNICHANNEL_PREPARED_CREATED_AT_INVALID');
  return new Date(parsed).toISOString();
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
