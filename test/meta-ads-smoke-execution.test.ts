import { describe, expect, it } from 'vitest';
import type { ControlledCreatePausedResult } from '../src/providers/meta-ads/meta-ads-controlled-write.js';
import {
  metaAdsProviderCreationCheckpointFromError,
  runMetaAdsCreatePausedSettlement,
} from '../src/providers/meta-ads/meta-ads-smoke-execution.js';
import type { MetaAdsProviderSmokeSnapshot } from '../src/providers/meta-ads/meta-ads-smoke-readiness.js';

const requestSha256 = 'a'.repeat(64);
const result: ControlledCreatePausedResult = {
  requestSha256,
  campaignId: 'campaign-1',
  adSetId: 'adset-1',
  creativeIds: ['creative-1'],
  adIds: ['ad-1'],
  status: 'PAUSED',
};
const snapshot: MetaAdsProviderSmokeSnapshot = {
  campaign: { id: 'campaign-1', status: 'PAUSED', effective_status: 'PAUSED' },
  adSet: { id: 'adset-1', status: 'PAUSED', effective_status: 'PAUSED' },
  ads: [{ id: 'ad-1', status: 'PAUSED', effective_status: 'PAUSED' }],
};
const context = {
  smokeId: 'smoke-1',
  campaignName: 'TOCA | P0 SMOKE CREATE_PAUSED | smoke-1',
  approvedRequestSha256: requestSha256,
};

describe('Meta Ads CREATE_PAUSED recovery checkpoint', () => {
  it('checkpoints provider IDs before settlement polling', async () => {
    const order: string[] = [];
    const settled = await runMetaAdsCreatePausedSettlement(context, {
      createPaused: () => {
        order.push('create');
        return Promise.resolve(result);
      },
      checkpointCreated: (checkpoint) => {
        order.push('checkpoint');
        expect(checkpoint).toMatchObject({
          campaignId: 'campaign-1',
          adSetId: 'adset-1',
          creativeIds: ['creative-1'],
          adIds: ['ad-1'],
          approvedRequestSha256: requestSha256,
        });
        return Promise.resolve();
      },
      reconcile: (created) => {
        order.push('reconcile');
        expect(created).toBe(result);
        return Promise.resolve(snapshot);
      },
    });

    expect(order).toEqual(['create', 'checkpoint', 'reconcile']);
    expect(settled.providerVerification).toBe(snapshot);
  });

  it('preserves exact IDs and approved hash when settlement times out without recreating', async () => {
    let createCalls = 0;
    let checkpointCalls = 0;
    let caught: unknown;

    try {
      await runMetaAdsCreatePausedSettlement(context, {
        createPaused: () => {
          createCalls += 1;
          return Promise.resolve(result);
        },
        checkpointCreated: () => {
          checkpointCalls += 1;
          return Promise.resolve();
        },
        reconcile: () =>
          Promise.reject(new Error('META_ADS_SMOKE_PROVIDER_RECONCILIATION_TIMEOUT')),
      });
    } catch (error) {
      caught = error;
    }

    expect(createCalls).toBe(1);
    expect(checkpointCalls).toBe(1);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('META_ADS_SMOKE_PROVIDER_RECONCILIATION_TIMEOUT');
    expect(metaAdsProviderCreationCheckpointFromError(caught)).toEqual({
      smokeId: 'smoke-1',
      campaignName: context.campaignName,
      approvedRequestSha256: requestSha256,
      ...result,
    });
  });

  it('preserves the provider checkpoint even if durable checkpoint persistence itself fails', async () => {
    let createCalls = 0;
    let reconcileCalls = 0;
    let caught: unknown;

    try {
      await runMetaAdsCreatePausedSettlement(context, {
        createPaused: () => {
          createCalls += 1;
          return Promise.resolve(result);
        },
        checkpointCreated: () => Promise.reject(new Error('AUDIT_CHECKPOINT_WRITE_FAILED')),
        reconcile: () => {
          reconcileCalls += 1;
          return Promise.resolve(snapshot);
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(createCalls).toBe(1);
    expect(reconcileCalls).toBe(0);
    expect((caught as Error).message).toBe('AUDIT_CHECKPOINT_WRITE_FAILED');
    expect(metaAdsProviderCreationCheckpointFromError(caught)?.campaignId).toBe('campaign-1');
  });
});
