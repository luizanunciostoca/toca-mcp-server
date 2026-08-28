import { describe, expect, it } from 'vitest';
import {
  indexProviderCapabilityEvidence,
  loadCapabilityValidationEvidenceManifest,
  validateProviderCapabilityEvidence,
} from '../src/governance/capability-validation-evidence.js';

const exactHeadSha = 'a'.repeat(40);
const valid = () => ({
  validationId: 'validation-image-1',
  capabilityId: 'instagram.publish.image',
  provider: 'Meta/Instagram',
  environment: 'production' as const,
  status: 'PRODUCTION_VALIDATED' as const,
  exactHeadSha,
  validatedAt: '2026-08-26T21:00:00Z',
  expiresAt: '2026-09-26T21:00:00Z',
  checks: {
    providerWriteSucceeded: true as const,
    providerReadbackVerified: true as const,
    idempotencyVerified: true as const,
    reconciliationVerified: true as const,
    unknownOutcomeFailClosed: true as const,
  },
  externalResourceId: 'ig_media_1',
  evidence: ['provider:instagram:ig_media_1', 'readback:instagram:ig_media_1', 'acceptance:run:1'],
});

describe('provider capability validation evidence', () => {
  it('loads the canonical provider-backed validation without inflating other capabilities', () => {
    const manifest = loadCapabilityValidationEvidenceManifest({
      exactHeadSha: 'b1d838a6b3efe35b7df3afb6b53c4a9b42f7712a',
      now: '2026-08-28T04:00:00Z',
    });
    expect(manifest.manifestId).toBe('TOCA_CAPABILITY_VALIDATION_EVIDENCE_V1');
    expect(manifest.validations).toHaveLength(1);
    expect(manifest.validations[0]).toMatchObject({
      capabilityId: 'instagram.publish.image',
      provider: 'Meta/Instagram',
      status: 'PRODUCTION_VALIDATED',
      externalResourceId: '18620842246053649',
    });
  });

  it('accepts an exact-head production package with write, readback, idempotency and reconciliation proof', () => {
    expect(
      validateProviderCapabilityEvidence(valid(), {
        capabilityId: 'instagram.publish.image',
        provider: 'Meta/Instagram',
        exactHeadSha,
        now: '2026-08-26T22:00:00Z',
      }),
    ).toMatchObject({ capabilityId: 'instagram.publish.image', status: 'PRODUCTION_VALIDATED' });
  });

  it('rejects expired or wrong-head evidence', () => {
    expect(() =>
      validateProviderCapabilityEvidence(valid(), {
        exactHeadSha,
        now: '2026-10-01T00:00:00Z',
      }),
    ).toThrow('CAPABILITY_EVIDENCE_EXPIRED:instagram.publish.image');
    expect(() =>
      validateProviderCapabilityEvidence(valid(), {
        exactHeadSha: 'b'.repeat(40),
        now: '2026-08-26T22:00:00Z',
      }),
    ).toThrow('CAPABILITY_EVIDENCE_EXACT_HEAD_MISMATCH:instagram.publish.image');
  });

  it('rejects packages without provider, readback and acceptance evidence classes', () => {
    expect(() =>
      validateProviderCapabilityEvidence(
        { ...valid(), evidence: ['artifact:one', 'artifact:two', 'artifact:three'] },
        { now: '2026-08-26T22:00:00Z' },
      ),
    ).toThrow('CAPABILITY_EVIDENCE_REQUIRED_CLASSES_MISSING:instagram.publish.image');
  });

  it('indexes each capability once', () => {
    expect(() =>
      indexProviderCapabilityEvidence(
        [valid(), { ...valid(), validationId: 'validation-image-2' }],
        {
          now: '2026-08-26T22:00:00Z',
        },
      ),
    ).toThrow('CAPABILITY_EVIDENCE_DUPLICATE:instagram.publish.image');
  });
});
