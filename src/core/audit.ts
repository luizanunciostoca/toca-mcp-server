import type { AuthenticationMethod, AuthorizationRole, PrincipalType } from './identity.js';

export type AuditStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'DENIED';

export interface AuditEvent {
  readonly executionId: string;
  readonly correlationId: string;
  readonly toolName: string;
  readonly requester: string;
  readonly principalType?: PrincipalType;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly organizationId?: string;
  readonly sessionId?: string;
  readonly authenticationMethod?: AuthenticationMethod;
  readonly authorizationRoles?: readonly AuthorizationRole[];
  readonly status: AuditStatus;
  readonly approvalId?: string;
  readonly connectedAccount?: string;
  readonly externalResourceId?: string;
  readonly errorCode?: string;
  readonly createdAt: string;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

export class InMemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  write(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  list(): readonly AuditEvent[] {
    return this.events;
  }
}
