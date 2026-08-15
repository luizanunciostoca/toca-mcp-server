import * as z from 'zod/v4';
import type { ToolDefinition } from './tool-registry.js';

export const requesterTypeSchema = z.enum([
  'HUMAN',
  'CHATGPT',
  'SCHEDULED_TASK',
  'SYSTEM',
  'SERVICE',
]);
export type RequesterType = z.infer<typeof requesterTypeSchema>;

export const requesterRoleSchema = z.enum([
  'ACCOUNTABLE_OWNER',
  'ORCHESTRATOR',
  'EXECUTOR',
  'REVIEWER',
  'APPROVER',
  'SYSTEM_WORKER',
  'SERVICE',
]);
export type RequesterRole = z.infer<typeof requesterRoleSchema>;

export const authenticationMethodSchema = z.enum([
  'CLOUD_RUN_IAM',
  'MCP_STDIO',
  'SCHEDULED_OIDC',
  'INTERNAL',
  'TEST',
]);
export type AuthenticationMethod = z.infer<typeof authenticationMethodSchema>;

export const requesterIdentitySchema = z.object({
  subjectId: z.string().trim().min(1),
  subjectType: requesterTypeSchema,
  workspaceId: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  roles: z.array(requesterRoleSchema).min(1),
  authenticationMethod: authenticationMethodSchema,
  accountId: z.string().trim().min(1).optional(),
  targetAccount: z.string().trim().min(1).optional(),
  sessionId: z.string().trim().min(1).optional(),
});

export type RequesterIdentity = z.infer<typeof requesterIdentitySchema>;

export interface AuthorizationContext {
  readonly requester: RequesterIdentity;
  readonly connectedAccount?: string;
  readonly approvalReference?: string;
}

export interface AuthorizationResult {
  readonly decision: 'ALLOW' | 'DENY';
  readonly reason: string;
}

const executionRoles: ReadonlySet<RequesterRole> = new Set([
  'ACCOUNTABLE_OWNER',
  'EXECUTOR',
  'SYSTEM_WORKER',
]);

export function parseRequesterIdentity(input: unknown): RequesterIdentity {
  const identity = requesterIdentitySchema.parse(input);
  return {
    ...identity,
    roles: [...new Set(identity.roles)].sort(),
  };
}

export function hasRequesterRole(
  requester: RequesterIdentity,
  role: RequesterRole,
): boolean {
  return requester.roles.includes(role);
}

export function evaluateAuthorization(
  tool: ToolDefinition,
  context: AuthorizationContext,
): AuthorizationResult {
  const requester = parseRequesterIdentity(context.requester);

  if (
    requester.targetAccount &&
    context.connectedAccount &&
    requester.targetAccount !== context.connectedAccount
  ) {
    return {
      decision: 'DENY',
      reason: 'Requester target account does not match the connected account.',
    };
  }

  if (!tool.sideEffects) {
    return { decision: 'ALLOW', reason: 'Authenticated requester may execute a read capability.' };
  }

  if (!requester.roles.some((role) => executionRoles.has(role))) {
    return {
      decision: 'DENY',
      reason: 'Requester does not hold an execution role for side-effecting capabilities.',
    };
  }

  if (
    requester.subjectType === 'SCHEDULED_TASK' &&
    tool.riskClass !== 'WRITE_REVERSIBLE'
  ) {
    return {
      decision: 'DENY',
      reason: 'Scheduled task identities are limited to reversible writes.',
    };
  }

  if (requester.subjectType === 'SERVICE' && !hasRequesterRole(requester, 'SYSTEM_WORKER')) {
    return {
      decision: 'DENY',
      reason: 'Service identities require the SYSTEM_WORKER role for side effects.',
    };
  }

  return {
    decision: 'ALLOW',
    reason: 'Requester identity is authorized to proceed to capability policy evaluation.',
  };
}

export function createReadOnlyFallbackIdentity(): RequesterIdentity {
  return {
    subjectId: 'toca-local-readonly',
    subjectType: 'SYSTEM',
    workspaceId: 'toca-os',
    organizationId: 'toca-do-morcego',
    roles: ['SERVICE'],
    authenticationMethod: 'INTERNAL',
  };
}
