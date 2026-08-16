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
  const adSet = selectMetaAdsValidationAdSet(adSets);
  const adSetId = scalarString(adSet?.id);
  if (!adSetId) throw new Error('META_ADS_SMOKE_VALIDATE_ONLY_ADSET_NOT_FOUND');

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
