import type { ControlledCreatePausedResult } from './meta-ads-controlled-write.js';
import type { MetaAdsProviderSmokeSnapshot } from './meta-ads-smoke-readiness.js';

export interface MetaAdsProviderCreationCheckpoint extends ControlledCreatePausedResult {
  readonly smokeId: string;
  readonly campaignName: string;
  readonly approvedRequestSha256: string;
}

export interface MetaAdsCreatePausedSettlementContext {
  readonly smokeId: string;
  readonly campaignName: string;
  readonly approvedRequestSha256: string;
}

export interface MetaAdsCreatePausedSettlementDependencies {
  readonly createPaused: () => Promise<ControlledCreatePausedResult>;
  readonly checkpointCreated: (checkpoint: MetaAdsProviderCreationCheckpoint) => Promise<void>;
  readonly reconcile: (
    result: ControlledCreatePausedResult,
  ) => Promise<MetaAdsProviderSmokeSnapshot>;
}

export class MetaAdsPostCreateSettlementError extends Error {
  readonly checkpoint: MetaAdsProviderCreationCheckpoint;
  readonly originalError: unknown;

  constructor(error: unknown, checkpoint: MetaAdsProviderCreationCheckpoint) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'MetaAdsPostCreateSettlementError';
    this.checkpoint = checkpoint;
    this.originalError = error;
  }
}

const maxSettlementReadbackPasses = 2;

export async function runMetaAdsCreatePausedSettlement(
  context: MetaAdsCreatePausedSettlementContext,
  dependencies: MetaAdsCreatePausedSettlementDependencies,
): Promise<{
  readonly result: ControlledCreatePausedResult;
  readonly checkpoint: MetaAdsProviderCreationCheckpoint;
  readonly providerVerification: MetaAdsProviderSmokeSnapshot;
}> {
  const result = await dependencies.createPaused();
  const checkpoint: MetaAdsProviderCreationCheckpoint = {
    smokeId: context.smokeId,
    campaignName: context.campaignName,
    approvedRequestSha256: context.approvedRequestSha256,
    ...result,
  };

  try {
    await dependencies.checkpointCreated(checkpoint);
    if (result.requestSha256 !== context.approvedRequestSha256) {
      throw new Error('META_ADS_SMOKE_PROVIDER_RESULT_SHA_MISMATCH');
    }
    const providerVerification = await reconcileWithBoundedSettlementRetry(result, dependencies);
    return { result, checkpoint, providerVerification };
  } catch (error) {
    throw new MetaAdsPostCreateSettlementError(error, checkpoint);
  }
}

async function reconcileWithBoundedSettlementRetry(
  result: ControlledCreatePausedResult,
  dependencies: MetaAdsCreatePausedSettlementDependencies,
): Promise<MetaAdsProviderSmokeSnapshot> {
  let lastError: unknown;
  for (let pass = 1; pass <= maxSettlementReadbackPasses; pass += 1) {
    try {
      return await dependencies.reconcile(result);
    } catch (error) {
      lastError = error;
      if (!isProviderReconciliationTimeout(error) || pass === maxSettlementReadbackPasses) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isProviderReconciliationTimeout(error: unknown): boolean {
  return (
    error instanceof Error && error.message === 'META_ADS_SMOKE_PROVIDER_RECONCILIATION_TIMEOUT'
  );
}

export function metaAdsProviderCreationCheckpointFromError(
  error: unknown,
): MetaAdsProviderCreationCheckpoint | undefined {
  return error instanceof MetaAdsPostCreateSettlementError ? error.checkpoint : undefined;
}
