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
  | 'DUPLICATE_PREVENTED'
  | 'SOURCE_IMAGE_FETCH_BLOCK'
  | 'SOURCE_IMAGE_BINDING_FAILURE'
  | 'NATIVE_IMAGE_EDIT_BINDING_FAILED'
  | 'GENERATION_CONTEXT_DRIFT'
  | 'FIDELITY_GATE_FAILED'
  | 'OUTPUT_TECH_SPEC_MISMATCH'
  | 'QUALITY_GATE_FAILED';

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
