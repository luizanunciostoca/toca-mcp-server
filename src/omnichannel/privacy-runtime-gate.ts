import type { CrmScope } from '../crm/crm-records.js';
import type {
  CommunicationPolicyDecision,
  PrivacyExecutionContext,
} from '../privacy/contracts.js';
import type { PrivacyGovernanceService } from '../privacy/privacy-governance.js';
import type { OmnichannelChannel } from './contracts.js';

export interface OutboundPrivacyRevalidationInput extends CrmScope {
  readonly channel: OmnichannelChannel;
  /** Exact channel key used by the canonical Privacy ledger/purpose policy. */
  readonly privacyChannel: string;
  readonly subjectRef: string;
  readonly purposeId: string;
  readonly requester: string;
  readonly executionId: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
}

/**
 * Narrow port into the canonical Privacy engine. Channel runtimes use this
 * immediately before an external send so scheduled/retried work cannot rely on
 * a stale consent/suppression snapshot.
 */
export interface OutboundPrivacyRevalidationPort {
  revalidate(input: OutboundPrivacyRevalidationInput): Promise<CommunicationPolicyDecision>;
}

/**
 * Adapter over the existing PrivacyGovernanceService. It intentionally owns no
 * state and creates no second consent/suppression ledger.
 */
export class CanonicalOutboundPrivacyRevalidationPort
  implements OutboundPrivacyRevalidationPort
{
  constructor(
    private readonly privacy: Pick<PrivacyGovernanceService, 'canContact'>,
  ) {}

  revalidate(input: OutboundPrivacyRevalidationInput): Promise<CommunicationPolicyDecision> {
    const context: PrivacyExecutionContext = {
      tenantId: requireText(input.tenantId, 'OMNICHANNEL_PRIVACY_TENANT_REQUIRED'),
      workspaceId: requireText(input.workspaceId, 'OMNICHANNEL_PRIVACY_WORKSPACE_REQUIRED'),
      organizationId: requireText(
        input.organizationId,
        'OMNICHANNEL_PRIVACY_ORGANIZATION_REQUIRED',
      ),
      requester: requireText(input.requester, 'OMNICHANNEL_PRIVACY_REQUESTER_REQUIRED'),
      executionId: requireText(input.executionId, 'OMNICHANNEL_PRIVACY_EXECUTION_REQUIRED'),
      correlationId: requireText(
        input.correlationId,
        'OMNICHANNEL_PRIVACY_CORRELATION_REQUIRED',
      ),
      evidence: input.evidence,
    };

    return this.privacy.canContact({
      context,
      contact: {
        subjectRef: requireText(input.subjectRef, 'OMNICHANNEL_PRIVACY_SUBJECT_REQUIRED'),
        identityState: 'RESOLVED',
      },
      channel: requireText(input.privacyChannel, 'OMNICHANNEL_PRIVACY_CHANNEL_REQUIRED'),
      purposeId: requireText(input.purposeId, 'OMNICHANNEL_PRIVACY_PURPOSE_REQUIRED'),
    });
  }
}

export async function requireFreshOutboundPrivacy(
  port: OutboundPrivacyRevalidationPort,
  input: OutboundPrivacyRevalidationInput,
): Promise<CommunicationPolicyDecision> {
  const decision = await port.revalidate(input);
  if (decision.purposeId !== input.purposeId) {
    throw new Error('OMNICHANNEL_PRIVACY_REVALIDATION_PURPOSE_MISMATCH');
  }
  if (decision.channel !== input.privacyChannel) {
    throw new Error('OMNICHANNEL_PRIVACY_REVALIDATION_CHANNEL_MISMATCH');
  }
  if (decision.state !== 'ALLOWED' || !decision.allowed || decision.blocked) {
    const reasons = decision.reasons.length > 0 ? decision.reasons.join(',') : 'NOT_ALLOWED';
    throw new Error(`OMNICHANNEL_PRIVACY_REVALIDATION_BLOCKED:${reasons}`);
  }
  return decision;
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}
