import { describe, expect, it } from 'vitest';
import {
  PLATFORM_NEXT_SLOS,
  PLATFORM_SLO_IDS,
  getPlatformSlo,
  validatePlatformSloCatalog,
} from '../src/core/platform-slo-catalog.js';

describe('platform hardening SLO catalog', () => {
  it('contains one validated definition for every required SLO', () => {
    expect(() => validatePlatformSloCatalog()).not.toThrow();
    expect(PLATFORM_NEXT_SLOS).toHaveLength(PLATFORM_SLO_IDS.length);
    expect(new Set(PLATFORM_NEXT_SLOS.map((definition) => definition.id)).size).toBe(
      PLATFORM_SLO_IDS.length,
    );
  });

  it('keeps provider readback as a zero-tolerance verification invariant', () => {
    expect(getPlatformSlo('provider_readback_success')).toEqual(
      expect.objectContaining({ kind: 'RATIO', comparator: 'GTE', target: 1, severity: 'P0' }),
    );
  });

  it('keeps future WhatsApp and Email SLOs declared but not falsely production-active', () => {
    expect(getPlatformSlo('whatsapp_delivery_success')).toEqual(
      expect.objectContaining({
        signal: 'whatsapp.readback_verified_ratio',
        futureProvider: true,
      }),
    );
    expect(getPlatformSlo('email_delivery_success').futureProvider).toBe(true);
  });

  it('rejects duplicate catalog identifiers', () => {
    const first = PLATFORM_NEXT_SLOS[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('TEST_SLO_FIXTURE_MISSING');

    expect(() => validatePlatformSloCatalog([...PLATFORM_NEXT_SLOS, first])).toThrow(
      `PLATFORM_SLO_DUPLICATE:${first.id}`,
    );
  });
});
