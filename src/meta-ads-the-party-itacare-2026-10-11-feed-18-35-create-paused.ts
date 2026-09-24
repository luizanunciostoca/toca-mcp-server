import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const ACCOUNT_ID = '311793958882290';
const CAMPAIGN_ID = '52622846509265';
const PAGE_ID = '306103746115875';
const DESTINATION_URL = 'https://www.sympla.com.br/evento/the-party-exclusive-itacare/3569762';
const PIXEL_ID = '461233076843065';
const START_TIME = '2026-09-24T08:00:00-03:00';
const END_TIME = '2026-10-11T22:00:00-03:00';
const APPROVAL = 'APPROVED_THE_PARTY_ITACARE_FEED_18_35_CREATE_PAUSED_20260923';

type CityKey = 'ITACARE' | 'ILHEUS' | 'ITABUNA' | 'VITORIA_DA_CONQUISTA';
type CreativeKey = 'BRAND' | 'DATE' | 'LINEUP' | 'ILLUSIONIZE' | 'PRICE';

interface CreativeSpec {
  readonly key: CreativeKey;
  readonly driveFileId: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly headline: string;
}

interface CitySpec {
  readonly key: CityKey;
  readonly label: string;
  readonly sourceFeedAdSetId: string;
  readonly lifetimeBudgetMinor: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly primaryCityId: number;
  readonly messages: Readonly<Record<CreativeKey, string>>;
}

interface Descriptor {
  readonly schemaVersion: 1;
  readonly accountId: string;
  readonly campaignId: string;
  readonly pageId: string;
  readonly destinationUrl: string;
  readonly pixelId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly ageMin: 18;
  readonly ageMax: 35;
  readonly status: 'PAUSED';
  readonly placements: {
    readonly publisherPlatforms: readonly ['facebook', 'instagram'];
    readonly facebookPositions: readonly ['feed'];
    readonly instagramPositions: readonly ['stream'];
  };
  readonly creatives: readonly CreativeSpec[];
  readonly cities: readonly CitySpec[];
}

const descriptor = buildDescriptor();
assertDescriptor(descriptor);

const config = loadConfig(process.env);
const api = createMetaPublicationApiClient(config);
const provider = new MetaAdsControlledGraphProvider(api);

const mode = requiredEnv('META_ADS_ITACARE_FEED_18_35_MODE');
if (mode === 'PREPARE') {
  const result = await prepare();
  console.log(`META_ADS_ITACARE_FEED_18_35_PREPARE_RESULT=${JSON.stringify(result)}`);
} else if (mode === 'EXECUTE_PAUSED') {
  const result = await executePaused();
  console.log(`META_ADS_ITACARE_FEED_18_35_EXECUTE_RESULT=${JSON.stringify(result)}`);
} else {
  throw new Error('META_ADS_ITACARE_FEED_18_35_MODE_UNSUPPORTED');
}

function buildDescriptor(): Descriptor {
  const creatives: readonly CreativeSpec[] = [
    {
      key: 'BRAND',
      driveFileId: '1HRkEn3M1U-MrgHowCllceBC5kDNvVUhx',
      fileName: 'creative-01-brand.jpg',
      sha256: '156d87d1045efacdeaa4e9de17e33a74ab2645b7a49124e25eacd471b0f7ea85',
      headline: 'THE PARTY OF ITACARÉ • 11/10',
    },
    {
      key: 'DATE',
      driveFileId: '1l9nGtL4OJ9VyJtEUZju9eajloOYdqDx5',
      fileName: 'creative-02-date.jpg',
      sha256: 'ea9b7d263906ab62bdae043ab385d5d13e73065cf2e339e7fe44d82b43909693',
      headline: '11 DE OUTUBRO • ITACARÉ',
    },
    {
      key: 'LINEUP',
      driveFileId: '1mygYM6Lr48LOGEOzomQ5Rgy7EhIiwJ_u',
      fileName: 'creative-03-lineup.jpg',
      sha256: '31cf4408c8100026115131b270b54b27487d06eee68f251389abb87f9f2f911e',
      headline: 'ILLUSIONIZE + BRISOTTI EM ITACARÉ',
    },
    {
      key: 'ILLUSIONIZE',
      driveFileId: '1k1jYcsdpiwzXEtqoLGRUXVZcQbKo1XDl',
      fileName: 'creative-04-illusionize.jpg',
      sha256: 'fe75d300b3ab86de009a120a1ca8725c4b032defe6c37d7b949cbb6423558b02',
      headline: 'ILLUSIONIZE • 11/10 • ITACARÉ',
    },
    {
      key: 'PRICE',
      driveFileId: '1wOQgEsBG15nTJW6RcRRWjdC6uSeQP6Sz',
      fileName: 'creative-05-price.jpg',
      sha256: 'e0d0fad62b05477a49e9efecaa78e9f3b212f44b6af544db8afb9350103b4ae4',
      headline: '1º LOTE • R$110',
    },
  ];

  const cities: readonly CitySpec[] = [
    {
      key: 'ITACARE',
      label: 'ITACARÉ',
      sourceFeedAdSetId: '52625517764465',
      lifetimeBudgetMinor: 46486,
      latitude: -14.27834,
      longitude: -38.99306,
      primaryCityId: 255575,
      messages: {
        BRAND:
          'Itacaré tem noites especiais. E tem noites que viram história. Dia 11 de outubro, a Praia da Ribeira recebe Illusionize + Brisotti para a The Party of Itacaré. Não é qualquer festa. É A festa. Garanta seu ingresso.',
        DATE:
          '11 DE OUTUBRO. Salva essa data. Illusionize + Brisotti na Praia da Ribeira. The Party of Itacaré. Garanta seu ingresso.',
        LINEUP:
          'Dois nomes. Um beach club. Uma noite em Itacaré. ILLUSIONIZE + BRISOTTI, dia 11 de outubro, na Praia da Ribeira. Garanta seu ingresso.',
        ILLUSIONIZE:
          'ILLUSIONIZE EM ITACARÉ. Agora tem data: 11.10.2026. Praia da Ribeira • Beach Club Terra Boa. Garanta seu ingresso para a The Party of Itacaré.',
        PRICE:
          'Se você já decidiu que vai, existe um bom motivo para não deixar para depois. 1º lote: R$110. Illusionize + Brisotti, Praia da Ribeira, 11 de outubro. Garanta o valor do lote atual.',
      },
    },
    {
      key: 'ILHEUS',
      label: 'ILHÉUS',
      sourceFeedAdSetId: '52625517791665',
      lifetimeBudgetMinor: 46433,
      latitude: -14.79895,
      longitude: -39.03255,
      primaryCityId: 255098,
      messages: {
        BRAND:
          'Ilhéus, no dia 11 de outubro o destino é Itacaré. Praia da Ribeira, beach club, Illusionize + Brisotti e uma noite inteira para sair da rotina. Não é qualquer festa. É A festa. Garanta seu ingresso.',
        DATE:
          '11 de outubro tem destino: Itacaré. Illusionize + Brisotti na Praia da Ribeira. Chame sua turma de Ilhéus e programe a viagem. Ingressos disponíveis.',
        LINEUP:
          'Uma noite dessas está mais perto do que parece. Saia de Ilhéus para viver Illusionize + Brisotti em um beach club na Praia da Ribeira, em Itacaré. Garanta seu ingresso.',
        ILLUSIONIZE:
          'Ilhéus, Illusionize está a uma viagem de distância. Dia 11 de outubro, na Praia da Ribeira, em Itacaré. Garanta seu ingresso.',
        PRICE:
          'Ilhéus, se Itacaré já está nos planos, resolva o ingresso agora. 1º lote: R$110. Illusionize + Brisotti, 11 de outubro. Garanta o valor do lote atual.',
      },
    },
    {
      key: 'ITABUNA',
      label: 'ITABUNA',
      sourceFeedAdSetId: '52625517808465',
      lifetimeBudgetMinor: 47249,
      latitude: -14.79219,
      longitude: -39.27558,
      primaryCityId: 255568,
      messages: {
        BRAND:
          'Itabuna → Itacaré. Já pode colocar essa rota nos planos. Illusionize + Brisotti, Praia da Ribeira e uma noite inteira no beach club. Dia 11 de outubro. Não é qualquer festa. É A festa.',
        DATE:
          '11/10: Itabuna → Itacaré. Illusionize + Brisotti. Praia da Ribeira. The Party. Garanta seu ingresso.',
        LINEUP:
          'Itabuna, prepare a turma. Illusionize + Brisotti esperam por você em Itacaré no dia 11 de outubro. Praia, beach club e pista até a madrugada. Garanta seu ingresso.',
        ILLUSIONIZE:
          'Itabuna, marque 11 de outubro. O destino é Itacaré. Illusionize na Praia da Ribeira. Garanta seu ingresso.',
        PRICE:
          'Itabuna, não espere todo mundo decidir para garantir o seu. 1º lote: R$110. Illusionize + Brisotti, Itacaré, 11 de outubro. Garanta o valor do lote atual.',
      },
    },
    {
      key: 'VITORIA_DA_CONQUISTA',
      label: 'VITÓRIA DA CONQUISTA',
      sourceFeedAdSetId: '52625517833865',
      lifetimeBudgetMinor: 48070,
      latitude: -14.8661,
      longitude: -40.8394,
      primaryCityId: 274411,
      messages: {
        BRAND:
          'Vitória da Conquista, dia 11 de outubro o destino é Itacaré. Praia da Ribeira, Illusionize + Brisotti e uma noite inteira para viver a The Party. Não é qualquer festa. É A festa.',
        DATE:
          '11 de outubro tem destino: Itacaré. Vitória da Conquista, programe a viagem e chame sua turma para Illusionize + Brisotti na Praia da Ribeira.',
        LINEUP:
          'Vitória da Conquista, prepare a rota para Itacaré. Illusionize + Brisotti, Praia da Ribeira e uma noite inteira de The Party. Garanta seu ingresso.',
        ILLUSIONIZE:
          'Vitória da Conquista, Illusionize espera por você em Itacaré no dia 11 de outubro. Praia da Ribeira • Beach Club Terra Boa. Garanta seu ingresso.',
        PRICE:
          'Vitória da Conquista, se Itacaré já está nos planos, resolva o ingresso agora. 1º lote: R$110. Illusionize + Brisotti, 11 de outubro. Garanta o valor do lote atual.',
      },
    },
  ];

  return {
    schemaVersion: 1,
    accountId: ACCOUNT_ID,
    campaignId: CAMPAIGN_ID,
    pageId: PAGE_ID,
    destinationUrl: DESTINATION_URL,
    pixelId: PIXEL_ID,
    startTime: START_TIME,
    endTime: END_TIME,
    ageMin: 18,
    ageMax: 35,
    status: 'PAUSED',
    placements: {
      publisherPlatforms: ['facebook', 'instagram'],
      facebookPositions: ['feed'],
      instagramPositions: ['stream'],
    },
    creatives,
    cities,
  };
}

async function prepare(): Promise<Readonly<Record<string, unknown>>> {
  assertExactApproval();
  await verifyProviderPrerequisites();
  await assertNoDuplicateAdSets();
  const assets = await loadAssets();
  const requestSha256 = descriptorSha256(descriptor);
  return {
    status: 'READY_FOR_CREATE_PAUSED',
    providerMutationExecuted: false,
    requestSha256,
    descriptorBase64: Buffer.from(JSON.stringify(descriptor), 'utf8').toString('base64'),
    accountId: descriptor.accountId,
    campaignId: descriptor.campaignId,
    ageRange: [descriptor.ageMin, descriptor.ageMax],
    placements: descriptor.placements,
    cities: descriptor.cities.map((city) => ({
      key: city.key,
      label: city.label,
      sourceFeedAdSetId: city.sourceFeedAdSetId,
      lifetimeBudgetMinor: city.lifetimeBudgetMinor,
    })),
    creatives: assets.map((asset) => ({
      key: asset.key,
      sha256: asset.sha256,
      sizeBytes: asset.bytes.length,
    })),
    plannedAdSetCount: descriptor.cities.length,
    plannedAdCount: descriptor.cities.length * descriptor.creatives.length,
  };
}

async function executePaused(): Promise<Readonly<Record<string, unknown>>> {
  assertExactApproval();
  const approvedSha256 = requiredEnv('META_ADS_ITACARE_FEED_18_35_APPROVED_SHA256');
  const descriptorBase64 = requiredEnv('META_ADS_ITACARE_FEED_18_35_DESCRIPTOR_B64');
  const supplied = JSON.parse(Buffer.from(descriptorBase64, 'base64').toString('utf8')) as Descriptor;
  assertDescriptor(supplied);
  if (JSON.stringify(supplied) !== JSON.stringify(descriptor)) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_DESCRIPTOR_MISMATCH');
  }
  const computed = descriptorSha256(supplied);
  if (computed !== approvedSha256 || config.META_ADS_APPROVED_REQUEST_SHA256 !== approvedSha256) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_APPROVED_SHA_MISMATCH');
  }

  await verifyProviderPrerequisites();
  await assertNoDuplicateAdSets();
  const assets = await loadAssets();
  const imageHashes = new Map<CreativeKey, string>();
  for (const asset of assets) imageHashes.set(asset.key, await uploadImage(asset.base64));

  const createdAdSetIds: string[] = [];
  const createdCreativeIds: string[] = [];
  const createdAdIds: string[] = [];

  for (const city of descriptor.cities) {
    const adSetName = adSetNameFor(city);
    const adSet = await provider.createAdSet(
      { adAccountId: descriptor.accountId, currency: 'BRL' },
      {
        campaignId: descriptor.campaignId,
        name: adSetName,
        lifetimeBudgetMinor: city.lifetimeBudgetMinor,
        billingEvent: 'IMPRESSIONS',
        optimizationGoal: 'OFFSITE_CONVERSIONS',
        targeting: targetingFor(city),
        promotedObject: {
          pixel_id: descriptor.pixelId,
          custom_event_type: 'PURCHASE',
        },
        startTime: descriptor.startTime,
        endTime: descriptor.endTime,
        status: 'PAUSED',
      },
    );
    createdAdSetIds.push(adSet.id);

    for (const creative of descriptor.creatives) {
      const imageHash = imageHashes.get(creative.key);
      if (!imageHash) throw new Error('META_ADS_ITACARE_FEED_18_35_IMAGE_HASH_MISSING');
      const createdCreative = await provider.createCreative(
        { adAccountId: descriptor.accountId, currency: 'BRL' },
        {
          name: `THE PARTY 11.10 | ${city.label} | ${creative.key} | FEED 18-35`,
          pageId: descriptor.pageId,
          objectStorySpec: {
            link_data: {
              link: descriptor.destinationUrl,
              image_hash: imageHash,
              message: city.messages[creative.key],
              name: creative.headline,
              description: '11 de outubro • Itacaré',
              call_to_action: { type: 'SHOP_NOW' },
            },
          },
        },
      );
      createdCreativeIds.push(createdCreative.id);

      const ad = await provider.createAd(
        { adAccountId: descriptor.accountId, currency: 'BRL' },
        {
          name: `${city.label} | ${creative.key} | FEED 18-35 | 23.09`,
          adSetId: adSet.id,
          creativeId: createdCreative.id,
          status: 'PAUSED',
        },
      );
      createdAdIds.push(ad.id);
    }
  }

  const verification = await verifyCreated(createdAdSetIds, createdCreativeIds, createdAdIds, imageHashes);
  return {
    status: 'CREATED_PAUSED',
    providerMutationExecuted: true,
    requestSha256: approvedSha256,
    campaignId: descriptor.campaignId,
    createdAdSetIds,
    createdCreativeIds,
    createdAdIds,
    counts: {
      adSets: createdAdSetIds.length,
      creatives: createdCreativeIds.length,
      ads: createdAdIds.length,
    },
    activationBlockedPendingBudgetRedistribution: true,
    verification,
  };
}

function targetingFor(city: CitySpec): Record<string, unknown> {
  return {
    age_min: descriptor.ageMin,
    age_max: descriptor.ageMax,
    geo_locations: {
      custom_locations: [
        {
          distance_unit: 'kilometer',
          latitude: city.latitude,
          longitude: city.longitude,
          radius: 15,
          primary_city_id: city.primaryCityId,
          region_id: 442,
          country: 'BR',
        },
      ],
      location_types: ['frequently_in', 'home', 'recent'],
    },
    publisher_platforms: descriptor.placements.publisherPlatforms,
    facebook_positions: descriptor.placements.facebookPositions,
    instagram_positions: descriptor.placements.instagramPositions,
  };
}

function adSetNameFor(city: CitySpec): string {
  return `TESTE FEED | ${city.label} | 18-35 | NOVOS CRIATIVOS | 23.09`;
}

async function verifyProviderPrerequisites(): Promise<void> {
  const account = asRecord(
    await api.get(`act_${descriptor.accountId}`, {
      fields: 'id,name,currency,account_status',
    }),
  );
  if (!scalarString(account.id).endsWith(descriptor.accountId)) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_ACCOUNT_MISMATCH');
  }
  if (scalarString(account.currency) !== 'BRL' || finiteNumber(account.account_status) !== 1) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_ACCOUNT_NOT_READY');
  }

  const campaign = asRecord(
    await api.get(descriptor.campaignId, {
      fields: 'id,name,status,effective_status,objective',
    }),
  );
  if (
    scalarString(campaign.id) !== descriptor.campaignId ||
    scalarString(campaign.status) !== 'ACTIVE' ||
    scalarString(campaign.objective) !== 'OUTCOME_SALES'
  ) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_CAMPAIGN_NOT_READY');
  }

  const permissions = asRecord(await api.get('me/permissions'));
  const rows = Array.isArray(permissions.data) ? permissions.data.map(asRecord) : [];
  const granted = rows
    .filter((row) => row.status === 'granted')
    .map((row) => scalarString(row.permission));
  if (!granted.includes('ads_management')) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_ADS_MANAGEMENT_REQUIRED');
  }

  for (const city of descriptor.cities) {
    const source = asRecord(
      await api.get(city.sourceFeedAdSetId, {
        fields:
          'id,campaign_id,status,effective_status,lifetime_budget,optimization_goal,billing_event,promoted_object,targeting,end_time',
      }),
    );
    if (
      scalarString(source.campaign_id) !== descriptor.campaignId ||
      scalarString(source.status) !== 'ACTIVE' ||
      finiteNumber(source.lifetime_budget) !== city.lifetimeBudgetMinor
    ) {
      throw new Error(`META_ADS_ITACARE_FEED_18_35_SOURCE_MISMATCH_${city.key}`);
    }
  }
}

async function assertNoDuplicateAdSets(): Promise<void> {
  const response = asRecord(
    await api.get(`${descriptor.campaignId}/adsets`, {
      fields: 'id,name,status,effective_status',
      limit: '200',
    }),
  );
  const rows = Array.isArray(response.data) ? response.data.map(asRecord) : [];
  const names = new Set(rows.map((row) => scalarString(row.name)));
  for (const city of descriptor.cities) {
    if (names.has(adSetNameFor(city))) {
      throw new Error(`META_ADS_ITACARE_FEED_18_35_DUPLICATE_ADSET_${city.key}`);
    }
  }
}

interface LoadedAsset {
  readonly key: CreativeKey;
  readonly sha256: string;
  readonly bytes: Buffer;
  readonly base64: string;
}

async function loadAssets(): Promise<readonly LoadedAsset[]> {
  const output: LoadedAsset[] = [];
  for (const creative of descriptor.creatives) {
    const path = `ops/meta-ads/the-party-itacare-2026-10-11/feed-18-35/${creative.fileName}`;
    const bytes = await readFile(path);
    if (bytes.length < 100_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error(`META_ADS_ITACARE_FEED_18_35_ASSET_INVALID_${creative.key}`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== creative.sha256) {
      throw new Error(`META_ADS_ITACARE_FEED_18_35_ASSET_SHA_MISMATCH_${creative.key}`);
    }
    output.push({ key: creative.key, sha256, bytes, base64: bytes.toString('base64') });
  }
  return output;
}

async function uploadImage(base64: string): Promise<string> {
  const response = asRecord(
    await api.post(`act_${descriptor.accountId}/adimages`, {
      bytes: base64,
    }),
  );
  const images = asRecord(response.images);
  for (const value of Object.values(images)) {
    const hash = scalarString(asRecord(value).hash);
    if (hash) return hash;
  }
  throw new Error('META_ADS_ITACARE_FEED_18_35_IMAGE_UPLOAD_HASH_NOT_RETURNED');
}

async function verifyCreated(
  adSetIds: readonly string[],
  creativeIds: readonly string[],
  adIds: readonly string[],
  imageHashes: ReadonlyMap<CreativeKey, string>,
): Promise<Readonly<Record<string, unknown>>> {
  if (adSetIds.length !== 4 || creativeIds.length !== 20 || adIds.length !== 20) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_CREATED_COUNTS_MISMATCH');
  }

  const verifiedAdSets: Record<string, unknown>[] = [];
  for (const [index, id] of adSetIds.entries()) {
    const city = descriptor.cities[index];
    if (!city) throw new Error('META_ADS_ITACARE_FEED_18_35_CITY_INDEX_MISSING');
    const row = asRecord(
      await api.get(id, {
        fields:
          'id,name,status,effective_status,lifetime_budget,start_time,end_time,targeting,promoted_object,optimization_goal,billing_event',
      }),
    );
    if (
      scalarString(row.status) !== 'PAUSED' ||
      scalarString(row.name) !== adSetNameFor(city) ||
      finiteNumber(row.lifetime_budget) !== city.lifetimeBudgetMinor
    ) {
      throw new Error(`META_ADS_ITACARE_FEED_18_35_ADSET_READBACK_${city.key}`);
    }
    const targeting = asRecord(row.targeting);
    if (finiteNumber(targeting.age_min) !== 18 || finiteNumber(targeting.age_max) !== 35) {
      throw new Error(`META_ADS_ITACARE_FEED_18_35_AGE_READBACK_${city.key}`);
    }
    verifiedAdSets.push(row);
  }

  const verifiedCreatives: Record<string, unknown>[] = [];
  for (const [index, id] of creativeIds.entries()) {
    const creativeSpec = descriptor.creatives[index % descriptor.creatives.length];
    if (!creativeSpec) throw new Error('META_ADS_ITACARE_FEED_18_35_CREATIVE_INDEX_MISSING');
    const row = asRecord(await api.get(id, { fields: 'id,name,object_story_spec' }));
    const story = asRecord(row.object_story_spec);
    const linkData = asRecord(story.link_data);
    const cta = asRecord(linkData.call_to_action);
    if (
      scalarString(linkData.link) !== descriptor.destinationUrl ||
      scalarString(cta.type) !== 'SHOP_NOW'
    ) {
      throw new Error('META_ADS_ITACARE_FEED_18_35_CREATIVE_READBACK');
    }
    const returnedHash = scalarString(linkData.image_hash);
    const expectedHash = imageHashes.get(creativeSpec.key);
    if (returnedHash && expectedHash && returnedHash !== expectedHash) {
      throw new Error('META_ADS_ITACARE_FEED_18_35_IMAGE_READBACK');
    }
    verifiedCreatives.push(row);
  }

  const verifiedAds: Record<string, unknown>[] = [];
  for (const id of adIds) {
    const row = asRecord(await api.get(id, { fields: 'id,name,status,effective_status,adset_id,creative' }));
    if (scalarString(row.status) !== 'PAUSED') {
      throw new Error('META_ADS_ITACARE_FEED_18_35_AD_NOT_PAUSED');
    }
    verifiedAds.push(row);
  }

  return {
    adSets: verifiedAdSets.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      effective_status: row.effective_status,
      lifetime_budget: row.lifetime_budget,
      targeting: row.targeting,
    })),
    creatives: verifiedCreatives.map((row) => ({ id: row.id, name: row.name })),
    ads: verifiedAds.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      effective_status: row.effective_status,
    })),
  };
}

function assertDescriptor(value: Descriptor): void {
  if (
    value.schemaVersion !== 1 ||
    value.accountId !== ACCOUNT_ID ||
    value.campaignId !== CAMPAIGN_ID ||
    value.pageId !== PAGE_ID ||
    value.destinationUrl !== DESTINATION_URL ||
    value.pixelId !== PIXEL_ID ||
    value.ageMin !== 18 ||
    value.ageMax !== 35 ||
    value.status !== 'PAUSED' ||
    value.cities.length !== 4 ||
    value.creatives.length !== 5
  ) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_DESCRIPTOR_INVALID');
  }
}

function assertExactApproval(): void {
  if (requiredEnv('META_ADS_ITACARE_FEED_18_35_EXPLICIT_APPROVAL') !== APPROVAL) {
    throw new Error('META_ADS_ITACARE_FEED_18_35_APPROVAL_MISMATCH');
  }
}

function descriptorSha256(value: Descriptor): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
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

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
