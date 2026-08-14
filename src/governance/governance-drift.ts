import { createHash } from 'node:crypto';
import type { StateMachineDefinition } from './state-machine.js';

export const GOVERNANCE_SOURCES = [
  'DRIVE_PHYSICAL',
  'CANONICAL_REGISTRY',
  'MASTER_MANUAL',
  'ROUTING_REGISTRY',
  'DRIVE_CAPABILITY_REGISTRY',
  'GITHUB_RUNTIME',
  'PROVIDER',
] as const;

export type GovernanceSource = (typeof GOVERNANCE_SOURCES)[number];

export type GovernanceReconciliationState =
  | 'SCAN'
  | 'GOVERNANCE_DRIFT_DETECTED'
  | 'CLASSIFIED'
  | 'RECONCILIATION_PLANNED'
  | 'RECONCILED'
  | 'BLOCKED_PENDING_HUMAN_DECISION';

export const GOVERNANCE_RECONCILIATION_LIFECYCLE: StateMachineDefinition<GovernanceReconciliationState> = {
  id: 'R21_GOVERNANCE_DRIFT_RECONCILIATION',
  initialState: 'SCAN',
  terminalStates: ['RECONCILED', 'BLOCKED_PENDING_HUMAN_DECISION'],
  transitions: {
    SCAN: ['GOVERNANCE_DRIFT_DETECTED', 'RECONCILED'],
    GOVERNANCE_DRIFT_DETECTED: ['CLASSIFIED'],
    CLASSIFIED: ['RECONCILIATION_PLANNED', 'BLOCKED_PENDING_HUMAN_DECISION'],
    RECONCILIATION_PLANNED: ['RECONCILED', 'BLOCKED_PENDING_HUMAN_DECISION'],
    RECONCILED: [],
    BLOCKED_PENDING_HUMAN_DECISION: [],
  },
};

export interface GovernanceRecord {
  readonly resourceKey: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly evidenceRef: string;
  readonly observedAt: string;
}

export interface GovernanceSnapshot {
  readonly source: GovernanceSource;
  readonly records: readonly GovernanceRecord[];
}

export type GovernanceDriftType =
  | 'MISSING_RECORD'
  | 'MISSING_FIELD'
  | 'VALUE_MISMATCH'
  | 'STATUS_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'CANONICAL_CONFLICT';

export interface GovernanceDrift {
  readonly driftId: string;
  readonly event: 'GOVERNANCE_DRIFT_DETECTED';
  readonly resourceKey: string;
  readonly field: string;
  readonly type: GovernanceDriftType;
  readonly observed: readonly {
    source: GovernanceSource;
    value: unknown;
    evidenceRef: string | null;
  }[];
}

export interface GovernanceScanResult {
  readonly state: 'RECONCILED' | 'GOVERNANCE_DRIFT_DETECTED';
  readonly drifts: readonly GovernanceDrift[];
  readonly scannedSources: readonly GovernanceSource[];
  readonly scannedResources: number;
}

export interface ReconciliationCommand {
  readonly targetSource: GovernanceSource;
  readonly resourceKey: string;
  readonly field: string;
  readonly expectedCurrentHash: string;
  readonly replacementValue: unknown;
  readonly authoritySource: GovernanceSource;
  readonly reason: string;
}

export interface GovernanceReconciliationPlan {
  readonly state: 'RECONCILIATION_PLANNED' | 'BLOCKED_PENDING_HUMAN_DECISION';
  readonly commands: readonly ReconciliationCommand[];
  readonly blockedDriftIds: readonly string[];
}

const humanDecisionFields = new Set([
  'approver',
  'approval',
  'financial_ceiling',
  'owner',
  'provider_state',
  'target_account',
]);

export function scanGovernanceDrift(
  snapshots: readonly GovernanceSnapshot[],
): GovernanceScanResult {
  assertUniqueSources(snapshots);
  const resourceKeys = new Set(
    snapshots.flatMap((snapshot) => snapshot.records.map((record) => record.resourceKey)),
  );
  const drifts: GovernanceDrift[] = [];

  for (const resourceKey of [...resourceKeys].sort()) {
    const records = snapshots.map((snapshot) => ({
      source: snapshot.source,
      record: snapshot.records.find((candidate) => candidate.resourceKey === resourceKey),
    }));
    const fields = new Set(
      records.flatMap(({ record }) => (record ? Object.keys(record.values) : [])),
    );

    for (const field of [...fields].sort()) {
      const observed = records.map(({ source, record }) => ({
        source,
        value: record?.values[field],
        evidenceRef: record?.evidenceRef ?? null,
      }));
      const distinct = new Set(observed.map((item) => stableJson(item.value)));
      if (distinct.size <= 1) continue;
      drifts.push({
        driftId: hash({ resourceKey, field, observed }),
        event: 'GOVERNANCE_DRIFT_DETECTED',
        resourceKey,
        field,
        type: classifyDrift(field, observed),
        observed,
      });
    }
  }

  return {
    state: drifts.length === 0 ? 'RECONCILED' : 'GOVERNANCE_DRIFT_DETECTED',
    drifts,
    scannedSources: snapshots.map((snapshot) => snapshot.source),
    scannedResources: resourceKeys.size,
  };
}

export function planGovernanceReconciliation(
  scan: GovernanceScanResult,
  authorityByField: Readonly<Record<string, GovernanceSource>>,
): GovernanceReconciliationPlan {
  const commands: ReconciliationCommand[] = [];
  const blockedDriftIds: string[] = [];

  for (const drift of scan.drifts) {
    const authoritySource = authorityByField[drift.field];
    const authority = drift.observed.find((item) => item.source === authoritySource);
    if (!authoritySource || !authority || authority.value === undefined || humanDecisionFields.has(drift.field)) {
      blockedDriftIds.push(drift.driftId);
      continue;
    }
    for (const target of drift.observed) {
      if (target.source === authoritySource || stableJson(target.value) === stableJson(authority.value))
        continue;
      commands.push({
        targetSource: target.source,
        resourceKey: drift.resourceKey,
        field: drift.field,
        expectedCurrentHash: hash(target.value),
        replacementValue: authority.value,
        authoritySource,
        reason: `${drift.type}:${drift.driftId}`,
      });
    }
  }

  return {
    state:
      blockedDriftIds.length > 0
        ? 'BLOCKED_PENDING_HUMAN_DECISION'
        : 'RECONCILIATION_PLANNED',
    commands,
    blockedDriftIds,
  };
}

function assertUniqueSources(snapshots: readonly GovernanceSnapshot[]): void {
  const sources = snapshots.map((snapshot) => snapshot.source);
  if (new Set(sources).size !== sources.length) throw new Error('GOVERNANCE_SOURCE_DUPLICATE');
  for (const snapshot of snapshots) {
    const keys = snapshot.records.map((record) => record.resourceKey);
    if (new Set(keys).size !== keys.length)
      throw new Error(`GOVERNANCE_RESOURCE_DUPLICATE:${snapshot.source}`);
  }
}

function classifyDrift(
  field: string,
  observed: GovernanceDrift['observed'],
): GovernanceDriftType {
  if (observed.some((item) => item.evidenceRef === null)) return 'MISSING_RECORD';
  if (observed.some((item) => item.value === undefined)) return 'MISSING_FIELD';
  if (/status/i.test(field)) return 'STATUS_CONFLICT';
  if (/version/i.test(field)) return 'VERSION_CONFLICT';
  if (/canonical/i.test(field)) return 'CANONICAL_CONFLICT';
  return 'VALUE_MISMATCH';
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('GOVERNANCE_VALUE_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('GOVERNANCE_VALUE_INVALID');
}
