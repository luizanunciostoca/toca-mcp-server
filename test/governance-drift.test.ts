import { describe, expect, it } from 'vitest';
import {
  planGovernanceReconciliation,
  scanGovernanceDrift,
  type GovernanceSnapshot,
} from '../src/governance/governance-drift.js';

const snapshots: readonly GovernanceSnapshot[] = [
  {
    source: 'CANONICAL_REGISTRY',
    records: [
      {
        resourceKey: 'DOC-MANUAL-MESTRE',
        values: { version: 'v1.1', status: 'ACTIVE_CANONICAL' },
        evidenceRef: 'drive:registry:row-5',
        observedAt: '2026-08-14T20:00:00Z',
      },
    ],
  },
  {
    source: 'MASTER_MANUAL',
    records: [
      {
        resourceKey: 'DOC-MANUAL-MESTRE',
        values: { version: 'v2.1', status: 'ACTIVE_OPERATIONAL' },
        evidenceRef: 'drive:manual:v2.1',
        observedAt: '2026-08-14T20:00:00Z',
      },
    ],
  },
];

describe('R21 governance drift reconciliation', () => {
  it('detects deterministic version and status drift', () => {
    const result = scanGovernanceDrift(snapshots);
    expect(result.state).toBe('GOVERNANCE_DRIFT_DETECTED');
    expect(result.drifts.map((drift) => drift.type).sort()).toEqual([
      'STATUS_CONFLICT',
      'VERSION_CONFLICT',
    ]);
    expect(result.drifts.every((drift) => drift.event === 'GOVERNANCE_DRIFT_DETECTED')).toBe(true);
  });

  it('plans safe reconciliation and blocks owner/approval decisions', () => {
    const result = scanGovernanceDrift(snapshots);
    const plan = planGovernanceReconciliation(result, {
      version: 'CANONICAL_REGISTRY',
      status: 'CANONICAL_REGISTRY',
    });
    expect(plan.state).toBe('RECONCILIATION_PLANNED');
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands.every((command) => command.authoritySource === 'CANONICAL_REGISTRY')).toBe(
      true,
    );

    const ownerDrift = scanGovernanceDrift([
      {
        ...snapshots[0]!,
        records: [{ ...snapshots[0]!.records[0]!, values: { owner: 'Luiz' } }],
      },
      {
        ...snapshots[1]!,
        records: [{ ...snapshots[1]!.records[0]!, values: { owner: 'ChatGPT' } }],
      },
    ]);
    expect(
      planGovernanceReconciliation(ownerDrift, { owner: 'CANONICAL_REGISTRY' }).state,
    ).toBe('BLOCKED_PENDING_HUMAN_DECISION');
  });
});
