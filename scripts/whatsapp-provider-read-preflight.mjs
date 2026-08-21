const token = required('META_ACCESS_TOKEN');
const sourceSha = required('SOURCE_SHA');
const graphBase = env('META_GRAPH_BASE_URL', 'https://graph.facebook.com').replace(/\/$/, '');
const apiVersion = env('META_GRAPH_API_VERSION', 'v24.0');
const selector = {
  businessId: optional('WHATSAPP_BUSINESS_ID'),
  wabaId: optional('WHATSAPP_WABA_ID'),
  phoneNumberId: optional('WHATSAPP_PHONE_NUMBER_ID'),
};

const evidence = [];
const gates = {};
const details = {
  businessCandidates: [],
  wabaCandidates: [],
  phoneCandidates: [],
  approvedTemplates: [],
};

try {
  const permissions = await graph('me/permissions?limit=200');
  gates.token = permissions.ok;
  evidence.push(`meta:permissions:http:${permissions.status}`);
  const granted = new Set(
    safeArray(permissions.body?.data)
      .filter((row) => row?.status === 'granted' && typeof row?.permission === 'string')
      .map((row) => row.permission),
  );
  for (const scope of ['whatsapp_business_management', 'whatsapp_business_messaging']) {
    const present = granted.has(scope);
    gates[`scope_${scope}`] = present;
    evidence.push(`meta:scope:${scope}:${present ? 'granted' : 'missing'}`);
  }

  const businessesResponse = await graph('me/businesses?fields=id,name&limit=100');
  gates.business_api = businessesResponse.ok;
  evidence.push(`meta:businesses:http:${businessesResponse.status}`);
  const businesses = businessesResponse.ok
    ? safeArray(businessesResponse.body?.data).map(asset).filter(Boolean)
    : [];
  details.businessCandidates = businesses;
  for (const business of businesses) evidence.push(`meta:business:${business.id}`);

  const businessSelection = selectAsset(businesses, selector.businessId);
  gates.business_unambiguous = businessSelection.ok;
  evidence.push(`meta:business-selection:${businessSelection.reason}`);

  // Read all Business -> WABA edges for diagnostic evidence without selecting
  // or mutating any provider asset. Canonical execution still fails closed on
  // ambiguous Business selection.
  const wabaByBusiness = [];
  for (const business of businesses) {
    const [owned, client] = await Promise.all([
      graph(`${business.id}/owned_whatsapp_business_accounts?fields=id,name&limit=100`),
      graph(`${business.id}/client_whatsapp_business_accounts?fields=id,name&limit=100`),
    ]);
    evidence.push(`meta:business:${business.id}:waba-owned:http:${owned.status}`);
    evidence.push(`meta:business:${business.id}:waba-client:http:${client.status}`);
    const assets = dedupeAssets([
      ...safeArray(owned.body?.data).map(asset).filter(Boolean),
      ...safeArray(client.body?.data).map(asset).filter(Boolean),
    ]);
    wabaByBusiness.push({ businessId: business.id, assets });
  }

  if (businessSelection.ok) {
    const selectedWabas =
      wabaByBusiness.find((row) => row.businessId === businessSelection.value.id)?.assets ?? [];
    details.wabaCandidates = selectedWabas;
    for (const waba of selectedWabas) evidence.push(`meta:waba:${waba.id}`);
    const wabaSelection = selectAsset(selectedWabas, selector.wabaId);
    gates.waba_unambiguous = wabaSelection.ok;
    evidence.push(`meta:waba-selection:${wabaSelection.reason}`);

    if (wabaSelection.ok) {
      const phonesResponse = await graph(
        `${wabaSelection.value.id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status&limit=100`,
      );
      gates.phone_api = phonesResponse.ok;
      evidence.push(
        `meta:waba:${wabaSelection.value.id}:phone-numbers:http:${phonesResponse.status}`,
      );
      const phones = phonesResponse.ok
        ? safeArray(phonesResponse.body?.data).map(phoneAsset).filter(Boolean)
        : [];
      details.phoneCandidates = phones;
      for (const phone of phones) evidence.push(`meta:phone-number-id:${phone.id}`);
      const phoneSelection = selectAsset(phones, selector.phoneNumberId);
      gates.phone_unambiguous = phoneSelection.ok;
      evidence.push(`meta:phone-selection:${phoneSelection.reason}`);

      const templatesResponse = await graph(
        `${wabaSelection.value.id}/message_templates?fields=id,name,status,language,category,components&limit=100`,
      );
      gates.templates_api = templatesResponse.ok;
      evidence.push(
        `meta:waba:${wabaSelection.value.id}:templates:http:${templatesResponse.status}`,
      );
      const approved = templatesResponse.ok
        ? safeArray(templatesResponse.body?.data)
            .filter(
              (template) =>
                template?.status === 'APPROVED' &&
                text(template?.id) &&
                text(template?.name) &&
                text(template?.language),
            )
            .map((template) => ({
              id: String(template.id),
              name: String(template.name),
              status: 'APPROVED',
              language: String(template.language),
              category: text(template.category),
              variableCount: countTemplateVariables(template.components),
            }))
        : [];
      details.approvedTemplates = approved;
      gates.approved_template = approved.length > 0;
      evidence.push(`meta:templates:approved-count:${approved.length}`);
      for (const template of approved) {
        evidence.push(
          `meta:template:${template.id}:APPROVED:${template.language}:vars-${template.variableCount}`,
        );
      }
    } else {
      gates.phone_api = false;
      gates.phone_unambiguous = false;
      gates.templates_api = false;
      gates.approved_template = false;
    }
  } else {
    gates.waba_unambiguous = false;
    gates.phone_api = false;
    gates.phone_unambiguous = false;
    gates.templates_api = false;
    gates.approved_template = false;
  }

  const pass = Object.values(gates).length > 0 && Object.values(gates).every(Boolean);
  const result = {
    schemaVersion: 1,
    sourceSha,
    verifiedAt: new Date().toISOString(),
    provider: 'meta-whatsapp-cloud-api',
    mode: 'READ_ONLY_PROVIDER_PREFLIGHT',
    pass,
    gates,
    evidence: [...new Set(evidence)],
    details,
    safety: {
      providerWrites: false,
      messageSent: false,
      webhookMutated: false,
      templateMutated: false,
      lifecyclePromoted: false,
    },
  };
  console.log(`TOCA_WHATSAPP_READ_RESULT=${JSON.stringify(result)}`);
  if (!pass) process.exitCode = 1;
} catch (error) {
  const result = {
    schemaVersion: 1,
    sourceSha,
    verifiedAt: new Date().toISOString(),
    provider: 'meta-whatsapp-cloud-api',
    mode: 'READ_ONLY_PROVIDER_PREFLIGHT',
    pass: false,
    gates: { probe_completed: false },
    evidence: [`probe:error:${errorCode(error)}`],
    details,
    safety: {
      providerWrites: false,
      messageSent: false,
      webhookMutated: false,
      templateMutated: false,
      lifecyclePromoted: false,
    },
  };
  console.log(`TOCA_WHATSAPP_READ_RESULT=${JSON.stringify(result)}`);
  process.exitCode = 1;
}

async function graph(path) {
  try {
    const response = await fetch(`${graphBase}/${apiVersion}/${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const raw = await response.text();
    let body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, transportError: errorCode(error) };
  }
}

function selectAsset(candidates, id) {
  if (id) {
    const matches = candidates.filter((candidate) => candidate.id === id);
    return matches.length === 1
      ? { ok: true, value: matches[0], reason: 'selector-matched' }
      : {
          ok: false,
          value: null,
          reason: matches.length === 0 ? 'selector-not-found' : 'selector-ambiguous',
        };
  }
  return candidates.length === 1
    ? { ok: true, value: candidates[0], reason: 'unique' }
    : {
        ok: false,
        value: null,
        reason: candidates.length === 0 ? 'not-found' : 'ambiguous',
      };
}

function asset(value) {
  const id = text(value?.id);
  if (!id) return null;
  return { id, name: text(value?.name) };
}

function phoneAsset(value) {
  const id = text(value?.id);
  if (!id) return null;
  return {
    id,
    displayPhoneNumberMasked: maskPhone(text(value?.display_phone_number)),
    verifiedName: text(value?.verified_name),
    qualityRating: text(value?.quality_rating),
    codeVerificationStatus: text(value?.code_verification_status),
  };
}

function dedupeAssets(values) {
  const map = new Map();
  for (const value of values) map.set(value.id, value);
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function countTemplateVariables(components) {
  const matches = JSON.stringify(components ?? []).match(/\{\{\d+\}\}/g) ?? [];
  return new Set(matches).size;
}

function maskPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `***${digits.slice(-4)}` : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorCode(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return error.code.replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
  }
  if (error instanceof Error) {
    return error.name.replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
  }
  return 'UNKNOWN';
}

function env(key, fallback) {
  return process.env[key]?.trim() || fallback;
}

function optional(key) {
  const value = process.env[key]?.trim();
  return value || null;
}

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`CONFIG_REQUIRED_${key}`);
  return value;
}
