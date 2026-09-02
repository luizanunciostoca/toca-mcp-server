import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const APPROVAL = 'APPROVED_THE_PARTY_2026_09_04_ADD_AD06_AD07_AND_ACTIVATE_R300';
const ACCOUNT_ID = '311793958882290';
const CAMPAIGN_ID = '52621895410665';
const ADSET_ID = '52621895413265';
const PAGE_ID = '306103746115875';
const INSTAGRAM_USER_ID = '17841402033495654';
const PRODUCT_URL = 'https://tocadomorcego.com.br/produtos/the-party-by-toca-experience-7175.html';
const EXPECTED_BUDGET_MINOR = 30_000;
const EXPECTED_EXISTING_AD_COUNT = 5;
const EXPECTED_FINAL_AD_COUNT = 7;

const NEW_ASSETS = [
  {
    creativeCode: 'AD06_DUAS_PISTAS_DUAS_ENERGIAS',
    fileName: 'creative-06-duas-pistas-duas-energias.jpg',
    creativeName: 'The Party 04-09 | Duas Pistas Duas Energias',
    adName: 'The Party 04-09 | AD 06 | Duas Pistas Duas Energias',
    primaryText:
      'Duas pistas. Duas energias. Na The Party, voce escolhe entre a Pista Nacional e a Pista Internacional — e pode viver as duas na mesma noite. Sexta, 04 de setembro, no Toca do Morcego.',
    headline: 'Duas pistas. Duas energias.',
    description: 'The Party • 04 Set • Morro',
    destinationUrl: `${PRODUCT_URL}?utm_source=meta&utm_medium=paid_social&utm_campaign=the_party_2026_09_04_morro&utm_term=morro_local&utm_content=ad06_duas_pistas_energias`,
  },
  {
    creativeCode: 'AD07_DUAS_PISTAS_DUAS_EXPERIENCIAS',
    fileName: 'creative-07-duas-pistas-duas-experiencias.jpg',
    creativeName: 'The Party 04-09 | Duas Pistas Duas Experiencias',
    adName: 'The Party 04-09 | AD 07 | Duas Pistas Duas Experiencias',
    primaryText:
      'Duas pistas. Duas experiencias. Escolha uma, troque quando quiser e viva as duas. The Party nesta sexta, 04 de setembro, no Toca do Morcego.',
    headline: 'Duas pistas. Duas experiencias.',
    description: 'Pista Nacional + Internacional',
    destinationUrl: `${PRODUCT_URL}?utm_source=meta&utm_medium=paid_social&utm_campaign=the_party_2026_09_04_morro&utm_term=morro_local&utm_content=ad07_duas_pistas_experiencias`,
  },
] as const;

const suppliedApproval = requiredEnv('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_APPROVAL');
if (suppliedApproval !== APPROVAL) {
  throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_APPROVAL_MISMATCH');
}

const config = loadConfig(process.env);
if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const api = createMetaPublicationApiClient(config);
const provider = new MetaAdsControlledGraphProvider(api);
const account = { adAccountId: ACCOUNT_ID, currency: 'BRL' } as const;
const pool = createPostgresPool({ connectionString: config.DATABASE_URL });
const correlationId = 'meta-ads:the-party:2026-09-04:add-two-and-activate:r300';
const discoveredAdIds = new Set<string>();
const createdAdIds: string[] = [];
const createdCreativeIds: string[] = [];
let providerMutationExecuted = false;

try {
  const preflight = await readEnvelope();
  assertPausedPreflight(preflight);
  const verifiedAssets = await loadAndVerifyAssets();

  await writeAudit('APPROVED_ADD_TWO_AND_ACTIVATE_STARTED', {
    campaignId: CAMPAIGN_ID,
    adSetId: ADSET_ID,
    lifetimeBudgetMinor: EXPECTED_BUDGET_MINOR,
    existingAdCount: EXPECTED_EXISTING_AD_COUNT,
    newCreativeCount: NEW_ASSETS.length,
    requestedFinalAdCount: EXPECTED_FINAL_AD_COUNT,
    activationApproved: true,
  });

  const imageHashes: string[] = [];
  for (const asset of verifiedAssets) {
    imageHashes.push(await uploadImage(asset.base64));
    providerMutationExecuted = true;
  }

  for (const [index, asset] of NEW_ASSETS.entries()) {
    const imageHash = imageHashes[index];
    if (!imageHash) {
      throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_IMAGE_HASH_MISSING');
    }

    const creative = await provider.createCreative(account, {
      name: asset.creativeName,
      pageId: PAGE_ID,
      instagramActorId: INSTAGRAM_USER_ID,
      objectStorySpec: {
        link_data: {
          image_hash: imageHash,
          link: asset.destinationUrl,
          message: asset.primaryText,
          name: asset.headline,
          description: asset.description,
          call_to_action: {
            type: 'LEARN_MORE',
            value: { link: asset.destinationUrl },
          },
        },
      },
    });
    createdCreativeIds.push(creative.id);
    providerMutationExecuted = true;

    const ad = await provider.createAd(account, {
      name: asset.adName,
      adSetId: ADSET_ID,
      creativeId: creative.id,
      status: 'PAUSED',
    });
    createdAdIds.push(ad.id);
    discoveredAdIds.add(ad.id);
    providerMutationExecuted = true;
  }

  const pausedSeven = await readEnvelope();
  assertSevenPaused(pausedSeven);

  for (const ad of pausedSeven.ads) {
    const adId = requiredScalar(ad.id, 'ACTIVATE_AD_ID');
    discoveredAdIds.add(adId);
    await api.post(adId, { status: 'ACTIVE' });
    providerMutationExecuted = true;
  }

  await api.post(ADSET_ID, { status: 'ACTIVE' });
  providerMutationExecuted = true;
  await api.post(CAMPAIGN_ID, { status: 'ACTIVE' });
  providerMutationExecuted = true;

  const activeVerification = await readEnvelope();
  assertActiveFinal(activeVerification);

  await writeAudit('APPROVED_ADD_TWO_AND_ACTIVATE_SUCCEEDED', {
    campaignId: CAMPAIGN_ID,
    adSetId: ADSET_ID,
    lifetimeBudgetMinor: EXPECTED_BUDGET_MINOR,
    finalAdCount: activeVerification.ads.length,
    newAdIds: createdAdIds,
    newCreativeIds: createdCreativeIds,
    placements: ['facebook_story', 'instagram_story'],
    ctaType: 'LEARN_MORE',
    activationPerformed: true,
  });

  console.log(
    `META_ADS_THE_PARTY_0904_ADD_ACTIVATE_RESULT=${JSON.stringify({
      status: 'AD06_AD07_ADDED_AND_CAMPAIGN_ACTIVATED',
      campaignStatus: scalarString(activeVerification.campaign.status),
      adSetStatus: scalarString(activeVerification.adSet.status),
      configuredActiveAds: activeVerification.ads.filter(
        (ad) => scalarString(ad.status) === 'ACTIVE',
      ).length,
      finalAdCount: activeVerification.ads.length,
      newAdIds: createdAdIds,
      newCreativeIds: createdCreativeIds,
      lifetimeBudgetMinor: finiteNumber(activeVerification.adSet.lifetime_budget),
      currency: 'BRL',
      placements: ['facebook_story', 'instagram_story'],
      ctaType: 'LEARN_MORE',
      productUrl: PRODUCT_URL,
      providerMutationExecuted,
      activationPerformed: true,
      effectiveStatuses: activeVerification.ads.map((ad) => ({
        name: scalarString(ad.name),
        status: scalarString(ad.status),
        effectiveStatus: scalarString(ad.effective_status),
      })),
    })}`,
  );
} catch (error) {
  const rollbackErrors = await rollbackToPaused();
  try {
    await writeAudit('APPROVED_ADD_TWO_AND_ACTIVATE_FAILED_PAUSED_ROLLBACK', {
      error: normalizeError(error),
      rollbackErrors,
      createdAdIds,
      createdCreativeIds,
      providerMutationExecuted,
      activationPerformed: false,
    });
  } catch (auditError) {
    rollbackErrors.push(`AUDIT:${normalizeError(auditError)}`);
  }
  throw new Error(
    `META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FAILED:${normalizeError(error)}:ROLLBACK=${JSON.stringify(rollbackErrors)}`,
  );
} finally {
  await pool.end();
}

interface Envelope {
  readonly campaign: Record<string, unknown>;
  readonly adSet: Record<string, unknown>;
  readonly ads: Record<string, unknown>[];
  readonly creatives: Map<string, Record<string, unknown>>;
}

interface VerifiedAsset {
  readonly base64: string;
}

async function readEnvelope(): Promise<Envelope> {
  const campaign = asRecord(
    await api.get(CAMPAIGN_ID, {
      fields: 'id,name,status,effective_status,objective',
    }),
  );
  const adSet = asRecord(
    await api.get(ADSET_ID, {
      fields:
        'id,name,campaign_id,status,effective_status,lifetime_budget,start_time,end_time,targeting,promoted_object',
    }),
  );
  const ads = arrayRecords(
    asRecord(
      await api.get(`${CAMPAIGN_ID}/ads`, {
        fields: 'id,name,adset_id,campaign_id,status,effective_status,creative',
        limit: '100',
      }),
    ).data,
  ).sort((left, right) => scalarString(left.name).localeCompare(scalarString(right.name)));

  const creatives = new Map<string, Record<string, unknown>>();
  for (const ad of ads) {
    const adId = requiredScalar(ad.id, 'READ_AD_ID');
    discoveredAdIds.add(adId);
    const creativeId = requiredScalar(asRecord(ad.creative).id, 'READ_CREATIVE_ID');
    creatives.set(
      adId,
      asRecord(
        await api.get(creativeId, {
          fields: 'id,name,object_story_spec',
        }),
      ),
    );
  }
  return { campaign, adSet, ads, creatives };
}

function assertPausedPreflight(envelope: Envelope): void {
  if (scalarString(envelope.campaign.status) !== 'PAUSED') {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_CAMPAIGN_NOT_PAUSED');
  }
  if (scalarString(envelope.adSet.status) !== 'PAUSED') {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_ADSET_NOT_PAUSED');
  }
  if (scalarString(envelope.adSet.campaign_id) !== CAMPAIGN_ID) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_ADSET_CAMPAIGN_MISMATCH');
  }
  if (finiteNumber(envelope.adSet.lifetime_budget) !== EXPECTED_BUDGET_MINOR) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_BUDGET_MISMATCH');
  }
  if (!isStoriesOnlyTargeting(asRecord(envelope.adSet.targeting))) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_PLACEMENTS_MISMATCH');
  }
  if (envelope.ads.length !== EXPECTED_EXISTING_AD_COUNT) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_EXISTING_AD_COUNT_MISMATCH');
  }
  if (envelope.ads.some((ad) => scalarString(ad.status) !== 'PAUSED')) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_EXISTING_AD_NOT_PAUSED');
  }
  for (const ad of envelope.ads) {
    assertCreativeLearnMore(envelope.creatives.get(requiredScalar(ad.id, 'PREFLIGHT_AD_ID')));
  }
}

function assertSevenPaused(envelope: Envelope): void {
  if (
    scalarString(envelope.campaign.status) !== 'PAUSED' ||
    scalarString(envelope.adSet.status) !== 'PAUSED'
  ) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_PAUSED_ENVELOPE_CHANGED');
  }
  if (finiteNumber(envelope.adSet.lifetime_budget) !== EXPECTED_BUDGET_MINOR) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_PAUSED_BUDGET_CHANGED');
  }
  if (!isStoriesOnlyTargeting(asRecord(envelope.adSet.targeting))) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_PAUSED_PLACEMENTS_CHANGED');
  }
  if (envelope.ads.length !== EXPECTED_FINAL_AD_COUNT) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FINAL_PAUSED_AD_COUNT_MISMATCH');
  }
  if (envelope.ads.some((ad) => scalarString(ad.status) !== 'PAUSED')) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FINAL_PAUSED_AD_STATUS_MISMATCH');
  }
  for (const asset of NEW_ASSETS) {
    if (!envelope.ads.some((ad) => scalarString(ad.name) === asset.adName)) {
      throw new Error(`META_ADS_THE_PARTY_0904_ADD_ACTIVATE_NEW_AD_MISSING_${asset.creativeCode}`);
    }
  }
  for (const ad of envelope.ads) {
    assertCreativeLearnMore(envelope.creatives.get(requiredScalar(ad.id, 'PAUSED_AD_ID')));
  }
}

function assertActiveFinal(envelope: Envelope): void {
  if (scalarString(envelope.campaign.status) !== 'ACTIVE') {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FINAL_CAMPAIGN_NOT_ACTIVE');
  }
  if (scalarString(envelope.adSet.status) !== 'ACTIVE') {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FINAL_ADSET_NOT_ACTIVE');
  }
  if (finiteNumber(envelope.adSet.lifetime_budget) !== EXPECTED_BUDGET_MINOR) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FINAL_BUDGET_CHANGED');
  }
  if (!isStoriesOnlyTargeting(asRecord(envelope.adSet.targeting))) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FINAL_PLACEMENTS_CHANGED');
  }
  if (envelope.ads.length !== EXPECTED_FINAL_AD_COUNT) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FINAL_AD_COUNT_MISMATCH');
  }
  if (envelope.ads.some((ad) => scalarString(ad.status) !== 'ACTIVE')) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_FINAL_AD_NOT_ACTIVE');
  }
  for (const ad of envelope.ads) {
    assertCreativeLearnMore(envelope.creatives.get(requiredScalar(ad.id, 'FINAL_AD_ID')));
  }
}

function assertCreativeLearnMore(creative: Record<string, unknown> | undefined): void {
  if (!creative) throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_CREATIVE_MISSING');
  const linkData = asRecord(asRecord(creative.object_story_spec).link_data);
  const cta = asRecord(linkData.call_to_action);
  const value = asRecord(cta.value);
  if (scalarString(cta.type) !== 'LEARN_MORE') {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_CTA_NOT_LEARN_MORE');
  }
  const link = scalarString(linkData.link);
  const ctaLink = scalarString(value.link);
  if (!isExpectedDestination(link) || !isExpectedDestination(ctaLink)) {
    throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_DESTINATION_MISMATCH');
  }
}

async function loadAndVerifyAssets(): Promise<readonly VerifiedAsset[]> {
  const output: VerifiedAsset[] = [];
  for (const asset of NEW_ASSETS) {
    const bytes = await readFile(`ops/meta-ads/the-party-2026-09-04/${asset.fileName}`);
    if (bytes.length < 100_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error(`META_ADS_THE_PARTY_0904_ADD_ACTIVATE_ASSET_INVALID_${asset.creativeCode}`);
    }
    output.push({ base64: bytes.toString('base64') });
  }
  return output;
}

async function uploadImage(base64: string): Promise<string> {
  const response = asRecord(
    await api.post(`act_${ACCOUNT_ID}/adimages`, {
      bytes: base64,
    }),
  );
  const images = asRecord(response.images);
  for (const value of Object.values(images)) {
    const hash = scalarString(asRecord(value).hash);
    if (hash) return hash;
  }
  throw new Error('META_ADS_THE_PARTY_0904_ADD_ACTIVATE_IMAGE_HASH_NOT_RETURNED');
}

async function rollbackToPaused(): Promise<string[]> {
  const errors: string[] = [];
  try {
    await api.post(CAMPAIGN_ID, { status: 'PAUSED' });
  } catch (error) {
    errors.push(`CAMPAIGN:${normalizeError(error)}`);
  }
  try {
    await api.post(ADSET_ID, { status: 'PAUSED' });
  } catch (error) {
    errors.push(`ADSET:${normalizeError(error)}`);
  }
  for (const adId of discoveredAdIds) {
    try {
      await api.post(adId, { status: 'PAUSED' });
    } catch (error) {
      errors.push(`AD:${adId}:${normalizeError(error)}`);
    }
  }
  return errors;
}

async function writeAudit(
  decision: string,
  providerResult: Readonly<Record<string, unknown>>,
): Promise<void> {
  await pool.query(
    `insert into audit_events
       (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      correlationId,
      'chatgpt/user-explicit-approval',
      'meta_ads.the_party_2026_09_04.add_two_and_activate',
      'WRITE_EXTERNAL',
      decision,
      JSON.stringify({
        eventId: 'THE_PARTY_2026_09_04',
        accountId: ACCOUNT_ID,
        campaignId: CAMPAIGN_ID,
        adSetId: ADSET_ID,
        lifetimeBudgetMinor: EXPECTED_BUDGET_MINOR,
        currency: 'BRL',
        financialImpact: true,
        addedCreativeCodes: NEW_ASSETS.map((asset) => asset.creativeCode),
      }),
      JSON.stringify(providerResult),
    ],
  );
}

function isStoriesOnlyTargeting(targeting: Readonly<Record<string, unknown>>): boolean {
  return (
    sortedStrings(targeting.publisher_platforms).join(',') === 'facebook,instagram' &&
    sortedStrings(targeting.facebook_positions).join(',') === 'story' &&
    sortedStrings(targeting.instagram_positions).join(',') === 'story'
  );
}

function isExpectedDestination(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === new URL(PRODUCT_URL).origin &&
      url.pathname === new URL(PRODUCT_URL).pathname &&
      !url.searchParams.has('fbclid')
    );
  } catch {
    return false;
  }
}

function sortedStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(scalarString).filter(Boolean).sort() : [];
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

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function requiredScalar(value: unknown, label: string): string {
  const result = scalarString(value);
  if (!result) {
    throw new Error(`META_ADS_THE_PARTY_0904_ADD_ACTIVATE_${label}_MISSING`);
  }
  return result;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_REQUIRED_ENV_${name}`);
  return value;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
