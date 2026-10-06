import { describe, expect, it } from 'vitest';
import { CAPABILITY_CATALOG } from '../src/governance/capability-catalog.js';
import { buildLiveCapabilityMatrix } from '../src/governance/live-capability-matrix.js';
import { buildRouteAcceptanceMatrix } from '../src/governance/route-acceptance.js';
import { ROUTE_CATALOG } from '../src/governance/route-catalog.js';

const SHA = 'a'.repeat(40);
const NOW = '2026-10-06T12:00:00Z';

describe('TOCA-MAX R01-R32 acceptance projection', () => {
  it('structurally accepts exactly the canonical R01-R32 routes without overclaiming execution', () => {
    const capabilities = buildLiveCapabilityMatrix(CAPABILITY_CATALOG, {
      exactHeadSha: SHA,
      now: NOW,
    });
    const acceptance = buildRouteAcceptanceMatrix(ROUTE_CATALOG, capabilities);

    expect(acceptance.route_total).toBe(32);
    expect(acceptance.structural_pass_count).toBe(32);
    expect(new Set(acceptance.records.map((record) => record.route_id)).size).toBe(32);
    expect(
      acceptance.records.every((record) =>
        record.semantic_assertion.includes(
          'structural acceptance never implies runtime/provider/production proof',
        ),
      ),
    ).toBe(true);
    expect(acceptance.production_verified_count).toBe(0);
    expect(acceptance.not_proven_count).toBeGreaterThan(0);
  });

  it('carries the owner-deferred final provider families into route acceptance', () => {
    const capabilities = buildLiveCapabilityMatrix(CAPABILITY_CATALOG, {
      exactHeadSha: SHA,
      now: NOW,
    });
    const acceptance = buildRouteAcceptanceMatrix(ROUTE_CATALOG, capabilities);
    const deferredIds = acceptance.records.flatMap(
      (record) => record.final_provider_capability_ids,
    );

    for (const prefix of ['google_business.', 'google_ads.', 'whatsapp.', 'email.']) {
      expect(
        deferredIds.some((capabilityId) => capabilityId.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });

  it('fails closed if a canonical route capability is missing from the capability projection', () => {
    const capabilities = buildLiveCapabilityMatrix(CAPABILITY_CATALOG, {
      exactHeadSha: SHA,
      now: NOW,
    });
    const firstCapability = ROUTE_CATALOG[0]?.capabilityIds[0];
    expect(firstCapability).toBeDefined();
    if (!firstCapability) return;

    expect(() =>
      buildRouteAcceptanceMatrix(ROUTE_CATALOG, {
        ...capabilities,
        records: capabilities.records.filter(
          (record) => record.capability_id !== firstCapability,
        ),
        total: capabilities.total - 1,
      }),
    ).toThrow(`ROUTE_ACCEPTANCE_CAPABILITY_MISSING:R01:${firstCapability}`);
  });

  it('marks a route deferred only after every non-deferred capability is production verified', () => {
    const capabilities = buildLiveCapabilityMatrix(CAPABILITY_CATALOG, {
      exactHeadSha: SHA,
      now: NOW,
    });
    const route = ROUTE_CATALOG.find((candidate) =>
      candidate.capabilityIds.some((capabilityId) =>
        capabilityId.startsWith('google_business.'),
      ),
    );
    expect(route).toBeDefined();
    if (!route) return;

    const routeIds = new Set(route.capabilityIds);
    const promoted = {
      ...capabilities,
      records: capabilities.records.map((record) => {
        if (!routeIds.has(record.capability_id) || record.deferred_final_provider_phase) {
          return record;
        }
        return {
          ...record,
          closure_state: 'PRODUCTION_VERIFIED' as const,
          blocker: null,
          next_action: 'NONE',
        };
      }),
    };
    const acceptance = buildRouteAcceptanceMatrix([route], promoted);

    expect(acceptance.records[0]).toMatchObject({
      structural_state: 'PASS',
      proof_state: 'DEFERRED_FINAL_PROVIDER_PHASE',
      next_action: 'FINAL_PROVIDER_PHASE',
    });
  });
});
