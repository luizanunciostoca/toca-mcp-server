import { describe, expect, it } from 'vitest';
import { analyzeAgent09Evidence, type Agent09AnalysisInput } from '../src/measurement/agent09-evidence-analytics.js';

const window = { since: '2026-10-14', until: '2026-10-14', timezone: 'America/Bahia' as const };
const current = '2026-10-14T21:00:00-03:00';
const meta = {
  source: 'TOCA_CORE_META_GRAPH' as const,
  capability: 'meta_ads.insights.get' as const,
  accountId: '123', currency: 'BRL', window,
  observedAt: '2026-10-14T20:55:00-03:00',
  adsReadVerified: true, gatewayVerified: true, providerReadbackVerified: true,
  rows: [{
    level: 'campaign' as const, id: 'cmp1', campaignId: 'cmp1', dateStart: window.since,
    dateStop: window.until, deliveryStatus: 'ACTIVE' as const, deliveryStatusReadbackVerified: true,
    impressions: 1000, clicks: 50, reach: 500, spend: 100,
  }], evidence: ['core:graph:readback-1'],
};
const mission = {
  authorized: true, routeId: 'R18', correlationId: 'corr-1', ownerId: 'agent-01',
  accountId: '123', campaignId: 'cmp1', startsAt: '2026-10-14T08:00:00-03:00',
  endsAt: '2026-10-14T23:00:00-03:00', evidence: ['core:mission:1'],
};
const crm = {
  source: 'TOCA_CORE_CRM' as const, accountId: '123', campaignId: 'cmp1', correlationId: 'corr-1',
  currency: 'BRL', window, observedAt: '2026-10-14T20:57:00-03:00',
  providerReadbackVerified: true, leads: 10, revenue: 300,
  financeReconciled: true, financeEvidence: ['finance:reconciled:1'], evidence: ['crm:leads:1', 'finance:reconciled:1'],
};
function sample(overrides: Partial<Agent09AnalysisInput> = {}): Agent09AnalysisInput {
  return { now: current, meta, crm, mission, organic: [], publications: [], ...overrides };
}

describe('TOCA OS / AGENTE 09 — canonical read-only metrics', () => {
  it('calculates CTR, frequency, CPL and reconciled ROAS with matching canonical identities', () => {
    const r = analyzeAgent09Evidence(sample());
    expect(r).toMatchObject({mode:'AG01_CAMPAIGN',metaState:'PROVEN',ctr:0.05,frequency:2,spend:100,cpl:10,revenue:300,roas:3,sampleRows:1});
    expect(r.recommendation).toBeNull();
  });
  it('never treats disconnected gateway, missing envelope or valid empty array as zero', () => {
    for (const m of [null,{...meta,gatewayVerified:false},{...meta,rows:null},{...meta,rows:[]}]) {
      const r=analyzeAgent09Evidence(sample({meta:m}));
      expect(r.metaState).toBe('METRICS_NOT_PROVEN');
      expect(r.spend).toBeNull(); expect(r.ctr).toBeNull(); expect(r.roas).toBeNull();
    }
  });
  it('dedupes exact repeated rows, refuses conflicting duplicates and mixed levels', () => {
    const row=meta.rows[0]!;
    expect(analyzeAgent09Evidence(sample({meta:{...meta,rows:[row,row]}})).spend).toBe(100);
    const conflict={...row,spend:200};
    expect(analyzeAgent09Evidence(sample({meta:{...meta,rows:[row,conflict]}})).metaState).toBe('METRICS_NOT_PROVEN');
    expect(analyzeAgent09Evidence(sample({meta:{...meta,rows:[row,{...row,id:'ad1',level:'ad' as const}]}})).metaState).toBe('METRICS_NOT_PROVEN');
  });
  it('does not aggregate cross-entity reach into frequency and does not infer sales', () => {
    const r=analyzeAgent09Evidence(sample({meta:{...meta,rows:[meta.rows[0]!,{...meta.rows[0]!,id:'cmp2',campaignId:'cmp2'}]}}));
    expect(r.frequency).toBeNull(); expect(r.cpl).toBeNull(); expect(r.roas).toBeNull();
  });
  it('enforces CRM and finance reconciliation, window, campaign, account, correlation and currency', () => {
    const variants=[{...crm,financeReconciled:false},{...crm,financeEvidence:[]},{...crm,accountId:'another'},
      {...crm,currency:'USD'},{...crm,correlationId:'different'},
      {...crm,window:{...window,since:'2026-10-13'}}];
    for (const bad of variants) {
      const r=analyzeAgent09Evidence(sample({crm:bad}));
      expect(r.roas).toBeNull();
    }
    expect(analyzeAgent09Evidence(sample({crm:{...crm,financeReconciled:false}})).cpl).toBe(10);
    expect(analyzeAgent09Evidence(sample({mission:null})).roas).toBe(3);
  });
  it('treats confirmed spend zero and CRM leads zero separately from missing values', () => {
    const r=analyzeAgent09Evidence(sample({meta:{...meta,rows:[{...meta.rows[0]!,spend:0}]},crm:{...crm,leads:0}}));
    expect(r.spend).toBe(0);expect(r.cpl).toBeNull();expect(r.roas).toBeNull();
    expect(r.recommendation?.code).toBe('ACTIVE_ZERO_SPEND_RECONCILIATION');
  });
  it('reports publication reconciliation, not a proven publication failure or a duplicate post', () => {
    const p={contentItemId:'slot-1',expectedAccountId:'ig-account',providerAccountId:null,scheduledAt:'2026-10-14T09:00:00-03:00',status:'MISSED_WINDOW',
      providerMediaId:null,permalink:null,providerReadbackVerified:false,evidence:['drive:content:slot-1']};
    const r=analyzeAgent09Evidence(sample({publications:[p,p]}));
    expect(r.publicationUnreconciled).toBe(1);
    expect(r.recommendation?.code).toBe('PUBLICATION_PROVIDER_RECONCILIATION');
    expect(r.recommendation?.fact).toContain('UNKNOWN');
    const readback=analyzeAgent09Evidence(sample({publications:[p,{...p,status:'PUBLISHED',providerAccountId:'ig-account',providerMediaId:'ig1',permalink:'https://www.instagram.com/p/example/',providerReadbackVerified:true}]}));
    expect(readback.publicationConfirmed).toBe(1);
    expect(readback.publicationUnreconciled).toBe(0);
    const wrongAccount=analyzeAgent09Evidence(sample({publications:[{...p,providerAccountId:'another',providerMediaId:'ig1',permalink:'https://www.instagram.com/p/example/',providerReadbackVerified:true}]}));
    expect(wrongAccount.publicationConfirmed).toBe(0);
  });
  it('refuses reuse of a provider media ID across different slots and refuses multiple IDs for one slot', () => {
    const p={contentItemId:'slot-a',expectedAccountId:'ig-account',providerAccountId:'ig-account',scheduledAt:'2026-10-14T09:00:00-03:00',
      status:'PUBLISHED',providerMediaId:'ig-media-1',permalink:'https://www.instagram.com/p/example/',providerReadbackVerified:true,evidence:['ig:ack:1']};
    const reused=analyzeAgent09Evidence(sample({publications:[p,{...p,contentItemId:'slot-b',scheduledAt:'2026-10-14T15:00:00-03:00'}]}));
    expect(reused.publicationConfirmed).toBe(0); expect(reused.publicationUnreconciled).toBe(2);
    const conflicting=analyzeAgent09Evidence(sample({publications:[p,{...p,providerMediaId:'ig-media-2'}]}));
    expect(conflicting.publicationConfirmed).toBe(0); expect(conflicting.publicationUnreconciled).toBe(1);
  });
  it('requires independently verified delivery status before interpreting ACTIVE with zero spend', () => {
    const r=analyzeAgent09Evidence(sample({meta:{...meta,rows:[{...meta.rows[0]!,spend:0,deliveryStatusReadbackVerified:false}]}}));
    expect(r.spend).toBe(0); expect(r.recommendation).toBeNull();
  });
  it('deduplicates repeated readback receipts, but alerts for a newly affected slot', () => {
    const p={contentItemId:'slot-a',expectedAccountId:'ig-account',providerAccountId:null,scheduledAt:'2026-10-14T09:00:00-03:00',
      status:'MISSED_WINDOW',providerMediaId:null,permalink:null,providerReadbackVerified:false,evidence:['readback:1']};
    const first=analyzeAgent09Evidence(sample({publications:[p]}));
    const same=analyzeAgent09Evidence(sample({publications:[{...p,evidence:['readback:2']}],previousFingerprint:first.fingerprint}));
    expect(same.recommendation).toBeNull();
    const newSlot=analyzeAgent09Evidence(sample({publications:[{...p,contentItemId:'slot-b'}],previousFingerprint:first.fingerprint}));
    expect(newSlot.recommendation?.code).toBe('PUBLICATION_PROVIDER_RECONCILIATION');
  });
  it('requires provider ACK for claimed PUBLISHED and does not infer readback from registry status', () => {
    const p={contentItemId:'slot-1',expectedAccountId:'ig-account',providerAccountId:null,scheduledAt:'2026-10-14T15:00:00-03:00',status:'PUBLISHED',
      providerMediaId:'ig1',permalink:null,providerReadbackVerified:true,evidence:['drive:item:1']};
    const r=analyzeAgent09Evidence(sample({publications:[p]}));
    expect(r.publicationConfirmed).toBe(0);expect(r.publicationUnreconciled).toBe(1);
  });
  it('does not activate AG-01 mission without owner/correlation/window/current account', () => {
    const cases=[null,{...mission,authorized:false},{...mission,ownerId:''},
      {...mission,accountId:'999'},{...mission,endsAt:'2026-10-14T20:00:00-03:00'}];
    for (const bad of cases) {
      const r=analyzeAgent09Evidence(sample({mission:bad}));
      expect(r.mode).toBe('NORMAL'); expect(r.roas).toBe(3);
    }
  });
  it('prevents old, unscoped and invalid rows from being promoted to valid metrics', () => {
    const cases=[{...meta,observedAt:'2026-10-14T14:00:00-03:00'},
      {...meta,rows:[{...meta.rows[0]!,dateStop:'2026-10-13'}]},
      {...meta,rows:[{...meta.rows[0]!,spend:-1}]},
      {...meta,adsReadVerified:false},
      {...meta,window:{...window,timezone:'UTC' as 'America/Bahia'}}];
    for (const bad of cases)expect(analyzeAgent09Evidence(sample({meta:bad})).metaState).toBe('METRICS_NOT_PROVEN');
  });
  it('remains silent on the same prioritized evidence fingerprint', () => {
    const first=analyzeAgent09Evidence(sample({meta:null}));
    expect(first.recommendation).not.toBeNull();
    const next=analyzeAgent09Evidence(sample({meta:null,previousFingerprint:first.fingerprint}));
    expect(next.recommendation).toBeNull(); expect(next.fingerprint).toBe(first.fingerprint);
  });
  it('requires canonical Instagram readback for organic metrics', () => {
    const obs={source:'TOCA_CORE_INSTAGRAM' as const,format:'FEED' as const,accountId:'ig-account',mediaId:'ig-media',
      window,observedAt:'2026-10-14T20:56:00-03:00',providerReadbackVerified:false,
      reach:20,engagement:3,evidence:['instagram:insights:1']};
    expect(analyzeAgent09Evidence(sample({organic:[obs]})).organicState).toBe('METRICS_NOT_PROVEN');
    const verified=analyzeAgent09Evidence(sample({organic:[{...obs,providerReadbackVerified:true}]}));
    expect(verified.organicState).toBe('PROVEN');
    expect(verified.organicMetrics).toEqual([{format:'FEED',mediaId:'ig-media',reach:20,engagement:3,engagementRate:0.15}]);
  });
});