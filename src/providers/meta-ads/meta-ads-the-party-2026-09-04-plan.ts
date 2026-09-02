import { createHash } from 'node:crypto';
import { META_ADS_PRIMARY_ACCOUNT_ID } from './meta-ads-account-binding.js';

export const THE_PARTY_2026_09_04_APPROVAL = 'APPROVED_THE_PARTY_2026_09_04_R300_CREATE_PAUSED';
export const THE_PARTY_2026_09_04_ACCOUNT_ID = META_ADS_PRIMARY_ACCOUNT_ID;
export const THE_PARTY_2026_09_04_CURRENCY = 'BRL';
export const THE_PARTY_2026_09_04_PIXEL_ID = '461233076843065';
export const THE_PARTY_2026_09_04_PAGE_ID = '306103746115875';
export const THE_PARTY_2026_09_04_INSTAGRAM_USER_ID = '17841402033495654';
export const THE_PARTY_2026_09_04_LIFETIME_BUDGET_MINOR = 30_000;
export const THE_PARTY_2026_09_04_START_TIME = '2026-09-02T20:30:00-03:00';
export const THE_PARTY_2026_09_04_END_TIME = '2026-09-05T01:00:00-03:00';

export const THE_PARTY_2026_09_04_ASSETS = [
  {
    key: 'hero_event',
    fileName: 'creative-01-hero.jpg',
    sourceSha256: 'f3f6cbefacea0367ce70f38c0d08fde01a00386dd87e5212ac80d9e31c1fb9af',
    creativeName: 'The Party 04-09 | Hero | Sexta 04 Set',
    adName: 'The Party 04-09 | AD 01 | Hero',
    primaryText:
      'É nesta sexta. The Party by Toca Experience no Toca do Morcego, em Morro de São Paulo. Garanta seu ingresso e viva a experiência noturna da Toca.',
    headline: 'Garanta seu ingresso',
    description: 'Sexta • 04 Set • Toca do Morcego',
    callToActionType: 'SHOP_NOW',
    destinationUrl:
      'https://tocadomorcego.com.br/produtos/the-party-3819.html?utm_source=meta&utm_medium=paid_social&utm_campaign=the_party_2026_09_04_morro&utm_term=morro_local&utm_content=ad01_hero',
  },
  {
    key: 'experience_storytelling',
    fileName: 'creative-02-experience.jpg',
    sourceSha256: 'd64e32bdf41f7eea918442256dfe36bc7c84c13ffcd64a8c630e4db0a8b60ce5',
    creativeName: 'The Party 04-09 | Experience | Storytelling',
    adName: 'The Party 04-09 | AD 02 | Experience',
    primaryText:
      'A noite começa aqui. Chegue, sinta a energia e viva a experiência da The Party nesta sexta em Morro de São Paulo.',
    headline: 'Viva The Party',
    description: 'Toca do Morcego • 04 Set',
    callToActionType: 'SHOP_NOW',
    destinationUrl:
      'https://tocadomorcego.com.br/produtos/the-party-3819.html?utm_source=meta&utm_medium=paid_social&utm_campaign=the_party_2026_09_04_morro&utm_term=morro_local&utm_content=ad02_experience',
  },
  {
    key: 'urgency_friday',
    fileName: 'creative-03-urgency.jpg',
    sourceSha256: 'f966cd2e5a25a41ee69219b47c2c9b6dcbc6494a693bb7cb4c1320ac964406e2',
    creativeName: 'The Party 04-09 | Urgency | É Nesta Sexta',
    adName: 'The Party 04-09 | AD 03 | Urgency',
    primaryText:
      'É nesta sexta. The Party chega ao Toca do Morcego com a energia que Morro merece. Garanta seu ingresso agora.',
    headline: 'É nesta sexta',
    description: 'Morro de São Paulo • 04 Set',
    callToActionType: 'SHOP_NOW',
    destinationUrl:
      'https://tocadomorcego.com.br/produtos/the-party-3819.html?utm_source=meta&utm_medium=paid_social&utm_campaign=the_party_2026_09_04_morro&utm_term=morro_local&utm_content=ad03_urgency',
  },
  {
    key: 'venue_crowd',
    fileName: 'creative-04-venue-crowd.jpg',
    sourceSha256: '651ff66c4cca870304a7097fe7cb160f3e2b1b5bdbec8b14ffda97cb9178f331',
    creativeName: 'The Party 04-09 | Venue + Crowd',
    adName: 'The Party 04-09 | AD 04 | Venue Crowd',
    primaryText:
      'A experiência noturna da Toca te espera nesta sexta. The Party no Toca do Morcego, em Morro de São Paulo.',
    headline: 'A experiência noturna da Toca',
    description: 'Sexta • 04 Set',
    callToActionType: 'SHOP_NOW',
    destinationUrl:
      'https://tocadomorcego.com.br/produtos/the-party-3819.html?utm_source=meta&utm_medium=paid_social&utm_campaign=the_party_2026_09_04_morro&utm_term=morro_local&utm_content=ad04_venue_crowd',
  },
  {
    key: 'brand_statement',
    fileName: 'creative-05-brand-statement.jpg',
    sourceSha256: 'a4fafe3b833138351ac60d42f8ef616812c664a25620a7b7a9fba888739ee4e8',
    creativeName: 'The Party 04-09 | Brand | Não É Qualquer Festa',
    adName: 'The Party 04-09 | AD 05 | Brand Statement',
    primaryText:
      'Não é qualquer festa. É a festa. Sexta, 04 de setembro, no Toca do Morcego. Viva The Party em Morro de São Paulo.',
    headline: 'Não é qualquer festa',
    description: 'The Party • Toca do Morcego',
    callToActionType: 'SHOP_NOW',
    destinationUrl:
      'https://tocadomorcego.com.br/produtos/the-party-3819.html?utm_source=meta&utm_medium=paid_social&utm_campaign=the_party_2026_09_04_morro&utm_term=morro_local&utm_content=ad05_brand_statement',
  },
] as const;

export interface TheParty20260904CampaignDescriptor {
  readonly eventId: 'THE_PARTY_2026_09_04';
  readonly account: {
    readonly adAccountId: string;
    readonly currency: 'BRL';
  };
  readonly campaign: {
    readonly name: string;
    readonly objective: 'OUTCOME_SALES';
    readonly specialAdCategories: readonly string[];
  };
  readonly adSet: {
    readonly name: string;
    readonly lifetimeBudgetMinor: number;
    readonly billingEvent: 'IMPRESSIONS';
    readonly optimizationGoal: 'OFFSITE_CONVERSIONS';
    readonly targeting: {
      readonly age_min: 21;
      readonly age_max: 45;
      readonly targeting_automation: {
        readonly advantage_audience: 0;
      };
      readonly publisher_platforms: readonly ['facebook', 'instagram'];
      readonly geo_locations: {
        readonly custom_locations: readonly [
          {
            readonly latitude: -13.3833;
            readonly longitude: -38.9167;
            readonly radius: 2;
            readonly distance_unit: 'kilometer';
          },
        ];
      };
    };
    readonly promotedObject: {
      readonly pixel_id: string;
      readonly custom_event_type: 'PURCHASE';
    };
    readonly startTime: string;
    readonly endTime: string;
  };
  readonly identity: {
    readonly pageId: string;
    readonly instagramUserId: string;
  };
  readonly assets: readonly {
    readonly key: string;
    readonly fileName: string;
    readonly sourceSha256: string;
    readonly creativeName: string;
    readonly adName: string;
    readonly primaryText: string;
    readonly headline: string;
    readonly description: string;
    readonly callToActionType: 'SHOP_NOW';
    readonly destinationUrl: string;
  }[];
}

export function buildTheParty20260904Descriptor(): TheParty20260904CampaignDescriptor {
  return {
    eventId: 'THE_PARTY_2026_09_04',
    account: {
      adAccountId: THE_PARTY_2026_09_04_ACCOUNT_ID,
      currency: THE_PARTY_2026_09_04_CURRENCY,
    },
    campaign: {
      name: 'TOCA | THE PARTY | 2026-09-04 | MORRO | PURCHASE',
      objective: 'OUTCOME_SALES',
      specialAdCategories: [],
    },
    adSet: {
      name: 'THE PARTY | 2026-09-04 | Morro 2km | Broad 21-45 | Purchase',
      lifetimeBudgetMinor: THE_PARTY_2026_09_04_LIFETIME_BUDGET_MINOR,
      billingEvent: 'IMPRESSIONS',
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      targeting: {
        age_min: 21,
        age_max: 45,
        targeting_automation: {
          advantage_audience: 0,
        },
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
      },
      promotedObject: {
        pixel_id: THE_PARTY_2026_09_04_PIXEL_ID,
        custom_event_type: 'PURCHASE',
      },
      startTime: THE_PARTY_2026_09_04_START_TIME,
      endTime: THE_PARTY_2026_09_04_END_TIME,
    },
    identity: {
      pageId: THE_PARTY_2026_09_04_PAGE_ID,
      instagramUserId: THE_PARTY_2026_09_04_INSTAGRAM_USER_ID,
    },
    assets: THE_PARTY_2026_09_04_ASSETS.map((asset) => ({ ...asset })),
  };
}

export function theParty20260904DescriptorSha256(
  descriptor: TheParty20260904CampaignDescriptor,
): string {
  return createHash('sha256').update(stableStringify(descriptor)).digest('hex');
}

export function assertExactTheParty20260904Descriptor(
  descriptor: TheParty20260904CampaignDescriptor,
): void {
  const canonical = buildTheParty20260904Descriptor();
  if (stableStringify(descriptor) !== stableStringify(canonical)) {
    throw new Error('META_ADS_THE_PARTY_0904_DESCRIPTOR_NOT_CANONICAL');
  }
  if (descriptor.adSet.lifetimeBudgetMinor !== 30_000) {
    throw new Error('META_ADS_THE_PARTY_0904_TOTAL_BUDGET_MISMATCH');
  }
  if (descriptor.assets.length !== 5) {
    throw new Error('META_ADS_THE_PARTY_0904_CREATIVE_COUNT_MISMATCH');
  }
  const start = new Date(descriptor.adSet.startTime).getTime();
  const end = new Date(descriptor.adSet.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('META_ADS_THE_PARTY_0904_WINDOW_INVALID');
  }
  const location = descriptor.adSet.targeting.geo_locations.custom_locations[0];
  if (location.radius !== 2 || location.distance_unit !== 'kilometer') {
    throw new Error('META_ADS_THE_PARTY_0904_GEO_MISMATCH');
  }
  if (descriptor.adSet.targeting.publisher_platforms.join(',') !== 'facebook,instagram') {
    throw new Error('META_ADS_THE_PARTY_0904_PLATFORMS_MISMATCH');
  }
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
