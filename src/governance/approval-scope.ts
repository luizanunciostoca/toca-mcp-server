import type {
  ApprovalAtomicTransition,
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
  getScoped(approvalId: string, scope: ApprovalTenantScope): Promise<ApprovalRecord | undefined>;
  listScoped(
    scope: ApprovalTenantScope,
    options?: ApprovalListOptions,
  ): Promise<readonly ApprovalRecord[]>;
  historyScoped(approvalId: string, scope: ApprovalTenantScope): Promise<readonly ApprovalRecord[]>;
  transitionScoped(
    approvalId: string,
    transition: ApprovalAtomicTransition,
    scope: ApprovalTenantScope,
  ): Promise<ApprovalRecord>;
}

export interface BoundApprovalStore extends ApprovalStore {
  list(options?: ApprovalListOptions): Promise<readonly ApprovalRecord[]>;
}

export function isTenantScopedApprovalStore(
  store: ApprovalStore | undefined,
): store is TenantScopedApprovalStore {
  if (!store) return false;
  const candidate = store as Partial<TenantScopedApprovalStore>;
  return (
    typeof candidate.putScoped === 'function' &&
    typeof candidate.getScoped === 'function' &&
    typeof candidate.listScoped === 'function' &&
    typeof candidate.historyScoped === 'function' &&
    typeof candidate.transitionScoped === 'function'
  );
}

export function bindApprovalStoreToScope(
  store: ApprovalStore,
  scope: ApprovalTenantScope,
): BoundApprovalStore {
  const normalized = approvalTenantScope(scope);
  if (isTenantScopedApprovalStore(store)) {
    return {
      put: (record, expectedVersion) => store.putScoped(record, normalized, expectedVersion),
      get: (approvalId) => store.getScoped(approvalId, normalized),
      history: (approvalId) => store.historyScoped(approvalId, normalized),
      transition: (approvalId, transition) =>
        store.transitionScoped(approvalId, transition, normalized),
      list: (options) => store.listScoped(normalized, options),
    };
  }
  if (
    normalized.tenantId === 'toca' &&
    normalized.workspaceId === 'toca' &&
    normalized.organizationId === 'toca'
  ) {
    return {
      put: (record, expectedVersion) => store.put(record, expectedVersion),
      get: (approvalId) => store.get(approvalId),
      history: (approvalId) => store.history(approvalId),
      transition: (approvalId, transition) => store.transition(approvalId, transition),
      list: () => Promise.reject(new Error('APPROVAL_TENANT_LIST_STORE_REQUIRED')),
    };
  }
  throw new Error('APPROVAL_TENANT_SCOPED_STORE_REQUIRED');
}

export function approvalTenantScope(input: ApprovalTenantScope): ApprovalTenantScope {
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
