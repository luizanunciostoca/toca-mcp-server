import {
  resolveExecutionIdentityFromMcpContext,
  type ExecutionIdentity,
  type McpToolContextLike,
} from '../core/identity.js';

const TENANT_SCOPE_PREFIX = 'toca:tenant:';
const WORKSPACE_SCOPE_PREFIX = 'toca:workspace:';
const ORGANIZATION_SCOPE_PREFIX = 'toca:organization:';

export interface RuntimeTenantDefaults {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly organizationId?: string;
  readonly fallbackIdentity?: ExecutionIdentity;
}

/**
 * Resolve the authenticated tenant boundary without allowing request payloads
 * to declare their own scope. The current production tenant remains the
 * default compatibility boundary, while explicitly scoped OAuth clients can
 * select another tenant only when tenant + workspace + organization are all
 * unambiguous.
 */
export function resolveRuntimeTenantIdentity(
  context: McpToolContextLike,
  defaults: RuntimeTenantDefaults,
): ExecutionIdentity | undefined {
  const defaultTenantId = requireScopeValue(defaults.tenantId, 'RUNTIME_DEFAULT_TENANT_REQUIRED');
  const authInfo = context.http?.authInfo;
  if (!authInfo) {
    return resolveExecutionIdentityFromMcpContext(context, {
      tenantId: defaultTenantId,
      ...(defaults.workspaceId ? { workspaceId: defaults.workspaceId } : {}),
      ...(defaults.organizationId ? { organizationId: defaults.organizationId } : {}),
      ...(defaults.fallbackIdentity ? { fallbackIdentity: defaults.fallbackIdentity } : {}),
    });
  }

  const tenantSelection = scopedValue(authInfo.scopes, TENANT_SCOPE_PREFIX);
  const workspaceSelection = scopedValue(authInfo.scopes, WORKSPACE_SCOPE_PREFIX);
  const organizationSelection = scopedValue(authInfo.scopes, ORGANIZATION_SCOPE_PREFIX);
  if (
    tenantSelection.state === 'AMBIGUOUS' ||
    workspaceSelection.state === 'AMBIGUOUS' ||
    organizationSelection.state === 'AMBIGUOUS'
  ) {
    return undefined;
  }

  const tenantId = tenantSelection.value ?? defaultTenantId;
  const selectingAnotherTenant = tenantId !== defaultTenantId;
  if (
    selectingAnotherTenant &&
    (workspaceSelection.value === undefined || organizationSelection.value === undefined)
  ) {
    return undefined;
  }

  const workspaceId =
    workspaceSelection.value ??
    (selectingAnotherTenant ? undefined : (defaults.workspaceId ?? defaultTenantId));
  const organizationId =
    organizationSelection.value ??
    (selectingAnotherTenant ? undefined : (defaults.organizationId ?? defaultTenantId));
  if (!workspaceId || !organizationId) return undefined;

  return resolveExecutionIdentityFromMcpContext(context, {
    tenantId,
    workspaceId,
    organizationId,
  });
}

type ScopedValue =
  | { readonly state: 'ABSENT'; readonly value: undefined }
  | { readonly state: 'RESOLVED'; readonly value: string }
  | { readonly state: 'AMBIGUOUS'; readonly value: undefined };

function scopedValue(scopes: readonly string[], prefix: string): ScopedValue {
  const values = [
    ...new Set(
      scopes
        .filter((scope) => scope.startsWith(prefix))
        .map((scope) => scope.slice(prefix.length).trim())
        .filter(Boolean),
    ),
  ];
  if (values.length === 0) return { state: 'ABSENT', value: undefined };
  if (values.length !== 1) return { state: 'AMBIGUOUS', value: undefined };
  const value = values[0];
  if (!value || !isSafeScopeValue(value)) {
    return { state: 'AMBIGUOUS', value: undefined };
  }
  return { state: 'RESOLVED', value };
}

function requireScopeValue(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || !isSafeScopeValue(normalized)) throw new Error(code);
  return normalized;
}

function isSafeScopeValue(value: string): boolean {
  return value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}
