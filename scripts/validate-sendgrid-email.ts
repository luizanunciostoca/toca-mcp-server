import { EnvironmentSecretResolver } from '../src/core/environment-secret-resolver.js';
import {
  SendGridEmailProvider,
  validateSendGridDns,
  validateSendGridInboundMx,
  type SendGridPreparedCampaignResolver,
} from '../src/providers/sendgrid/email-provider.js';
import { loadSendGridRuntimeConfig } from '../src/providers/sendgrid/runtime-config.js';

const secretResolver = new EnvironmentSecretResolver();
const loaded = await loadSendGridRuntimeConfig({ secretResolver });
if (!loaded.enabled || !loaded.config) {
  throw new Error('EMAIL_SENDGRID_VALIDATION_REQUIRES_ENABLED_CONFIG');
}

const resolver: SendGridPreparedCampaignResolver = {
  resolve() {
    return Promise.reject(new Error('EMAIL_SENDGRID_VALIDATION_DOES_NOT_SEND'));
  },
};

const provider = new SendGridEmailProvider(loaded.config, resolver);
const [providerReadback, dnsReadback, inboundMxReadback] = await Promise.all([
  provider.validateCredentialsAndDomain(),
  validateSendGridDns({
    sendingDomain: loaded.config.sendingDomain,
    expectedDkimRecords: loaded.expectedDkimRecords,
    expectedSpfInclude: loaded.expectedSpfInclude,
  }),
  loaded.config.inboundParseEnabled && loaded.config.inboundParseHostname
    ? validateSendGridInboundMx(loaded.config.inboundParseHostname)
    : Promise.resolve(null),
]);

const inboundEnabled = loaded.config.inboundParseEnabled === true;
const gates = {
  credentials: providerReadback.valid,
  sender_domain_found: providerReadback.authenticatedDomainFound,
  sender_domain_valid: providerReadback.authenticatedDomainValid,
  spf: dnsReadback.spf === 'PASS',
  dkim: dnsReadback.dkim === 'PASS',
  dmarc: dnsReadback.dmarc === 'PASS',
  event_webhook_signature_key: Boolean(loaded.config.eventWebhookPublicKeyPem?.trim()),
  inbound_parse_hostname: !inboundEnabled || Boolean(loaded.config.inboundParseHostname?.trim()),
  inbound_parse_signature_key:
    !inboundEnabled || Boolean(loaded.config.inboundParsePublicKeyPem?.trim()),
  inbound_parse_mx: !inboundEnabled || inboundMxReadback?.mx === 'PASS',
  independent_provider_readback: loaded.config.emailActivityReadbackEnabled === true,
};
const pass = Object.values(gates).every(Boolean);

console.log(
  JSON.stringify(
    {
      provider: 'twilio-sendgrid',
      sending_domain: loaded.config.sendingDomain,
      from_email: loaded.config.fromEmail,
      binding_state: loaded.config.bindingState,
      pass,
      gates,
      evidence: [
        ...providerReadback.evidence,
        ...dnsReadback.evidence,
        ...(inboundMxReadback?.evidence ?? []),
      ],
      safety: {
        sent_email: false,
        mutated_dns: false,
        mutated_suppressions: false,
      },
    },
    null,
    2,
  ),
);

if (!pass) process.exitCode = 1;
