import { describe, expect, it } from 'vitest';
import {
  evaluateMetaAdsProviderSmokeReadiness,
  isMetaAdsPixelAssignedToAccount,
  selectMetaAdsValidationAdSet,
} from '../src/providers/meta-ads/meta-ads-smoke-readiness.js';

describe('Meta Ads provider smoke readiness', () => {
  it('accepts only settled paused effective states', () => {
    expect(
      evaluateMetaAdsProviderSmokeReadiness({
        campaign: { status: 'PAUSED', effective_status: 'PAUSED' },
        adSet: { status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED', issues_info: [] },
        ads: [
          {
            status: 'PAUSED',
            effective_status: 'CAMPAIGN_PAUSED',
            issues_info: [],
            failed_delivery_checks: [],
          },
        ],
      }),
    ).toEqual({ state: 'READY' });
  });

  it('treats provider processing states as pending instead of success', () => {
    expect(
      evaluateMetaAdsProviderSmokeReadiness({
        campaign: { status: 'PAUSED', effective_status: 'PAUSED' },
        adSet: { status: 'PAUSED', effective_status: 'IN_PROCESS', issues_info: [] },
        ads: [
          {
            status: 'PAUSED',
            effective_status: 'PENDING_REVIEW',
            issues_info: [],
            failed_delivery_checks: [],
          },
        ],
      }),
    ).toEqual({ state: 'PENDING', entities: ['adset:IN_PROCESS', 'ad_0:PENDING_REVIEW'] });
  });

  it('rejects WITH_ISSUES even when configured status remains PAUSED', () => {
    expect(() =>
      evaluateMetaAdsProviderSmokeReadiness({
        campaign: { status: 'PAUSED', effective_status: 'PAUSED' },
        adSet: { status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED', issues_info: [] },
        ads: [
          {
            status: 'PAUSED',
            effective_status: 'WITH_ISSUES',
            issues_info: [],
            failed_delivery_checks: [],
          },
        ],
      }),
    ).toThrow('META_ADS_SMOKE_AD_0_UNSAFE_EFFECTIVE_STATUS_WITH_ISSUES');
  });

  it('rejects provider issues and failed delivery checks', () => {
    expect(() =>
      evaluateMetaAdsProviderSmokeReadiness({
        campaign: { status: 'PAUSED', effective_status: 'PAUSED' },
        adSet: {
          status: 'PAUSED',
          effective_status: 'CAMPAIGN_PAUSED',
          issues_info: [{ level: 'ERROR' }],
        },
        ads: [],
      }),
    ).toThrow('META_ADS_SMOKE_ADSET_HAS_ISSUES');

    expect(() =>
      evaluateMetaAdsProviderSmokeReadiness({
        campaign: { status: 'PAUSED', effective_status: 'PAUSED' },
        adSet: { status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED', issues_info: [] },
        ads: [
          {
            status: 'PAUSED',
            effective_status: 'CAMPAIGN_PAUSED',
            failed_delivery_checks: [{ check_name: 'pixel_access' }],
          },
        ],
      }),
    ).toThrow('META_ADS_SMOKE_AD_0_FAILED_DELIVERY_CHECKS');
  });

  it('matches pixel assignment by account_id or provider id', () => {
    expect(
      isMetaAdsPixelAssignedToAccount(
        [{ id: 'act_311793958882290', account_id: '311793958882290' }],
        '311793958882290',
      ),
    ).toBe(true);
    expect(
      isMetaAdsPixelAssignedToAccount(
        [{ id: 'act_2036212826847237', account_id: '2036212826847237' }],
        '311793958882290',
      ),
    ).toBe(false);
  });

  it('selects only a usable existing ad set for no-side-effect validation', () => {
    expect(
      selectMetaAdsValidationAdSet([
        { id: 'broken-1', status: 'PAUSED', effective_status: 'WITH_ISSUES' },
        {
          id: 'broken-2',
          status: 'ACTIVE',
          effective_status: 'ACTIVE',
          issues_info: [{ level: 'ERROR' }],
        },
        { id: 'archived-1', status: 'ARCHIVED' },
        { id: '', status: 'PAUSED' },
        { id: 'paused-1', status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED' },
        { id: 'active-1', status: 'ACTIVE', effective_status: 'ACTIVE' },
      ]),
    ).toEqual({ id: 'paused-1', status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED' });
    expect(
      selectMetaAdsValidationAdSet([{ id: 'archived-1', status: 'ARCHIVED' }]),
    ).toBeUndefined();
  });

  it('skips expired or nearly expired ad sets before provider validate-only', () => {
    const now = new Date('2026-08-16T01:00:00.000Z');
    expect(
      selectMetaAdsValidationAdSet(
        [
          {
            id: 'expired-1',
            status: 'PAUSED',
            effective_status: 'CAMPAIGN_PAUSED',
            end_time: '2026-08-15T23:59:59.000Z',
          },
          {
            id: 'too-close-1',
            status: 'ACTIVE',
            effective_status: 'ACTIVE',
            end_time: '2026-08-16T01:04:59.000Z',
          },
          {
            id: 'future-1',
            status: 'PAUSED',
            effective_status: 'CAMPAIGN_PAUSED',
            end_time: '2026-08-16T03:00:00.000Z',
          },
        ],
        now,
      ),
    ).toEqual({
      id: 'future-1',
      status: 'PAUSED',
      effective_status: 'CAMPAIGN_PAUSED',
      end_time: '2026-08-16T03:00:00.000Z',
    });
  });

  it('fails closed on invalid dated ad sets when no evergreen alternative exists', () => {
    const now = new Date('2026-08-16T01:00:00.000Z');
    expect(
      selectMetaAdsValidationAdSet(
        [
          {
            id: 'invalid-end-time',
            status: 'PAUSED',
            effective_status: 'CAMPAIGN_PAUSED',
            end_time: 'not-a-date',
          },
        ],
        now,
      ),
    ).toBeUndefined();
  });
});
