import { randomUUID } from 'node:crypto';
import {
  issueApproval,
  requestApproval,
  type ApprovalAuthority,
  type ApprovalRecord,
  type ApprovalRequestInput,
} from './approval-governance.js';

export const APPROVAL_BATCH_STATUSES = [
  'REQUESTED',
  'PARTIALLY_APPROVED',
  'APPROVED',
  'PARTIALLY_CONSUMED',
  'CONSUMED',
  'FAILED_REVIEW_REQUIRED',
  'CLOSED',
] as const;
export type ApprovalBatchStatus = (typeof APPROVAL_BATCH_STATUSES)[number];

export interface ApprovalBatch {
  readonly batchId: string;
  readonly requester: string;
  readonly requestedAt: string;
  readonly evidence: readonly string[];
  readonly approvals: readonly ApprovalRecord[];
  readonly status: ApprovalBatchStatus;
}

export interface ApprovalBatchSummary {
  readonly batchId: string;
  readonly status: ApprovalBatchStatus;
  readonly total: number;
  readonly requested: number;
  readonly approved: number;
  readonly inExecution: number;
  readonly consumed: number;
  readonly failedReviewRequired: number;
  readonly closed: number;
  readonly approvalIds: readonly string[];
  readonly descriptorSha256s: readonly string[];
}

export function requestApprovalBatch(
  inputs: readonly ApprovalRequestInput[],
  options: {
    readonly now?: string;
    readonly createBatchId?: () => string;
    readonly createApprovalId?: (index: number) => string;
    readonly evidence?: readonly string[];
  } = {},
): ApprovalBatch {
  if (inputs.length < 1 || inputs.length > 100) {
    throw new Error('APPROVAL_BATCH_SIZE_INVALID');
  }
  const requester = inputs[0]!.requester;
  if (!requester.trim()) throw new Error('APPROVAL_BATCH_REQUESTER_REQUIRED');
  if (inputs.some((input) => input.requester !== requester)) {
    throw new Error('APPROVAL_BATCH_REQUESTER_MISMATCH');
  }
  const correlationIds = inputs.map((input) => input.correlationId);
  if (new Set(correlationIds).size !== correlationIds.length) {
    throw new Error('APPROVAL_BATCH_CORRELATION_DUPLICATE');
  }
  const now = options.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error('APPROVAL_BATCH_TIMESTAMP_INVALID');
  const batchId = options.createBatchId?.() ?? randomUUID();
  const batchEvidence = normalizeEvidence([
    ...(options.evidence ?? []),
    `approval-batch:${batchId}`,
  ]);
  const approvals = inputs.map((input, index) =>
    requestApproval(
      {
        ...input,
        evidence: normalizeEvidence([...(input.evidence ?? []), ...batchEvidence]),
      },
      {
        now,
        ...(options.createApprovalId ? { createId: () => options.createApprovalId!(index) } : {}),
      },
    ),
  );
  assertDistinctApprovalBindings(approvals);
  return {
    batchId,
    requester,
    requestedAt: now,
    evidence: batchEvidence,
    approvals,
    status: deriveApprovalBatchStatus(approvals),
  };
}

export function issueApprovalBatch(
  batch: ApprovalBatch,
  input: {
    readonly authority: ApprovalAuthority;
    readonly selectedApprovalIds: readonly string[] | 'ALL';
    readonly evidence: readonly string[];
    readonly now?: string;
  },
): ApprovalBatch {
  const selected =
    input.selectedApprovalIds === 'ALL'
      ? new Set(batch.approvals.map((approval) => approval.approvalId))
      : new Set(input.selectedApprovalIds);
  if (selected.size === 0) throw new Error('APPROVAL_BATCH_SELECTION_REQUIRED');
  if (
    [...selected].some(
      (approvalId) => !batch.approvals.some((item) => item.approvalId === approvalId),
    )
  ) {
    throw new Error('APPROVAL_BATCH_SELECTION_UNKNOWN');
  }
  const evidence = normalizeEvidence([...batch.evidence, ...input.evidence]);
  if (evidence.length === 0) throw new Error('APPROVAL_BATCH_EVIDENCE_REQUIRED');

  const approvals = batch.approvals.map((approval) => {
    if (!selected.has(approval.approvalId)) return approval;
    return issueApproval(approval, {
      authority: input.authority,
      evidence: [...evidence, `approval-batch:item:${approval.approvalId}`],
      ...(input.now ? { now: input.now } : {}),
    });
  });
  return {
    ...batch,
    approvals,
    evidence,
    status: deriveApprovalBatchStatus(approvals),
  };
}

export function refreshApprovalBatch(
  batch: ApprovalBatch,
  approvals: readonly ApprovalRecord[],
): ApprovalBatch {
  const expected = new Set(batch.approvals.map((approval) => approval.approvalId));
  if (
    approvals.length !== expected.size ||
    approvals.some((approval) => !expected.has(approval.approvalId))
  ) {
    throw new Error('APPROVAL_BATCH_REFRESH_MEMBERSHIP_MISMATCH');
  }
  assertDistinctApprovalBindings(approvals);
  return {
    ...batch,
    approvals: [...approvals].sort((left, right) =>
      left.approvalId.localeCompare(right.approvalId),
    ),
    status: deriveApprovalBatchStatus(approvals),
  };
}

export function summarizeApprovalBatch(batch: ApprovalBatch): ApprovalBatchSummary {
  return {
    batchId: batch.batchId,
    status: batch.status,
    total: batch.approvals.length,
    requested: count(batch.approvals, ['REQUESTED']),
    approved: count(batch.approvals, ['APPROVED', 'RELEASED']),
    inExecution: count(batch.approvals, ['RESERVED', 'EXECUTING', 'PROVIDER_READBACK']),
    consumed: count(batch.approvals, ['CONSUMED']),
    failedReviewRequired: count(batch.approvals, ['FAILED_REVIEW_REQUIRED']),
    closed: count(batch.approvals, ['REVOKED', 'EXPIRED']),
    approvalIds: batch.approvals.map((approval) => approval.approvalId).sort(),
    descriptorSha256s: batch.approvals.map((approval) => approval.descriptorSha256).sort(),
  };
}

export function deriveApprovalBatchStatus(
  approvals: readonly ApprovalRecord[],
): ApprovalBatchStatus {
  if (approvals.some((approval) => approval.status === 'FAILED_REVIEW_REQUIRED')) {
    return 'FAILED_REVIEW_REQUIRED';
  }
  if (approvals.every((approval) => approval.status === 'CONSUMED')) return 'CONSUMED';
  if (approvals.some((approval) => approval.status === 'CONSUMED')) return 'PARTIALLY_CONSUMED';
  if (approvals.every((approval) => approval.status === 'APPROVED')) return 'APPROVED';
  if (approvals.some((approval) => approval.status === 'APPROVED')) return 'PARTIALLY_APPROVED';
  if (approvals.every((approval) => ['REVOKED', 'EXPIRED'].includes(approval.status))) {
    return 'CLOSED';
  }
  return 'REQUESTED';
}

function assertDistinctApprovalBindings(approvals: readonly ApprovalRecord[]): void {
  const approvalIds = approvals.map((approval) => approval.approvalId);
  if (new Set(approvalIds).size !== approvalIds.length) {
    throw new Error('APPROVAL_BATCH_APPROVAL_ID_DUPLICATE');
  }
  const bindings = approvals.map(
    (approval) =>
      `${approval.capabilityId}\u0000${approval.targetAccount}\u0000${approval.descriptorSha256}`,
  );
  if (new Set(bindings).size !== bindings.length) {
    throw new Error('APPROVAL_BATCH_ITEM_BINDING_DUPLICATE');
  }
}

function count(
  approvals: readonly ApprovalRecord[],
  statuses: readonly ApprovalRecord['status'][],
): number {
  return approvals.filter((approval) => statuses.includes(approval.status)).length;
}

function normalizeEvidence(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
