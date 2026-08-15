import type { RiskClass } from '../../src/core/tool-registry.js';

export const M_FOUND_12_PIPELINE = [
  'CAPABILITY_DISCOVERY',
  'IDENTITY',
  'TYPED_SCHEMA',
  'AUTHORIZATION',
  'POLICY',
  'RISK',
  'APPROVAL',
  'IDEMPOTENCY',
  'WORKFLOW',
  'HANDLER_PROVIDER',
  'PROVIDER_READBACK',
  'DOMAIN_LINKAGE',
  'TRANSACTIONAL_OUTBOX',
  'AUDIT_LEDGER',
  'VERIFY',
  'FINAL_RESPONSE',
] as const;

export type MFound12PipelineStage = (typeof M_FOUND_12_PIPELINE)[number];

export const M_FOUND_12_DIMENSIONS = [
  'READ',
  'WRITE_REVERSIBLE',
  'WRITE_EXTERNAL',
  'FINANCIAL_IMPACT',
  'DESTRUCTIVE',
  'APPROVAL_REQUIRED',
  'HUMAN_TASK',
  'TIMER',
  'RETRY',
  'COMPENSATION',
  'STALE_CLAIM',
  'IDEMPOTENCY_REPLAY',
  'DUPLICATE_REQUEST',
  'PAYLOAD_DRIFT',
  'APPROVAL_REPLAY',
  'CROSS_TENANT_ATTEMPT',
  'PROVIDER_TIMEOUT',
  'AMBIGUOUS_PROVIDER_RESPONSE',
  'MISSING_READBACK',
  'AUDIT_FAILURE',
  'OUTBOX_RETRY',
  'RECOVERY_AFTER_RESTART',
  'EVENT_RECORD_LINKAGE',
  'CRM_LINKAGE',
] as const;

export type MFound12Dimension = (typeof M_FOUND_12_DIMENSIONS)[number];

export type MFound12ProviderBehavior =
  | 'SUCCESS'
  | 'TIMEOUT_AFTER_ACCEPT'
  | 'AMBIGUOUS'
  | 'MISSING_READBACK';

export type MFound12ExpectedOutcome =
  | 'SUCCEEDS_VERIFIED'
  | 'DENIED_BEFORE_PROVIDER'
  | 'WAITS_DURABLY'
  | 'RETRIES_DURABLY'
  | 'COMPENSATES_DURABLY'
  | 'RECONCILIATION_REQUIRED'
  | 'FAILS_CLOSED'
  | 'RECOVERS_WITHOUT_DUPLICATE';

export interface MFound12Scenario {
  readonly id: `E2E-${string}`;
  readonly dimension: MFound12Dimension;
  readonly riskClass: RiskClass;
  readonly sideEffects: boolean;
  readonly approvalRequired: boolean;
  readonly idempotencyRequired: boolean;
  readonly providerBehavior: MFound12ProviderBehavior;
  readonly providerReadbackRequired: boolean;
  readonly eventRecordApplicable?: boolean;
  readonly crmApplicable?: boolean;
  readonly expectedOutcome: MFound12ExpectedOutcome;
}

export const M_FOUND_12_SCENARIOS: readonly MFound12Scenario[] = [
  scenario('001', 'READ', 'READ', false, false, false, 'SUCCESS', false, 'SUCCEEDS_VERIFIED'),
  scenario(
    '002',
    'WRITE_REVERSIBLE',
    'WRITE_REVERSIBLE',
    true,
    false,
    true,
    'SUCCESS',
    true,
    'SUCCEEDS_VERIFIED',
  ),
  scenario(
    '003',
    'WRITE_EXTERNAL',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'SUCCEEDS_VERIFIED',
  ),
  scenario(
    '004',
    'FINANCIAL_IMPACT',
    'FINANCIAL_IMPACT',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'SUCCEEDS_VERIFIED',
  ),
  scenario(
    '005',
    'DESTRUCTIVE',
    'DESTRUCTIVE',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'SUCCEEDS_VERIFIED',
  ),
  scenario(
    '006',
    'APPROVAL_REQUIRED',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'DENIED_BEFORE_PROVIDER',
  ),
  scenario(
    '007',
    'HUMAN_TASK',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'WAITS_DURABLY',
  ),
  scenario(
    '008',
    'TIMER',
    'WRITE_REVERSIBLE',
    true,
    false,
    true,
    'SUCCESS',
    true,
    'WAITS_DURABLY',
  ),
  scenario(
    '009',
    'RETRY',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'TIMEOUT_AFTER_ACCEPT',
    true,
    'RETRIES_DURABLY',
  ),
  scenario(
    '010',
    'COMPENSATION',
    'WRITE_REVERSIBLE',
    true,
    false,
    true,
    'SUCCESS',
    true,
    'COMPENSATES_DURABLY',
  ),
  scenario(
    '011',
    'STALE_CLAIM',
    'WRITE_REVERSIBLE',
    true,
    false,
    true,
    'SUCCESS',
    true,
    'DENIED_BEFORE_PROVIDER',
  ),
  scenario(
    '012',
    'IDEMPOTENCY_REPLAY',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'RECOVERS_WITHOUT_DUPLICATE',
  ),
  scenario(
    '013',
    'DUPLICATE_REQUEST',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'RECOVERS_WITHOUT_DUPLICATE',
  ),
  scenario(
    '014',
    'PAYLOAD_DRIFT',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'DENIED_BEFORE_PROVIDER',
  ),
  scenario(
    '015',
    'APPROVAL_REPLAY',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'DENIED_BEFORE_PROVIDER',
  ),
  scenario(
    '016',
    'CROSS_TENANT_ATTEMPT',
    'DESTRUCTIVE',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'DENIED_BEFORE_PROVIDER',
  ),
  scenario(
    '017',
    'PROVIDER_TIMEOUT',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'TIMEOUT_AFTER_ACCEPT',
    true,
    'RECONCILIATION_REQUIRED',
  ),
  scenario(
    '018',
    'AMBIGUOUS_PROVIDER_RESPONSE',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'AMBIGUOUS',
    true,
    'RECONCILIATION_REQUIRED',
  ),
  scenario(
    '019',
    'MISSING_READBACK',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'MISSING_READBACK',
    true,
    'FAILS_CLOSED',
  ),
  scenario(
    '020',
    'AUDIT_FAILURE',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'FAILS_CLOSED',
  ),
  scenario(
    '021',
    'OUTBOX_RETRY',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'RETRIES_DURABLY',
  ),
  scenario(
    '022',
    'RECOVERY_AFTER_RESTART',
    'WRITE_EXTERNAL',
    true,
    true,
    true,
    'SUCCESS',
    true,
    'RECOVERS_WITHOUT_DUPLICATE',
  ),
  {
    ...scenario(
      '023',
      'EVENT_RECORD_LINKAGE',
      'WRITE_EXTERNAL',
      true,
      true,
      true,
      'SUCCESS',
      true,
      'SUCCEEDS_VERIFIED',
    ),
    eventRecordApplicable: true,
  },
  {
    ...scenario(
      '024',
      'CRM_LINKAGE',
      'WRITE_EXTERNAL',
      true,
      true,
      true,
      'SUCCESS',
      true,
      'SUCCEEDS_VERIFIED',
    ),
    crmApplicable: true,
  },
] as const;

function scenario(
  suffix: string,
  dimension: MFound12Dimension,
  riskClass: RiskClass,
  sideEffects: boolean,
  approvalRequired: boolean,
  idempotencyRequired: boolean,
  providerBehavior: MFound12ProviderBehavior,
  providerReadbackRequired: boolean,
  expectedOutcome: MFound12ExpectedOutcome,
): MFound12Scenario {
  return {
    id: `E2E-${suffix}`,
    dimension,
    riskClass,
    sideEffects,
    approvalRequired,
    idempotencyRequired,
    providerBehavior,
    providerReadbackRequired,
    expectedOutcome,
  };
}

export interface MFound12FakeProviderOptions {
  readonly behavior?: MFound12ProviderBehavior;
  readonly endpoint?: string;
  readonly credential?: string;
}

export interface MFound12FakeProviderReadback {
  readonly verified: boolean;
  readonly evidence: readonly string[];
  readonly reason?: string;
}

export class MFound12FakeProvider {
  readonly calls: unknown[] = [];
  private readonly behavior: MFound12ProviderBehavior;

  constructor(options: MFound12FakeProviderOptions = {}) {
    if (options.endpoint || options.credential) {
      throw new Error('M_FOUND_12_HARNESS_EXTERNAL_CONNECTIVITY_FORBIDDEN');
    }
    this.behavior = options.behavior ?? 'SUCCESS';
  }

  async execute(payload: unknown): Promise<Readonly<Record<string, unknown>>> {
    this.calls.push(payload);
    if (this.behavior === 'TIMEOUT_AFTER_ACCEPT') {
      throw new Error('M_FOUND_12_FAKE_PROVIDER_TIMEOUT_AFTER_ACCEPT');
    }
    if (this.behavior === 'AMBIGUOUS') {
      return { accepted: true, providerState: 'UNKNOWN' };
    }
    return { accepted: true, providerId: 'fake-provider-resource-1' };
  }

  async readback(): Promise<MFound12FakeProviderReadback> {
    if (this.behavior === 'MISSING_READBACK') {
      return { verified: false, evidence: [], reason: 'PROVIDER_READBACK_MISSING' };
    }
    if (this.behavior === 'AMBIGUOUS' || this.behavior === 'TIMEOUT_AFTER_ACCEPT') {
      return {
        verified: false,
        evidence: ['fake:provider:ambiguous'],
        reason: 'PROVIDER_STATE_AMBIGUOUS',
      };
    }
    return { verified: true, evidence: ['fake:provider:verified'] };
  }
}
