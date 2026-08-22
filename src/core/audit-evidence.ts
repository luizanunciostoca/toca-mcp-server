import { createHash } from 'node:crypto';

const OPAQUE_EVIDENCE_REF = /^[a-z][a-z0-9_.-]{0,47}:(?:\/\/)?[A-Za-z0-9._~:/=+-]+$/i;
const EMAIL_LIKE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const DIRECT_PHONE_REF = /\b(?:phone|telephone|tel|whatsapp):\+?[0-9][0-9()-]{7,}\b/i;
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;

export function sanitizeAuditEvidenceValues(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(sanitizeAuditEvidenceValue).filter(Boolean))].sort();
}

export function sanitizeAuditEvidenceValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  const safeOpaqueRef =
    OPAQUE_EVIDENCE_REF.test(normalized) &&
    !EMAIL_LIKE.test(normalized) &&
    !DIRECT_PHONE_REF.test(normalized) &&
    !JWT_LIKE.test(normalized);
  if (safeOpaqueRef) return normalized;

  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `audit:redacted:sha256:${digest}`;
}
