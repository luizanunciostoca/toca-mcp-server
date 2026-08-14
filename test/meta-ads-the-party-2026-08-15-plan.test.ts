import { describe, expect, it } from 'vitest';
import {
  assertExactTheParty20260815Descriptor,
  buildTheParty20260815Descriptor,
  THE_PARTY_2026_08_15_APPROVAL,
  THE_PARTY_2026_08_15_DESTINATION_URL,
  theParty20260815DescriptorSha256,
  type TheParty20260815CampaignDescriptor,
} from '../src/providers/meta-ads/meta-ads-the-party-2026-08-15-plan.js';

describe('The Party 2026-08-15 approved Meta Ads descriptor', () => {
  it('pins the exact total-budget, schedule, conversion and identity envelope', () => {
    const descriptor = buildTheParty20260815Descriptor();

    expect(THE_PARTY_2026_08_15_APPROVAL).toBe('APPROVED_THE_PARTY_2026_08_15_R170_TOTAL');
    expect(descriptor.account).toEqual({ adAccountId: '311793958882290', currency: 'BRL' });
    expect(descriptor.campaign.objective).toBe('OUTCOME_SALES');
    expect(descriptor.adSet).toEqual(
      expect.objectContaining({
        lifetimeBudgetMinor: 17_000,
        billingEvent: 'IMPRESSIONS',
        optimizationGoal: 'OFFSITE_CONVERSIONS',
        promotedObject: {
          pixel_id: '461233076843065',
          custom_event_type: 'PURCHASE',
        },
        startTime: '2026-08-15T00:00:00-03:00',
        endTime: '2026-08-16T01:00:00-03:00',
      }),
    );
    expect(descriptor.identity).toEqual({
      pageId: '306103746115875',
      instagramUserId: '17841402033495654',
    });
    expect(descriptor.destinationUrl).toBe(THE_PARTY_2026_08_15_DESTINATION_URL);
    expect(descriptor.assets).toHaveLength(2);
    expect(() => assertExactTheParty20260815Descriptor(descriptor)).not.toThrow();
  });

  it('pins broad-local Morro targeting without interests or explicit placements', () => {
    const descriptor = buildTheParty20260815Descriptor();
    const targeting = descriptor.adSet.targeting as unknown as Record<string, unknown>;

    expect(targeting.age_min).toBe(21);
    expect(targeting.age_max).toBe(45);
    expect(targeting.geo_locations).toEqual({
      custom_locations: [
        {
          latitude: -13.3833,
          longitude: -38.9167,
          radius: 15,
          distance_unit: 'kilometer',
        },
      ],
    });
    expect(targeting).not.toHaveProperty('interests');
    expect(targeting).not.toHaveProperty('flexible_spec');
    expect(targeting).not.toHaveProperty('publisher_platforms');
    expect(targeting).not.toHaveProperty('facebook_positions');
    expect(targeting).not.toHaveProperty('instagram_positions');
  });

  it('produces a deterministic approval hash and fails closed on descriptor drift', () => {
    const canonical = buildTheParty20260815Descriptor();
    const first = theParty20260815DescriptorSha256(canonical);
    const second = theParty20260815DescriptorSha256(buildTheParty20260815Descriptor());
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);

    const mutated = structuredClone(canonical) as TheParty20260815CampaignDescriptor & {
      adSet: { lifetimeBudgetMinor: number };
    };
    mutated.adSet.lifetimeBudgetMinor = 17_001;
    expect(() => assertExactTheParty20260815Descriptor(mutated)).toThrow(
      'META_ADS_THE_PARTY_DESCRIPTOR_NOT_CANONICAL',
    );
  });

  it('pins the exact two approved Drive-backed creative sources and checksums', () => {
    const descriptor = buildTheParty20260815Descriptor();
    expect(descriptor.assets.map((asset) => asset.fileName)).toEqual([
      'creative-1.jpg',
      'creative-2.jpg',
    ]);
    expect(descriptor.assets.map((asset) => asset.driveFileId)).toEqual([
      '1zTpX6T-truHpBmjomvs2KU1QYeojRnXk',
      '1PA3cfg8gDeWRyflhlcrVINuFw-FCJJLR',
    ]);
    expect(descriptor.assets.map((asset) => asset.sourceSha256)).toEqual([
      'ea2784a3a95b946ee81e266b2b660e0b6a571c0d07025fbdcb5f8f27ab319e78',
      '6771739c8098e490e0f68682b8f7c7c6dcdab9ebc8aa9064d8a1568afec46fd6',
    ]);
    expect(descriptor.assets.every((asset) => /^[A-Za-z0-9_-]{20,}$/.test(asset.driveFileId))).toBe(
      true,
    );
    expect(descriptor.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sourceSha256))).toBe(
      true,
    );
  });
});
