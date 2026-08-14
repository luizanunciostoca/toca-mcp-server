export interface MetaAdsProviderEntitySnapshot extends Readonly<Record<string, unknown>> {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly effective_status?: unknown;
  readonly issues_info?: unknown;
  readonly failed_delivery_checks?: unknown;
}

export interface MetaAdsProviderSmokeSnapshot {
  readonly campaign: MetaAdsProviderEntitySnapshot;
  readonly adSet: MetaAdsProviderEntitySnapshot;
  readonly ads: readonly MetaAdsProviderEntitySnapshot[];
}

export type MetaAdsProviderSmokeReadiness =
  { readonly state: 'READY' } | { readonly state: 'PENDING'; readonly entities: readonly string[] };

const TRANSIENT_EFFECTIVE_STATUSES = new Set(['IN_PROCESS', 'PENDING_REVIEW', 'PREAPPROVED']);
const AD_SET_SAFE_EFFECTIVE_STATUSES = new Set(['PAUSED', 'CAMPAIGN_PAUSED']);
const AD_SAFE_EFFECTIVE_STATUSES = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']);
const VALIDATION_AD_SET_STATUSES = new Set(['ACTIVE', 'PAUSED']);

export function evaluateMetaAdsProviderSmokeReadiness(
  snapshot: MetaAdsProviderSmokeSnapshot,
): MetaAdsProviderSmokeReadiness {
  assertConfiguredPaused('campaign', snapshot.campaign);
  assertConfiguredPaused('adset', snapshot.adSet);
  snapshot.ads.forEach((ad, index) => assertConfiguredPaused(`ad_${index}`, ad));

  assertNoProviderIssues('campaign', snapshot.campaign);
  assertNoProviderIssues('adset', snapshot.adSet);
  snapshot.ads.forEach((ad, index) => assertNoProviderIssues(`ad_${index}`, ad));

  const pending: string[] = [];
  evaluateEffectiveStatus('campaign', snapshot.campaign, new Set(['PAUSED']), pending);
  evaluateEffectiveStatus('adset', snapshot.adSet, AD_SET_SAFE_EFFECTIVE_STATUSES, pending);
  snapshot.ads.forEach((ad, index) =>
    evaluateEffectiveStatus(`ad_${index}`, ad, AD_SAFE_EFFECTIVE_STATUSES, pending),
  );

  return pending.length === 0 ? { state: 'READY' } : { state: 'PENDING', entities: pending };
}

export function isMetaAdsPixelAssignedToAccount(
  assignedAccounts: readonly Readonly<Record<string, unknown>>[],
  accountId: string,
): boolean {
  return assignedAccounts.some((account) => {
    const id = scalarString(account.id);
    const providerAccountId = scalarString(account.account_id);
    return providerAccountId === accountId || id === accountId || id === `act_${accountId}`;
  });
}

export function selectMetaAdsValidationAdSet(
  adSets: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> | undefined {
  return adSets.find((adSet) => {
    const id = scalarString(adSet.id);
    const status = scalarString(adSet.status);
    return Boolean(id) && VALIDATION_AD_SET_STATUSES.has(status);
  });
}

function evaluateEffectiveStatus(
  kind: string,
  entity: MetaAdsProviderEntitySnapshot,
  safeStatuses: ReadonlySet<string>,
  pending: string[],
): void {
  const effectiveStatus = scalarString(entity.effective_status);
  if (safeStatuses.has(effectiveStatus)) return;
  if (TRANSIENT_EFFECTIVE_STATUSES.has(effectiveStatus)) {
    pending.push(`${kind}:${effectiveStatus}`);
    return;
  }
  throw new Error(
    `META_ADS_SMOKE_${kind.toUpperCase()}_UNSAFE_EFFECTIVE_STATUS_${token(effectiveStatus)}`,
  );
}

function assertConfiguredPaused(kind: string, entity: MetaAdsProviderEntitySnapshot): void {
  if (scalarString(entity.status) !== 'PAUSED') {
    throw new Error(`META_ADS_SMOKE_${kind.toUpperCase()}_NOT_PAUSED`);
  }
}

function assertNoProviderIssues(kind: string, entity: MetaAdsProviderEntitySnapshot): void {
  if (nonEmptyCollection(entity.issues_info)) {
    throw new Error(`META_ADS_SMOKE_${kind.toUpperCase()}_HAS_ISSUES`);
  }
  if (nonEmptyCollection(entity.failed_delivery_checks)) {
    throw new Error(`META_ADS_SMOKE_${kind.toUpperCase()}_FAILED_DELIVERY_CHECKS`);
  }
}

function nonEmptyCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function token(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80) || 'EMPTY';
}
