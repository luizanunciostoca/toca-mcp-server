export type ExecutionErrorCode =
  | 'CAPABILITY_UNAVAILABLE'
  | 'PERMISSION_REVOKED'
  | 'TOKEN_EXPIRED'
  | 'ACCOUNT_NOT_ELIGIBLE'
  | 'SCOPE_MISSING'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'POLICY_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'FINANCIAL_GUARDRAIL_BLOCKED'
  | 'STATE_CONFLICT'
  | 'DUPLICATE_PREVENTED';

export class ExecutionError extends Error {
  constructor(
    readonly code: ExecutionErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}
