import type { RiskClass } from '../core/tool-registry.js';
import type {
  AuthenticationMode,
  CapabilityContractQuality,
  JsonSchemaReference,
  ProviderPermissionRequirement,
} from './types.js';

export interface CapabilityContractOverride {
  readonly description?: string;
  readonly contract_quality?: CapabilityContractQuality;
  readonly risk_class?: RiskClass;
  readonly side_effects?: boolean;
  readonly approval_required?: boolean;
  readonly idempotent?: boolean;
  readonly provider?: string;
  readonly operation?: string;
  readonly authentication_mode?: AuthenticationMode;
  readonly required_scopes?: readonly string[];
  readonly permission_requirements?: readonly ProviderPermissionRequirement[];
  readonly input_schema?: JsonSchemaReference;
  readonly output_schema?: JsonSchemaReference;
  readonly verification_method?: string;
  readonly rollback_method?: string;
}

const META_PERMISSION_VALIDATED_AT = '2026-08-14';
const META_OFFICIAL_POSTMAN_EVIDENCE = [
  'Meta official Instagram API Postman workspace — Instagram Login and Facebook Login permission model, validated 2026-08-14',
];
const GOOGLE_BUSINESS_PERMISSION_VALIDATED_AT = '2026-08-15';
const GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const GOOGLE_BUSINESS_OFFICIAL_EVIDENCE = [
  'Google Business Profile official API documentation — OAuth, Business Information, Local Posts, Reviews, Notifications and Performance, validated 2026-08-15',
];

function googleBusinessPermissionRequirements(
  operation: string,
  accessLevel: ProviderPermissionRequirement['access_level'],
): readonly ProviderPermissionRequirement[] {
  return [
    {
      provider: 'Google Business Profile',
      authentication_mode: 'OAUTH2',
      operation,
      scopes: [GOOGLE_BUSINESS_SCOPE],
      access_level: accessLevel,
      validated_at: GOOGLE_BUSINESS_PERMISSION_VALIDATED_AT,
      evidence: GOOGLE_BUSINESS_OFFICIAL_EVIDENCE,
    },
  ];
}

function closedObject(
  id: string,
  properties: JsonSchemaReference['properties'] = {},
  required: readonly string[] = [],
): JsonSchemaReference {
  return {
    $id: id,
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function instagramPermissionRequirements(
  operation: string,
  facebookScopes: readonly string[],
  instagramScopes: readonly string[],
  accessLevel: ProviderPermissionRequirement['access_level'],
): readonly ProviderPermissionRequirement[] {
  return [
    {
      provider: 'Meta/Instagram',
      authentication_mode: 'META_FACEBOOK_LOGIN',
      operation,
      scopes: facebookScopes,
      access_level: accessLevel,
      validated_at: META_PERMISSION_VALIDATED_AT,
      evidence: META_OFFICIAL_POSTMAN_EVIDENCE,
    },
    {
      provider: 'Meta/Instagram',
      authentication_mode: 'META_INSTAGRAM_LOGIN',
      operation,
      scopes: instagramScopes,
      access_level: accessLevel,
      validated_at: META_PERMISSION_VALIDATED_AT,
      evidence: META_OFFICIAL_POSTMAN_EVIDENCE,
    },
  ];
}

export const INSTAGRAM_PUBLISH_PERMISSION_REQUIREMENTS = instagramPermissionRequirements(
  'content.publish',
  ['instagram_basic', 'instagram_content_publish'],
  ['instagram_business_basic', 'instagram_business_content_publish'],
  'PUBLISH',
);

export const INSTAGRAM_COMMENT_PERMISSION_REQUIREMENTS = instagramPermissionRequirements(
  'comment.manage',
  ['instagram_basic', 'instagram_manage_comments', 'pages_read_engagement'],
  ['instagram_business_basic', 'instagram_business_manage_comments'],
  'COMMENT',
);

export const INSTAGRAM_MESSAGE_PERMISSION_REQUIREMENTS: readonly ProviderPermissionRequirement[] = [
  {
    provider: 'Meta/Instagram',
    authentication_mode: 'META_INSTAGRAM_LOGIN',
    operation: 'message.send',
    scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
    access_level: 'MESSAGE',
    validated_at: META_PERMISSION_VALIDATED_AT,
    evidence: META_OFFICIAL_POSTMAN_EVIDENCE,
  },
];

const systemHealthInput = closedObject('toca://capabilities/system.health/input/v1.1');
const systemHealthOutput = closedObject(
  'toca://capabilities/system.health/output/v1.1',
  {
    status: { type: 'string', const: 'ok' },
    service: { type: 'string', minLength: 1 },
    version: { type: 'string', minLength: 1 },
    phase: { type: 'string', const: 'production-foundation' },
  },
  ['status', 'service', 'version', 'phase'],
);

const systemCapabilitiesInput = closedObject('toca://capabilities/system.capabilities/input/v1.1');
const systemCapabilitiesOutput = closedObject(
  'toca://capabilities/system.capabilities/output/v1.1',
  {
    tools: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          version: { type: 'string', minLength: 1 },
          provider: { type: 'string', minLength: 1 },
          riskClass: { type: 'string' },
          requiredScopes: { type: 'array', items: { type: 'string' } },
          capabilityStatus: { type: 'string' },
          sideEffects: { type: 'boolean' },
          idempotent: { type: 'boolean' },
        },
        required: [
          'name',
          'version',
          'provider',
          'riskClass',
          'requiredScopes',
          'capabilityStatus',
          'sideEffects',
          'idempotent',
        ],
        additionalProperties: false,
      },
    },
  },
  ['tools'],
);

/**
 * Explicit v1.1 corrections and contracts. This map is intentionally small and
 * evidence-backed. Catalog entries not present here are labelled honestly as
 * RUNTIME_BOUND or LEGACY_INFERRED by the catalog builder instead of being
 * presented as fully specified contracts.
 */
export const CAPABILITY_CONTRACT_OVERRIDES: Readonly<Record<string, CapabilityContractOverride>> = {
  'system.health': {
    description: 'Return the health and production-foundation identity of the TOCA MCP server.',
    contract_quality: 'EXPLICIT',
    provider: 'system',
    operation: 'health.read',
    authentication_mode: 'NONE',
    input_schema: systemHealthInput,
    output_schema: systemHealthOutput,
    verification_method: 'SCHEMA_VALIDATION',
    rollback_method: 'NOT_APPLICABLE',
  },
  'system.capabilities': {
    description:
      'List deterministic execution tools registered in the current TOCA MCP runtime and their declared metadata.',
    contract_quality: 'EXPLICIT',
    provider: 'system',
    operation: 'capabilities.list',
    authentication_mode: 'NONE',
    input_schema: systemCapabilitiesInput,
    output_schema: systemCapabilitiesOutput,
    verification_method: 'SCHEMA_VALIDATION',
    rollback_method: 'NOT_APPLICABLE',
  },
  'drive.file.copy': {
    description: 'Copy a Google Drive file, creating a new external Drive resource.',
    contract_quality: 'EXPLICIT',
    risk_class: 'WRITE_EXTERNAL',
    side_effects: true,
    approval_required: true,
    idempotent: false,
    provider: 'Google Drive',
    operation: 'file.copy',
    authentication_mode: 'OAUTH2',
    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',
    rollback_method: 'DELETE_CREATED_COPY_OR_MANUAL_RECOVERY',
  },
  'operations.opening.checklist.execute': {
    description: 'Execute and persist the opening checklist state for a TOCA operational context.',
    contract_quality: 'EXPLICIT',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'opening.checklist.execute',
    authentication_mode: 'INTERNAL',
    verification_method: 'PERSISTED_STATE_READBACK',
    rollback_method: 'COMPENSATING_STATE_TRANSITION',
  },
  'operations.closing.checklist.execute': {
    description: 'Execute and persist the closing checklist state for a TOCA operational context.',
    contract_quality: 'EXPLICIT',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'closing.checklist.execute',
    authentication_mode: 'INTERNAL',
    verification_method: 'PERSISTED_STATE_READBACK',
    rollback_method: 'COMPENSATING_STATE_TRANSITION',
  },
  'google_business.location.read': {
    description:
      'Read the current Google Business Profile location snapshot using an explicit read mask.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'Google Business Profile',
    operation: 'businessinformation.locations.get',
    authentication_mode: 'OAUTH2',
    required_scopes: [GOOGLE_BUSINESS_SCOPE],
    permission_requirements: googleBusinessPermissionRequirements(
      'businessinformation.locations.get',
      'READ',
    ),
    verification_method: 'PROVIDER_RESPONSE_SCHEMA_VALIDATION',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.location.validate': {
    description:
      'Validate a normalized Google Business location snapshot against canonical local-discovery expectations.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'google_business.location.validate',
    authentication_mode: 'INTERNAL',
    required_scopes: [],
    verification_method: 'DETERMINISTIC_PROFILE_VALIDATION',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.hours.reconcile': {
    description:
      'Compare canonical and provider hours and return a read-only reconciliation plan without mutating Google.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'google_business.hours.reconcile',
    authentication_mode: 'INTERNAL',
    required_scopes: [],
    verification_method: 'DETERMINISTIC_HOURS_DIFF',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.post.prepare': {
    description:
      'Prepare a local post draft and bind event posts to the canonical EventRecord when applicable.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'google_business.post.prepare',
    authentication_mode: 'INTERNAL',
    required_scopes: [],
    verification_method: 'DRAFT_AND_EVENT_RECORD_VALIDATION',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.post.create': {
    description:
      'Create a Google Business Profile Local Post only through R27 approval and mandatory provider read-back.',
    risk_class: 'WRITE_EXTERNAL',
    side_effects: true,
    approval_required: true,
    idempotent: false,
    provider: 'Google Business Profile',
    operation: 'accounts.locations.localPosts.create',
    authentication_mode: 'OAUTH2',
    required_scopes: [GOOGLE_BUSINESS_SCOPE],
    permission_requirements: googleBusinessPermissionRequirements(
      'accounts.locations.localPosts.create',
      'PUBLISH',
    ),
    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',
    rollback_method: 'EXPLICIT_PROVIDER_COMPENSATION_OR_MANUAL_RECOVERY',
  },
  'google_business.post.readback': {
    description:
      'Read a Google Business Local Post and compare it with the prepared expected state.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'Google Business Profile',
    operation: 'accounts.locations.localPosts.get',
    authentication_mode: 'OAUTH2',
    required_scopes: [GOOGLE_BUSINESS_SCOPE],
    permission_requirements: googleBusinessPermissionRequirements(
      'accounts.locations.localPosts.get',
      'READ',
    ),
    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.review.ingest': {
    description:
      'Normalize an incoming Google Business review into an idempotent ingestion envelope.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'google_business.review.ingest',
    authentication_mode: 'INTERNAL',
    required_scopes: [],
    verification_method: 'NORMALIZED_REVIEW_SCHEMA_AND_DEDUPLICATION_KEY',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.review.classify': {
    description:
      'Classify Google Business reviews conservatively for intent, sentiment and human-review risk.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'google_business.review.classify',
    authentication_mode: 'INTERNAL',
    required_scopes: [],
    verification_method: 'DETERMINISTIC_REVIEW_POLICY_CLASSIFICATION',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.review.reply_draft': {
    description: 'Create a review reply draft that is never eligible for unrestricted auto-reply.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: 'google_business.review.reply_draft',
    authentication_mode: 'INTERNAL',
    required_scopes: [],
    verification_method: 'REPLY_DRAFT_POLICY_VALIDATION',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.review.reply': {
    description:
      'Publish a review reply only through R27 approval, with extra human review for complaints, legal and crisis cases, and provider read-back.',
    risk_class: 'WRITE_EXTERNAL',
    side_effects: true,
    approval_required: true,
    idempotent: false,
    provider: 'Google Business Profile',
    operation: 'accounts.locations.reviews.updateReply',
    authentication_mode: 'OAUTH2',
    required_scopes: [GOOGLE_BUSINESS_SCOPE],
    permission_requirements: googleBusinessPermissionRequirements(
      'accounts.locations.reviews.updateReply',
      'COMMENT',
    ),
    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',
    rollback_method: 'EXPLICIT_PROVIDER_COMPENSATION_OR_MANUAL_RECOVERY',
  },
  'google_business.review.verify': {
    description:
      'Read a Google Business review after reply and verify the exact provider-side reply text.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'Google Business Profile',
    operation: 'accounts.locations.reviews.get',
    authentication_mode: 'OAUTH2',
    required_scopes: [GOOGLE_BUSINESS_SCOPE],
    permission_requirements: googleBusinessPermissionRequirements(
      'accounts.locations.reviews.get',
      'READ',
    ),
    verification_method: 'PROVIDER_READBACK_AND_EXPECTED_STATE_COMPARISON',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.notification.ingest': {
    description:
      'Normalize a verified Google Business Profile notification delivery into a stable deduplication envelope.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'Google Business Profile Notifications / Cloud PubSub',
    operation: 'google_business.notification.ingest',
    authentication_mode: 'INTERNAL',
    required_scopes: [],
    verification_method: 'NORMALIZED_NOTIFICATION_SCHEMA_AND_DEDUPLICATION_KEY',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.performance.read': {
    description:
      'Read Google Business Profile Performance daily metrics for a bounded location/date range.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'Google Business Profile Performance API',
    operation: 'locations.fetchMultiDailyMetricsTimeSeries',
    authentication_mode: 'OAUTH2',
    required_scopes: [GOOGLE_BUSINESS_SCOPE],
    permission_requirements: googleBusinessPermissionRequirements(
      'locations.fetchMultiDailyMetricsTimeSeries',
      'READ',
    ),
    verification_method: 'PROVIDER_RESPONSE_SCHEMA_VALIDATION',
    rollback_method: 'NOT_APPLICABLE',
  },
  'google_business.profile.drift.detect': {
    description:
      'Detect canonical-vs-provider and Google-updated profile drift without mutating the location.',
    risk_class: 'READ',
    side_effects: false,
    approval_required: false,
    idempotent: true,
    provider: 'Google Business Profile',
    operation: 'businessinformation.locations.get+getGoogleUpdated',
    authentication_mode: 'OAUTH2',
    required_scopes: [GOOGLE_BUSINESS_SCOPE],
    permission_requirements: googleBusinessPermissionRequirements(
      'businessinformation.locations.get+getGoogleUpdated',
      'READ',
    ),
    verification_method: 'CANONICAL_PROVIDER_AND_GOOGLE_UPDATED_DIFF',
    rollback_method: 'NOT_APPLICABLE',
  },
  'story.export': {
    description: 'Export a Story artifact from an approved content definition.',
    contract_quality: 'EXPLICIT',
    risk_class: 'WRITE_REVERSIBLE',
    side_effects: true,
    approval_required: false,
    idempotent: true,
    provider: 'ChatGPT+TOCA_OS',
    operation: 'story.export',
    authentication_mode: 'INTERNAL',
    verification_method: 'ARTIFACT_EXISTS_AND_SCHEMA_VALID',
    rollback_method: 'DELETE_OR_SUPERSEDE_ARTIFACT',
  },
};

export function permissionRequirementsForCapability(
  capabilityId: string,
): readonly ProviderPermissionRequirement[] {
  if (/^(instagram|social|engagement)\./.test(capabilityId)) {
    if (
      /\.(publish|publication\.schedule)$/.test(capabilityId) ||
      capabilityId.startsWith('instagram.publish.')
    ) {
      return INSTAGRAM_PUBLISH_PERMISSION_REQUIREMENTS;
    }
    if (/comment|reply/.test(capabilityId)) return INSTAGRAM_COMMENT_PERMISSION_REQUIREMENTS;
    if (/message|conversation|\.send$/.test(capabilityId))
      return INSTAGRAM_MESSAGE_PERMISSION_REQUIREMENTS;
  }
  return [];
}
