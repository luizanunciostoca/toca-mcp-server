import { createHash } from 'node:crypto';
import { resolveTxt, resolveCname } from 'node:dns/promises';

const sourceSha = required('SOURCE_SHA');
const metaToken = required('META_ACCESS_TOKEN');
const sendGridApiKey = required('SENDGRID_API_KEY');
const metaGraphBaseUrl = env('META_GRAPH_BASE_URL', 'https://graph.facebook.com').replace(
  /\/$/,
  '',
);
const metaGraphApiVersion = env('META_GRAPH_API_VERSION', 'v24.0');
const sendGridApiBaseUrl = env('SENDGRID_API_BASE_URL', 'https://api.sendgrid.com').replace(
  /\/$/,
  '',
);

const expected = {
  businessId: optional('WHATSAPP_BUSINESS_ID'),
  wabaId: optional('WHATSAPP_WABA_ID'),
  phoneNumberId: optional('WHATSAPP_PHONE_NUMBER_ID'),
  sendingDomain: normalizeDomain(required('EMAIL_SENDGRID_SENDING_DOMAIN')),
  fromEmail: required('EMAIL_SENDGRID_FROM_EMAIL').toLowerCase(),
  eventWebhookUrl: optional('EMAIL_SENDGRID_EVENT_WEBHOOK_URL'),
};

const result = {
  schemaVersion: 1,
  sourceSha,
  verifiedAt: new Date().toISOString(),
  mode: 'READ_ONLY_PROVIDER_PREFLIGHT',
  sendgrid: await validateSendGrid().catch((error) => providerFailure('sendgrid', error)),
  whatsapp: await validateWhatsApp().catch((error) => providerFailure('whatsapp', error)),
  safety: {
    providerWrites: false,
    emailSent: false,
    whatsappSent: false,
    dnsMutated: false,
    webhookMutated: false,
    suppressionsMutated: false,
    lifecyclePromoted: false,
  },
};
result.overallPass = result.sendgrid.pass === true && result.whatsapp.pass === true;
console.log(`TOCA_PROVIDER_READ_RESULT=${JSON.stringify(result)}`);
if (!result.overallPass) process.exitCode = 1;

async function validateSendGrid() {
  const evidence = [];
  const gates = {};
  const sendGrid = (path) =>
    httpJson(`${sendGridApiBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${sendGridApiKey}`, Accept: 'application/json' },
    });

  const fromDomain = normalizeDomain(
    expected.fromEmail.slice(expected.fromEmail.lastIndexOf('@') + 1),
  );
  gates.sender_matches_domain =
    fromDomain === expected.sendingDomain || fromDomain.endsWith(`.${expected.sendingDomain}`);
  evidence.push(`sendgrid:sender-domain-match:${gates.sender_matches_domain}`);

  const domainsResponse = await sendGrid('/v3/whitelabel/domains?limit=200&offset=0');
  gates.api_key = domainsResponse.ok;
  evidence.push(`sendgrid:authenticated-domains:http:${domainsResponse.status}`);
  if (!domainsResponse.ok) {
    return finalize('twilio-sendgrid', gates, evidence, {
      sendingDomain: expected.sendingDomain,
      fromDomain,
    });
  }
  evidence.push('sendgrid:credentials:api-key-accepted');
  const domains = Array.isArray(domainsResponse.body) ? domainsResponse.body : [];
  const domain = domains.find((row) => {
    const base = normalizeDomain(text(row?.domain));
    const subdomain = text(row?.subdomain);
    const full = subdomain ? normalizeDomain(`${subdomain}.${base}`) : null;
    return base === expected.sendingDomain || full === expected.sendingDomain;
  });
  gates.domain_auth_found = Boolean(domain);
  gates.domain_auth_valid = domain?.valid === true;
  if (domain?.id !== undefined) {
    evidence.push(
      `sendgrid:authenticated-domain:${String(domain.id)}:${gates.domain_auth_valid ? 'valid' : 'invalid'}`,
    );
  } else {
    evidence.push(`sendgrid:authenticated-domain:not-found:${expected.sendingDomain}`);
  }

  const dnsEvidence = await validateSendGridDns(expected.sendingDomain, domain?.dns);
  gates.spf = dnsEvidence.spf;
  gates.dkim = dnsEvidence.dkim;
  gates.dmarc = dnsEvidence.dmarc;
  evidence.push(...dnsEvidence.evidence);

  const webhookResponse = await sendGrid('/v3/user/webhooks/event/settings/all');
  gates.event_webhook_api = webhookResponse.ok;
  evidence.push(`sendgrid:event-webhooks:http:${webhookResponse.status}`);
  let webhook = null;
  let webhookAmbiguous = false;
  if (webhookResponse.ok) {
    const raw = Array.isArray(webhookResponse.body?.webhooks) ? webhookResponse.body.webhooks : [];
    const eligible = raw
      .filter(
        (row) => row?.enabled === true && Boolean(text(row?.public_key)) && Boolean(text(row?.url)),
      )
      .map((row) => ({
        id: String(row.id ?? ''),
        url: normalizeUrl(text(row.url)),
        publicKey: text(row.public_key),
      }))
      .filter((row) => row.id && row.url && row.publicKey);
    if (expected.eventWebhookUrl) {
      const normalizedExpected = normalizeUrl(expected.eventWebhookUrl);
      const matches = eligible.filter((row) => row.url === normalizedExpected);
      webhookAmbiguous = matches.length > 1;
      webhook = matches.length === 1 ? matches[0] : null;
      evidence.push(
        `sendgrid:event-webhook:expected-url:${matches.length === 1 ? 'matched' : matches.length === 0 ? 'not-found' : 'ambiguous'}`,
      );
    } else {
      webhookAmbiguous = eligible.length > 1;
      webhook = eligible.length === 1 ? eligible[0] : null;
      evidence.push(`sendgrid:event-webhook:eligible-count:${eligible.length}`);
    }
  }
  gates.event_webhook_unambiguous = Boolean(webhook) && !webhookAmbiguous;
  gates.event_webhook_signature = Boolean(webhook?.publicKey);
  if (webhook) {
    evidence.push(`sendgrid:event-webhook:${webhook.id}`);
    evidence.push(`sendgrid:event-webhook:url:${webhook.url}`);
    evidence.push(`sendgrid:event-webhook:public-key-sha256:${sha256(webhook.publicKey)}`);
  }

  const now = new Date();
  const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const activityQuery = new URLSearchParams({
    limit: '1',
    query: `last_event_time BETWEEN TIMESTAMP \"${startDate} 00:00:00\" AND TIMESTAMP \"${now.toISOString().slice(0, 10)} 23:59:59\"`,
  });
  const activityResponse = await sendGrid(`/v3/messages?${activityQuery.toString()}`);
  gates.email_activity_api = activityResponse.ok;
  evidence.push(`sendgrid:email-activity:http:${activityResponse.status}`);

  const statsResponse = await sendGrid(
    `/v3/stats?start_date=${encodeURIComponent(startDate)}&aggregated_by=day`,
  );
  gates.statistics = statsResponse.ok;
  evidence.push(`sendgrid:stats:http:${statsResponse.status}`);
  const metrics = summarizeStats(statsResponse.ok ? statsResponse.body : []);

  const scopesResponse = await sendGrid('/v3/scopes');
  gates.scopes_api = scopesResponse.ok;
  evidence.push(`sendgrid:scopes:http:${scopesResponse.status}`);

  return finalize('twilio-sendgrid', gates, evidence, {
    sendingDomain: expected.sendingDomain,
    fromDomain,
    authenticatedDomainId: domain?.id == null ? null : String(domain.id),
    eventWebhookId: webhook?.id ?? null,
    eventWebhookUrl: webhook?.url ?? null,
    eventWebhookPublicKeySha256: webhook?.publicKey ? sha256(webhook.publicKey) : null,
    activityReturnedCount: safeArray(activityResponse.body?.messages).length,
    statistics: metrics,
  });
}

async function validateSendGridDns(sendingDomain, providerDns) {
  const evidence = [];
  let spf = false;
  let dkim = false;
  let dmarc = false;

  try {
    const records = (await resolveTxt(sendingDomain)).map((parts) => parts.join(''));
    const record = records.find((value) => /^v=spf1\b/i.test(value));
    spf = Boolean(record && /include:sendgrid\.net\b/i.test(record));
    evidence.push(`dns:spf:${spf ? 'PASS' : 'FAIL'}`);
  } catch (error) {
    evidence.push(`dns:spf:FAIL:${errorCode(error)}`);
  }

  const dkimRows = extractDkimRows(providerDns);
  if (dkimRows.length > 0) {
    dkim = true;
    for (const row of dkimRows) {
      try {
        const answers = await resolveCname(row.host);
        const matched = answers.some(
          (answer) => normalizeDomain(answer) === normalizeDomain(row.target),
        );
        dkim &&= matched;
        evidence.push(`dns:dkim:${row.host}:${matched ? 'PASS' : 'FAIL'}`);
      } catch (error) {
        dkim = false;
        evidence.push(`dns:dkim:${row.host}:FAIL:${errorCode(error)}`);
      }
    }
  } else {
    evidence.push('dns:dkim:FAIL:no-provider-records');
  }

  try {
    const records = (await resolveTxt(`_dmarc.${sendingDomain}`)).map((parts) => parts.join(''));
    dmarc = records.some((value) => /^v=DMARC1\b/i.test(value));
    evidence.push(`dns:dmarc:${dmarc ? 'PASS' : 'FAIL'}`);
  } catch (error) {
    evidence.push(`dns:dmarc:FAIL:${errorCode(error)}`);
  }
  return { spf, dkim, dmarc, evidence };
}

function extractDkimRows(providerDns) {
  if (!providerDns || typeof providerDns !== 'object') return [];
  const rows = [];
  for (const [key, value] of Object.entries(providerDns)) {
    if (!/^dkim/i.test(key) || !value || typeof value !== 'object') continue;
    const host = text(value.host);
    const target = text(value.data);
    if (host && target) rows.push({ host: normalizeDomain(host), target: normalizeDomain(target) });
  }
  return rows;
}

async function validateWhatsApp() {
  const evidence = [];
  const gates = {};
  const graph = (path) =>
    httpJson(`${metaGraphBaseUrl}/${metaGraphApiVersion}/${path}`, {
      headers: { Authorization: `Bearer ${metaToken}`, Accept: 'application/json' },
    });

  const permissionsResponse = await graph('me/permissions?limit=200');
  gates.token = permissionsResponse.ok;
  evidence.push(`meta:permissions:http:${permissionsResponse.status}`);
  if (!permissionsResponse.ok) return finalize('meta-whatsapp-cloud-api', gates, evidence, {});
  const granted = new Set(
    safeArray(permissionsResponse.body?.data)
      .filter((item) => item?.status === 'granted' && typeof item?.permission === 'string')
      .map((item) => item.permission),
  );
  for (const scope of ['whatsapp_business_management', 'whatsapp_business_messaging']) {
    gates[`scope_${scope}`] = granted.has(scope);
    evidence.push(`meta:scope:${scope}:${granted.has(scope) ? 'granted' : 'missing'}`);
  }

  const businessesResponse = await graph('me/businesses?fields=id,name&limit=100');
  gates.business_api = businessesResponse.ok;
  evidence.push(`meta:businesses:http:${businessesResponse.status}`);
  if (!businessesResponse.ok) return finalize('meta-whatsapp-cloud-api', gates, evidence, {});
  const businesses = safeArray(businessesResponse.body?.data).map(asset).filter(Boolean);
  const businessSelection = selectProviderAsset(businesses, expected.businessId);
  gates.business_unambiguous = businessSelection.ok;
  evidence.push(`meta:business-selection:${businessSelection.reason}`);
  if (!businessSelection.ok) {
    return finalize('meta-whatsapp-cloud-api', gates, evidence, {
      businessCandidateCount: businesses.length,
    });
  }
  const business = businessSelection.value;
  evidence.push(`meta:business:${business.id}`);

  const wabaResponses = await Promise.all([
    graph(`${business.id}/owned_whatsapp_business_accounts?fields=id,name&limit=100`),
    graph(`${business.id}/client_whatsapp_business_accounts?fields=id,name&limit=100`),
  ]);
  const successfulWabaResponses = wabaResponses.filter((response) => response.ok);
  gates.waba_api = successfulWabaResponses.length > 0;
  evidence.push(`meta:waba-owned:http:${wabaResponses[0].status}`);
  evidence.push(`meta:waba-client:http:${wabaResponses[1].status}`);
  const wabas = dedupeAssets(
    successfulWabaResponses.flatMap((response) =>
      safeArray(response.body?.data).map(asset).filter(Boolean),
    ),
  );
  const wabaSelection = selectProviderAsset(wabas, expected.wabaId);
  gates.waba_unambiguous = wabaSelection.ok;
  evidence.push(`meta:waba-selection:${wabaSelection.reason}`);
  if (!wabaSelection.ok) {
    return finalize('meta-whatsapp-cloud-api', gates, evidence, {
      businessId: business.id,
      wabaCandidateCount: wabas.length,
    });
  }
  const waba = wabaSelection.value;
  evidence.push(`meta:waba:${waba.id}`);

  const phonesResponse = await graph(
    `${waba.id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status&limit=100`,
  );
  gates.phone_api = phonesResponse.ok;
  evidence.push(`meta:phone-numbers:http:${phonesResponse.status}`);
  const phones = phonesResponse.ok
    ? safeArray(phonesResponse.body?.data).map(phoneAsset).filter(Boolean)
    : [];
  const phoneSelection = selectProviderAsset(phones, expected.phoneNumberId);
  gates.phone_unambiguous = phoneSelection.ok;
  evidence.push(`meta:phone-selection:${phoneSelection.reason}`);
  if (!phoneSelection.ok) {
    return finalize('meta-whatsapp-cloud-api', gates, evidence, {
      businessId: business.id,
      wabaId: waba.id,
      phoneCandidateCount: phones.length,
    });
  }
  const phone = phoneSelection.value;
  evidence.push(`meta:phone-number-id:${phone.id}`);

  const templatesResponse = await graph(
    `${waba.id}/message_templates?fields=id,name,status,language,category,components&limit=100`,
  );
  gates.templates_api = templatesResponse.ok;
  evidence.push(`meta:templates:http:${templatesResponse.status}`);
  const templates = templatesResponse.ok ? safeArray(templatesResponse.body?.data) : [];
  const approvedTemplates = templates.filter(
    (template) =>
      template?.status === 'APPROVED' &&
      text(template?.id) &&
      text(template?.name) &&
      text(template?.language),
  );
  gates.approved_template = approvedTemplates.length > 0;
  evidence.push(`meta:templates:approved-count:${approvedTemplates.length}`);
  const templateSummary = approvedTemplates.map((template) => ({
    id: String(template.id),
    name: String(template.name),
    status: 'APPROVED',
    language: String(template.language),
    category: text(template.category),
    variableCount: countTemplateVariables(template.components),
  }));
  for (const template of templateSummary) {
    evidence.push(
      `meta:template:${template.id}:APPROVED:${template.language}:vars-${template.variableCount}`,
    );
  }

  return finalize('meta-whatsapp-cloud-api', gates, evidence, {
    businessId: business.id,
    wabaId: waba.id,
    phoneNumberId: phone.id,
    displayPhoneNumberMasked: maskPhone(phone.displayPhoneNumber),
    verifiedName: phone.verifiedName,
    qualityRating: phone.qualityRating,
    approvedTemplates: templateSummary,
  });
}

function finalize(provider, gates, evidence, details) {
  const pass = Object.values(gates).length > 0 && Object.values(gates).every(Boolean);
  return { provider, pass, gates, evidence: [...new Set(evidence)], details };
}

function providerFailure(provider, error) {
  return {
    provider,
    pass: false,
    gates: { probe_completed: false },
    evidence: [`probe:error:${errorCode(error)}`],
    details: {},
  };
}

async function httpJson(url, init) {
  try {
    const response = await fetch(url, init);
    const textBody = await response.text();
    let body = null;
    if (textBody) {
      try {
        body = JSON.parse(textBody);
      } catch {
        body = null;
      }
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, transportError: errorCode(error) };
  }
}

function selectProviderAsset(candidates, selector) {
  if (selector) {
    const matches = candidates.filter((candidate) => candidate.id === selector);
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
    : { ok: false, value: null, reason: candidates.length === 0 ? 'not-found' : 'ambiguous' };
}

function dedupeAssets(values) {
  const map = new Map();
  for (const value of values) map.set(value.id, value);
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
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
    displayPhoneNumber: text(value?.display_phone_number),
    verifiedName: text(value?.verified_name),
    qualityRating: text(value?.quality_rating),
  };
}

function countTemplateVariables(components) {
  const serialized = JSON.stringify(components ?? []);
  const matches = serialized.match(/\{\{\d+\}\}/g) ?? [];
  return new Set(matches).size;
}

function summarizeStats(body) {
  let delivered = 0;
  let bounces = 0;
  let spamReports = 0;
  let unsubscribes = 0;
  let requests = 0;
  for (const row of safeArray(body)) {
    for (const stat of safeArray(row?.stats)) {
      const metrics = stat?.metrics ?? {};
      delivered += number(metrics.delivered);
      bounces += number(metrics.bounces);
      spamReports += number(metrics.spam_reports);
      unsubscribes += number(metrics.unsubscribes);
      requests += number(metrics.requests);
    }
  }
  return { delivered, bounces, spamReports, unsubscribes, requests };
}

function normalizeUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

function maskPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `***${digits.slice(-4)}`;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function errorCode(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string')
    return error.code.replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
  if (error instanceof Error) return error.name.replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
  return 'UNKNOWN';
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function optional(key) {
  const value = process.env[key]?.trim();
  return value || null;
}

function env(key, fallback) {
  return process.env[key]?.trim() || fallback;
}

function required(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`CONFIG_REQUIRED_${key}`);
  return value;
}
