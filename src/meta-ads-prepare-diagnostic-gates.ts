import { loadConfig } from './config.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const config = loadConfig(process.env);
const gate = requiredEnv('META_ADS_DIAGNOSTIC_GATE');
const accountId = requiredEnv('META_ADS_SMOKE_ACCOUNT_ID');
const currency = requiredEnv('META_ADS_SMOKE_CURRENCY');
const pageId = requiredEnv('META_ADS_SMOKE_PAGE_ID');
const api = createMetaPublicationApiClient(config);

if (gate === 'PERMISSIONS') {
  const response = asRecord(await api.get('me/permissions'));
  const data = Array.isArray(response.data) ? response.data : [];
  const granted = data
    .map(asRecord)
    .filter((item) => item.status === 'granted')
    .map((item) => scalarString(item.permission))
    .filter(Boolean)
    .sort();
  if (!granted.includes('ads_management')) {
    throw new Error('META_ADS_DIAGNOSTIC_ADS_MANAGEMENT_REQUIRED');
  }
  console.log(`META_ADS_DIAGNOSTIC_PERMISSIONS_OK=${granted.join(',')}`);
} else if (gate === 'ACCOUNT') {
  const account = asRecord(
    await api.get(`act_${accountId}`, { fields: 'id,name,currency,account_status' }),
  );
  if (!scalarString(account.id).endsWith(accountId)) {
    throw new Error('META_ADS_DIAGNOSTIC_ACCOUNT_ID_MISMATCH');
  }
  if (scalarString(account.currency) !== currency) {
    throw new Error('META_ADS_DIAGNOSTIC_CURRENCY_MISMATCH');
  }
  console.log(`META_ADS_DIAGNOSTIC_ACCOUNT_OK=${accountId}:${currency}`);
} else if (gate === 'GEO') {
  const queries = ['Morro de São Paulo', 'Morro de Sao Paulo'];
  const matches = new Map<string, Readonly<Record<string, unknown>>>();
  for (const query of queries) {
    const response = asRecord(
      await api.get('search', {
        type: 'adgeolocation',
        location_types: JSON.stringify(['city']),
        q: query,
        country_code: 'BR',
      }),
    );
    const data = Array.isArray(response.data) ? response.data : [];
    for (const itemValue of data) {
      const item = asRecord(itemValue);
      const key = scalarString(item.key);
      const name = normalizeText(scalarString(item.name));
      const countryCode = scalarString(item.country_code).toUpperCase();
      if (
        key &&
        name.includes('morro de sao paulo') &&
        (countryCode === 'BR' || countryCode === 'BRA' || countryCode === '')
      ) {
        matches.set(key, item);
      }
    }
  }
  if (matches.size === 0) throw new Error('META_ADS_DIAGNOSTIC_GEO_NOT_FOUND');
  if (matches.size > 1) throw new Error('META_ADS_DIAGNOSTIC_GEO_AMBIGUOUS');
  const [key] = matches.keys();
  console.log(`META_ADS_DIAGNOSTIC_GEO_OK=${key}`);
} else if (gate === 'CREATIVE') {
  const response = asRecord(
    await api.get(`act_${accountId}/adcreatives`, {
      fields: 'id,name,object_story_spec',
      limit: '100',
    }),
  );
  const data = Array.isArray(response.data) ? response.data : [];
  const eligible = data
    .map(asRecord)
    .filter((item) => {
      const spec = asRecord(item.object_story_spec);
      if (!scalarString(item.id) || scalarString(spec.page_id) !== pageId) return false;
      return Boolean(spec.link_data || spec.photo_data || spec.video_data || spec.template_data);
    });
  if (eligible.length === 0) throw new Error('META_ADS_DIAGNOSTIC_SOURCE_CREATIVE_NOT_FOUND');
  console.log(`META_ADS_DIAGNOSTIC_CREATIVE_OK=${eligible.length}`);
} else {
  throw new Error('META_ADS_DIAGNOSTIC_GATE_UNSUPPORTED');
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

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
