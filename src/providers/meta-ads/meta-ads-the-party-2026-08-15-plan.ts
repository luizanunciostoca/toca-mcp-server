import { createHash } from 'node:crypto';

export const THE_PARTY_2026_08_15_APPROVAL = 'APPROVED_THE_PARTY_2026_08_15_R170_TOTAL';
export const THE_PARTY_2026_08_15_ACCOUNT_ID = '311793958882290';
export const THE_PARTY_2026_08_15_CURRENCY = 'BRL';
export const THE_PARTY_2026_08_15_PIXEL_ID = '461233076843065';
export const THE_PARTY_2026_08_15_PAGE_ID = '306103746115875';
export const THE_PARTY_2026_08_15_INSTAGRAM_USER_ID = '17841402033495654';
export const THE_PARTY_2026_08_15_DESTINATION_URL =
  'https://tocadomorcego.com.br/produtos/the-party-3819.html';
export const THE_PARTY_2026_08_15_LIFETIME_BUDGET_MINOR = 17_000;
export const THE_PARTY_2026_08_15_START_TIME = '2026-08-15T00:00:00-03:00';
export const THE_PARTY_2026_08_15_END_TIME = '2026-08-16T01:00:00-03:00';

export const THE_PARTY_2026_08_15_ASSETS = [
  {
    key: 'creative-1',
    fileName: 'creative-1.jpg.b64',
    sourceSha256: 'ee8128a08cf5143c581fba135384f2cf8d2f95c2d7258d4ff8c6740469351022',
    creativeName: 'The Party 15-08 | Festa da ilha',
    adName: 'The Party 15-08 | Creative 01 | Festa da ilha',
  },
  {
    key: 'creative-2',
    fileName: 'creative-2.jpg.b64',
    sourceSha256: '2adab63d6ecac535d4a5ac5b1adea45ee99b5be7edc3c867a712eb4ce2fa770d',
    creativeName: 'The Party 15-08 | Bar dobrado 2x1',
    adName: 'The Party 15-08 | Creative 02 | Bar dobrado 2x1',
  },
] as const;

export interface TheParty20260815CampaignDescriptor {
  readonly eventId: 'THE_PARTY_2026_08_15';
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
      readonly geo_locations: {
        readonly custom_locations: readonly [
          {
            readonly latitude: -13.3833;
            readonly longitude: -38.9167;
            readonly radius: 15;
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
  readonly destinationUrl: string;
  readonly assets: readonly {
    readonly key: string;
    readonly fileName: string;
    readonly sourceSha256: string;
    readonly creativeName: string;
    readonly adName: string;
  }[];
}

export function buildTheParty20260815Descriptor(): TheParty20260815CampaignDescriptor {
  return {
    eventId: 'THE_PARTY_2026_08_15',
    account: {
      adAccountId: THE_PARTY_2026_08_15_ACCOUNT_ID,
      currency: THE_PARTY_2026_08_15_CURRENCY,
    },
    campaign: {
      name: 'TOCA | THE PARTY | 2026-08-15 | PURCHASE',
      objective: 'OUTCOME_SALES',
      specialAdCategories: [],
    },
    adSet: {
      name: 'THE PARTY | 2026-08-15 | Morro 15km | Broad 21-45 | Purchase',
      lifetimeBudgetMinor: THE_PARTY_2026_08_15_LIFETIME_BUDGET_MINOR,
      billingEvent: 'IMPRESSIONS',
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      targeting: {
        age_min: 21,
        age_max: 45,
        geo_locations: {
          custom_locations: [
            {
              latitude: -13.3833,
              longitude: -38.9167,
              radius: 15,
              distance_unit: 'kilometer',
            },
          ],
        },
      },
      promotedObject: {
        pixel_id: THE_PARTY_2026_08_15_PIXEL_ID,
        custom_event_type: 'PURCHASE',
      },
      startTime: THE_PARTY_2026_08_15_START_TIME,
      endTime: THE_PARTY_2026_08_15_END_TIME,
    },
    identity: {
      pageId: THE_PARTY_2026_08_15_PAGE_ID,
      instagramUserId: THE_PARTY_2026_08_15_INSTAGRAM_USER_ID,
    },
    destinationUrl: THE_PARTY_2026_08_15_DESTINATION_URL,
    assets: THE_PARTY_2026_08_15_ASSETS.map((asset) => ({ ...asset })),
  };
}

export function theParty20260815DescriptorSha256(
  descriptor: TheParty20260815CampaignDescriptor,
): string {
  return createHash('sha256').update(stableStringify(descriptor)).digest('hex');
}

export function assertExactTheParty20260815Descriptor(
  descriptor: TheParty20260815CampaignDescriptor,
): void {
  const canonical = buildTheParty20260815Descriptor();
  if (stableStringify(descriptor) !== stableStringify(canonical)) {
    throw new Error('META_ADS_THE_PARTY_DESCRIPTOR_NOT_CANONICAL');
  }
  if (descriptor.adSet.lifetimeBudgetMinor !== 17_000) {
    throw new Error('META_ADS_THE_PARTY_TOTAL_BUDGET_MISMATCH');
  }
  if (descriptor.assets.length !== 2) {
    throw new Error('META_ADS_THE_PARTY_CREATIVE_COUNT_MISMATCH');
  }
  const start = new Date(descriptor.adSet.startTime).getTime();
  const end = new Date(descriptor.adSet.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 25 * 60 * 60 * 1000) {
    throw new Error('META_ADS_THE_PARTY_WINDOW_MISMATCH');
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
