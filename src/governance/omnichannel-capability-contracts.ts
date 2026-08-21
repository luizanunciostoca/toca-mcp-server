import type { CapabilityContractOverride } from './capability-contract-overrides.js';
import type { JsonSchemaNode, JsonSchemaReference } from './types.js';

const text: JsonSchemaNode = { type: 'string', minLength: 1 };
const isoTimestamp: JsonSchemaNode = { type: 'string', format: 'date-time', minLength: 1 };
const scopeProperties = {
  tenant_id: text,
  workspace_id: text,
  organization_id: text,
  correlation_id: text,
} as const;
const scopeRequired = ['tenant_id', 'workspace_id', 'organization_id', 'correlation_id'] as const;

const singleRecipientEligibilityProperties = {
  contact_record_id: text,
  contact_resolution_id: text,
  contact_resolution_status: { type: 'string', const: 'RESOLVED' } as const,
  privacy_execution_id: text,
  privacy_subject_ref: text,
  privacy_state: { type: 'string', const: 'ALLOWED' } as const,
  privacy_blocked: { type: 'boolean', const: false } as const,
  privacy_purpose_id: text,
  privacy_channel: { type: 'string', enum: ['WHATSAPP', 'EMAIL'] } as const,
  policy_decision_id: text,
  policy_allowed: { type: 'boolean', const: true } as const,
} as const;
const singleRecipientEligibilityRequired = [
  'contact_record_id',
  'contact_resolution_id',
  'contact_resolution_status',
  'privacy_execution_id',
  'privacy_subject_ref',
  'privacy_state',
  'privacy_blocked',
  'privacy_purpose_id',
  'privacy_channel',
  'policy_decision_id',
  'policy_allowed',
] as const;

const approvalProperties = {
  approval_id: text,
  approval_status: { type: 'string', const: 'APPROVED' } as const,
} as const;

const audienceEligibilityProperties = {
  audience_snapshot_id: text,
  privacy_purpose_id: text,
  resolved_contact_count: { type: 'integer', minimum: 1 } as const,
  ambiguous_contact_count: { type: 'integer', const: 0 } as const,
  unresolved_contact_count: { type: 'integer', const: 0 } as const,
  privacy_unknown_blocked_count: { type: 'integer', const: 0 } as const,
  privacy_suppressed_count: { type: 'integer', const: 0 } as const,
  policy_denied_count: { type: 'integer', const: 0 } as const,
} as const;
const audienceEligibilityRequired = Object.keys(audienceEligibilityProperties);

function closedObject(
  id: string,
  properties: Readonly<Record<string, JsonSchemaNode>>,
  required: readonly string[],
): JsonSchemaReference {
  return {
    $id: id,
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function inputSchema(
  capabilityId: string,
  properties: Readonly<Record<string, JsonSchemaNode>>,
  required: readonly string[],
): JsonSchemaReference {
  return closedObject(
    `toca://capabilities/${capabilityId}/input/v1.1`,
    { ...scopeProperties, ...properties },
    [...scopeRequired, ...required],
  );
}

function outputSchema(
  capabilityId: string,
  properties: Readonly<Record<string, JsonSchemaNode>>,
  required: readonly string[],
): JsonSchemaReference {
  return closedObject(`toca://capabilities/${capabilityId}/output/v1.1`, properties, required);
}

function explicit(
  override: Omit<
    CapabilityContractOverride,
    'contract_quality' | 'required_scopes' | 'permission_requirements'
  >,
): CapabilityContractOverride {
  return {
    contract_quality: 'EXPLICIT',
    required_scopes: [],
    permission_requirements: [],
    ...override,
  };
}

const whatsappContactResolveInput = inputSchema('whatsapp.contact.resolve', { phone_e164: text }, [
  'phone_e164',
]);
const whatsappContactResolveOutput = outputSchema(
  'whatsapp.contact.resolve',
  {
    resolution_id: text,
    resolution_status: {
      type: 'string',
      enum: ['RESOLVED', 'AMBIGUOUS', 'NOT_FOUND'],
    },
    contact_record_id: { type: ['string', 'null'], minLength: 1 },
  },
  ['resolution_id', 'resolution_status', 'contact_record_id'],
);

const whatsappOptInInput = inputSchema(
  'whatsapp.opt_in.verify',
  {
    contact_record_id: text,
    privacy_subject_ref: text,
    purpose_id: text,
    preference_required: { type: 'boolean' },
  },
  ['contact_record_id', 'privacy_subject_ref', 'purpose_id', 'preference_required'],
);
const whatsappOptInOutput = outputSchema(
  'whatsapp.opt_in.verify',
  {
    privacy_execution_id: text,
    privacy_state: {
      type: 'string',
      enum: ['ALLOWED', 'SUPPRESSED', 'UNKNOWN_BLOCKED'],
    },
    privacy_blocked: { type: 'boolean' },
    purpose_id: text,
    channel: { type: 'string', const: 'WHATSAPP' },
    reasons: { type: 'array', items: text },
  },
  ['privacy_execution_id', 'privacy_state', 'privacy_blocked', 'purpose_id', 'channel', 'reasons'],
);

const whatsappTemplateValidateInput = inputSchema(
  'whatsapp.template.validate',
  {
    template_key: text,
    locale: text,
    variable_names: { type: 'array', items: text, maxItems: 100 },
  },
  ['template_key', 'locale', 'variable_names'],
);
const whatsappTemplateValidateOutput = outputSchema(
  'whatsapp.template.validate',
  {
    valid: { type: 'boolean' },
    provider_template_id: { type: ['string', 'null'], minLength: 1 },
    evidence: { type: 'array', items: text, minItems: 1 },
  },
  ['valid', 'provider_template_id', 'evidence'],
);

const whatsappPrepareInput = inputSchema(
  'whatsapp.message.prepare',
  {
    ...singleRecipientEligibilityProperties,
    template_key: text,
    locale: text,
    variables_ref: text,
  },
  [...singleRecipientEligibilityRequired, 'template_key', 'locale', 'variables_ref'],
);
const whatsappPrepareOutput = outputSchema(
  'whatsapp.message.prepare',
  {
    prepared_message_id: text,
    content_hash: text,
    state: { type: 'string', const: 'PREPARED' },
  },
  ['prepared_message_id', 'content_hash', 'state'],
);

const whatsappSendInput = inputSchema(
  'whatsapp.message.send',
  {
    ...singleRecipientEligibilityProperties,
    ...approvalProperties,
    message_id: text,
    prepared_message_id: text,
    idempotency_key: text,
  },
  [
    ...singleRecipientEligibilityRequired,
    'approval_id',
    'approval_status',
    'message_id',
    'prepared_message_id',
    'idempotency_key',
  ],
);
const whatsappSendOutput = outputSchema(
  'whatsapp.message.send',
  {
    provider_message_id: text,
    provider: text,
    state: { type: 'string', enum: ['SUBMITTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN'] },
    accepted_at: isoTimestamp,
  },
  ['provider_message_id', 'provider', 'state', 'accepted_at'],
);

const whatsappReadbackInput = inputSchema(
  'whatsapp.message.readback',
  { provider_message_id: text },
  ['provider_message_id'],
);
const whatsappReadbackOutput = outputSchema(
  'whatsapp.message.readback',
  {
    provider_message_id: text,
    state: {
      type: 'string',
      enum: ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'REJECTED', 'UNKNOWN'],
    },
    observed_at: isoTimestamp,
    evidence: { type: 'array', items: text, minItems: 1 },
  },
  ['provider_message_id', 'state', 'observed_at', 'evidence'],
);

const whatsappConversationIngestInput = inputSchema(
  'whatsapp.conversation.ingest',
  {
    provider_event_id: text,
    provider_conversation_id: text,
    occurred_at: isoTimestamp,
    payload_ref: text,
  },
  ['provider_event_id', 'provider_conversation_id', 'occurred_at', 'payload_ref'],
);
const whatsappConversationIngestOutput = outputSchema(
  'whatsapp.conversation.ingest',
  {
    ingestion_id: text,
    duplicate: { type: 'boolean' },
    state: { type: 'string', const: 'INGESTED' },
  },
  ['ingestion_id', 'duplicate', 'state'],
);

const emailContactResolveInput = inputSchema(
  'email.contact.resolve',
  { email_address: { type: 'string', format: 'email', minLength: 3 } },
  ['email_address'],
);
const emailContactResolveOutput = outputSchema(
  'email.contact.resolve',
  {
    resolution_id: text,
    resolution_status: {
      type: 'string',
      enum: ['RESOLVED', 'AMBIGUOUS', 'NOT_FOUND'],
    },
    contact_record_id: { type: ['string', 'null'], minLength: 1 },
  },
  ['resolution_id', 'resolution_status', 'contact_record_id'],
);

const emailSuppressionInput = inputSchema(
  'email.suppression.verify',
  {
    contact_record_id: text,
    privacy_subject_ref: text,
    purpose_id: text,
    preference_required: { type: 'boolean' },
  },
  ['contact_record_id', 'privacy_subject_ref', 'purpose_id', 'preference_required'],
);
const emailSuppressionOutput = outputSchema(
  'email.suppression.verify',
  {
    privacy_execution_id: text,
    privacy_state: {
      type: 'string',
      enum: ['ALLOWED', 'SUPPRESSED', 'UNKNOWN_BLOCKED'],
    },
    privacy_blocked: { type: 'boolean' },
    purpose_id: text,
    channel: { type: 'string', const: 'EMAIL' },
    reasons: { type: 'array', items: text },
  },
  ['privacy_execution_id', 'privacy_state', 'privacy_blocked', 'purpose_id', 'channel', 'reasons'],
);

const emailCampaignPrepareInput = inputSchema(
  'email.campaign.prepare',
  {
    ...audienceEligibilityProperties,
    campaign_key: text,
    subject_ref: text,
    content_ref: text,
  },
  [...audienceEligibilityRequired, 'campaign_key', 'subject_ref', 'content_ref'],
);
const emailCampaignPrepareOutput = outputSchema(
  'email.campaign.prepare',
  {
    prepared_campaign_id: text,
    audience_snapshot_id: text,
    content_hash: text,
    state: { type: 'string', const: 'PREPARED' },
  },
  ['prepared_campaign_id', 'audience_snapshot_id', 'content_hash', 'state'],
);

const emailCampaignSendInput = inputSchema(
  'email.campaign.send',
  {
    ...audienceEligibilityProperties,
    ...approvalProperties,
    message_id: text,
    prepared_campaign_id: text,
    idempotency_key: text,
  },
  [
    ...audienceEligibilityRequired,
    'approval_id',
    'approval_status',
    'message_id',
    'prepared_campaign_id',
    'idempotency_key',
  ],
);
const emailCampaignSendOutput = outputSchema(
  'email.campaign.send',
  {
    provider_dispatch_id: text,
    provider: text,
    state: { type: 'string', enum: ['SUBMITTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN'] },
    accepted_at: isoTimestamp,
  },
  ['provider_dispatch_id', 'provider', 'state', 'accepted_at'],
);

const emailDeliveryReadbackInput = inputSchema(
  'email.delivery.readback',
  { provider_dispatch_id: text },
  ['provider_dispatch_id'],
);
const emailDeliveryReadbackOutput = outputSchema(
  'email.delivery.readback',
  {
    provider_dispatch_id: text,
    state: {
      type: 'string',
      enum: ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'REJECTED', 'UNKNOWN'],
    },
    observed_at: isoTimestamp,
    evidence: { type: 'array', items: text, minItems: 1 },
  },
  ['provider_dispatch_id', 'state', 'observed_at', 'evidence'],
);

function emailEngagementIngestInput(capabilityId: string): JsonSchemaReference {
  return inputSchema(
    capabilityId,
    {
      provider_event_id: text,
      provider_message_id: text,
      contact_record_id: text,
      occurred_at: isoTimestamp,
      payload_ref: text,
    },
    ['provider_event_id', 'provider_message_id', 'contact_record_id', 'occurred_at', 'payload_ref'],
  );
}

function emailEngagementIngestOutput(capabilityId: string): JsonSchemaReference {
  return outputSchema(
    capabilityId,
    {
      ingestion_id: text,
      duplicate: { type: 'boolean' },
      state: { type: 'string', const: 'INGESTED' },
    },
    ['ingestion_id', 'duplicate', 'state'],
  );
}

const nurtureSequenceCreateInput = inputSchema(
  'nurture.sequence.create',
  {
    sequence_key: text,
    name: text,
    workflow_definition_id: text,
    steps_ref: text,
  },
  ['sequence_key', 'name', 'workflow_definition_id', 'steps_ref'],
);
const nurtureSequenceCreateOutput = outputSchema(
  'nurture.sequence.create',
  {
    sequence_id: text,
    workflow_definition_id: text,
    state: { type: 'string', const: 'DRAFT' },
  },
  ['sequence_id', 'workflow_definition_id', 'state'],
);

const nurtureSequenceEnrollInput = inputSchema(
  'nurture.sequence.enroll',
  {
    ...singleRecipientEligibilityProperties,
    ...approvalProperties,
    sequence_id: text,
    workflow_definition_id: text,
    idempotency_key: text,
  },
  [
    ...singleRecipientEligibilityRequired,
    'approval_id',
    'approval_status',
    'sequence_id',
    'workflow_definition_id',
    'idempotency_key',
  ],
);
const nurtureSequenceEnrollOutput = outputSchema(
  'nurture.sequence.enroll',
  {
    enrollment_id: text,
    workflow_instance_id: text,
    state: { type: 'string', const: 'ENROLLED' },
  },
  ['enrollment_id', 'workflow_instance_id', 'state'],
);

const nurtureSequencePauseInput = inputSchema(
  'nurture.sequence.pause',
  {
    enrollment_id: text,
    workflow_instance_id: text,
    expected_version: { type: 'integer', minimum: 1 },
    reason: text,
  },
  ['enrollment_id', 'workflow_instance_id', 'expected_version', 'reason'],
);
const nurtureSequencePauseOutput = outputSchema(
  'nurture.sequence.pause',
  {
    enrollment_id: text,
    workflow_instance_id: text,
    state: { type: 'string', const: 'PAUSED' },
    version: { type: 'integer', minimum: 1 },
  },
  ['enrollment_id', 'workflow_instance_id', 'state', 'version'],
);

const nurtureOutcomeInput = inputSchema(
  'nurture.sequence.outcome.record',
  {
    enrollment_id: text,
    workflow_instance_id: text,
    outcome: text,
    occurred_at: isoTimestamp,
    evidence: { type: 'array', items: text, minItems: 1 },
  },
  ['enrollment_id', 'workflow_instance_id', 'outcome', 'occurred_at', 'evidence'],
);
const nurtureOutcomeOutput = outputSchema(
  'nurture.sequence.outcome.record',
  {
    outcome_record_id: text,
    state: { type: 'string', const: 'RECORDED' },
  },
  ['outcome_record_id', 'state'],
);

export const OMNICHANNEL_CAPABILITY_CONTRACT_OVERRIDES: Readonly<
  Record<string, CapabilityContractOverride>
> = {
  'whatsapp.contact.resolve': explicit({
    description:
      'Resolve a WhatsApp identity to one canonical ContactRecord without guessing across ambiguous matches.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core CRM dependency',
    operation: 'contact.resolve.whatsapp',
    authentication_mode: 'INTERNAL',
    input_schema: whatsappContactResolveInput,
    output_schema: whatsappContactResolveOutput,
    verification_method: 'CRM_CONTACT_RECORD_READBACK',
    rollback_method: 'NOT_APPLICABLE',
  }),
  'whatsapp.opt_in.verify': explicit({
    description:
      'Verify WhatsApp outbound eligibility through canonical privacy.suppression.check, which resolves purpose, legal basis, consent, preferences and suppression fail-closed.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core Privacy dependency',
    operation: 'privacy.suppression.check.whatsapp',
    authentication_mode: 'INTERNAL',
    input_schema: whatsappOptInInput,
    output_schema: whatsappOptInOutput,
    verification_method: 'PRIVACY_DECISION_READBACK',
    rollback_method: 'NOT_APPLICABLE',
  }),
  'whatsapp.template.validate': explicit({
    description:
      'Validate a WhatsApp template contract against a provider adapter without assuming provider support.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'WhatsApp provider adapter (unbound)',
    operation: 'template.validate',
    authentication_mode: 'UNKNOWN',
    input_schema: whatsappTemplateValidateInput,
    output_schema: whatsappTemplateValidateOutput,
    verification_method: 'PROVIDER_TEMPLATE_READBACK',
    rollback_method: 'NOT_APPLICABLE',
  }),
  'whatsapp.message.prepare': explicit({
    description:
      'Prepare a WhatsApp outbound payload only for a resolved ContactRecord with canonical Privacy state ALLOWED and policy approval.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core',
    operation: 'whatsapp.message.prepare',
    authentication_mode: 'INTERNAL',
    input_schema: whatsappPrepareInput,
    output_schema: whatsappPrepareOutput,
    verification_method: 'PERSISTED_PREPARED_MESSAGE_READBACK',
    rollback_method: 'SUPERSEDE_PREPARED_MESSAGE',
  }),
  'whatsapp.message.send': explicit({
    description:
      'Send one approved WhatsApp message through a bound provider only after ContactRecord, consent, suppression and policy gates pass.',
    risk_class: 'WRITE_EXTERNAL',
    side_effects: true,
    approval_required: true,
    idempotent: true,
    provider: 'Meta WhatsApp Cloud API',
    operation: 'message.send',
    authentication_mode: 'UNKNOWN',
    input_schema: whatsappSendInput,
    output_schema: whatsappSendOutput,
    verification_method: 'PROVIDER_READBACK_AND_AUDIT_EVIDENCE',
    rollback_method: 'NO_AUTOMATIC_RESEND_PROVIDER_COMPENSATION_OR_MANUAL_RECOVERY',
  }),
  'whatsapp.message.readback': explicit({
    description: 'Read back provider delivery state for a previously submitted WhatsApp message.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'Meta WhatsApp Cloud API',
    operation: 'provider_event.readback',
    authentication_mode: 'INTERNAL',
    input_schema: whatsappReadbackInput,
    output_schema: whatsappReadbackOutput,
    verification_method: 'PROVIDER_READBACK',
    rollback_method: 'NOT_APPLICABLE',
  }),
  'whatsapp.conversation.ingest': explicit({
    description:
      'Idempotently ingest a normalized WhatsApp conversation event into TOCA Core without sending a reply.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core',
    operation: 'conversation.ingest.whatsapp',
    authentication_mode: 'INTERNAL',
    input_schema: whatsappConversationIngestInput,
    output_schema: whatsappConversationIngestOutput,
    verification_method: 'IDEMPOTENT_EVENT_PERSISTENCE_AND_AUDIT',
    rollback_method: 'APPEND_ONLY_RECONCILIATION',
  }),
  'email.contact.resolve': explicit({
    description:
      'Resolve an email identity to one canonical ContactRecord without guessing across ambiguous matches.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core CRM dependency',
    operation: 'contact.resolve.email',
    authentication_mode: 'INTERNAL',
    input_schema: emailContactResolveInput,
    output_schema: emailContactResolveOutput,
    verification_method: 'CRM_CONTACT_RECORD_READBACK',
    rollback_method: 'NOT_APPLICABLE',
  }),
  'email.suppression.verify': explicit({
    description:
      'Verify email outbound eligibility through canonical privacy.suppression.check, including purpose, legal basis, consent, preferences and suppression.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core Privacy dependency',
    operation: 'privacy.suppression.check.email',
    authentication_mode: 'INTERNAL',
    input_schema: emailSuppressionInput,
    output_schema: emailSuppressionOutput,
    verification_method: 'PRIVACY_SUPPRESSION_READBACK',
    rollback_method: 'NOT_APPLICABLE',
  }),
  'email.campaign.prepare': explicit({
    description:
      'Prepare an email campaign only from an eligibility snapshot with zero ambiguous, unknown-consent, denied, suppressed or policy-denied recipients.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core',
    operation: 'email.campaign.prepare',
    authentication_mode: 'INTERNAL',
    input_schema: emailCampaignPrepareInput,
    output_schema: emailCampaignPrepareOutput,
    verification_method: 'PERSISTED_CAMPAIGN_AND_AUDIENCE_SNAPSHOT_READBACK',
    rollback_method: 'SUPERSEDE_PREPARED_CAMPAIGN',
  }),
  'email.campaign.send': explicit({
    description:
      'Dispatch an approved email campaign through a bound provider only from a fully eligible ContactRecord audience snapshot.',
    risk_class: 'WRITE_EXTERNAL',
    side_effects: true,
    approval_required: true,
    idempotent: true,
    provider: 'Twilio SendGrid',
    operation: 'campaign.send',
    authentication_mode: 'UNKNOWN',
    input_schema: emailCampaignSendInput,
    output_schema: emailCampaignSendOutput,
    verification_method: 'PROVIDER_READBACK_AND_AUDIT_EVIDENCE',
    rollback_method: 'NO_AUTOMATIC_RESEND_PROVIDER_COMPENSATION_OR_MANUAL_RECOVERY',
  }),
  'email.delivery.readback': explicit({
    description: 'Read back provider delivery aggregates for a submitted email dispatch.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'Twilio SendGrid',
    operation: 'provider_event.readback',
    authentication_mode: 'INTERNAL',
    input_schema: emailDeliveryReadbackInput,
    output_schema: emailDeliveryReadbackOutput,
    verification_method: 'PROVIDER_READBACK',
    rollback_method: 'NOT_APPLICABLE',
  }),
  'email.open.ingest': explicit({
    description:
      'Idempotently ingest a provider-reported email open event linked to a canonical ContactRecord.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core',
    operation: 'email.open.ingest',
    authentication_mode: 'INTERNAL',
    input_schema: emailEngagementIngestInput('email.open.ingest'),
    output_schema: emailEngagementIngestOutput('email.open.ingest'),
    verification_method: 'IDEMPOTENT_EVENT_PERSISTENCE_AND_AUDIT',
    rollback_method: 'APPEND_ONLY_RECONCILIATION',
  }),
  'email.click.ingest': explicit({
    description:
      'Idempotently ingest a provider-reported email click event linked to a canonical ContactRecord.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core',
    operation: 'email.click.ingest',
    authentication_mode: 'INTERNAL',
    input_schema: emailEngagementIngestInput('email.click.ingest'),
    output_schema: emailEngagementIngestOutput('email.click.ingest'),
    verification_method: 'IDEMPOTENT_EVENT_PERSISTENCE_AND_AUDIT',
    rollback_method: 'APPEND_ONLY_RECONCILIATION',
  }),
  'nurture.sequence.create': explicit({
    description:
      'Create a nurture sequence definition bound to the existing durable workflow engine rather than a parallel scheduler.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core workflow engine',
    operation: 'nurture.sequence.create',
    authentication_mode: 'INTERNAL',
    input_schema: nurtureSequenceCreateInput,
    output_schema: nurtureSequenceCreateOutput,
    verification_method: 'WORKFLOW_DEFINITION_PERSISTED_STATE_READBACK',
    rollback_method: 'SUPERSEDE_WORKFLOW_DEFINITION',
  }),
  'nurture.sequence.enroll': explicit({
    description:
      'Enroll a ContactRecord into a nurture workflow only after consent, suppression, policy and approval gates pass.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: true,
    idempotent: true,
    provider: 'TOCA Core workflow engine',
    operation: 'nurture.sequence.enroll',
    authentication_mode: 'INTERNAL',
    input_schema: nurtureSequenceEnrollInput,
    output_schema: nurtureSequenceEnrollOutput,
    verification_method: 'WORKFLOW_INSTANCE_PERSISTED_STATE_READBACK',
    rollback_method: 'PAUSE_OR_CANCEL_WORKFLOW_INSTANCE',
  }),
  'nurture.sequence.pause': explicit({
    description:
      'Pause an existing nurture workflow instance using the canonical workflow engine and optimistic versioning.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core workflow engine',
    operation: 'nurture.sequence.pause',
    authentication_mode: 'INTERNAL',
    input_schema: nurtureSequencePauseInput,
    output_schema: nurtureSequencePauseOutput,
    verification_method: 'WORKFLOW_INSTANCE_PERSISTED_STATE_READBACK',
    rollback_method: 'CONTROLLED_WORKFLOW_RESUME',
  }),
  'nurture.sequence.outcome.record': explicit({
    description:
      'Append a nurture outcome to the existing workflow/audit lineage without creating a second scheduler or source of truth.',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA Core workflow engine',
    operation: 'nurture.sequence.outcome.record',
    authentication_mode: 'INTERNAL',
    input_schema: nurtureOutcomeInput,
    output_schema: nurtureOutcomeOutput,
    verification_method: 'APPEND_ONLY_OUTCOME_AND_AUDIT_READBACK',
    rollback_method: 'APPEND_ONLY_CORRECTION_EVENT',
  }),
} satisfies Readonly<Record<string, CapabilityContractOverride>>;
