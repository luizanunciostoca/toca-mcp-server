import { describe, expect, it } from 'vitest';
import {
  assertExactTheParty20260904Descriptor,
  buildTheParty20260904Descriptor,
  THE_PARTY_2026_09_04_APPROVAL,
  THE_PARTY_2026_09_04_ASSETS,
  THE_PARTY_2026_09_04_END_TIME,
  THE_PARTY_2026_09_04_LIFETIME_BUDGET_MINOR,
  THE_PARTY_2026_09_04_START_TIME,
  theParty20260904DescriptorSha256,
  type TheParty20260904CampaignDescriptor,
} from '../src/providers/meta-ads/meta-ads-the-party-2026-09-04-plan.js';

describe('The Party 2026-09-04 approved Meta Ads create-paused descriptor', () => {
  it('pins the exact R$300 total budget, schedule, identity and purchase envelope', () => {
    const descriptor = buildTheParty20260904Descriptor();

    expect(THE_PARTY_2026_09_04_APPROVAL).toBe('APPROVED_THE_PARTY_2026_09_04_R300_CREATE_PAUSED');
    expect(descriptor.account).toEqual({ adAccountId: '311793958882290', currency: 'BRL' });
    expect(descriptor.campaign).toEqual({
      name: 'TOCA | THE PARTY | 2026-09-04 | MORRO | PURCHASE',
      objective: 'OUTCOME_SALES',
      specialAdCategories: [],
    });
    expect(descriptor.adSet.lifetimeBudgetMinor).toBe(THE_PARTY_2026_09_04_LIFETIME_BUDGET_MINOR);
    expect(descriptor.adSet.startTime).toBe(THE_PARTY_2026_09_04_START_TIME);
    expect(descriptor.adSet.endTime).toBe(THE_PARTY_2026_09_04_END_TIME);
    expect(descriptor.adSet.promotedObject).toEqual({
      pixel_id: '461233076843065',
      custom_event_type: 'PURCHASE',
    });
    expect(descriptor.identity).toEqual({
      pageId: '306103746115875',
      instagramUserId: '17841402033495654',
    });
  });

  it('pins Morro 2km broad 21-45 and limits publisher platforms to Facebook and Instagram', () => {
    const descriptor = buildTheParty20260904Descriptor();

    expect(descriptor.adSet.targeting).toEqual({
      age_min: 21,
      age_max: 45,
      targeting_automation: { advantage_audience: 0 },
      publisher_platforms: ['facebook', 'instagram'],
      geo_locations: {
        custom_locations: [
          {
            latitude: -13.3833,
            longitude: -38.9167,
            radius: 2,
            distance_unit: 'kilometer',
          },
        ],
      },
    });
  });

  it('pins all five user-approved creatives with immutable source hashes and per-ad UTMs', () => {
    const descriptor = buildTheParty20260904Descriptor();

    expect(descriptor.assets).toHaveLength(5);
    expect(descriptor.assets.map((asset) => asset.sourceSha256)).toEqual([
      'f3f6cbefacea0367ce70f38c0d08fde01a00386dd87e5212ac80d9e31c1fb9af',
      'd64e32bdf41f7eea918442256dfe36bc7c84c13ffcd64a8c630e4db0a8b60ce5',
      'f966cd2e5a25a41ee69219b47c2c9b6dcbc6494a693bb7cb4c1320ac964406e2',
      '651ff66c4cca870304a7097fe7cb160f3e2b1b5bdbec8b14ffda97cb9178f331',
      'a4fafe3b833138351ac60d42f8ef616812c664a25620a7b7a9fba888739ee4e8',
    ]);
    expect(descriptor.assets.map((asset) => asset.key)).toEqual([
      'hero_event',
      'experience_storytelling',
      'urgency_friday',
      'venue_crowd',
      'brand_statement',
    ]);
    for (const asset of descriptor.assets) {
      expect(asset.destinationUrl).toContain('utm_source=meta');
      expect(asset.destinationUrl).toContain('utm_campaign=the_party_2026_09_04_morro');
      expect(asset.callToActionType).toBe('SHOP_NOW');
    }
    expect(THE_PARTY_2026_09_04_ASSETS).toHaveLength(5);
  });

  it('rejects any budget or creative mutation from the canonical descriptor', () => {
    const canonical = buildTheParty20260904Descriptor();
    const mutatedBudget = {
      ...canonical,
      adSet: { ...canonical.adSet, lifetimeBudgetMinor: 30_001 },
    } as TheParty20260904CampaignDescriptor;
    expect(() => assertExactTheParty20260904Descriptor(mutatedBudget)).toThrow(
      'META_ADS_THE_PARTY_0904_DESCRIPTOR_NOT_CANONICAL',
    );

    const mutatedAssets = {
      ...canonical,
      assets: canonical.assets.slice(0, 4),
    } as TheParty20260904CampaignDescriptor;
    expect(() => assertExactTheParty20260904Descriptor(mutatedAssets)).toThrow(
      'META_ADS_THE_PARTY_0904_DESCRIPTOR_NOT_CANONICAL',
    );
  });

  it('produces a stable exact descriptor hash', () => {
    const first = buildTheParty20260904Descriptor();
    const second = buildTheParty20260904Descriptor();
    expect(theParty20260904DescriptorSha256(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(theParty20260904DescriptorSha256(second)).toBe(theParty20260904DescriptorSha256(first));
  });
});
