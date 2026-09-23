import { describe, expect, it } from 'vitest';
import {
  THE_PARTY_ITACARE_1011_ACCOUNT_ID,
  THE_PARTY_ITACARE_1011_CAMPAIGN_ID,
  THE_PARTY_ITACARE_1011_FEED_ASSETS,
  THE_PARTY_ITACARE_1011_FEED_CITIES,
  THE_PARTY_ITACARE_1011_PIXEL_ID,
  buildThePartyItacare1011Targeting,
} from '../src/providers/meta-ads/meta-ads-the-party-itacare-2026-10-11-feed-plan.js';

describe('The Party Itacare 2026-10-11 feed 18-35 plan', () => {
  it('locks the approved account, campaign, pixel, cities and five creatives', () => {
    expect(THE_PARTY_ITACARE_1011_ACCOUNT_ID).toBe('311793958882290');
    expect(THE_PARTY_ITACARE_1011_CAMPAIGN_ID).toBe('52622846509265');
    expect(THE_PARTY_ITACARE_1011_PIXEL_ID).toBe('461233076843065');
    expect(THE_PARTY_ITACARE_1011_FEED_CITIES.map((city) => city.code)).toEqual([
      'ITACARE',
      'ILHEUS',
      'ITABUNA',
      'VITORIA_DA_CONQUISTA',
    ]);
    expect(THE_PARTY_ITACARE_1011_FEED_ASSETS).toHaveLength(5);
    expect(new Set(THE_PARTY_ITACARE_1011_FEED_ASSETS.map((asset) => asset.sha256)).size).toBe(5);
  });

  it('enforces hard 18-35 age and feed-only Facebook/Instagram placement', () => {
    for (const city of THE_PARTY_ITACARE_1011_FEED_CITIES) {
      const targeting = buildThePartyItacare1011Targeting(city);
      expect(targeting.age_min).toBe(18);
      expect(targeting.age_max).toBe(35);
      expect(targeting.targeting_automation.advantage_audience).toBe(0);
      expect(targeting.publisher_platforms).toEqual(['facebook', 'instagram']);
      expect(targeting.facebook_positions).toEqual(['feed']);
      expect(targeting.instagram_positions).toEqual(['stream']);
      expect(targeting.geo_locations.custom_locations).toEqual([city.location]);
    }
  });

  it('keeps the source Feed budgets as paused configuration values only', () => {
    expect(
      Object.fromEntries(
        THE_PARTY_ITACARE_1011_FEED_CITIES.map((city) => [city.code, city.lifetimeBudgetMinor]),
      ),
    ).toEqual({
      ITACARE: 46486,
      ILHEUS: 46433,
      ITABUNA: 47249,
      VITORIA_DA_CONQUISTA: 48070,
    });
  });

  it('provides one primary text per asset in every city', () => {
    for (const city of THE_PARTY_ITACARE_1011_FEED_CITIES) {
      expect(city.primaryTexts).toHaveLength(THE_PARTY_ITACARE_1011_FEED_ASSETS.length);
      expect(city.primaryTexts.every((text) => text.length > 40)).toBe(true);
    }
  });
});
