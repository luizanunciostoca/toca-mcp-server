import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const CAMPAIGN_ID = '52622846509265';
const APPROVAL = 'APPROVED_ITACARE_REBALANCE_PLUS_1000_20260925';

const NEW_ILHEUS = '52626772028665';
const NEW_VITORIA = '52626772163265';
const NEW_ITACARE = '52626771954265';
const NEW_ITABUNA = '52626772085865';

const OLD_ITABUNA_BROAD = '52622846516065';
const OLD_ITABUNA_FEED = '52625517808465';
const OLD_ITABUNA_STORIES = '52625517821465';
const OLD_VITORIA_STORIES = '52625517841265';

const BROAD_ITABUNA_TARGET_BUDGET = 50528;
const NEW_BUDGETS: Readonly<Record<string, number>> = {
  [NEW_ILHEUS]: 30000,
  [NEW_VITORIA]: 30000,
  [NEW_ITACARE]: 20000,
};

const EXPECTED_NAMES: Readonly<Record<string, string>> = {
  [NEW_ILHEUS]: 'TESTE FEED | ILHÉUS | 18-35 | NOVOS CRIATIVOS | 25.09',
  [NEW_VITORIA]: 'TESTE FEED | VITÓRIA DA CONQUISTA | 18-35 | NOVOS CRIATIVOS | 25.09',
  [NEW_ITACARE]: 'TESTE FEED | ITACARÉ | 18-35 | NOVOS CRIATIVOS | 25.09',
  [NEW_ITABUNA]: 'TESTE FEED | ITABUNA | 18-35 | NOVOS CRIATIVOS | 25.09',
  [OLD_ITABUNA_BROAD]: 'ITABUNA | BROAD 18-44 | PURCHASE',
};

if (requiredEnv('META_ADS_ITACARE_REBALANCE_APPROVAL') !== APPROVAL) {
  throw new Error('META_ADS_ITACARE_REBALANCE_APPROVAL_MISMATCH');
}

const config = loadConfig(process.env);
const api = createMetaPublicationApiClient(config);

type AdSetSnapshot = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  lifetimeBudget: number;
  budgetRemaining: number;
};

type AdSnapshot = {
  id: string;
  name: string;
  adSetId: string;
  status: string;
  effectiveStatus: string;
};

const targetIds = new Set([
  NEW_ILHEUS,
  NEW_VITORIA,
  NEW_ITACARE,
  NEW_ITABUNA,
  OLD_ITABUNA_BROAD,
  OLD_ITABUNA_FEED,
  OLD_ITABUNA_STORIES,
  OLD_VITORIA_STORIES,
]);

console.log('META_ADS_ITACARE_REBALANCE_STAGE=PREFLIGHT');

const campaign = asRecord(
  await withRateLimitRetry('campaign-read', () =>
    api.get(CAMPAIGN_ID, { fields: 'id,name,status,effective_status,objective' }),
  ),
);
if (
  scalarString(campaign.id) !== CAMPAIGN_ID ||
  scalarString(campaign.status) !== 'ACTIVE' ||
  scalarString(campaign.objective) !== 'OUTCOME_SALES'
) {
  throw new Error('META_ADS_ITACARE_REBALANCE_CAMPAIGN_MISMATCH');
}

const allAdSets = arrayRecords(
  asRecord(
    await withRateLimitRetry('adsets-read', () =>
      api.get(CAMPAIGN_ID + '/adsets', {
        fields: 'id,name,campaign_id,status,effective_status,lifetime_budget,budget_remaining',
        limit: '100',
      }),
    ),
  ).data,
);
const allAds = arrayRecords(
  asRecord(
    await withRateLimitRetry('ads-read', () =>
      api.get(CAMPAIGN_ID + '/ads', {
        fields: 'id,name,adset_id,status,effective_status',
        limit: '500',
      }),
    ),
  ).data,
);

const before = new Map<string, AdSetSnapshot>();
for (const row of allAdSets) {
  const id = scalarString(row.id);
  if (!targetIds.has(id)) continue;
  before.set(id, snapshotAdSet(row));
}
for (const id of targetIds) {
  if (!before.has(id)) throw new Error('META_ADS_ITACARE_REBALANCE_ADSET_MISSING_' + id);
}

for (const [id, expectedName] of Object.entries(EXPECTED_NAMES)) {
  if (before.get(id)?.name !== expectedName) {
    throw new Error('META_ADS_ITACARE_REBALANCE_NAME_MISMATCH_' + id);
  }
}

const adsByAdSet = new Map<string, AdSnapshot[]>();
for (const row of allAds) {
  const ad = snapshotAd(row);
  const list = adsByAdSet.get(ad.adSetId) ?? [];
  list.push(ad);
  adsByAdSet.set(ad.adSetId, list);
}
for (const id of [NEW_ILHEUS, NEW_VITORIA, NEW_ITACARE]) {
  const ads = adsByAdSet.get(id) ?? [];
  if (ads.length !== 5) throw new Error('META_ADS_ITACARE_REBALANCE_NEW_AD_COUNT_' + id);
}

if (before.get(OLD_ITABUNA_BROAD)!.lifetimeBudget < BROAD_ITABUNA_TARGET_BUDGET) {
  throw new Error('META_ADS_ITACARE_REBALANCE_BROAD_BUDGET_BELOW_TARGET');
}

const originalAdStatuses = new Map<string, string>();
for (const id of [NEW_ILHEUS, NEW_VITORIA, NEW_ITACARE]) {
  for (const ad of adsByAdSet.get(id) ?? []) originalAdStatuses.set(ad.id, ad.status);
}

const mutatedAdSets = new Set<string>();
const mutatedAds = new Set<string>();

try {
  console.log('META_ADS_ITACARE_REBALANCE_STAGE=MUTATE');

  await setAdSetStatus(OLD_ITABUNA_FEED, 'PAUSED');
  await setAdSetStatus(OLD_ITABUNA_STORIES, 'PAUSED');
  await setAdSetStatus(OLD_VITORIA_STORIES, 'PAUSED');

  for (const [id, budget] of Object.entries(NEW_BUDGETS)) {
    await setAdSetBudget(id, budget);
  }
  await setAdSetStatus(NEW_ITABUNA, 'PAUSED');
  await setAdSetBudget(OLD_ITABUNA_BROAD, BROAD_ITABUNA_TARGET_BUDGET);

  for (const id of [NEW_ILHEUS, NEW_VITORIA, NEW_ITACARE]) {
    for (const ad of adsByAdSet.get(id) ?? []) {
      await setAdStatus(ad.id, 'ACTIVE');
    }
    await setAdSetStatus(id, 'ACTIVE');
  }
  await setAdSetStatus(OLD_ITABUNA_BROAD, 'ACTIVE');

  console.log('META_ADS_ITACARE_REBALANCE_STAGE=READBACK');
  await sleep(2000);

  const finalAdSets = await readTargetAdSets();
  const finalAds = await readTargetAds();

  assertFinal(finalAdSets, finalAds);

  console.log(
    'META_ADS_ITACARE_REBALANCE_RESULT=' +
      JSON.stringify({
        status: 'REBALANCED_AND_ACTIVATED',
        providerMutationExecuted: true,
        approvedIncrementMinor: 100000,
        newChallengerBudgetMinor: 80000,
        broadItabunaAdditionalMinor: 20000,
        broadItabunaNewLifetimeBudgetMinor: BROAD_ITABUNA_TARGET_BUDGET,
        adSets: Array.from(finalAdSets.values()),
        activeNewAds: finalAds.filter(
          (ad) =>
            [NEW_ILHEUS, NEW_VITORIA, NEW_ITACARE].includes(ad.adSetId) && ad.status === 'ACTIVE',
        ),
      }),
  );
} catch (error) {
  console.error('META_ADS_ITACARE_REBALANCE_STAGE=ROLLBACK');
  await rollback();
  throw error;
}

async function setAdSetStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
  const current = before.get(id);
  if (current?.status === status) return;
  await pacedPost(id, { status }, 'adset-status-' + id);
  mutatedAdSets.add(id);
}

async function setAdSetBudget(id: string, budget: number): Promise<void> {
  const current = before.get(id);
  if (current?.lifetimeBudget === budget) return;
  await pacedPost(id, { lifetime_budget: String(budget) }, 'adset-budget-' + id);
  mutatedAdSets.add(id);
}

async function setAdStatus(id: string, status: 'ACTIVE' | 'PAUSED'): Promise<void> {
  if (originalAdStatuses.get(id) === status) return;
  await pacedPost(id, { status }, 'ad-status-' + id);
  mutatedAds.add(id);
}

async function pacedPost(id: string, values: Record<string, string>, label: string): Promise<void> {
  await withRateLimitRetry(label, () => api.post(id, values));
  await sleep(650);
}

async function readTargetAdSets(): Promise<Map<string, AdSetSnapshot>> {
  const rows = arrayRecords(
    asRecord(
      await withRateLimitRetry('final-adsets-read', () =>
        api.get(CAMPAIGN_ID + '/adsets', {
          fields: 'id,name,campaign_id,status,effective_status,lifetime_budget,budget_remaining',
          limit: '100',
        }),
      ),
    ).data,
  );
  const map = new Map<string, AdSetSnapshot>();
  for (const row of rows) {
    const id = scalarString(row.id);
    if (targetIds.has(id)) map.set(id, snapshotAdSet(row));
  }
  return map;
}

async function readTargetAds(): Promise<AdSnapshot[]> {
  const rows = arrayRecords(
    asRecord(
      await withRateLimitRetry('final-ads-read', () =>
        api.get(CAMPAIGN_ID + '/ads', {
          fields: 'id,name,adset_id,status,effective_status',
          limit: '500',
        }),
      ),
    ).data,
  );
  return rows
    .map(snapshotAd)
    .filter((ad) => [NEW_ILHEUS, NEW_VITORIA, NEW_ITACARE].includes(ad.adSetId));
}

function assertFinal(adSets: Map<string, AdSetSnapshot>, ads: AdSnapshot[]): void {
  const budgets: Readonly<Record<string, number>> = {
    ...NEW_BUDGETS,
    [OLD_ITABUNA_BROAD]: BROAD_ITABUNA_TARGET_BUDGET,
  };

  for (const [id, budget] of Object.entries(budgets)) {
    const row = adSets.get(id);
    if (!row || row.status !== 'ACTIVE' || row.lifetimeBudget !== budget) {
      throw new Error('META_ADS_ITACARE_REBALANCE_FINAL_' + id);
    }
  }
  for (const id of [OLD_ITABUNA_FEED, OLD_ITABUNA_STORIES, OLD_VITORIA_STORIES, NEW_ITABUNA]) {
    if (adSets.get(id)?.status !== 'PAUSED') {
      throw new Error('META_ADS_ITACARE_REBALANCE_PAUSE_FINAL_' + id);
    }
  }
  if (ads.length !== 15 || ads.some((ad) => ad.status !== 'ACTIVE')) {
    throw new Error('META_ADS_ITACARE_REBALANCE_FINAL_ADS');
  }
}

async function rollback(): Promise<void> {
  for (const adId of mutatedAds) {
    const status = originalAdStatuses.get(adId);
    if (!status) continue;
    try {
      await pacedPost(adId, { status }, 'rollback-ad-' + adId);
    } catch (error) {
      console.error('META_ADS_ITACARE_REBALANCE_ROLLBACK_AD_FAILED', adId, normalizeError(error));
    }
  }
  for (const id of mutatedAdSets) {
    const snap = before.get(id);
    if (!snap) continue;
    try {
      await pacedPost(
        id,
        { lifetime_budget: String(snap.lifetimeBudget), status: snap.status },
        'rollback-adset-' + id,
      );
    } catch (error) {
      console.error('META_ADS_ITACARE_REBALANCE_ROLLBACK_ADSET_FAILED', id, normalizeError(error));
    }
  }
}

async function withRateLimitRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const waits = [0, 30000, 60000];
  let last: unknown;
  for (let attempt = 0; attempt < waits.length; attempt += 1) {
    if (waits[attempt]! > 0) {
      console.log('META_ADS_ITACARE_REBALANCE_RATE_LIMIT_BACKOFF=' + label + ':' + waits[attempt]);
      await sleep(waits[attempt]);
    }
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isRateLimit(error) || attempt === waits.length - 1) throw error;
    }
  }
  throw last;
}

function isRateLimit(error: unknown): boolean {
  const message = normalizeError(error);
  return message.includes('META_CODE_17') || message.includes('2446079');
}

function snapshotAdSet(row: Record<string, unknown>): AdSetSnapshot {
  if (scalarString(row.campaign_id) !== CAMPAIGN_ID) {
    throw new Error('META_ADS_ITACARE_REBALANCE_ADSET_CAMPAIGN_MISMATCH');
  }
  return {
    id: requiredScalar(row.id, 'ADSET_ID'),
    name: scalarString(row.name),
    status: scalarString(row.status),
    effectiveStatus: scalarString(row.effective_status),
    lifetimeBudget: num(row.lifetime_budget),
    budgetRemaining: num(row.budget_remaining),
  };
}

function snapshotAd(row: Record<string, unknown>): AdSnapshot {
  return {
    id: requiredScalar(row.id, 'AD_ID'),
    name: scalarString(row.name),
    adSetId: requiredScalar(row.adset_id, 'ADSET_ID'),
    status: scalarString(row.status),
    effectiveStatus: scalarString(row.effective_status),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function requiredScalar(value: unknown, label: string): string {
  const result = scalarString(value);
  if (!result) throw new Error('META_ADS_ITACARE_REBALANCE_' + label + '_MISSING');
  return result;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('META_ADS_ITACARE_REBALANCE_NUMERIC_FIELD_INVALID');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + '_REQUIRED');
  return value;
}
