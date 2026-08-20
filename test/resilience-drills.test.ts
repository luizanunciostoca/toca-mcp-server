import { describe, expect, it } from 'vitest';
import {
  CONTROLLED_DRILL_CATALOG,
  CONTROLLED_DRILL_SCENARIOS,
  assessControlledDrill,
  getControlledDrillDefinition,
  type ControlledDrillObservation,
} from '../src/core/resilience-drills.js';

function passingObservation(
  scenario: ControlledDrillObservation['scenario'],
): ControlledDrillObservation {
  return {
    scenario,
    duplicateExternalWrite: false,
    providerReadbackPerformed: true,
    durableAuditRecorded: true,
    outboxStatePreserved: true,
    idempotencyPreserved: true,
    cleanupVerified: true,
  };
}

describe('controlled resilience drills', () => {
  it('declares every requested drill without allowing destructive provider mutation', () => {
    expect(CONTROLLED_DRILL_CATALOG).toHaveLength(CONTROLLED_DRILL_SCENARIOS.length);
    expect(CONTROLLED_DRILL_CATALOG.every((drill) => !drill.destructiveProviderMutationAllowed)).toBe(
      true,
    );
  });

  it.each(CONTROLLED_DRILL_SCENARIOS)('accepts preserved invariants for %s', (scenario) => {
    expect(assessControlledDrill(passingObservation(scenario))).toEqual({
      scenario,
      passed: true,
      failures: [],
    });
  });

  it('fails partial provider write drill when readback is absent', () => {
    const result = assessControlledDrill({
      ...passingObservation('partial_provider_write'),
      providerReadbackPerformed: false,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain('PROVIDER_READBACK_REQUIRED');
  });

  it('fails any drill that observes a duplicate provider mutation', () => {
    const result = assessControlledDrill({
      ...passingObservation('restart'),
      duplicateExternalWrite: true,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain('DUPLICATE_EXTERNAL_WRITE');
  });

  it('requires readback for all provider-ambiguity scenarios', () => {
    const scenarios = [
      'delayed_callback',
      'provider_outage',
      'partial_provider_write',
      'ambiguous_status',
      'expired_token',
      'quota_exceeded',
    ] as const;

    for (const scenario of scenarios) {
      expect(getControlledDrillDefinition(scenario).requiresProviderReadback).toBe(true);
    }
  });
});
