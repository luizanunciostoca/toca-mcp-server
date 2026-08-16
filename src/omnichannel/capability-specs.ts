import type { CapabilityStatus } from '../core/tool-registry.js';
import type { RouteId } from '../governance/types.js';
import { OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES } from '../governance/omnichannel-capability-contracts.js';

export const OMNICHANNEL_DEPENDENCY_BLOCKERS = [
  'PRIVACY_CONSENT_SUPPRESSION_NOT_CANONICAL_ON_MAIN',
] as const;
export type OmnichannelDependencyBlocker = (typeof OMNICHANNEL_DEPENDENCY_BLOCKERS)[number];

export const OMNICHANNEL_CAPABILITY_IDS = [
  'whatsapp.contact.resolve',
  'whatsapp.opt_in.verify',
  'whatsapp.template.validate',
  'whatsapp.message.prepare',
  'whatsapp.message.send',
  'whatsapp.message.readback',
  'whatsapp.conversation.ingest',
  'email.contact.resolve',
  'email.suppression.verify',
  'email.campaign.prepare',
  'email.campaign.send',
  'email.delivery.readback',
  'email.open.ingest',
  'email.click.ingest',
  'nurture.sequence.create',
  'nurture.sequence.enroll',
  'nurture.sequence.pause',
  'nurture.sequence.outcome.record',
] as const;
export type OmnichannelCapabilityId = (typeof OMNICHANNEL_CAPABILITY_IDS)[number];

export interface OmnichannelCapabilitySpec {
  readonly capabilityId: OmnichannelCapabilityId;
  readonly primaryRouteId: RouteId;
  readonly lifecycleStatus: Extract<CapabilityStatus, 'SPECIFIED'>;
  readonly runtimeExposed: false;
  readonly productionExecutionAllowed: false;
  readonly blockedBy: readonly OmnichannelDependencyBlocker[];
}

function primaryRouteId(capabilityId: OmnichannelCapabilityId): RouteId {
  return capabilityId.startsWith('nurture.') ? 'R10' : 'R30';
}

export const OMNICHANNEL_CAPABILITY_SPECS: readonly OmnichannelCapabilitySpec[] =
  OMNICHANNEL_CAPABILITY_IDS.map((capabilityId) => ({
    capabilityId,
    primaryRouteId: primaryRouteId(capabilityId),
    lifecycleStatus: 'SPECIFIED',
    runtimeExposed: false,
    productionExecutionAllowed: false,
    blockedBy: OMNICHANNEL_DEPENDENCY_BLOCKERS,
  }));

export function validateOmnichannelCapabilitySpecs(): void {
  const ids = new Set<string>();

  for (const spec of OMNICHANNEL_CAPABILITY_SPECS) {
    if (ids.has(spec.capabilityId)) {
      throw new Error(`OMNICHANNEL_CAPABILITY_DUPLICATE:${spec.capabilityId}`);
    }
    ids.add(spec.capabilityId);

    if (!OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES[spec.capabilityId]) {
      throw new Error(`OMNICHANNEL_CONTRACT_MISSING:${spec.capabilityId}`);
    }
    if (spec.lifecycleStatus !== 'SPECIFIED') {
      throw new Error(`OMNICHANNEL_LIFECYCLE_MUST_REMAIN_SPECIFIED:${spec.capabilityId}`);
    }
    if (spec.runtimeExposed || spec.productionExecutionAllowed) {
      throw new Error(`OMNICHANNEL_RUNTIME_EXPOSURE_FORBIDDEN:${spec.capabilityId}`);
    }
    if (spec.blockedBy.length !== OMNICHANNEL_DEPENDENCY_BLOCKERS.length) {
      throw new Error(`OMNICHANNEL_DEPENDENCY_BLOCKER_MISMATCH:${spec.capabilityId}`);
    }
  }

  const contractIds = Object.keys(OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES).sort();
  const manifestIds = [...OMNICHANNEL_CAPABILITY_IDS].sort();
  if (JSON.stringify(contractIds) !== JSON.stringify(manifestIds)) {
    throw new Error('OMNICHANNEL_CONTRACT_MANIFEST_DRIFT');
  }
}
