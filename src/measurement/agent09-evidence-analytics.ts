/**
 * AGENTE 09: deterministic, read-only analytical projection.
 * Inputs MUST be supplied by canonical provider/Core readers. This module never fetches,
 * schedules, publishes, sends, mutates accounts, or promotes a capability to runtime proof.
 */
export type Agent09MetricState = 'PROVEN' | 'METRICS_NOT_PROVEN';
export type Agent09EvidenceSource = 'TOCA_CORE_META_GRAPH' | 'TOCA_CORE_CRM' | 'TOCA_CORE_INSTAGRAM';

export interface Agent09Window {
  readonly since: string; // YYYY-MM-DD, inclusive
  readonly until: string; // YYYY-MM-DD, inclusive
  readonly timezone: 'America/Bahia';
}

export interface Agent09MetaRow {
  readonly level: 'campaign' | 'adset' | 'ad';
  readonly id: string;
  readonly campaignId: string;
  readonly dateStart: string;
  readonly dateStop: string;
  readonly deliveryStatus: 'ACTIVE' | 'PAUSED' | 'OTHER';
  /** Independently read from the canonical Core delivery/status provider, not inferred from Insights. */
  readonly deliveryStatusReadbackVerified: boolean;
  readonly impressions: number | null;
  readonly clicks: number | null;
  readonly reach: number | null;
  readonly spend: number | null; // real units, not minor units; Graph currency context required
}

export interface Agent09MetaEvidence {
  readonly source: 'TOCA_CORE_META_GRAPH';
  readonly capability: 'meta_ads.insights.get';
  readonly accountId: string;
  readonly currency: string;
  readonly window: Agent09Window;
  readonly observedAt: string;
  readonly adsReadVerified: boolean;
  readonly gatewayVerified: boolean;
  readonly providerReadbackVerified: boolean;
  /** null = missing/malformed envelope; [] = a real empty data array, NOT proved zero. */
  readonly rows: readonly Agent09MetaRow[] | null;
  readonly evidence: readonly string[];
}

export interface Agent09CrmEvidence {
  readonly source: 'TOCA_CORE_CRM';
  readonly accountId: string;
  readonly campaignId: string;
  readonly correlationId: string;
  readonly currency: string;
  readonly window: Agent09Window;
  readonly observedAt: string;
  readonly providerReadbackVerified: boolean;
  readonly leads: number | null;
  readonly revenue: number | null;
  /** Revenue is permitted only after distinct CRM + financial reconciliation. */
  readonly financeReconciled: boolean;
  /** Independent CRM/finance reconciliation receipt, not Meta action attribution. */
  readonly financeEvidence: readonly string[];
  readonly evidence: readonly string[];
}

export interface Agent09OrganicEvidence {
  readonly source: 'TOCA_CORE_INSTAGRAM';
  readonly format: 'FEED' | 'STORY' | 'REEL';
  readonly accountId: string;
  readonly mediaId: string;
  readonly window: Agent09Window;
  readonly observedAt: string;
  readonly providerReadbackVerified: boolean;
  readonly reach: number | null;
  readonly engagement: number | null;
  readonly evidence: readonly string[];
}

export interface Agent09PublicationEvidence {
  readonly contentItemId: string;
  readonly expectedAccountId: string;
  readonly providerAccountId: string | null;
  readonly scheduledAt: string; // exact UTC/offset instant; no timezone-free local strings
  readonly status: string; // content-registry status alone is not provider proof
  readonly providerMediaId: string | null;
  readonly permalink: string | null;
  readonly providerReadbackVerified: boolean;
  readonly evidence: readonly string[];
}

export interface Agent09Mission {
  readonly authorized: boolean;
  readonly routeId: string;
  readonly correlationId: string;
  readonly ownerId: string;
  readonly accountId: string;
  readonly campaignId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly evidence: readonly string[];
}

export interface Agent09AnalysisInput {
  readonly now: string;
  readonly meta: Agent09MetaEvidence | null;
  readonly crm: Agent09CrmEvidence | null;
  readonly organic: readonly Agent09OrganicEvidence[];
  readonly publications: readonly Agent09PublicationEvidence[];
  readonly mission: Agent09Mission | null;
  readonly previousFingerprint?: string | null;
}

export interface Agent09Recommendation {
  readonly code:
    | 'PUBLICATION_PROVIDER_RECONCILIATION'
    | 'META_IDENTITY_OR_EVIDENCE_GAP'
    | 'ACTIVE_ZERO_SPEND_RECONCILIATION'
    | 'CAMPAIGN_PERFORMANCE_REVIEW';
  readonly priority: 'P0' | 'P1' | 'P2';
  /** Stable affected entity/date identity, independent of fetch receipt IDs. */
  readonly incidentKey: string;
  readonly fact: string;
  readonly risk: string;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly decision: string;
  readonly rollback: string;
  readonly evidence: readonly string[];
}

export interface Agent09Analysis {
  readonly mode: 'NORMAL' | 'AG01_CAMPAIGN';
  readonly metaState: Agent09MetricState;
  readonly metaReason: string | null;
  readonly organicState: Agent09MetricState;
  /** Per-media only; no cross-media summation of unique reach. */
  readonly organicMetrics: readonly {format: 'FEED' | 'STORY' | 'REEL'; mediaId: string; reach: number | null; engagement: number | null; engagementRate: number | null}[];
  readonly ctr: number | null;
  readonly frequency: number | null;
  readonly spend: number | null;
  readonly cpl: number | null;
  readonly revenue: number | null;
  readonly roas: number | null;
  readonly currency: string | null;
  readonly sampleRows: number;
  readonly publicationConfirmed: number;
  readonly publicationUnreconciled: number;
  readonly fingerprint: string | null;
  /** At most one new recommendation. Null means silent NO-OP. */
  readonly recommendation: Agent09Recommendation | null;
}

function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function validInstant(value: string): boolean {
  return /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function validWindow(w: Agent09Window): boolean {
  return w.timezone === 'America/Bahia' && validDate(w.since) &&
    validDate(w.until) && w.since <= w.until;
}

function sameWindow(a: Agent09Window, b: Agent09Window): boolean {
  return a.since === b.since && a.until === b.until && a.timezone === b.timezone;
}

function hasEvidence(evidence: readonly string[]): boolean {
  return evidence.length > 0 && evidence.every(e => typeof e === 'string' && e.trim().length > 0);
}

function fresh(observedAt: string, nowMs: number): boolean {
  if (!validInstant(observedAt)) return false;
  const delta = nowMs - Date.parse(observedAt);
  return delta >= 0 && delta <= 3 * 60 * 60 * 1000;
}

function nonnegative(n: number | null): boolean {
  return n === null || (Number.isFinite(n) && n >= 0);
}

function nonnegativeInteger(n: number | null): boolean {
  return n === null || (Number.isSafeInteger(n) && n >= 0);
}

function sumComplete(rows: readonly Agent09MetaRow[], field: 'impressions' | 'clicks' | 'reach' | 'spend'): number | null {
  if (rows.length === 0 || rows.some(r => r[field] === null)) return null;
  return rows.reduce((total, row) => total + (row[field] ?? 0), 0);
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

function dedupeMeta(rows: readonly Agent09MetaRow[], window: Agent09Window): readonly Agent09MetaRow[] | null {
  const distinct = new Map<string, Agent09MetaRow>();
  for (const row of rows) {
    if (!row.id || !row.campaignId || !['campaign', 'adset', 'ad'].includes(row.level) ||
        !['ACTIVE', 'PAUSED', 'OTHER'].includes(row.deliveryStatus) ||
        typeof row.deliveryStatusReadbackVerified !== 'boolean' ||
        row.dateStart !== window.since || row.dateStop !== window.until ||
        !nonnegativeInteger(row.impressions) || !nonnegativeInteger(row.clicks) ||
        !nonnegativeInteger(row.reach) || !nonnegative(row.spend) ||
        (row.reach !== null && row.impressions !== null && row.reach > row.impressions)) return null;
    const key = `${row.level}:${row.id}:${row.dateStart}:${row.dateStop}`;
    const prior = distinct.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) return null;
    distinct.set(key, row);
  }
  const out = [...distinct.values()];
  // Summing account, campaign and ad-set levels together would double-count spend.
  if (new Set(out.map(r => r.level)).size > 1) return null;
  return out;
}

function verifiedPublication(p: Agent09PublicationEvidence): boolean {
  return p.providerReadbackVerified && !!p.expectedAccountId.trim() &&
    p.expectedAccountId === p.providerAccountId && !!p.providerMediaId?.trim() &&
    !!p.permalink?.trim() && hasEvidence(p.evidence);
}

function verifiedMission(m: Agent09Mission | null, nowMs: number, accountId: string | null): m is Agent09Mission {
  return !!m && m.authorized && !!m.routeId.trim() && !!m.correlationId.trim() &&
    !!m.ownerId.trim() && !!m.accountId.trim() && !!m.campaignId.trim() &&
    m.accountId === accountId && hasEvidence(m.evidence) &&
    validInstant(m.startsAt) && validInstant(m.endsAt) &&
    Date.parse(m.startsAt) <= nowMs && nowMs <= Date.parse(m.endsAt);
}

function fingerprintFor(r: Agent09Recommendation): string {
  const stable = JSON.stringify([r.code, r.priority, r.incidentKey, r.fact]);
  // Deterministic non-cryptographic dedupe token; not a security/idempotency key.
  let a = 2166136261;
  let b = 5381;
  for (const char of stable) {
    a = Math.imul(a ^ char.charCodeAt(0), 16777619);
    b = (Math.imul(b, 33) ^ char.charCodeAt(0)) | 0;
  }
  return `${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

/** No external I/O; this is NOT an AG-01 to ChatGPT Tasks bridge. */
export function analyzeAgent09Evidence(input: Agent09AnalysisInput): Agent09Analysis {
  if (!validInstant(input.now)) throw new Error('AGENT09_NOW_MUST_BE_OFFSET_AWARE');
  const nowMs = Date.parse(input.now);
  const meta = input.meta;
  let metaReason: string | null = 'META_CORE_GATEWAY_OR_PROVIDER_NOT_VERIFIED';
  let rows: readonly Agent09MetaRow[] = [];
  if (meta && meta.source === 'TOCA_CORE_META_GRAPH' &&
      meta.capability === 'meta_ads.insights.get' &&
      meta.adsReadVerified && meta.gatewayVerified && meta.providerReadbackVerified &&
      !!meta.accountId.trim() && !!meta.currency.trim() && validWindow(meta.window) &&
      fresh(meta.observedAt, nowMs) && hasEvidence(meta.evidence)) {
    if (meta.rows === null) metaReason = 'META_ENVELOPE_MISSING';
    else if (meta.rows.length === 0) metaReason = 'META_VALID_EMPTY_ROWS_NOT_ZERO';
    else {
      const normalized = dedupeMeta(meta.rows, meta.window);
      if (normalized === null) metaReason = 'META_ROWS_CONFLICT_SCOPE_OR_FORMAT';
      else {
        rows = normalized;
        metaReason = null;
      }
    }
  }
  const metaState: Agent09MetricState = metaReason === null ? 'PROVEN' : 'METRICS_NOT_PROVEN';
  const currency = metaState === 'PROVEN' ? meta!.currency : null;
  const impressions = metaState === 'PROVEN' ? sumComplete(rows, 'impressions') : null;
  const clicks = metaState === 'PROVEN' ? sumComplete(rows, 'clicks') : null;
  const reach = metaState === 'PROVEN' ? sumComplete(rows, 'reach') : null;
  const spend = metaState === 'PROVEN' ? sumComplete(rows, 'spend') : null;
  const ctr = ratio(clicks, impressions);
  // Cross-row reach cannot be summed (the same person could appear in multiple campaigns).
  const frequency = rows.length === 1 ? ratio(impressions, reach) : null;
  const mission = verifiedMission(input.mission, nowMs, meta?.accountId ?? null) ? input.mission : null;
  const campaignId = rows.length === 1 ? rows[0]!.campaignId : null;
  const crm = input.crm;
  const crmVerified = !!(crm && metaState === 'PROVEN' && campaignId &&
    crm.source === 'TOCA_CORE_CRM' && crm.providerReadbackVerified &&
    crm.accountId === meta!.accountId && crm.campaignId === campaignId &&
    !!crm.correlationId.trim() && crm.currency === meta!.currency &&
    sameWindow(crm.window, meta!.window) && fresh(crm.observedAt, nowMs) &&
    hasEvidence(crm.evidence) && nonnegativeInteger(crm.leads) && nonnegative(crm.revenue));
  const leads = crmVerified ? crm!.leads : null;
  const cpl = ratio(spend, leads);
  const revenue = crmVerified && crm!.financeReconciled && hasEvidence(crm!.financeEvidence) && crm!.revenue !== null &&
    (!mission || (mission.campaignId === campaignId && mission.correlationId === crm!.correlationId))
      ? crm!.revenue : null;
  const roas = ratio(revenue, spend);

  const verifiedOrganic = input.organic.filter(o =>
    o.source === 'TOCA_CORE_INSTAGRAM' && o.providerReadbackVerified &&
    !!o.accountId.trim() && !!o.mediaId.trim() && validWindow(o.window) &&
    fresh(o.observedAt, nowMs) && hasEvidence(o.evidence) &&
    nonnegativeInteger(o.reach) && nonnegativeInteger(o.engagement));
  const organicById = new Map<string, Agent09OrganicEvidence>();
  const organicConflicts = new Set<string>();
  for (const o of verifiedOrganic) {
    const key = `${o.accountId}:${o.format}:${o.mediaId}:${o.window.since}:${o.window.until}`;
    if (organicConflicts.has(key)) continue;
    const prior = organicById.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(o)) {
      // Conflicting provider observations must not be merged or counted as two posts.
      organicById.delete(key);
      organicConflicts.add(key);
      continue;
    }
    organicById.set(key, o);
  }
  const organicMetrics = [...organicById.values()].map(o => ({
    format: o.format, mediaId: o.mediaId, reach: o.reach,
    engagement: o.engagement, engagementRate: ratio(o.engagement, o.reach),
  }));
  const organicState: Agent09MetricState = organicMetrics.length > 0 ? 'PROVEN' : 'METRICS_NOT_PROVEN';
  const published = new Set<string>();
  const pending = new Set<string>();
  const pendingEvidence = new Set<string>();
  const slotDue = new Map<string, number>();
  const slotProviders = new Map<string, Set<string>>();
  const providerSlots = new Map<string, Set<string>>();
  for (const p of input.publications) {
    if (!p.contentItemId.trim() || !validInstant(p.scheduledAt)) continue;
    const key = `${p.contentItemId}:${p.scheduledAt}`;
    slotDue.set(key, Date.parse(p.scheduledAt));
    if (verifiedPublication(p)) {
      const mediaKey = `${p.providerAccountId}:${p.providerMediaId}`;
      const mediaIds = slotProviders.get(key) ?? new Set<string>();
      mediaIds.add(mediaKey);
      slotProviders.set(key, mediaIds);
      const slotKeys = providerSlots.get(mediaKey) ?? new Set<string>();
      slotKeys.add(key);
      providerSlots.set(mediaKey, slotKeys);
      published.add(key);
      pending.delete(key);
      continue;
    }
    if (Date.parse(p.scheduledAt) < nowMs && !published.has(key)) {
      pending.add(key);
      for (const e of p.evidence) if (e.trim()) pendingEvidence.add(e);
    }
  }

  // A media ID reused by different slots, or multiple media IDs claimed by one slot,
  // cannot prove independent publications; fail closed instead of double-counting.
  for (const [key, mediaIds] of slotProviders) {
    const conflict = mediaIds.size > 1 ||
      [...mediaIds].some(mediaKey => (providerSlots.get(mediaKey)?.size ?? 0) > 1);
    if (conflict) {
      published.delete(key);
      if ((slotDue.get(key) ?? Number.POSITIVE_INFINITY) < nowMs) pending.add(key);
      for (const p of input.publications) {
        if (`${p.contentItemId}:${p.scheduledAt}` === key)
          for (const e of p.evidence) if (e.trim()) pendingEvidence.add(e);
      }
    }
  }

  const recommendations: Agent09Recommendation[] = [];
  if (pending.size > 0) recommendations.push({
    code: 'PUBLICATION_PROVIDER_RECONCILIATION', priority: 'P0',
    incidentKey: [...pending].sort().join('|'),
    fact: `${pending.size} past-due content slots have no verified provider ID/permalink in this evidence set; publication outcome is UNKNOWN.`,
    risk: 'A ledger gap can conceal a failed post or a successful post whose ACK was not persisted.',
    confidence: 'HIGH', decision: 'Request GET-only readback from the canonical publisher; do not retry or backfill without reconciliation.',
    rollback: 'No write proposed; preserve existing slots and reservations.',
    evidence: [...pendingEvidence].sort(),
  });
  if (metaState !== 'PROVEN') recommendations.push({
    code: 'META_IDENTITY_OR_EVIDENCE_GAP', priority: 'P1',
    incidentKey: `${meta?.accountId ?? 'UNKNOWN'}:${meta?.window.since ?? 'NONE'}:${meta?.window.until ?? 'NONE'}:${metaReason}`, 
    fact: `Meta Ads metrics are METRICS_NOT_PROVEN (${metaReason}).`,
    risk: 'Unavailable metrics must not be shown as zeros, purchases, revenue or campaign success.',
    confidence: 'HIGH', decision: 'Verify the native Core account, ads_read scope, requested date window and Meta Graph readback.',
    rollback: 'No write proposed; keep paid-campaign state and budgets unchanged.',
    evidence: meta?.evidence?.filter(e => e.trim()).sort() ?? [],
  });
  if (metaState === 'PROVEN' && rows.some(r => r.deliveryStatusReadbackVerified && r.deliveryStatus === 'ACTIVE' && r.spend === 0)) {
    recommendations.push({
      code: 'ACTIVE_ZERO_SPEND_RECONCILIATION', priority: 'P1',
      incidentKey: `${meta!.accountId}:${meta!.window.since}:${meta!.window.until}:${rows.filter(r => r.deliveryStatusReadbackVerified && r.deliveryStatus === 'ACTIVE' && r.spend === 0).map(r => `${r.level}:${r.id}`).sort().join(',')}`, 
      fact: 'An ACTIVE Meta Ads entity reports verified spend=0 for the requested window.',
      risk: 'Zero spend can indicate delivery/billing/approval issues; ACTIVE alone is not evidence of success.',
      confidence: 'MEDIUM', decision: 'Compare campaign/adset/ad delivery and billing read-only in Core before any proposed pause.',
      rollback: 'No campaign mutation is authorized by this analysis.',
      evidence: meta!.evidence,
    });
  }
  if (mission && metaState === 'PROVEN' && rows.length === 1 &&
    ctr !== null && frequency !== null && frequency >= 3 && ctr < 0.01) {
    recommendations.push({
      code: 'CAMPAIGN_PERFORMANCE_REVIEW', priority: 'P2',
      incidentKey: `${mission.campaignId}:${meta!.window.since}:${meta!.window.until}`, 
      fact: `Campaign ${mission.campaignId} has observed frequency >=3 and CTR <1% in a verified window.`,
      risk: 'Possible creative fatigue, targeting mismatch or weak attribution; thresholds are diagnostic only.',
      confidence: 'LOW', decision: 'Submit a read-only creative/copy comparison to the authorized planner; require independent baseline before recommending pause.',
      rollback: 'No automatic adjustment; any later Core write needs separate approval and rollback.',
      evidence: [...meta!.evidence, ...mission.evidence],
    });
  }
  const top = recommendations[0] ?? null;
  const fingerprint = top ? fingerprintFor(top) : null;
  return {
    mode: mission ? 'AG01_CAMPAIGN' : 'NORMAL', metaState, metaReason, organicState, organicMetrics,
    ctr, frequency, spend, cpl, revenue, roas, currency, sampleRows: rows.length,
    publicationConfirmed: published.size,
    publicationUnreconciled: pending.size,
    fingerprint,
    recommendation: top && fingerprint !== input.previousFingerprint ? top : null,
  };
}