import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { promises as dns } from 'node:dns';
import {
  assertAudienceEligibilitySnapshot,
  assertProductionProviderBinding,
  type EmailProviderAdapter,
  type ProviderBindingRef,
  type ProviderMessageReadback,
  type ProviderSendReceipt,
} from '../../omnichannel/contracts.js';
import {
  mapSendGridEventToDeliveryState,
  normalizeEmailAddress,
  providerPrivacySignalForEvent,
  resolveEmailTrackingSettings,
  type EmailDeliveryState,
  type EmailProviderPrivacySignal,
} from '../../omnichannel/email-runtime.js';

export const SENDGRID_PROVIDER_KEY = 'twilio-sendgrid' as const;

export interface SendGridConfig {
  readonly apiKey: string;
  readonly apiBaseUrl?: string;
  readonly sendingDomain: string;
  readonly fromEmail: string;
  readonly fromName: string;
  readonly replyToEmail?: string | null;
  readonly bindingId: string;
  readonly bindingState: ProviderBindingRef['state'];
  readonly eventWebhookPublicKeyPem?: string | null;
  readonly inboundParseEnabled?: boolean;
  readonly inboundParseHostname?: string | null;
  readonly inboundParsePublicKeyPem?: string | null;
  readonly emailActivityReadbackEnabled?: boolean;
}

export interface SendGridAttachmentPayload {
  readonly contentBase64: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly disposition: 'attachment' | 'inline';
  readonly contentId?: string | null;
}

export interface SendGridPreparedEmail {
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly subject: string;
  readonly text?: string | null;
  readonly html?: string | null;
  readonly internetMessageId: string;
  readonly inReplyTo?: string | null;
  readonly references?: readonly string[];
  readonly customArgs: Readonly<Record<string, string>>;
  readonly unsubscribeGroupId?: number | null;
  readonly openTrackingRequested: boolean;
  readonly clickTrackingRequested: boolean;
  readonly privacyTrackingAllowed: boolean;
  readonly policyTrackingAllowed: boolean;
  readonly attachments?: readonly SendGridAttachmentPayload[];
}

export interface SendGridPreparedCampaignResolver {
  resolve(preparedCampaignRef: string): Promise<SendGridPreparedEmail>;
}

export interface SendGridAuthenticatedDomainReadback {
  readonly id: number;
  readonly domain: string;
  readonly subdomain: string | null;
  readonly valid: boolean;
  readonly default: boolean;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface SendGridCredentialReadback {
  readonly valid: boolean;
  readonly authenticatedDomainFound: boolean;
  readonly authenticatedDomainValid: boolean;
  readonly sendingDomain: string;
  readonly evidence: readonly string[];
}

export interface SendGridDnsReadback {
  readonly domain: string;
  readonly spf: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly dkim: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly dmarc: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly evidence: readonly string[];
}

export interface SendGridSuppressionReadback {
  readonly email: string;
  readonly globalUnsubscribe: boolean;
  readonly bounced: boolean;
  readonly spamReported: boolean;
  readonly suppressed: boolean;
  readonly evidence: readonly string[];
}

export interface SendGridReputationReadback {
  readonly startDate: string;
  readonly delivered: number;
  readonly bounces: number;
  readonly spamReports: number;
  readonly unsubscribes: number;
  readonly requests: number;
  readonly bounceRate: number;
  readonly spamReportRate: number;
  readonly evidence: readonly string[];
}

export interface SendGridWebhookEvent {
  readonly providerEventId: string;
  readonly providerMessageId: string;
  readonly eventType: string;
  readonly email: string | null;
  readonly occurredAt: string;
  readonly deliveryState: EmailDeliveryState | null;
  readonly privacySignal: EmailProviderPrivacySignal | null;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface SendGridInboundParseEnvelope {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string | null;
  readonly html: string | null;
  readonly headers: string;
  readonly spamScore: number | null;
  readonly spamReport: string | null;
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly charsets: Readonly<Record<string, unknown>>;
  readonly attachmentCount: number;
}

type FetchLike = typeof fetch;

export class SendGridHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    readonly providerBodyEvidence: string,
  ) {
    super(`SENDGRID_MAIL_SEND_FAILED:${status}:provider-rejected`);
    this.name = 'SendGridHttpError';
  }
}

export class SendGridEmailProvider implements EmailProviderAdapter {
  readonly binding: ProviderBindingRef;
  private readonly apiBaseUrl: string;

  constructor(
    private readonly config: SendGridConfig,
    private readonly resolver: SendGridPreparedCampaignResolver,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    validateSendGridConfig(config);
    this.apiBaseUrl = (config.apiBaseUrl ?? 'https://api.sendgrid.com').replace(/\/$/, '');
    this.binding = {
      providerKey: SENDGRID_PROVIDER_KEY,
      bindingId: config.bindingId,
      state: config.bindingState,
    };
  }

  async sendCampaign(
    input: Parameters<EmailProviderAdapter['sendCampaign']>[0],
  ): Promise<ProviderSendReceipt> {
    assertProductionProviderBinding(this.binding);
    assertAudienceEligibilitySnapshot(input.eligibilitySnapshot);
    if (input.approval.status !== 'APPROVED') throw new Error('SENDGRID_APPROVAL_NOT_ACTIVE');
    if (
      input.approval.tenantId !== input.tenantId ||
      input.approval.workspaceId !== input.workspaceId ||
      input.approval.organizationId !== input.organizationId ||
      input.approval.correlationId !== input.correlationId
    ) {
      throw new Error('SENDGRID_APPROVAL_SCOPE_MISMATCH');
    }

    const prepared = await this.resolver.resolve(input.preparedCampaignRef);
    const payload = this.buildMailSendPayload(prepared, input.idempotencyKey);
    const response = await this.request('/v3/mail/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (response.status !== 202) {
      throw new SendGridHttpError(
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
        await safeResponseText(response),
      );
    }
    const providerMessageId = response.headers.get('x-message-id')?.trim();
    if (!providerMessageId) throw new Error('SENDGRID_MESSAGE_ID_MISSING');
    const acceptedAt = new Date().toISOString();
    return {
      provider: SENDGRID_PROVIDER_KEY,
      providerMessageId,
      acceptedAt,
      state: 'ACCEPTED',
      evidence: [`sendgrid:mail-send:202`, `sendgrid:x-message-id:${providerMessageId}`],
    };
  }

  async readback(providerMessageId: string): Promise<ProviderMessageReadback> {
    if (!this.config.emailActivityReadbackEnabled) {
      throw new Error('SENDGRID_EMAIL_ACTIVITY_READBACK_NOT_ENABLED');
    }
    const id = requireText(providerMessageId, 'SENDGRID_PROVIDER_MESSAGE_ID_REQUIRED');
    const response = await this.request(`/v3/messages/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error(
        `SENDGRID_MESSAGE_READBACK_FAILED:${response.status}:${await safeResponseText(response)}`,
      );
    }
    const body = asObject(await response.json());
    const providerStatus = optionalString(body.status)?.toLowerCase() ?? 'unknown';
    const state = mapActivityStatus(providerStatus);
    return {
      provider: SENDGRID_PROVIDER_KEY,
      providerMessageId: id,
      state,
      observedAt: new Date().toISOString(),
      evidence: [`sendgrid:email-activity:${providerStatus}`],
    };
  }

  async validateCredentialsAndDomain(): Promise<SendGridCredentialReadback> {
    const evidence: string[] = [];
    const response = await this.request('/v3/whitelabel/domains?limit=200&offset=0', {
      method: 'GET',
    });
    if (!response.ok) {
      return {
        valid: false,
        authenticatedDomainFound: false,
        authenticatedDomainValid: false,
        sendingDomain: this.config.sendingDomain,
        evidence: [`sendgrid:authenticated-domains:http:${response.status}`],
      };
    }
    evidence.push('sendgrid:credentials:api-key-accepted');
    const raw: unknown = await response.json();
    const domains = Array.isArray(raw) ? raw.map(parseAuthenticatedDomain) : [];
    const sendingDomain = normalizeDomain(this.config.sendingDomain);
    const match = domains.find((domain) => {
      const authenticated = normalizeDomain(domain.domain);
      const subdomain = domain.subdomain
        ? normalizeDomain(`${domain.subdomain}.${domain.domain}`)
        : null;
      return authenticated === sendingDomain || subdomain === sendingDomain;
    });
    if (!match) {
      evidence.push(`sendgrid:authenticated-domain:not-found:${sendingDomain}`);
      return {
        valid: true,
        authenticatedDomainFound: false,
        authenticatedDomainValid: false,
        sendingDomain,
        evidence,
      };
    }
    evidence.push(`sendgrid:authenticated-domain:${match.id}:${match.valid ? 'valid' : 'invalid'}`);
    return {
      valid: true,
      authenticatedDomainFound: true,
      authenticatedDomainValid: match.valid,
      sendingDomain,
      evidence,
    };
  }

  async getAuthenticatedDomains(): Promise<readonly SendGridAuthenticatedDomainReadback[]> {
    const response = await this.request('/v3/whitelabel/domains?limit=200&offset=0', {
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error(
        `SENDGRID_AUTHENTICATED_DOMAINS_FAILED:${response.status}:${await safeResponseText(response)}`,
      );
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('SENDGRID_AUTHENTICATED_DOMAINS_RESPONSE_INVALID');
    return body.map(parseAuthenticatedDomain);
  }

  async readSuppression(emailAddress: string): Promise<SendGridSuppressionReadback> {
    const email = normalizeEmailAddress(emailAddress);
    const encoded = encodeURIComponent(email);
    const [globalUnsubscribe, bounced, spamReported] = await Promise.all([
      this.exists(`/v3/asm/suppressions/global/${encoded}`),
      this.exists(`/v3/suppression/bounces/${encoded}`),
      this.exists(`/v3/suppression/spam_reports/${encoded}`),
    ]);
    return {
      email,
      globalUnsubscribe,
      bounced,
      spamReported,
      suppressed: globalUnsubscribe || bounced || spamReported,
      evidence: [
        `sendgrid:suppression:global:${globalUnsubscribe}`,
        `sendgrid:suppression:bounce:${bounced}`,
        `sendgrid:suppression:spam:${spamReported}`,
      ],
    };
  }

  async readReputation(startDate: string): Promise<SendGridReputationReadback> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      throw new Error('SENDGRID_STATS_START_DATE_INVALID');
    const response = await this.request(
      `/v3/stats?start_date=${encodeURIComponent(startDate)}&aggregated_by=day`,
      {
        method: 'GET',
      },
    );
    if (!response.ok) {
      throw new Error(
        `SENDGRID_STATS_READBACK_FAILED:${response.status}:${await safeResponseText(response)}`,
      );
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('SENDGRID_STATS_RESPONSE_INVALID');
    let delivered = 0;
    let bounces = 0;
    let spamReports = 0;
    let unsubscribes = 0;
    let requests = 0;
    for (const rowValue of body) {
      const row = asObject(rowValue);
      const stats = Array.isArray(row.stats) ? row.stats : [];
      for (const statValue of stats) {
        const stat = asObject(statValue);
        const metrics = asObject(stat.metrics);
        delivered += optionalNumber(metrics.delivered) ?? 0;
        bounces += optionalNumber(metrics.bounces) ?? 0;
        spamReports += optionalNumber(metrics.spam_reports) ?? 0;
        unsubscribes += optionalNumber(metrics.unsubscribes) ?? 0;
        requests += optionalNumber(metrics.requests) ?? 0;
      }
    }
    return {
      startDate,
      delivered,
      bounces,
      spamReports,
      unsubscribes,
      requests,
      bounceRate: requests === 0 ? 0 : bounces / requests,
      spamReportRate: delivered === 0 ? 0 : spamReports / delivered,
      evidence: [`sendgrid:stats:start:${startDate}`, `sendgrid:stats:rows:${body.length}`],
    };
  }

  buildMailSendPayload(
    prepared: SendGridPreparedEmail,
    idempotencyKey: string,
  ): Readonly<Record<string, unknown>> {
    const to = normalizeRecipientList(prepared.to, 'SENDGRID_TO_REQUIRED');
    const cc = normalizeOptionalRecipientList(prepared.cc);
    const bcc = normalizeOptionalRecipientList(prepared.bcc);
    const subject = requireText(prepared.subject, 'SENDGRID_SUBJECT_REQUIRED');
    if (!prepared.text?.trim() && !prepared.html?.trim())
      throw new Error('SENDGRID_CONTENT_REQUIRED');
    const tracking = resolveEmailTrackingSettings({
      privacyAllowed: prepared.privacyTrackingAllowed,
      policyAllowed: prepared.policyTrackingAllowed,
      openTrackingRequested: prepared.openTrackingRequested,
      clickTrackingRequested: prepared.clickTrackingRequested,
    });
    const personalization: Record<string, unknown> = {
      to: to.map((email) => ({ email })),
      custom_args: {
        ...prepared.customArgs,
        toca_idempotency_key: requireText(idempotencyKey, 'SENDGRID_IDEMPOTENCY_KEY_REQUIRED'),
      },
    };
    if (cc.length > 0) personalization.cc = cc.map((email) => ({ email }));
    if (bcc.length > 0) personalization.bcc = bcc.map((email) => ({ email }));

    const headers: Record<string, string> = {
      'Message-ID': requireText(
        prepared.internetMessageId,
        'SENDGRID_INTERNET_MESSAGE_ID_REQUIRED',
      ),
    };
    if (prepared.inReplyTo?.trim()) headers['In-Reply-To'] = prepared.inReplyTo.trim();
    if (prepared.references && prepared.references.length > 0) {
      headers.References = prepared.references.join(' ');
    }

    const content: { type: string; value: string }[] = [];
    if (prepared.text?.trim()) content.push({ type: 'text/plain', value: prepared.text });
    if (prepared.html?.trim()) content.push({ type: 'text/html', value: prepared.html });

    const payload: Record<string, unknown> = {
      personalizations: [personalization],
      from: { email: this.config.fromEmail, name: this.config.fromName },
      subject,
      content,
      headers,
      tracking_settings: {
        open_tracking: { enable: tracking.openTracking },
        click_tracking: { enable: tracking.clickTracking, enable_text: tracking.clickTracking },
      },
    };
    if (this.config.replyToEmail) payload.reply_to = { email: this.config.replyToEmail };
    if (prepared.unsubscribeGroupId !== undefined && prepared.unsubscribeGroupId !== null) {
      if (!Number.isInteger(prepared.unsubscribeGroupId) || prepared.unsubscribeGroupId <= 0) {
        throw new Error('SENDGRID_UNSUBSCRIBE_GROUP_ID_INVALID');
      }
      payload.asm = { group_id: prepared.unsubscribeGroupId };
    }
    if (prepared.attachments && prepared.attachments.length > 0) {
      payload.attachments = prepared.attachments.map((attachment) => {
        const item: Record<string, unknown> = {
          content: requireText(attachment.contentBase64, 'SENDGRID_ATTACHMENT_CONTENT_REQUIRED'),
          filename: requireText(attachment.fileName, 'SENDGRID_ATTACHMENT_FILENAME_REQUIRED'),
          type: requireText(attachment.contentType, 'SENDGRID_ATTACHMENT_CONTENT_TYPE_REQUIRED'),
          disposition: attachment.disposition,
        };
        if (attachment.contentId) item.content_id = attachment.contentId;
        return item;
      });
    }
    // Never set any SendGrid bypass_* mail setting here. Provider suppressions
    // remain effective in addition to canonical Privacy suppression checks.
    return payload;
  }

  verifySignedEventWebhook(rawBody: Buffer, timestamp: string, signatureBase64: string): boolean {
    const publicKeyPem = this.config.eventWebhookPublicKeyPem?.trim();
    if (!publicKeyPem) throw new Error('SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY_REQUIRED');
    const data = Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]);
    const signature = Buffer.from(signatureBase64, 'base64');
    return verifySignature('sha256', data, createPublicKey(publicKeyPem), signature);
  }

  normalizeEventWebhook(rawBody: Buffer): readonly SendGridWebhookEvent[] {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    if (!Array.isArray(parsed)) throw new Error('SENDGRID_EVENT_WEBHOOK_BODY_INVALID');
    return parsed.map((value) => {
      const raw = asObject(value);
      const eventType = requireText(
        optionalString(raw.event) ?? '',
        'SENDGRID_EVENT_TYPE_REQUIRED',
      );
      const providerMessageId = requireText(
        optionalString(raw.sg_message_id) ?? optionalString(raw['smtp-id']) ?? '',
        'SENDGRID_EVENT_MESSAGE_ID_REQUIRED',
      );
      const timestampSeconds = optionalNumber(raw.timestamp);
      if (timestampSeconds === null) throw new Error('SENDGRID_EVENT_TIMESTAMP_REQUIRED');
      const providerEventId =
        optionalString(raw.sg_event_id) ?? `${providerMessageId}:${eventType}:${timestampSeconds}`;
      const email = optionalString(raw.email);
      return {
        providerEventId,
        providerMessageId,
        eventType,
        email: email ? normalizeEmailAddress(email) : null,
        occurredAt: new Date(timestampSeconds * 1000).toISOString(),
        deliveryState: mapSendGridEventToDeliveryState(eventType),
        privacySignal: providerPrivacySignalForEvent(eventType),
        raw,
      };
    });
  }

  verifySignedInboundParse(rawBody: Buffer, timestamp: string, signatureBase64: string): boolean {
    const publicKeyPem = this.config.inboundParsePublicKeyPem?.trim();
    if (!publicKeyPem) throw new Error('SENDGRID_INBOUND_PARSE_PUBLIC_KEY_REQUIRED');
    const data = Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]);
    return verifySignature(
      'sha256',
      data,
      createPublicKey(publicKeyPem),
      Buffer.from(signatureBase64, 'base64'),
    );
  }

  normalizeInboundParse(fields: Readonly<Record<string, string>>): SendGridInboundParseEnvelope {
    const envelope = parseJsonObject(fields.envelope, 'SENDGRID_INBOUND_ENVELOPE_INVALID');
    const charsets = parseJsonObject(fields.charsets ?? '{}', 'SENDGRID_INBOUND_CHARSETS_INVALID');
    const to = splitAddresses(fields.to ?? optionalString(envelope.to) ?? '');
    const attachmentCount = Number.parseInt(fields.attachments ?? '0', 10);
    if (!Number.isInteger(attachmentCount) || attachmentCount < 0) {
      throw new Error('SENDGRID_INBOUND_ATTACHMENT_COUNT_INVALID');
    }
    const spamScore = fields.spam_score === undefined ? null : Number.parseFloat(fields.spam_score);
    if (spamScore !== null && !Number.isFinite(spamScore))
      throw new Error('SENDGRID_INBOUND_SPAM_SCORE_INVALID');
    return {
      from: normalizeEmailAddress(
        extractMailbox(fields.from ?? optionalString(envelope.from) ?? ''),
      ),
      to,
      subject: fields.subject ?? '',
      text: fields.text ?? null,
      html: fields.html ?? null,
      headers: fields.headers ?? '',
      spamScore,
      spamReport: fields.spam_report ?? null,
      envelope,
      charsets,
      attachmentCount,
    };
  }

  private async exists(path: string): Promise<boolean> {
    const response = await this.request(path, { method: 'GET' });
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `SENDGRID_SUPPRESSION_READBACK_FAILED:${response.status}:${await safeResponseText(response)}`,
      );
    }
    return true;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.config.apiKey}`);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    return this.fetchImpl(`${this.apiBaseUrl}${path}`, { ...init, headers });
  }
}

export async function validateSendGridDns(input: {
  readonly sendingDomain: string;
  readonly expectedDkimRecords: readonly { readonly host: string; readonly target: string }[];
  readonly expectedSpfInclude?: string;
}): Promise<SendGridDnsReadback> {
  const domain = normalizeDomain(input.sendingDomain);
  const evidence: string[] = [];
  const spfInclude = (input.expectedSpfInclude ?? 'sendgrid.net').toLowerCase();
  let spf: SendGridDnsReadback['spf'] = 'UNKNOWN';
  let dmarc: SendGridDnsReadback['dmarc'] = 'UNKNOWN';
  let dkim: SendGridDnsReadback['dkim'] =
    input.expectedDkimRecords.length === 0 ? 'UNKNOWN' : 'PASS';

  try {
    const records = (await dns.resolveTxt(domain)).map((parts) => parts.join(''));
    const spfRecord = records.find((record) => /^v=spf1\b/i.test(record));
    spf = spfRecord && spfRecord.toLowerCase().includes(`include:${spfInclude}`) ? 'PASS' : 'FAIL';
    evidence.push(`dns:spf:${spf}:${spfRecord ?? 'missing'}`);
  } catch (error) {
    spf = 'FAIL';
    evidence.push(`dns:spf:FAIL:${errorCode(error)}`);
  }

  for (const record of input.expectedDkimRecords) {
    try {
      const values = await dns.resolveCname(record.host);
      const expected = normalizeDomain(record.target);
      const matched = values.some((value) => normalizeDomain(value) === expected);
      evidence.push(`dns:dkim:${record.host}:${matched ? 'PASS' : 'FAIL'}`);
      if (!matched) dkim = 'FAIL';
    } catch (error) {
      dkim = 'FAIL';
      evidence.push(`dns:dkim:${record.host}:FAIL:${errorCode(error)}`);
    }
  }

  try {
    const records = (await dns.resolveTxt(`_dmarc.${domain}`)).map((parts) => parts.join(''));
    const dmarcRecord = records.find((record) => /^v=DMARC1\b/i.test(record));
    dmarc = dmarcRecord ? 'PASS' : 'FAIL';
    evidence.push(`dns:dmarc:${dmarc}:${dmarcRecord ?? 'missing'}`);
  } catch (error) {
    dmarc = 'FAIL';
    evidence.push(`dns:dmarc:FAIL:${errorCode(error)}`);
  }

  return { domain, spf, dkim, dmarc, evidence };
}

export async function validateSendGridInboundMx(hostname: string): Promise<{
  readonly hostname: string;
  readonly mx: 'PASS' | 'FAIL';
  readonly evidence: readonly string[];
}> {
  const normalizedHostname = normalizeDomain(hostname);
  try {
    const records = await dns.resolveMx(normalizedHostname);
    const matching = records.filter(
      (record) => normalizeDomain(record.exchange) === 'mx.sendgrid.net',
    );
    const passed = matching.length > 0;
    return {
      hostname: normalizedHostname,
      mx: passed ? 'PASS' : 'FAIL',
      evidence: [
        `dns:inbound-mx:${passed ? 'PASS' : 'FAIL'}:${
          records.map((record) => `${record.priority}:${record.exchange}`).join(',') || 'missing'
        }`,
      ],
    };
  } catch (error) {
    return {
      hostname: normalizedHostname,
      mx: 'FAIL',
      evidence: [`dns:inbound-mx:FAIL:${errorCode(error)}`],
    };
  }
}

export function validateSendGridConfig(config: SendGridConfig): void {
  requireText(config.apiKey, 'SENDGRID_API_KEY_REQUIRED');
  const sendingDomain = normalizeDomain(config.sendingDomain);
  const fromEmail = normalizeEmailAddress(config.fromEmail);
  const fromDomain = fromEmail.slice(fromEmail.lastIndexOf('@') + 1);
  if (fromDomain !== sendingDomain && !fromDomain.endsWith(`.${sendingDomain}`)) {
    throw new Error('SENDGRID_FROM_DOMAIN_MISMATCH');
  }
  requireText(config.fromName, 'SENDGRID_FROM_NAME_REQUIRED');
  requireText(config.bindingId, 'SENDGRID_BINDING_ID_REQUIRED');
  if (config.replyToEmail) normalizeEmailAddress(config.replyToEmail);
  if (config.inboundParseEnabled) {
    if (!config.inboundParseHostname?.trim()) {
      throw new Error('SENDGRID_INBOUND_PARSE_HOSTNAME_REQUIRED');
    }
    normalizeDomain(config.inboundParseHostname);
    if (!config.inboundParsePublicKeyPem?.trim()) {
      throw new Error('SENDGRID_INBOUND_PARSE_PUBLIC_KEY_REQUIRED');
    }
  }
  if (config.apiBaseUrl && !/^https:\/\//i.test(config.apiBaseUrl)) {
    throw new Error('SENDGRID_API_BASE_URL_INVALID');
  }
}

function parseAuthenticatedDomain(value: unknown): SendGridAuthenticatedDomainReadback {
  const raw = asObject(value);
  const id = optionalNumber(raw.id);
  const domain = optionalString(raw.domain);
  if (id === null || !Number.isInteger(id) || !domain) {
    throw new Error('SENDGRID_AUTHENTICATED_DOMAIN_RESPONSE_INVALID');
  }
  return {
    id,
    domain,
    subdomain: optionalString(raw.subdomain),
    valid: raw.valid === true,
    default: raw.default === true,
    raw,
  };
}

function mapActivityStatus(status: string): ProviderMessageReadback['state'] {
  if (status.includes('delivered')) return 'DELIVERED';
  if (status.includes('processed') || status.includes('sent')) return 'SENT';
  if (status.includes('processing') || status.includes('queued')) return 'QUEUED';
  if (status.includes('bounce') || status.includes('dropped') || status.includes('not_delivered'))
    return 'FAILED';
  return 'UNKNOWN';
}

function normalizeRecipientList(values: readonly string[], code: string): readonly string[] {
  if (values.length === 0) throw new Error(code);
  return [...new Set(values.map(normalizeEmailAddress))];
}

function normalizeOptionalRecipientList(values: readonly string[] | undefined): readonly string[] {
  return values ? [...new Set(values.map(normalizeEmailAddress))] : [];
}

function splitAddresses(value: string): readonly string[] {
  return [
    ...new Set(value.split(',').map(extractMailbox).filter(Boolean).map(normalizeEmailAddress)),
  ];
}

function extractMailbox(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/<([^>]+)>/);
  return (match?.[1] ?? normalized).trim();
}

function parseJsonObject(
  value: string | undefined,
  code: string,
): Readonly<Record<string, unknown>> {
  if (!value) return {};
  try {
    return asObject(JSON.parse(value));
  } catch {
    throw new Error(code);
  }
}

function normalizeDomain(value: string): string {
  const normalized = requireText(value, 'SENDGRID_DOMAIN_REQUIRED')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) throw new Error('SENDGRID_DOMAIN_INVALID');
  return normalized;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SENDGRID_RESPONSE_OBJECT_REQUIRED');
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return 'unreadable-response';
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value?.trim()) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10) * 1_000;
  const dateMs = Date.parse(normalized);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
