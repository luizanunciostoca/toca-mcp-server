import { existsSync, readFileSync } from 'node:fs';
import * as z from 'zod/v4';

export const providerCapabilityValidationEvidenceSchema = z
  .object({
    validationId: z.string().min(1),
    capabilityId: z.string().min(1),
    provider: z.string().min(1),
    environment: z.literal('production'),
    status: z.literal('PRODUCTION_VALIDATED'),
    exactHeadSha: z.string().regex(/^[a-f0-9]{40}$/),
    validatedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    checks: z
      .object({
        providerWriteSucceeded: z.literal(true),
        providerReadbackVerified: z.literal(true),
        idempotencyVerified: z.literal(true),
        reconciliationVerified: z.literal(true),
        unknownOutcomeFailClosed: z.literal(true),
      })
      .strict(),
    externalResourceId: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(3),
  })
  .strict();

export type ProviderCapabilityValidationEvidence = z.infer<
  typeof providerCapabilityValidationEvidenceSchema
>;

const capabilityValidationEvidenceManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    manifestId: z.literal('TOCA_CAPABILITY_VALIDATION_EVIDENCE_V1'),
    status: z.literal('ACTIVE_CANONICAL'),
    exactHeadSha: z.string().regex(/^[a-f0-9]{40}$/),
    generatedAt: z.string().datetime({ offset: true }),
    validations: z.array(providerCapabilityValidationEvidenceSchema),
  })
  .strict();

export type CapabilityValidationEvidenceManifest = z.infer<
  typeof capabilityValidationEvidenceManifestSchema
>;

export function loadCapabilityValidationEvidenceManifest(
  options: { readonly exactHeadSha?: string; readonly now?: string } = {},
): CapabilityValidationEvidenceManifest {
  const raw = JSON.parse(
    readFileSync(capabilityValidationEvidenceManifestPath(), 'utf8'),
  ) as unknown;
  const manifest = capabilityValidationEvidenceManifestSchema.parse(raw);
  if (
    manifest.validations.length > 0 &&
    options.exactHeadSha &&
    manifest.exactHeadSha !== options.exactHeadSha
  ) {
    throw new Error('CAPABILITY_EVIDENCE_MANIFEST_EXACT_HEAD_MISMATCH');
  }
  const evidenceByCapability = indexProviderCapabilityEvidence(manifest.validations, {
    exactHeadSha: manifest.exactHeadSha,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    ...manifest,
    validations: [...evidenceByCapability.values()].sort((left, right) =>
      left.capabilityId.localeCompare(right.capabilityId),
    ),
  };
}

export function validateProviderCapabilityEvidence(
  value: unknown,
  options: {
    readonly capabilityId?: string;
    readonly provider?: string;
    readonly exactHeadSha?: string;
    readonly now?: string;
  } = {},
): ProviderCapabilityValidationEvidence {
  const evidence = providerCapabilityValidationEvidenceSchema.parse(value);
  const now = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('CAPABILITY_EVIDENCE_NOW_INVALID');
  if (Date.parse(evidence.validatedAt) > Date.parse(now)) {
    throw new Error(`CAPABILITY_EVIDENCE_FROM_FUTURE:${evidence.capabilityId}`);
  }
  if (Date.parse(evidence.expiresAt) <= Date.parse(now)) {
    throw new Error(`CAPABILITY_EVIDENCE_EXPIRED:${evidence.capabilityId}`);
  }
  if (options.capabilityId && evidence.capabilityId !== options.capabilityId) {
    throw new Error(`CAPABILITY_EVIDENCE_CAPABILITY_MISMATCH:${options.capabilityId}`);
  }
  if (options.provider && evidence.provider !== options.provider) {
    throw new Error(`CAPABILITY_EVIDENCE_PROVIDER_MISMATCH:${evidence.capabilityId}`);
  }
  if (options.exactHeadSha && evidence.exactHeadSha !== options.exactHeadSha) {
    throw new Error(`CAPABILITY_EVIDENCE_EXACT_HEAD_MISMATCH:${evidence.capabilityId}`);
  }
  const normalizedEvidence = normalizeEvidence(evidence.evidence);
  if (normalizedEvidence.length !== evidence.evidence.length) {
    throw new Error(`CAPABILITY_EVIDENCE_DUPLICATE_OR_EMPTY:${evidence.capabilityId}`);
  }
  if (
    !normalizedEvidence.some((entry) => entry.startsWith('provider:')) ||
    !normalizedEvidence.some((entry) => entry.startsWith('readback:')) ||
    !normalizedEvidence.some((entry) => entry.startsWith('acceptance:'))
  ) {
    throw new Error(`CAPABILITY_EVIDENCE_REQUIRED_CLASSES_MISSING:${evidence.capabilityId}`);
  }
  return { ...evidence, evidence: normalizedEvidence };
}

export function indexProviderCapabilityEvidence(
  values: readonly unknown[],
  options: { readonly exactHeadSha?: string; readonly now?: string } = {},
): ReadonlyMap<string, ProviderCapabilityValidationEvidence> {
  const entries = values.map((value) =>
    validateProviderCapabilityEvidence(value, {
      ...(options.exactHeadSha ? { exactHeadSha: options.exactHeadSha } : {}),
      ...(options.now ? { now: options.now } : {}),
    }),
  );
  const map = new Map<string, ProviderCapabilityValidationEvidence>();
  for (const entry of entries) {
    if (map.has(entry.capabilityId)) {
      throw new Error(`CAPABILITY_EVIDENCE_DUPLICATE:${entry.capabilityId}`);
    }
    map.set(entry.capabilityId, entry);
  }
  return map;
}

function capabilityValidationEvidenceManifestPath(): URL {
  const candidates = [
    new URL('../../control/capability-validation-evidence.v1.json', import.meta.url),
    new URL('../../../control/capability-validation-evidence.v1.json', import.meta.url),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('CAPABILITY_VALIDATION_EVIDENCE_MANIFEST_NOT_FOUND');
  return found;
}

function normalizeEvidence(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
