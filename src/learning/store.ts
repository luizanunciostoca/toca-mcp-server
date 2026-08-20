export type LearningRecordType =
  'OBSERVATION' | 'EXPERIMENT' | 'OUTCOME' | 'DECISION' | 'RECOMMENDATION';

export interface LearningRecord {
  readonly recordId: string;
  readonly recordType: LearningRecordType;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly experimentId: string | null;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface AppendLearningRecordInput extends LearningRecord {
  readonly executionId: string;
  readonly correlationId: string;
  readonly actorPrincipalId: string;
  readonly evidence: readonly string[];
}

export interface LearningRecordStore {
  append(input: AppendLearningRecordInput): Promise<LearningRecord>;
  get(recordId: string): Promise<LearningRecord | undefined>;
  listByExperiment(input: {
    readonly workspaceId: string;
    readonly experimentId: string;
  }): Promise<readonly LearningRecord[]>;
}
