import type { MetaApiClient } from '../meta/meta-api-client.js';
import { selectMetaAdsValidationAdSet } from './meta-ads-smoke-readiness.js';

export interface MetaAdsNoSideEffectAdValidationInput {
  readonly accountId: string;
  readonly creativeId: string;
  readonly validationId: string;
}

export interface MetaAdsNoSideEffectAdValidationEvidence {
  readonly validated: true;
  readonly adSetId: string;
  readonly creativeId: string;
}

export async function validateMetaAdsAdWriteReadiness(
  api: MetaApiClient,
  input: MetaAdsNoSideEffectAdValidationInput,
): Promise<MetaAdsNoSideEffectAdValidationEvidence> {
  const response = asRecord(
    await api.get(`act_${input.accountId}/adsets`, {
      fields: 'id,name,status,effective_status,issues_info,end_time',
      limit: '200',
    }),
  );
  const adSets = Array.isArray(response.data) ? response.data.map(asRecord) : [];
  const remaining = [...adSets];
  let lastProviderError: unknown;

  while (remaining.length > 0) {
    const adSet = selectMetaAdsValidationAdSet(remaining);
    const adSetId = scalarString(adSet?.id);
    if (!adSetId) break;

    const selectedIndex = remaining.findIndex(
      (candidate) => scalarString(candidate.id) === adSetId,
    );
    if (selectedIndex >= 0) remaining.splice(selectedIndex, 1);

    try {
      const result = asRecord(
        await api.post(`act_${input.accountId}/ads`, {
          name: `TOCA | P0 VALIDATE_ONLY | ${input.validationId}`,
          adset_id: adSetId,
          creative: JSON.stringify({ creative_id: input.creativeId }),
          status: 'PAUSED',
          execution_options: JSON.stringify(['validate_only']),
        }),
      );
      if (scalarString(result.id)) {
        throw new Error('META_ADS_SMOKE_VALIDATE_ONLY_UNEXPECTED_ID');
      }

      return { validated: true, adSetId, creativeId: input.creativeId };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'META_ADS_SMOKE_VALIDATE_ONLY_UNEXPECTED_ID'
      ) {
        throw error;
      }
      lastProviderError = error;
    }
  }

  if (lastProviderError !== undefined) throw lastProviderError;
  throw new Error('META_ADS_SMOKE_VALIDATE_ONLY_ADSET_NOT_FOUND');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}
