import { describe, expect, it } from 'vitest';
import {
  CONTENT_ITEM_LIFECYCLE,
  DISASTER_RECOVERY_LIFECYCLE,
  ENGAGEMENT_LIFECYCLE,
  INCIDENT_LIFECYCLE,
  META_ADS_LIFECYCLE,
  PERFORMANCE_LEARNING_LIFECYCLE,
  REGISTRY_GOVERNANCE_LIFECYCLE,
  SECURITY_LIFECYCLE,
  STRUCTURAL_LIFECYCLES,
} from '../src/governance/structural-lifecycles.js';
import {
  isTerminalState,
  startStateMachine,
  transitionState,
  validateStateMachineDefinition,
} from '../src/governance/state-machine.js';
import {
  evaluateRecoveryReadiness,
  evaluateSecurityPosture,
  validateMasterDataRegistry,
} from '../src/governance/structural-evaluators.js';

describe('R24-R26 and R28-R32 structural lifecycles', () => {
  it('defines valid deterministic transition graphs', () => {
    expect(STRUCTURAL_LIFECYCLES).toHaveLength(8);
    expect(() => {
      validateStateMachineDefinition(SECURITY_LIFECYCLE);
      validateStateMachineDefinition(INCIDENT_LIFECYCLE);
      validateStateMachineDefinition(DISASTER_RECOVERY_LIFECYCLE);
      validateStateMachineDefinition(META_ADS_LIFECYCLE);
      validateStateMachineDefinition(CONTENT_ITEM_LIFECYCLE);
      validateStateMachineDefinition(ENGAGEMENT_LIFECYCLE);
      validateStateMachineDefinition(PERFORMANCE_LEARNING_LIFECYCLE);
      validateStateMachineDefinition(REGISTRY_GOVERNANCE_LIFECYCLE);
    }).not.toThrow();
    expect([
      SECURITY_LIFECYCLE.id,
      INCIDENT_LIFECYCLE.id,
      DISASTER_RECOVERY_LIFECYCLE.id,
      META_ADS_LIFECYCLE.id,
      CONTENT_ITEM_LIFECYCLE.id,
      ENGAGEMENT_LIFECYCLE.id,
      PERFORMANCE_LEARNING_LIFECYCLE.id,
      REGISTRY_GOVERNANCE_LIFECYCLE.id,
    ]).toHaveLength(8);
  });

  it('rejects skipped content lifecycle gates', () => {
    const instance = startStateMachine(CONTENT_ITEM_LIFECYCLE);
    expect(() =>
      transitionState(CONTENT_ITEM_LIFECYCLE, instance, 'PUBLISHED', {
        correlationId: 'corr-content-1',
      }),
    ).toThrow('STATE_TRANSITION_NOT_ALLOWED');
  });

  it('requires actual restore proof before declaring recovery validated', () => {
    expect(
      evaluateRecoveryReadiness([
        {
          component: 'postgresql',
          backupVerified: true,
          restoreExecuted: false,
          integrityVerified: false,
          targetRpoMinutes: 60,
          measuredRpoMinutes: 30,
          targetRtoMinutes: 120,
          measuredRtoMinutes: 0,
          testedAt: '2026-08-14T20:00:00Z',
          evidence: ['gcp://backup/1'],
        },
      ]).state,
    ).toBe('GAPS_RECORDED');
  });

  it('fails security and registry posture closed on unknown or stale evidence', () => {
    expect(
      evaluateSecurityPosture([
        {
          controlId: 'branch-protection',
          result: 'UNKNOWN',
          mandatory: true,
          checkedAt: '2026-08-14T20:00:00Z',
          evidence: [],
        },
      ]).state,
    ).toBe('REMEDIATION_REQUIRED');
    const registry = validateMasterDataRegistry(
      [
        {
          resourceId: 'DOC-1',
          title: 'Manual',
          owner: null,
          status: 'ACTIVE_CANONICAL',
          logicalPath: null,
          driveId: 'drive-1',
          githubRef: null,
          providerId: null,
          canonical: true,
          exists: false,
          lastValidatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      { now: '2026-08-14T20:00:00Z', maxAgeDays: 31 },
    );
    expect(registry.state).toBe('DIFF');
    expect(registry.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'OWNER_MISSING',
        'PATH_MISSING',
        'RESOURCE_NOT_FOUND',
        'STALE_VALIDATION',
      ]),
    );
  });

  it('reaches a terminal state only through allowed transitions', () => {
    let incident = startStateMachine(INCIDENT_LIFECYCLE);
    incident = transitionState(INCIDENT_LIFECYCLE, incident, 'TRIAGED', {
      correlationId: 'corr-incident-1',
    });
    incident = transitionState(INCIDENT_LIFECYCLE, incident, 'RESOLVED', {
      correlationId: 'corr-incident-1',
      evidence: ['logs://incident/1'],
    });
    incident = transitionState(INCIDENT_LIFECYCLE, incident, 'POSTMORTEM_COMPLETE', {
      correlationId: 'corr-incident-1',
      evidence: ['drive://postmortem/1'],
    });
    expect(isTerminalState(INCIDENT_LIFECYCLE, incident.state)).toBe(true);
    expect(incident.history).toHaveLength(3);
  });
});
