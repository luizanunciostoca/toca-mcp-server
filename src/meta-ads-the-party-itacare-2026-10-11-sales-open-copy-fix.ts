import { loadConfig } from './config.js';
import { MetaAdsControlledGraphProvider } from './providers/meta-ads/meta-ads-controlled-graph-provider.js';
import { createMetaPublicationApiClient } from './providers/meta/meta-publication-client.js';

const APPROVAL = 'APPROVED_THE_PARTY_ITACARE_SALES_OPEN_COPY_FIX_20260925';
const ACCOUNT_ID = '311793958882290';
const CAMPAIGN_ID = '52622846509265';
const PAGE_ID = '306103746115875';
const INSTAGRAM_USER_ID = '17841402033495654';
const DESTINATION_URL = 'https://www.sympla.com.br/evento/the-party-exclusive-itacare/3569762';

const targets = [
  {
    adId: '52626772023265',
    adSetId: '52626771954265',
    adName: 'ITACARÉ | SALES_OPEN | FEED 18-35 | 25.09',
    message:
      'É oficial: as vendas estão abertas. Illusionize + Brisotti, 11 de outubro, Praia da Ribeira, Itacaré. Garanta seu ingresso pela Sympla.',
  },
  {
    adId: '52626772078465',
    adSetId: '52626772028665',
    adName: 'ILHÉUS | SALES_OPEN | FEED 18-35 | 25.09',
    message:
      'Ilhéus, as vendas estão abertas. Dia 11 de outubro, Illusionize + Brisotti esperam por você em Itacaré. Monte a turma e garanta seu ingresso pela Sympla.',
  },
  {
    adId: '52626772157265',
    adSetId: '52626772085865',
    adName: 'ITABUNA | SALES_OPEN | FEED 18-35 | 25.09',
    message:
      'Itabuna, as vendas estão abertas. Dia 11 de outubro, o destino é Itacaré para viver Illusionize + Brisotti na Praia da Ribeira. Garanta seu ingresso pela Sympla.',
  },
  {
    adId: '52626772231065',
    adSetId: '52626772163265',
    adName: 'VITÓRIA DA CONQUISTA | SALES_OPEN | FEED 18-35 | 25.09',
    message:
      'Vitória da Conquista, as vendas estão abertas. Programe a rota para Itacaré no dia 11 de outubro e garanta seu ingresso para Illusionize + Brisotti pela Sympla.',
  },
] as const;

if (requiredEnv('META_ADS_ITACARE_SALES_OPEN_COPY_FIX_APPROVAL') !== APPROVAL) {
  throw new Error('META_ADS_ITACARE_SALES_OPEN_COPY_FIX_APPROVAL_MISMATCH');
}

const config = loadConfig(process.env);
const api = createMetaPublicationApiClient(config);
const provider = new MetaAdsControlledGraphProvider(api);
const account = { adAccountId: ACCOUNT_ID, currency: 'BRL' } as const;

const campaign = asRecord(
  await api.get(CAMPAIGN_ID, { fields: 'id,name,status,effective_status,objective' }),
);
if (
  scalarString(campaign.id) !== CAMPAIGN_ID ||
  scalarString(campaign.status) !== 'ACTIVE' ||
  scalarString(campaign.objective) !== 'OUTCOME_SALES'
) {
  throw new Error('META_ADS_ITACARE_SALES_OPEN_COPY_FIX_CAMPAIGN_MISMATCH');
}

const originals = new Map<string, { creativeId: string; status: string }>();
const createdCreativeIds: string[] = [];

try {
  for (const target of targets) {
    const ad = asRecord(
      await api.get(target.adId, {
        fields: 'id,name,adset_id,campaign_id,status,effective_status,creative',
      }),
    );
    if (
      scalarString(ad.id) !== target.adId ||
      scalarString(ad.name) !== target.adName ||
      scalarString(ad.adset_id) !== target.adSetId ||
      scalarString(ad.campaign_id) !== CAMPAIGN_ID ||
      scalarString(ad.status) !== 'PAUSED'
    ) {
      throw new Error(`META_ADS_ITACARE_SALES_OPEN_COPY_FIX_AD_ENVELOPE_${target.adId}`);
    }

    const adSet = asRecord(
      await api.get(target.adSetId, {
        fields: 'id,name,campaign_id,status,effective_status,lifetime_budget,targeting',
      }),
    );
    if (
      scalarString(adSet.status) !== 'PAUSED' ||
      scalarString(adSet.campaign_id) !== CAMPAIGN_ID
    ) {
      throw new Error(`META_ADS_ITACARE_SALES_OPEN_COPY_FIX_ADSET_ENVELOPE_${target.adSetId}`);
    }

    const currentCreativeId = requiredScalar(asRecord(ad.creative).id, 'CURRENT_CREATIVE_ID');
    originals.set(target.adId, { creativeId: currentCreativeId, status: 'PAUSED' });
    const currentCreative = asRecord(
      await api.get(currentCreativeId, { fields: 'id,name,object_story_spec' }),
    );
    const currentSpec = asRecord(currentCreative.object_story_spec);
    const currentLinkData = asRecord(currentSpec.link_data);
    const currentLink = requiredScalar(currentLinkData.link, 'CURRENT_LINK');
    if (currentLink !== DESTINATION_URL) {
      throw new Error('META_ADS_ITACARE_SALES_OPEN_COPY_FIX_DESTINATION_MISMATCH');
    }

    const cta = asRecord(currentLinkData.call_to_action);
    if (scalarString(cta.type) !== 'SHOP_NOW') {
      throw new Error('META_ADS_ITACARE_SALES_OPEN_COPY_FIX_CTA_MISMATCH');
    }
    if (!scalarString(currentLinkData.image_hash)) {
      throw new Error('META_ADS_ITACARE_SALES_OPEN_COPY_FIX_IMAGE_HASH_MISSING');
    }

    const nextSpec = {
      ...currentSpec,
      link_data: {
        ...currentLinkData,
        message: target.message,
        call_to_action: {
          ...cta,
          type: 'SHOP_NOW',
          value: {
            ...asRecord(cta.value),
            link: currentLink,
          },
        },
      },
    };

    const created = await provider.createCreative(account, {
      name: `${scalarString(currentCreative.name) || target.adName} | COPY FIX 25.09`,
      pageId: PAGE_ID,
      instagramActorId: INSTAGRAM_USER_ID,
      objectStorySpec: nextSpec,
    });
    createdCreativeIds.push(created.id);

    await api.post(target.adId, {
      creative: JSON.stringify({ creative_id: created.id }),
      status: 'PAUSED',
    });
  }

  const verification: Record<string, unknown>[] = [];
  for (const [index, target] of targets.entries()) {
    const expectedCreativeId = createdCreativeIds[index];
    if (!expectedCreativeId) {
      throw new Error('META_ADS_ITACARE_SALES_OPEN_COPY_FIX_CREATED_CREATIVE_MISSING');
    }
    const ad = asRecord(
      await api.get(target.adId, {
        fields: 'id,name,adset_id,campaign_id,status,effective_status,creative',
      }),
    );
    if (
      scalarString(ad.status) !== 'PAUSED' ||
      requiredScalar(asRecord(ad.creative).id, 'FINAL_CREATIVE_ID') !== expectedCreativeId
    ) {
      throw new Error(`META_ADS_ITACARE_SALES_OPEN_COPY_FIX_AD_READBACK_${target.adId}`);
    }
    const creative = asRecord(
      await api.get(expectedCreativeId, { fields: 'id,name,object_story_spec' }),
    );
    const linkData = asRecord(asRecord(creative.object_story_spec).link_data);
    const finalMessage = scalarString(linkData.message);
    if (
      finalMessage !== target.message ||
      /R\$\s*110|1º\s*lote/i.test(finalMessage) ||
      scalarString(linkData.link) !== DESTINATION_URL ||
      scalarString(asRecord(linkData.call_to_action).type) !== 'SHOP_NOW'
    ) {
      throw new Error(`META_ADS_ITACARE_SALES_OPEN_COPY_FIX_CREATIVE_READBACK_${target.adId}`);
    }
    verification.push({
      adId: target.adId,
      adSetId: target.adSetId,
      adName: target.adName,
      adStatus: ad.status,
      effectiveStatus: ad.effective_status,
      creativeId: expectedCreativeId,
      message: finalMessage,
    });
  }

  console.log(
    `META_ADS_ITACARE_SALES_OPEN_COPY_FIX_RESULT=${JSON.stringify({
      status: 'CORRECTED_PAUSED',
      providerMutationExecuted: true,
      activationPerformed: false,
      campaignId: CAMPAIGN_ID,
      correctedAdCount: targets.length,
      newCreativeIds: createdCreativeIds,
      verification,
    })}`,
  );
} catch (error) {
  const rollback: Record<string, string> = {};
  for (const target of targets) {
    const original = originals.get(target.adId);
    if (!original) continue;
    try {
      await api.post(target.adId, {
        creative: JSON.stringify({ creative_id: original.creativeId }),
        status: original.status,
      });
      rollback[target.adId] = 'ORIGINAL_CREATIVE_RESTORED';
    } catch (rollbackError) {
      rollback[target.adId] = `ROLLBACK_FAILED:${normalizeError(rollbackError)}`;
    }
  }
  throw new Error(
    `META_ADS_ITACARE_SALES_OPEN_COPY_FIX_FAILED:${normalizeError(error)}:ROLLBACK=${JSON.stringify(rollback)}`,
  );
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

function requiredScalar(value: unknown, label: string): string {
  const result = scalarString(value);
  if (!result) throw new Error(`META_ADS_ITACARE_SALES_OPEN_COPY_FIX_${label}_MISSING`);
  return result;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
