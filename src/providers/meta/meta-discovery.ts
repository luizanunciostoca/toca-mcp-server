import type { MetaConnectionState, MetaConnectionValidation } from './meta-connection.js';

export interface MetaCapabilityEvidence {
  readonly capability: string;
  readonly supported: boolean;
  readonly reason?: string;
}

export interface MetaCapabilityProbe {
  probe(state: MetaConnectionState): Promise<readonly MetaCapabilityEvidence[]>;
}

export function toConnectionValidation(input: {
  readonly state: MetaConnectionState;
  readonly providerAccountId?: string;
  readonly evidence: readonly MetaCapabilityEvidence[];
  readonly checkedAt: string;
  readonly reason?: string;
}): MetaConnectionValidation {
  const capabilities = input.evidence
    .filter((item) => item.supported)
    .map((item) => item.capability)
    .sort();

  return {
    healthy: input.reason === undefined,
    grantedScopes: [...input.state.grantedScopes].sort(),
    capabilities,
    checkedAt: input.checkedAt,
    ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}
