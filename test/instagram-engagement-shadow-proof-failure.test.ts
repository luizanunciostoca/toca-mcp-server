import { describe, expect, it } from 'vitest';
import { buildSafeShadowProofFailureEvidence } from '../src/ops/instagram-engagement-shadow-proof-failure.js';

describe('Instagram engagement shadow proof failure evidence', () => {
  it('preserves a known proof code without leaking its observed value', () => {
    const evidence = buildSafeShadowProofFailureEvidence(
      new Error('SHADOW_PROOF_COMMENT_UNEXPECTED_INTENT:EVENT_INFO'),
      'DECISION_ASSERT',
      'COMMENT',
    );

    expect(evidence).toEqual({
      validation: 'instagram-engagement-shadow-e2e-failure',
      status: 'FAIL',
      stage: 'DECISION_ASSERT',
      channel: 'COMMENT',
      errorCode: 'SHADOW_PROOF_COMMENT_UNEXPECTED_INTENT',
      errorName: 'Error',
      writesEnabled: false,
      rawErrorMessagePrinted: false,
      userIdentityPrinted: false,
      messageTextPrinted: false,
    });
    expect(JSON.stringify(evidence)).not.toContain('EVENT_INFO');
  });

  it('uses a safe nested runtime code for generic failures', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('private provider detail'), { code: 'ECONNRESET' }),
    });
    const evidence = buildSafeShadowProofFailureEvidence(error, 'WEBHOOK_REQUEST', 'DIRECT');

    expect(evidence.errorCode).toBe('ECONNRESET');
    expect(evidence.errorName).toBe('TypeError');
    expect(JSON.stringify(evidence)).not.toContain('fetch failed');
    expect(JSON.stringify(evidence)).not.toContain('private provider detail');
  });

  it('fails closed to a generic code for unknown error payloads', () => {
    const evidence = buildSafeShadowProofFailureEvidence(
      'secret raw failure detail',
      'DATABASE_CONNECT',
      null,
    );

    expect(evidence.errorCode).toBe('UNCLASSIFIED_RUNTIME_ERROR');
    expect(evidence.errorName).toBe('UnknownError');
    expect(JSON.stringify(evidence)).not.toContain('secret raw failure detail');
  });
});
