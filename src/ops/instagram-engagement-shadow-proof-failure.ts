export type ShadowProofChannel = 'COMMENT' | 'DIRECT' | null;

export type ShadowProofStage =
  | 'BOOTSTRAP'
  | 'ENVIRONMENT'
  | 'WRITE_GUARD'
  | 'DATABASE_CONNECT'
  | 'EVENT_NORMALIZATION'
  | 'WEBHOOK_REQUEST'
  | 'ACTION_WAIT'
  | 'DECISION_ASSERT'
  | 'INBOUND_READBACK'
  | 'REPLY_READBACK'
  | 'COMPLETE'
  | 'CLEANUP';

export interface SafeShadowProofFailureEvidence {
  readonly validation: 'instagram-engagement-shadow-e2e-failure';
  readonly status: 'FAIL';
  readonly stage: ShadowProofStage;
  readonly channel: ShadowProofChannel;
  readonly errorCode: string;
  readonly errorName: string;
  readonly writesEnabled: false;
  readonly rawErrorMessagePrinted: false;
  readonly userIdentityPrinted: false;
  readonly messageTextPrinted: false;
}

export function buildSafeShadowProofFailureEvidence(
  reason: unknown,
  stage: ShadowProofStage,
  channel: ShadowProofChannel,
): SafeShadowProofFailureEvidence {
  const error = reason instanceof Error ? reason : undefined;
  const messageHead = (error?.message ?? '').split(':', 1)[0] ?? '';
  const proofCode = isSafeProofCode(messageHead) ? messageHead : undefined;
  const directCode = safeRuntimeCode(readCode(error));
  const causeCode = safeRuntimeCode(readCode(error?.cause));

  return {
    validation: 'instagram-engagement-shadow-e2e-failure',
    status: 'FAIL',
    stage,
    channel,
    errorCode: proofCode ?? directCode ?? causeCode ?? 'UNCLASSIFIED_RUNTIME_ERROR',
    errorName: safeErrorName(error?.name),
    writesEnabled: false,
    rawErrorMessagePrinted: false,
    userIdentityPrinted: false,
    messageTextPrinted: false,
  };
}

function isSafeProofCode(value: string): boolean {
  if (value === 'SHADOW_PROOF_REQUIRES_WRITES_DISABLED') return true;
  if (/^SHADOW_PROOF_(?:COMMENT|DIRECT)_[A-Z_]+$/u.test(value)) return true;
  return /^[A-Z0-9_]+_REQUIRED$/u.test(value);
}

function readCode(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('code' in value)) return undefined;
  return value.code;
}

function safeRuntimeCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim().toUpperCase();
  return /^[A-Z0-9_]{2,32}$/u.test(candidate) ? candidate : undefined;
}

function safeErrorName(value: string | undefined): string {
  if (!value) return 'UnknownError';
  const candidate = value.trim();
  if (/^(?:[A-Za-z][A-Za-z0-9]{0,31}Error|Error)$/u.test(candidate)) return candidate;
  return 'UnknownError';
}
