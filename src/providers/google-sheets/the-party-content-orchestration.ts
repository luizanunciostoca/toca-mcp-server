import {
  TOCA_CREATIVE_TRUTH_POLICY_ID,
  type CreativeMode,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import {
  THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID,
  THE_PARTY_HYBRID_NETWORKS_STANDARD_ID,
  type ThePartyCreativeIntent,
  type ThePartyEnvironment,
  type ThePartyVisualStandardId,
} from '../../creative/the-party-visual-family-resolver.js';
import type { SpreadsheetValuesClient } from './media-assets.js';

export const THE_PARTY_CONTENT_REGISTRY_DRIVE_ID =
  '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw' as const;
export const THE_PARTY_EDITION_REGISTRY_DRIVE_ID =
  '1YI0xfOaSiD6UfLx97M9pQBSHqFVnDMnh5tIH68VwLlw' as const;
export const THE_PARTY_CONTENT_ORCHESTRATION_CONTRACT_ID =
  'THE_PARTY_CONTENT_ORCHESTRATION_V1' as const;
export const THE_PARTY_HERO_BRAND = 'THE_PARTY' as const;
export const THE_PARTY_HERO_BRAND_ASSET_ID = 'BRAND-THE-PARTY-WHITE-V1' as const;
export const THE_PARTY_VISUAL_STANDARD_VERSION = '2.0' as const;

const CONTENT_ITEMS_RANGE = 'CONTENT_ITEMS!A1:BX2000';
const EDITIONS_RANGE = 'EDITIONS!A1:P2000';
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

const NETWORKS_INTENTS = new Set<ThePartyCreativeIntent>([
  'HIGH_IMPACT_CAMPAIGN',
  'LINEUP',
  'EVENT',
  'ACTIVATION',
  'SOCIAL_PROMOTION',
  'IMMERSIVE_ANNOUNCEMENT',
]);

const MINIMALIST_INTENTS = new Set<ThePartyCreativeIntent>([
  'INSTITUTIONAL_COMMUNICATION',
  'ELEGANT_AD',
  'INVITATION',
  'HIGHLIGHT_COVER',
  'LANDING_PAGE',
  'WEBSITE',
  'PEOPLE_FIRST_CONVERSION',
]);

const REQUIRED_COLUMNS = [
  'content_item_id',
  'operation',
  'edition_id',
  'the_party_intent',
  'the_party_environment',
  'creative_standard_id',
  'creative_standard_version',
  'visual_standard_status',
  'hero_brand_asset_id',
  'venue_asset_id',
  'creative_truth_policy_id',
  'brand_integrity_status',
  'venue_fidelity_status',
  'quality_gate_status',
  'exact_asset_binding',
  'output_sha256',
] as const;

const REQUIRED_EDITION_COLUMNS = [
  'edition_id',
  'visual_family_policy',
  'the_party_environment',
  'environment_status',
  'environment_decision_source',
  'environment_decision_at',
  'environment_decision_by',
] as const;

export type ThePartyVisualStandardStatus =
  'RESOLVED' | 'BLOCKED_NEEDS_ENVIRONMENT' | 'CREATIVE_TRUTH_PENDING' | 'CREATIVE_TRUTH_PASSED';

export type ThePartyEnvironmentDecisionStatus = 'PENDING_DECISION' | 'DECIDED' | 'NOT_REQUIRED';

export type ThePartyEnvironmentSource = 'CONTENT_ITEM' | 'EDITION_CONTEXT';

export interface ThePartyContentOrchestrationRecord {
  readonly contentItemId: string;
  readonly operation: 'THE_PARTY';
  readonly editionId: string;
  readonly intent: ThePartyCreativeIntent;
  readonly environment?: ThePartyEnvironment;
  readonly environmentSource?: ThePartyEnvironmentSource;
  readonly editionEnvironmentStatus: ThePartyEnvironmentDecisionStatus;
  readonly standardId: ThePartyVisualStandardId;
  readonly standardVersion: string;
  readonly visualStandardStatus: ThePartyVisualStandardStatus;
  readonly persistedVisualStandardStatus: ThePartyVisualStandardStatus;
  readonly heroBrandAssetId: typeof THE_PARTY_HERO_BRAND_ASSET_ID;
  readonly venueAssetId?: string;
  readonly creativeTruthPolicyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly brandIntegrityStatus: string;
  readonly venueFidelityStatus: string;
  readonly qualityGateStatus: string;
  readonly exactAssetBinding?: boolean;
  readonly outputSha256?: string;
}

interface ParsedContentRecord {
  readonly contentItemId: string;
  readonly operation: 'THE_PARTY';
  readonly editionId: string;
  readonly intent: ThePartyCreativeIntent;
  readonly environment?: ThePartyEnvironment;
  readonly standardId: ThePartyVisualStandardId;
  readonly standardVersion: string;
  readonly visualStandardStatus: ThePartyVisualStandardStatus;
  readonly heroBrandAssetId: typeof THE_PARTY_HERO_BRAND_ASSET_ID;
  readonly venueAssetId?: string;
  readonly creativeTruthPolicyId: typeof TOCA_CREATIVE_TRUTH_POLICY_ID;
  readonly brandIntegrityStatus: string;
  readonly venueFidelityStatus: string;
  readonly qualityGateStatus: string;
  readonly exactAssetBinding?: boolean;
  readonly outputSha256?: string;
}

interface EditionContextRecord {
  readonly editionId: string;
  readonly environment?: ThePartyEnvironment;
  readonly status: ThePartyEnvironmentDecisionStatus;
  readonly decisionSource?: string;
  readonly decisionAt?: string;
  readonly decisionBy?: string;
}

export interface ThePartyCreativeTruthResolutionInput {
  readonly contentItemId: string;
  readonly standardId: ThePartyVisualStandardId;
  readonly operation: 'THE_PARTY';
  readonly requestedMode?: CreativeMode;
  readonly venueAssetId?: string;
  readonly requiredBrands: readonly string[];
  readonly brandVariant?: string;
  readonly thePartyIntent: ThePartyCreativeIntent;
  readonly thePartyEnvironment?: ThePartyEnvironment;
}

export interface ThePartyContentOrchestrationConfig {
  readonly spreadsheetId?: string;
  readonly range?: string;
  readonly editionSpreadsheetId?: string;
  readonly editionRange?: string;
}

export class GoogleSheetsThePartyContentOrchestration {
  private readonly spreadsheetId: string;
  private readonly range: string;
  private readonly editionSpreadsheetId: string;
  private readonly editionRange: string;

  constructor(
    private readonly client: SpreadsheetValuesClient,
    config: ThePartyContentOrchestrationConfig = {},
  ) {
    this.spreadsheetId = config.spreadsheetId ?? THE_PARTY_CONTENT_REGISTRY_DRIVE_ID;
    this.range = config.range ?? CONTENT_ITEMS_RANGE;
    this.editionSpreadsheetId = config.editionSpreadsheetId ?? THE_PARTY_EDITION_REGISTRY_DRIVE_ID;
    this.editionRange = config.editionRange ?? EDITIONS_RANGE;
  }

  async get(contentItemId: string): Promise<ThePartyContentOrchestrationRecord> {
    const normalizedContentItemId = contentItemId.trim();
    if (!normalizedContentItemId) {
      deny('THE_PARTY_CONTENT_ITEM_ID_REQUIRED');
    }

    const [contentRows, editionRows] = await Promise.all([
      this.client.readRange(this.spreadsheetId, this.range),
      this.client.readRange(this.editionSpreadsheetId, this.editionRange),
    ]);
    if (contentRows.length === 0) {
      deny('THE_PARTY_CONTENT_ORCHESTRATION_SCHEMA_INVALID');
    }
    if (editionRows.length === 0) {
      deny('THE_PARTY_EDITION_CONTEXT_SCHEMA_INVALID');
    }

    const headers = buildHeaderIndex(
      contentRows[0] ?? [],
      'THE_PARTY_CONTENT_ORCHESTRATION_DUPLICATE_COLUMN',
    );
    for (const required of REQUIRED_COLUMNS) {
      if (!headers.has(required)) {
        deny(`THE_PARTY_CONTENT_ORCHESTRATION_COLUMN_MISSING:${required}`);
      }
    }

    const contentItemIndex = headers.get('content_item_id')!;
    const matches = contentRows
      .slice(1)
      .filter((row) => cell(row[contentItemIndex]) === normalizedContentItemId);
    if (matches.length === 0) {
      deny('THE_PARTY_CONTENT_ITEM_NOT_FOUND');
    }
    if (matches.length !== 1) {
      deny('THE_PARTY_CONTENT_ITEM_DUPLICATE');
    }

    const contentRecord = parseAndValidateRecord(matches[0]!, headers);
    const editionRecord = findAndValidateEditionContext(contentRecord.editionId, editionRows);
    return reconcileEditionContext(contentRecord, editionRecord);
  }

  async buildCreativeTruthResolutionInput(
    contentItemId: string,
    options: {
      readonly requiredBrands?: readonly string[];
      readonly brandVariant?: string;
      readonly requestedMode?: CreativeMode;
    } = {},
  ): Promise<ThePartyCreativeTruthResolutionInput> {
    const record = await this.get(contentItemId);
    if (record.visualStandardStatus === 'BLOCKED_NEEDS_ENVIRONMENT') {
      deny('THE_PARTY_ENVIRONMENT_REQUIRED');
    }
    if (record.standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID && !record.environment) {
      deny('THE_PARTY_ENVIRONMENT_REQUIRED');
    }

    const requiredBrands = uniqueBrands([THE_PARTY_HERO_BRAND, ...(options.requiredBrands ?? [])]);

    return {
      contentItemId: record.contentItemId,
      standardId: record.standardId,
      operation: 'THE_PARTY',
      ...(options.requestedMode ? { requestedMode: options.requestedMode } : {}),
      ...(record.venueAssetId ? { venueAssetId: record.venueAssetId } : {}),
      requiredBrands,
      ...(options.brandVariant?.trim() ? { brandVariant: options.brandVariant.trim() } : {}),
      thePartyIntent: record.intent,
      ...(record.environment ? { thePartyEnvironment: record.environment } : {}),
    };
  }
}

function parseAndValidateRecord(
  row: readonly unknown[],
  headers: ReadonlyMap<string, number>,
): ParsedContentRecord {
  const value = (name: (typeof REQUIRED_COLUMNS)[number]) => cell(row[headers.get(name)!]);
  const contentItemId = value('content_item_id');
  if (!contentItemId) deny('THE_PARTY_CONTENT_ITEM_ID_REQUIRED');
  if (value('operation') !== 'THE_PARTY') deny('THE_PARTY_CONTENT_OPERATION_MISMATCH');

  const editionId = value('edition_id');
  if (!editionId) deny('THE_PARTY_CONTENT_EDITION_ID_REQUIRED');

  const intent = parseIntent(value('the_party_intent'));
  const rawEnvironment = value('the_party_environment');
  const environment = rawEnvironment ? parseEnvironment(rawEnvironment) : undefined;
  const standardId = parseStandardId(value('creative_standard_id'));
  const expectedStandardId = expectedStandardForIntent(intent);
  if (standardId !== expectedStandardId) {
    deny('THE_PARTY_CONTENT_STANDARD_INTENT_MISMATCH');
  }

  const standardVersion = value('creative_standard_version');
  if (standardVersion !== THE_PARTY_VISUAL_STANDARD_VERSION) {
    deny('THE_PARTY_CONTENT_STANDARD_VERSION_MISMATCH');
  }

  const visualStandardStatus = parseVisualStandardStatus(value('visual_standard_status'));
  if (standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID) {
    if (!environment && visualStandardStatus !== 'BLOCKED_NEEDS_ENVIRONMENT') {
      deny('THE_PARTY_CONTENT_MISSING_ENVIRONMENT_NOT_BLOCKED');
    }
    if (environment && visualStandardStatus === 'BLOCKED_NEEDS_ENVIRONMENT') {
      deny('THE_PARTY_CONTENT_ENVIRONMENT_PRESENT_BUT_BLOCKED');
    }
  } else if (environment) {
    deny('THE_PARTY_CONTENT_MINIMALIST_ENVIRONMENT_NOT_ALLOWED');
  }

  const heroBrandAssetId = value('hero_brand_asset_id');
  if (heroBrandAssetId !== THE_PARTY_HERO_BRAND_ASSET_ID) {
    deny('THE_PARTY_CONTENT_HERO_BRAND_MISMATCH');
  }

  const creativeTruthPolicyId = value('creative_truth_policy_id');
  if (creativeTruthPolicyId !== TOCA_CREATIVE_TRUTH_POLICY_ID) {
    deny('THE_PARTY_CONTENT_POLICY_MISMATCH');
  }

  const brandIntegrityStatus = value('brand_integrity_status');
  const venueFidelityStatus = value('venue_fidelity_status');
  const qualityGateStatus = value('quality_gate_status');
  if (!brandIntegrityStatus || !venueFidelityStatus || !qualityGateStatus) {
    deny('THE_PARTY_CONTENT_GATE_STATUS_REQUIRED');
  }

  const rawExactBinding = value('exact_asset_binding');
  const exactAssetBinding = rawExactBinding ? parseBoolean(rawExactBinding) : undefined;
  const rawOutputSha256 = value('output_sha256').toLowerCase();
  const outputSha256 = rawOutputSha256 || undefined;
  if (outputSha256 && !SHA256_PATTERN.test(outputSha256)) {
    deny('THE_PARTY_CONTENT_OUTPUT_SHA256_INVALID');
  }

  const finalEvidencePresent = exactAssetBinding !== undefined || outputSha256 !== undefined;
  if (finalEvidencePresent) {
    if (
      exactAssetBinding !== true ||
      !outputSha256 ||
      brandIntegrityStatus !== 'PASS' ||
      venueFidelityStatus !== 'PASS' ||
      qualityGateStatus !== 'PASS'
    ) {
      deny('THE_PARTY_CONTENT_FINAL_BINDING_INCOMPLETE');
    }
  }

  return {
    contentItemId,
    operation: 'THE_PARTY',
    editionId,
    intent,
    ...(environment ? { environment } : {}),
    standardId,
    standardVersion: THE_PARTY_VISUAL_STANDARD_VERSION,
    visualStandardStatus,
    heroBrandAssetId: THE_PARTY_HERO_BRAND_ASSET_ID,
    ...(value('venue_asset_id') ? { venueAssetId: value('venue_asset_id') } : {}),
    creativeTruthPolicyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
    brandIntegrityStatus,
    venueFidelityStatus,
    qualityGateStatus,
    ...(exactAssetBinding !== undefined ? { exactAssetBinding } : {}),
    ...(outputSha256 ? { outputSha256 } : {}),
  };
}

function findAndValidateEditionContext(
  editionId: string,
  rows: readonly (readonly unknown[])[],
): EditionContextRecord {
  const headers = buildHeaderIndex(rows[0] ?? [], 'THE_PARTY_EDITION_CONTEXT_DUPLICATE_COLUMN');
  for (const required of REQUIRED_EDITION_COLUMNS) {
    if (!headers.has(required)) {
      deny(`THE_PARTY_EDITION_CONTEXT_COLUMN_MISSING:${required}`);
    }
  }

  const editionIdIndex = headers.get('edition_id')!;
  const matches = rows.slice(1).filter((row) => cell(row[editionIdIndex]) === editionId);
  if (matches.length === 0) deny('THE_PARTY_EDITION_CONTEXT_NOT_FOUND');
  if (matches.length !== 1) deny('THE_PARTY_EDITION_CONTEXT_DUPLICATE');

  const row = matches[0]!;
  const value = (name: (typeof REQUIRED_EDITION_COLUMNS)[number]) => cell(row[headers.get(name)!]);
  if (value('visual_family_policy') !== 'RESOLVE_BY_INTENT') {
    deny('THE_PARTY_EDITION_VISUAL_FAMILY_POLICY_MISMATCH');
  }

  const status = parseEnvironmentDecisionStatus(value('environment_status'));
  const rawEnvironment = value('the_party_environment');
  const environment = rawEnvironment ? parseEnvironment(rawEnvironment) : undefined;
  const decisionSource = value('environment_decision_source') || undefined;
  const decisionAt = value('environment_decision_at') || undefined;
  const decisionBy = value('environment_decision_by') || undefined;

  if (status === 'DECIDED') {
    if (!environment || !decisionSource || !decisionAt || !decisionBy) {
      deny('THE_PARTY_EDITION_ENVIRONMENT_DECISION_EVIDENCE_REQUIRED');
    }
    if (!Number.isFinite(Date.parse(decisionAt))) {
      deny('THE_PARTY_EDITION_ENVIRONMENT_DECISION_AT_INVALID');
    }
  } else if (environment) {
    deny('THE_PARTY_EDITION_ENVIRONMENT_PRESENT_WITHOUT_DECISION');
  }

  return {
    editionId,
    ...(environment ? { environment } : {}),
    status,
    ...(decisionSource ? { decisionSource } : {}),
    ...(decisionAt ? { decisionAt } : {}),
    ...(decisionBy ? { decisionBy } : {}),
  };
}

function reconcileEditionContext(
  content: ParsedContentRecord,
  edition: EditionContextRecord,
): ThePartyContentOrchestrationRecord {
  const persistedVisualStandardStatus = content.visualStandardStatus;

  if (content.standardId === THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID) {
    return {
      ...content,
      editionEnvironmentStatus: edition.status,
      persistedVisualStandardStatus,
    };
  }

  if (content.environment) {
    if (edition.status === 'DECIDED' && edition.environment !== content.environment) {
      deny('THE_PARTY_CONTENT_EDITION_ENVIRONMENT_CONFLICT');
    }
    return {
      ...content,
      environmentSource: 'CONTENT_ITEM',
      editionEnvironmentStatus: edition.status,
      persistedVisualStandardStatus,
    };
  }

  if (edition.status === 'DECIDED' && edition.environment) {
    return {
      ...content,
      environment: edition.environment,
      environmentSource: 'EDITION_CONTEXT',
      editionEnvironmentStatus: edition.status,
      visualStandardStatus: 'RESOLVED',
      persistedVisualStandardStatus,
    };
  }

  return {
    ...content,
    editionEnvironmentStatus: edition.status,
    persistedVisualStandardStatus,
  };
}

function expectedStandardForIntent(intent: ThePartyCreativeIntent): ThePartyVisualStandardId {
  if (NETWORKS_INTENTS.has(intent)) return THE_PARTY_HYBRID_NETWORKS_STANDARD_ID;
  if (MINIMALIST_INTENTS.has(intent)) return THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID;
  deny('THE_PARTY_VISUAL_INTENT_UNSUPPORTED');
}

function parseIntent(value: string): ThePartyCreativeIntent {
  if (NETWORKS_INTENTS.has(value as ThePartyCreativeIntent)) return value as ThePartyCreativeIntent;
  if (MINIMALIST_INTENTS.has(value as ThePartyCreativeIntent))
    return value as ThePartyCreativeIntent;
  deny('THE_PARTY_VISUAL_INTENT_UNSUPPORTED');
}

function parseEnvironment(value: string): ThePartyEnvironment {
  if (value === 'INTERNATIONAL' || value === 'NATIONAL') return value;
  deny('THE_PARTY_CONTENT_ENVIRONMENT_INVALID');
}

function parseEnvironmentDecisionStatus(value: string): ThePartyEnvironmentDecisionStatus {
  if (value === 'PENDING_DECISION' || value === 'DECIDED' || value === 'NOT_REQUIRED') {
    return value;
  }
  deny('THE_PARTY_EDITION_ENVIRONMENT_STATUS_INVALID');
}

function parseStandardId(value: string): ThePartyVisualStandardId {
  if (
    value === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID ||
    value === THE_PARTY_HYBRID_MINIMALIST_STANDARD_ID
  ) {
    return value;
  }
  deny('THE_PARTY_CONTENT_STANDARD_INVALID');
}

function parseVisualStandardStatus(value: string): ThePartyVisualStandardStatus {
  if (
    value === 'RESOLVED' ||
    value === 'BLOCKED_NEEDS_ENVIRONMENT' ||
    value === 'CREATIVE_TRUTH_PENDING' ||
    value === 'CREATIVE_TRUTH_PASSED'
  ) {
    return value;
  }
  deny('THE_PARTY_CONTENT_VISUAL_STATUS_INVALID');
}

function parseBoolean(value: string): boolean {
  if (value === 'TRUE' || value === 'true' || value === '1') return true;
  if (value === 'FALSE' || value === 'false' || value === '0') return false;
  deny('THE_PARTY_CONTENT_EXACT_BINDING_INVALID');
}

function buildHeaderIndex(
  row: readonly unknown[],
  duplicateErrorPrefix: string,
): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  row.forEach((entry, column) => {
    const header = cell(entry);
    if (!header) return;
    if (index.has(header)) deny(`${duplicateErrorPrefix}:${header}`);
    index.set(header, column);
  });
  return index;
}

function uniqueBrands(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  deny(`THE_PARTY_CONTENT_CELL_TYPE_UNSUPPORTED:${typeof value}`);
}

function deny(message: string): never {
  throw new ExecutionError('POLICY_DENIED', message, false);
}
