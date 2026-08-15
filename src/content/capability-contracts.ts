import type { CapabilityContractOverride } from '../governance/capability-contract-overrides.js';
import type { JsonSchemaNode, JsonSchemaReference } from '../governance/types.js';

const text: JsonSchemaNode = { type: 'string', minLength: 1 };
const evidence: JsonSchemaNode = { type: 'array', minItems: 1, items: text };
const payload: JsonSchemaNode = { type: 'object', additionalProperties: true };

function closedSchema(
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

const commonInputProperties: Readonly<Record<string, JsonSchemaNode>> = {
  tenant_id: text,
  workspace_id: text,
  organization_id: text,
  content_item_id: text,
  version_id: text,
  correlation_id: text,
  idempotency_key: text,
  evidence,
  payload,
};

function inputSchema(
  capabilityId: string,
  extra: Readonly<Record<string, JsonSchemaNode>> = {},
  extraRequired: readonly string[] = [],
): JsonSchemaReference {
  return closedSchema(
    `toca://capabilities/${capabilityId}/input/v1.1`,
    { ...commonInputProperties, ...extra },
    [
      'tenant_id',
      'workspace_id',
      'organization_id',
      'content_item_id',
      'version_id',
      'correlation_id',
      'evidence',
      ...extraRequired,
    ],
  );
}

function outputSchema(capabilityId: string): JsonSchemaReference {
  return closedSchema(
    `toca://capabilities/${capabilityId}/output/v1.1`,
    {
      status: { type: 'string', enum: ['PASS', 'FAIL', 'REVIEW_REQUIRED', 'CREATED', 'READY'] },
      content_item_id: text,
      version_id: text,
      artifact_ref: text,
      lineage_root_version_id: text,
      issues: { type: 'array', items: text },
      evidence,
    },
    ['status', 'content_item_id', 'version_id', 'evidence'],
  );
}

function internalContract(
  capabilityId: string,
  description: string,
  options: {
    readonly write?: boolean;
    readonly approvalRequired?: boolean;
    readonly extra?: Readonly<Record<string, JsonSchemaNode>>;
    readonly extraRequired?: readonly string[];
    readonly verification?: string;
    readonly rollback?: string;
  } = {},
): CapabilityContractOverride {
  const write = options.write ?? false;
  return {
    description,
    contract_quality: 'EXPLICIT',
    risk_class: write ? 'WRITE_REVERSIBLE' : 'READ',
    side_effects: write,
    approval_required: options.approvalRequired ?? false,
    idempotent: true,
    provider: 'TOCA_OS+toca-mcp',
    operation: capabilityId,
    authentication_mode: 'INTERNAL',
    input_schema: inputSchema(capabilityId, options.extra, options.extraRequired),
    output_schema: outputSchema(capabilityId),
    verification_method:
      options.verification ??
      (write
        ? 'PERSISTED_ARTIFACT_OR_STATE_READBACK_AND_AUDIT_EVIDENCE'
        : 'SCHEMA_AND_GATE_VALIDATION'),
    rollback_method:
      options.rollback ?? (write ? 'SUPERSEDE_DERIVED_ARTIFACT_OR_STATE' : 'NOT_APPLICABLE'),
  };
}

const approvalRef: Readonly<Record<string, JsonSchemaNode>> = { approval_ref: text };
const destination: Readonly<Record<string, JsonSchemaNode>> = {
  target_channel: text,
  target_format: { type: 'string' },
  target_language: text,
};

export const VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES: Readonly<
  Record<string, CapabilityContractOverride>
> = {
  'video.brief.create': internalContract(
    'video.brief.create',
    'Create a version-bound short-form video brief without publishing or mutating an external provider.',
    { write: true },
  ),
  'video.storyboard.generate': internalContract(
    'video.storyboard.generate',
    'Generate a storyboard manifest bound to the content version and its factual/source references.',
    { write: true },
  ),
  'video.script.generate': internalContract(
    'video.script.generate',
    'Generate a timed script whose factual claims remain traceable to canonical source references.',
    { write: true },
  ),
  'video.asset.select': internalContract(
    'video.asset.select',
    'Select official assets using master-first rules while preserving original asset lineage and rights evidence.',
    { write: true },
  ),
  'video.timeline.compose': internalContract(
    'video.timeline.compose',
    'Compose a deterministic timeline manifest; this capability does not create a parallel video editor.',
    { write: true },
  ),
  'video.subtitle.generate': internalContract(
    'video.subtitle.generate',
    'Generate a time-bounded subtitle track for accessibility and later caption embedding.',
    { write: true },
  ),
  'video.caption.embed': internalContract(
    'video.caption.embed',
    'Create a caption-embedded derivation manifest while retaining source video and subtitle lineage.',
    { write: true },
  ),
  'video.audio.normalize': internalContract(
    'video.audio.normalize',
    'Create and validate an audio-normalized derivation with measured loudness and clipping evidence.',
    { write: true },
  ),
  'video.music_rights.validate': internalContract(
    'video.music_rights.validate',
    'Validate music ownership, license, territory, intended use and expiry before export.',
  ),
  'video.safe_area.validate': internalContract(
    'video.safe_area.validate',
    'Validate overlays against a caller-supplied channel safe-area policy instead of hard-coding unstable provider limits.',
  ),
  'video.duration.validate': internalContract(
    'video.duration.validate',
    'Validate duration against an explicit versioned channel policy supplied in the request.',
  ),
  'video.thumbnail.generate': internalContract(
    'video.thumbnail.generate',
    'Generate a thumbnail derivation that preserves version and source-asset lineage.',
    { write: true },
  ),
  'video.export.reel': internalContract(
    'video.export.reel',
    'Export an approved Reel artifact after rights, accessibility, safe-area, duration and quality gates pass; no publication occurs.',
    {
      write: true,
      extra: approvalRef,
      extraRequired: ['approval_ref'],
      verification: 'ARTIFACT_EXISTS_LINEAGE_VALID_AND_ALL_HARD_GATES_PASS',
    },
  ),
  'video.export.story': internalContract(
    'video.export.story',
    'Export an approved vertical Story video artifact after all hard gates pass; no publication occurs.',
    {
      write: true,
      extra: approvalRef,
      extraRequired: ['approval_ref'],
      verification: 'ARTIFACT_EXISTS_LINEAGE_VALID_AND_ALL_HARD_GATES_PASS',
    },
  ),
  'video.quality.validate': internalContract(
    'video.quality.validate',
    'Aggregate technical, visual, factual, rights and accessibility gates and fail closed on any hard failure.',
  ),
  'content_item.version.create': internalContract(
    'content_item.version.create',
    'Create an immutable child version with idempotency and original-to-derivation lineage.',
    { write: true },
  ),
  'content_item.variant.create': internalContract(
    'content_item.variant.create',
    'Create an immutable variant derived from a specific source version while preserving the lineage root.',
    { write: true },
  ),
  'content_item.channel.adapt': internalContract(
    'content_item.channel.adapt',
    'Create a channel-specific derivation without overwriting the source content version.',
    {
      write: true,
      extra: destination,
      extraRequired: ['target_channel', 'target_format'],
    },
  ),
  'content_item.language.localize': internalContract(
    'content_item.language.localize',
    'Create a localized language derivation without changing the factual meaning or source lineage.',
    {
      write: true,
      extra: { target_language: text },
      extraRequired: ['target_language'],
    },
  ),
  'content_item.fact.validate': internalContract(
    'content_item.fact.validate',
    'Validate version claims against explicit canonical source references and fail when observed facts diverge.',
  ),
  'content_item.rights.validate': internalContract(
    'content_item.rights.validate',
    'Validate image, video, music and other asset rights before a derivation becomes exportable.',
  ),
  'content_item.accessibility.validate': internalContract(
    'content_item.accessibility.validate',
    'Validate captions, readability, meaningful-audio treatment and text contrast for the target format.',
  ),
  'content_item.event.link': internalContract(
    'content_item.event.link',
    'Link a content item to the canonical EventRecord only when tenant/workspace/organization scope matches.',
    {
      write: true,
      extra: { event_id: text },
      extraRequired: ['event_id'],
      verification: 'CONTENT_ITEM_AND_EVENT_RECORD_PERSISTED_SCOPE_MATCH_READBACK',
    },
  ),
  'content_item.experiment.link': internalContract(
    'content_item.experiment.link',
    'Link a content item to a stable experiment identifier without replacing content lifecycle ownership.',
    {
      write: true,
      extra: { experiment_id: text },
      extraRequired: ['experiment_id'],
    },
  ),
  'content.repurpose.plan': internalContract(
    'content.repurpose.plan',
    'Produce a side-effect-free repurposing plan from one canonical source version to deduplicated destination variants.',
    { extra: destination },
  ),
};
