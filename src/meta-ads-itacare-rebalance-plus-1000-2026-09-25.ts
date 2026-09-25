import { loadConfig } from './config.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const ACCOUNT_ID = '311793958882290';
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

const EXPECTED = {
  [NEW_ILHEUS]: { name: 'TESTE FEED | ILHÉUS | 18-35 | NOVOS CRIATIVOS | 25.09', budget: 30000, activate: true },
  [NEW_VITORIA]: { name: 'TESTE FEED | VITÓRIA DA CONQUISTA | 18-35 | NOVOS CRIATIVOS | 25.09', budget: 30000, activate: true },
  [NEW_ITACARE]: { name: 'TESTE FEED | ITACARÉ | 18-35 | NOVOS CRIATIVOS | 25.09', budget: 20000, activate: true },
  [NEW_ITABUNA]: { name: 'TESTE FEED | ITABUNA | 18-35 | NOVOS CRIATIVOS | 25.09', budget: 47249, activate: false },
} as const;

if (requiredEnv('META_ADS_ITACARE_REBALANCE_APPROVAL') !== APPROVAL) {
  throw new Error('META_ADS_ITACARE_REBALANCE_APPROVAL_MISMATCH');
}

const config = loadConfig(process.env);
const api = createMetaPublicationApiClient(config);

type Snapshot = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  lifetimeBudget: number;
  budgetRemaining: number;
};

const ids = [
  NEW_ILHEUS,
  NEW_VITORIA,
  NEW_ITACARE,
  NEW_ITABUNA,
  OLD_ITABUNA_BROAD,
  OLD_ITABUNA_FEED,
  OLD_ITABUNA_STORIES,
  OLD_VITORIA_STORIES,
] as const;

const before = new Map<string, Snapshot>();
for (const id of ids) before.set(id, await readAdSet(id));

const campaign = await api.get(CAMPAIGN_ID, { fields: 'id,name,status,effective_status,objective' }) as Record<string, unknown>;
if (String(campaign.id) !== CAMPAIGN_ID || String(campaign.status) !== 'ACTIVE' || String(campaign.objective) !== 'OUTCOME_SALES') {
  throw new Error('META_ADS_ITACARE_REBALANCE_CAMPAIGN_MISMATCH');
}

for (const [id, rule] of Object.entries(EXPECTED)) {
  const snap = before.get(id);
  if (!snap || snap.name !== rule.name) throw new Error('META_ADS_ITACARE_REBALANCE_NEW_ADSET_MISMATCH_' + id);
  if (id !== NEW_ITABUNA && snap.status !== 'PAUSED') throw new Error('META_ADS_ITACARE_REBALANCE_NEW_ADSET_NOT_PAUSED_' + id);
}

for (const id of [OLD_ITABUNA_FEED, OLD_ITABUNA_STORIES, OLD_VITORIA_STORIES]) {
  const snap = before.get(id)!;
  if (!snap.name) throw new Error('META_ADS_ITACARE_REBALANCE_OLD_ADSET_MISSING_' + id);
}

const broad = before.get(OLD_ITABUNA_BROAD)!;
if (broad.name !== 'ITABUNA | BROAD 18-44 | PURCHASE') {
  throw new Error('META_ADS_ITACARE_REBALANCE_BROAD_MISMATCH');
}
const broadSpent = broad.lifetimeBudget - broad.budgetRemaining;
if (broadSpent < 0) throw new Error('META_ADS_ITACARE_REBALANCE_BROAD_SPEND_INVALID');
const broadNewBudget = broadSpent + 20000;

const originalAds = new Map<string, { id: string; status: string }[]>();
for (const id of [NEW_ILHEUS, NEW_VITORIA, NEW_ITACARE]) {
  const rows = await readAds(id);
  if (rows.length !== 5) throw new Error('META_ADS_ITACARE_REBALANCE_NEW_AD_COUNT_' + id);
  originalAds.set(id, rows.map((r) => ({ id: String(r.id), status: String(r.status) })));
}

let mutationStarted = false;
try {
  // Pause proven non-converters first.
  for (const id of [OLD_ITABUNA_FEED, OLD_ITABUNA_STORIES, OLD_VITORIA_STORIES]) {
    await api.post(id, { status: 'PAUSED' });
    mutationStarted = true;
  }

  // New challenger budgets: exactly R$800 total.
  await api.post(NEW_ILHEUS, { lifetime_budget: '30000' });
  await api.post(NEW_VITORIA, { lifetime_budget: '30000' });
  await api.post(NEW_ITACARE, { lifetime_budget: '20000' });

  // Keep new Itabuna challenger paused and untouched.
  await api.post(NEW_ITABUNA, { status: 'PAUSED' });

  // Broad Itabuna gets exactly R$200 additional capacity over observed spent.
  await api.post(OLD_ITABUNA_BROAD, { lifetime_budget: String(broadNewBudget) });

  // Activate ads first while parent remains paused, then activate parent.
  for (const id of [NEW_ILHEUS, NEW_VITORIA, NEW_ITACARE]) {
    const ads = await readAds(id);
    for (const ad of ads) await api.post(String(ad.id), { status: 'ACTIVE' });
    await api.post(id, { status: 'ACTIVE' });
  }

  await api.post(OLD_ITABUNA_BROAD, { status: 'ACTIVE' });

  const after = new Map<string, Snapshot>();
  for (const id of ids) after.set(id, await readAdSet(id));

  assertFinal(after, broadNewBudget);

  const finalAds: Record<string, unknown>[] = [];
  for (const id of [NEW_ILHEUS, NEW_VITORIA, NEW_ITACARE]) {
    const ads = await readAds(id);
    if (ads.length !== 5 || ads.some((a) => String(a.status) !== 'ACTIVE')) {
      throw new Error('META_ADS_ITACARE_REBALANCE_AD_READBACK_' + id);
    }
    finalAds.push(...ads.map((a) => ({ id: a.id, adset_id: id, status: a.status, effective_status: a.effective_status })));
  }

  console.log('META_ADS_ITACARE_REBALANCE_RESULT=' + JSON.stringify({
    status: 'REBALANCED_AND_ACTIVATED',
    providerMutationExecuted: true,
    approvedIncrementMinor: 100000,
    newChallengerBudgetMinor: 80000,
    broadItabunaAdditionalMinor: 20000,
    broadItabunaNewLifetimeBudgetMinor: broadNewBudget,
    adSets: Array.from(after.values()),
    activeNewAds: finalAds,
  }));
} catch (error) {
  if (mutationStarted) {
    for (const [id, snap] of before) {
      try {
        await api.post(id, { lifetime_budget: String(snap.lifetimeBudget), status: snap.status });
      } catch {}
    }
    for (const [, ads] of originalAds) {
      for (const ad of ads) {
        try { await api.post(ad.id, { status: ad.status }); } catch {}
      }
    }
  }
  throw error;
}

function assertFinal(after: Map<string, Snapshot>, broadBudget: number): void {
  const expectedBudgets: Record<string, number> = {
    [NEW_ILHEUS]: 30000,
    [NEW_VITORIA]: 30000,
    [NEW_ITACARE]: 20000,
    [OLD_ITABUNA_BROAD]: broadBudget,
  };
  for (const [id, budget] of Object.entries(expectedBudgets)) {
    const s = after.get(id)!;
    if (s.lifetimeBudget !== budget || s.status !== 'ACTIVE') throw new Error('META_ADS_ITACARE_REBALANCE_FINAL_' + id);
  }
  for (const id of [OLD_ITABUNA_FEED, OLD_ITABUNA_STORIES, OLD_VITORIA_STORIES, NEW_ITABUNA]) {
    if (after.get(id)!.status !== 'PAUSED') throw new Error('META_ADS_ITACARE_REBALANCE_PAUSE_FINAL_' + id);
  }
}

async function readAdSet(id: string): Promise<Snapshot> {
  const r = await api.get(id, {
    fields: 'id,name,campaign_id,status,effective_status,lifetime_budget,budget_remaining',
  }) as Record<string, unknown>;
  if (String(r.campaign_id) !== CAMPAIGN_ID) throw new Error('META_ADS_ITACARE_REBALANCE_CAMPAIGN_' + id);
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    status: String(r.status ?? ''),
    effectiveStatus: String(r.effective_status ?? ''),
    lifetimeBudget: num(r.lifetime_budget),
    budgetRemaining: num(r.budget_remaining),
  };
}

async function readAds(adSetId: string): Promise<Record<string, unknown>[]> {
  const r = await api.get(CAMPAIGN_ID + '/ads', {
    fields: 'id,name,adset_id,status,effective_status',
    filtering: JSON.stringify([{ field: 'adset.id', operator: 'EQUAL', value: adSetId }]),
    limit: '100',
  }) as Record<string, unknown>;
  return Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error('META_ADS_ITACARE_REBALANCE_NUMERIC_FIELD_INVALID');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + '_REQUIRED');
  return value;
}
