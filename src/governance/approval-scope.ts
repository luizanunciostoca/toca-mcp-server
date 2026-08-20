import type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalStore,
} from './approval-governance.js';

export interface ApprovalTenantScope {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}

export interface ApprovalListOptions {
  readonly status?: ApprovalStatus;
  readonly limit?: number;
}

export interface TenantScopedApprovalStore extends ApprovalStore {
  putScoped(
    record: ApprovalRecord,
    scope: ApprovalTenantScope,
    expectedVersion?: number,
  ): Promise<void>;
  getScoped(
    approvalId: string,
    scope: ApprovalTenantScope,
  ): Promise<ApprovalRecord | undefined>;
  listScoped(
    scope: ApprovalTenantScope,
    options?: ApprovalListOptions,
  ): Promise<readonly ApprovalRecord[]>;
}

export function isTenantScopedApprovalStore(
  store: ApprovalStore | undefined,
): store is TenantScopedApprovalStore {
  if (!store) return false;
  const candidate = store as Partial<TenantScopedApprovalStore>;
  return (
    typeof candidate.putScoped === 'function' &&
    typeof candidate.getScoped === 'function' &&
    typeof candidate.listScoped === 'function'
  );
}

export function approvalTenantScope(input: {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly organizationId: string;
}): ApprovalTenantScope {
  return {
    tenantId: requireScope(input.tenantId, 'APPROVAL_TENANT_REQUIRED'),
    workspaceId: requireScope(input.workspaceId, 'APPROVAL_WORKSPACE_REQUIRED'),
    organizationId: requireScope(input.organizationId, 'APPROVAL_ORGANIZATION_REQUIRED'),
  };
}

function requireScope(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
