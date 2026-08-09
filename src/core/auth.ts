export type RequesterType = 'USER' | 'SERVICE';

export interface RequesterIdentity {
  readonly id: string;
  readonly type: RequesterType;
  readonly workspace?: string;
}

export interface AuthorizationContext {
  readonly requester: RequesterIdentity;
  readonly connectedAccount?: string;
  readonly approvalReference?: string;
}
