import type { MetaApiClient } from '../meta/meta-api-client.js';

export interface WhatsAppAssetDiscoverySelectors {
  readonly businessId?: string | null;
  readonly wabaId?: string | null;
  readonly phoneNumberId?: string | null;
}

export interface WhatsAppDiscoveredAssets {
  readonly businessId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly displayPhoneNumber: string | null;
  readonly verifiedName: string | null;
  readonly evidence: readonly string[];
}

interface ProviderAsset {
  readonly id: string;
  readonly name: string | null;
}

interface PhoneAsset extends ProviderAsset {
  readonly displayPhoneNumber: string | null;
}

/**
 * Discovers the canonical WhatsApp Cloud API asset tuple from an already
 * authorized Meta token. Selectors are optional and are used only to resolve
 * ambiguity. With no selectors, every level must have exactly one candidate.
 */
export async function discoverWhatsAppAssets(
  api: MetaApiClient,
  selectors: WhatsAppAssetDiscoverySelectors = {},
): Promise<WhatsAppDiscoveredAssets> {
  const business = selectors.businessId?.trim()
    ? { id: selectors.businessId.trim(), name: null }
    : selectOne(
        parseAssets(await api.get('me/businesses', { fields: 'id,name', limit: '100' })),
        null,
        'WHATSAPP_BUSINESS',
      );

  const wabaCandidates = await listWabas(api, business.id);
  const waba = selectOne(wabaCandidates, selectors.wabaId ?? null, 'WHATSAPP_WABA');
  const phones = parsePhones(
    await api.get(`${waba.id}/phone_numbers`, {
      fields: 'id,display_phone_number,verified_name,quality_rating',
      limit: '100',
    }),
  );
  const phone = selectPhone(phones, selectors.phoneNumberId ?? null);

  return {
    businessId: business.id,
    wabaId: waba.id,
    phoneNumberId: phone.id,
    displayPhoneNumber: phone.displayPhoneNumber,
    verifiedName: phone.name,
    evidence: [
      `meta:business:${business.id}`,
      `meta:waba:${waba.id}`,
      `meta:phone-number-id:${phone.id}`,
      'whatsapp:asset-discovery:token-authorized',
    ],
  };
}

async function listWabas(
  api: MetaApiClient,
  businessId: string,
): Promise<readonly ProviderAsset[]> {
  const edges = ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts'] as const;
  const results = await Promise.allSettled(
    edges.map((edge) => api.get(`${businessId}/${edge}`, { fields: 'id,name', limit: '100' })),
  );
  const byId = new Map<string, ProviderAsset>();
  let successfulEdges = 0;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    successfulEdges += 1;
    for (const asset of parseAssets(result.value)) byId.set(asset.id, asset);
  }
  if (successfulEdges === 0) throw new Error('WHATSAPP_WABA_DISCOVERY_FAILED');
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function parseAssets(value: unknown): readonly ProviderAsset[] {
  const root = asRecord(value);
  const rows = Array.isArray(root.data) ? root.data : [];
  return rows.flatMap((value) => {
    const row = asRecord(value);
    const id = text(row.id);
    if (!id) return [];
    return [{ id, name: text(row.name) }];
  });
}

function parsePhones(value: unknown): readonly PhoneAsset[] {
  const root = asRecord(value);
  const rows = Array.isArray(root.data) ? root.data : [];
  return rows.flatMap((value) => {
    const row = asRecord(value);
    const id = text(row.id);
    if (!id) return [];
    return [
      {
        id,
        name: text(row.verified_name),
        displayPhoneNumber: text(row.display_phone_number),
      },
    ];
  });
}

function selectOne(
  candidates: readonly ProviderAsset[],
  selector: string | null,
  prefix: string,
): ProviderAsset {
  const selectedId = selector?.trim();
  if (selectedId) {
    const selected = candidates.find((candidate) => candidate.id === selectedId);
    if (!selected) throw new Error(`${prefix}_SELECTOR_NOT_FOUND`);
    return selected;
  }
  if (candidates.length === 0) throw new Error(`${prefix}_NOT_FOUND`);
  if (candidates.length !== 1) throw new Error(`${prefix}_AMBIGUOUS`);
  return candidates[0]!;
}

function selectPhone(candidates: readonly PhoneAsset[], selector: string | null): PhoneAsset {
  const selectedId = selector?.trim();
  if (selectedId) {
    const selected = candidates.find((candidate) => candidate.id === selectedId);
    if (!selected) throw new Error('WHATSAPP_PHONE_NUMBER_SELECTOR_NOT_FOUND');
    return selected;
  }
  if (candidates.length === 0) throw new Error('WHATSAPP_PHONE_NUMBER_NOT_FOUND');
  if (candidates.length !== 1) throw new Error('WHATSAPP_PHONE_NUMBER_AMBIGUOUS');
  return candidates[0]!;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
