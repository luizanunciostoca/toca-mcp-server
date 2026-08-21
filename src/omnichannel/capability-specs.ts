import type { CapabilityStatus } from '../core/tool-registry.js';
import type { RouteId } from '../governance/types.js';
import { OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES } from '../governance/omnichannel-capability-contracts.js';

export const OMNICHANNEL_DEPENDENCY_BLOCKERS = [] as const;
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
  readonly lifecycleStatus: Extract<CapabilityStatus, 'SPECIFIED' | 'PLANNED' | 'IMPLEMENTED'>;
  readonly runtimeExposed: boolean;
  readonly productionExecutionAllowed: boolean;
  readonly blockedBy: readonly OmnichannelDependencyBlocker[];
}

const runtimeReadbackIds = new Set<OmnichannelCapabilityId>([
  'email.delivery.readback',
  'whatsapp.message.readback',
]);
const runtimeImplementedIds = new Set<OmnichannelCapabilityId>([
  ...runtimeReadbackIds,
  'whatsapp.message.send',
]);
const canonicalPlannedIds = new Set<OmnichannelCapabilityId>(['email.campaign.send']);

function primaryRouteId(capabilityId: OmnichannelCapabilityId): RouteId {
  if (capabilityId.startsWith('email.')) return 'R07';
  return 'R10';
}

export const OMNICHANNEL_CAPABILITY_SPECS: readonly OmnichannelCapabilitySpec[] =
  OMNICHANNEL_CAPABILITY_IDS.map((capabilityId) => {
    const runtimeExposed = runtimeImplementedIds.has(capabilityId);
    return {
      capabilityId,
      primaryRouteId: primaryRouteId(capabilityId),
      lifecycleStatus: runtimeExposed
        ? 'IMPLEMENTED'
        : canonicalPlannedIds.has(capabilityId)
          ? 'PLANNED'
          : 'SPECIFIED',
      runtimeExposed,
      productionExecutionAllowed: runtimeReadbackIds.has(capabilityId),
      blockedBy: OMNICHANNEL_DEPENDENCY_BLOCKERS,
    };
  });

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
    const implemented = runtimeImplementedIds.has(spec.capabilityId);
    const planned = canonicalPlannedIds.has(spec.capabilityId);
    const expectedLifecycle = implemented ? 'IMPLEMENTED' : planned ? 'PLANNED' : 'SPECIFIED';
    if (spec.lifecycleStatus !== expectedLifecycle) {
      throw new Error(`OMNICHANNEL_LIFECYCLE_DRIFT:${spec.capabilityId}`);
    }
    if (
      spec.runtimeExposed !== implemented ||
      spec.productionExecutionAllowed !== runtimeReadbackIds.has(spec.capabilityId)
    ) {
      throw new Error(`OMNICHANNEL_RUNTIME_EXPOSURE_DRIFT:${spec.capabilityId}`);
    }
    if (spec.blockedBy.length !== 0) {
      throw new Error(`OMNICHANNEL_RESOLVED_DEPENDENCY_BLOCKER_PRESENT:${spec.capabilityId}`);
    }
  }

  const contractIds = Object.keys(OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES).sort();
  const manifestIds = [...OMNICHANNEL_CAPABILITY_IDS].sort();
  if (JSON.stringify(contractIds) !== JSON.stringify(manifestIds)) {
    throw new Error('OMNICHANNEL_CONTRACT_MANIFEST_DRIFT');
  }
}
