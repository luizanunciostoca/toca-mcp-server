import {
  deterministicRenderManifestSchema,
  type DeterministicRenderManifest,
} from '../../contracts/creative-truth.js';
import { ExecutionError } from '../../core/errors.js';
import { assertCreativeReadyForPublication } from '../../creative/creative-truth.js';
import { THE_PARTY_HYBRID_NETWORKS_STANDARD_ID } from '../../creative/the-party-visual-family-resolver.js';
import type {
  SpreadsheetRangeUpdate,
  SpreadsheetValuesBatchWriter,
  SpreadsheetValuesClient,
} from './media-assets.js';
import {
  GoogleSheetsThePartyContentOrchestration,
  THE_PARTY_CONTENT_REGISTRY_DRIVE_ID,
  THE_PARTY_HERO_BRAND_ASSET_ID,
  type ThePartyContentOrchestrationRecord,
} from './the-party-content-orchestration.js';

const CONTENT_ITEMS_RANGE = 'CONTENT_ITEMS!A1:BX2000';
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const TRANSVERSAL_THUMBNAIL_STANDARD_ID = 'TOCA_THUMBNAIL_V1';
const MINIMALIST_NEUTRAL = 'MINIMALIST_NEUTRAL';

const WRITEBACK_COLUMNS = [
  'the_party_environment',
  'visual_standard_status',
  'venue_asset_id',
  'brand_integrity_status',
  'venue_fidelity_status',
  'quality_gate_status',
  'exact_asset_binding',
  'output_sha256',
] as const;

export interface ThePartyFinalCreativeTruthWritebackInput {
  readonly contentItemId: string;
  readonly manifest: unknown;
  readonly observedOutputSha256: string;
}

export interface ThePartyFinalCreativeTruthWritebackResult {
  readonly status: 'WRITTEN' | 'IDEMPOTENT';
  readonly contentItemId: string;
  readonly outputSha256: string;
  readonly visualStandardId: string;
  readonly manifestStandardId: string;
  readonly venueAssetId?: string;
  readonly environment?: 'INTERNATIONAL' | 'NATIONAL';
}

interface ContentRowSnapshot {
  readonly rowNumber: number;
  readonly headers: ReadonlyMap<string, number>;
  readonly row: readonly unknown[];
}

interface ValidatedManifestContext {
  readonly manifest: DeterministicRenderManifest;
  readonly visualStandardId: string;
  readonly venueAssetId?: string;
}

export class GoogleSheetsThePartyContentWriteback {
  private readonly orchestration: GoogleSheetsThePartyContentOrchestration;
  private readonly writer?: SpreadsheetValuesBatchWriter;

  constructor(
    private readonly client: SpreadsheetValuesClient,
    writer?: SpreadsheetValuesBatchWriter,
  ) {
    this.orchestration = new GoogleSheetsThePartyContentOrchestration(client);
    this.writer = writer ?? asBatchWriter(client);
  }

  async writeFinalCreativeTruthEvidence(
    input: ThePartyFinalCreativeTruthWritebackInput,
  ): Promise<ThePartyFinalCreativeTruthWritebackResult> {
    const contentItemId = input.contentItemId.trim();
    if (!contentItemId) deny('THE_PARTY_WRITEBACK_CONTENT_ITEM_REQUIRED');

    const observedOutputSha256 = input.observedOutputSha256.trim().toLowerCase();
    if (!SHA256_PATTERN.test(observedOutputSha256)) {
      deny('THE_PARTY_WRITEBACK_OUTPUT_SHA256_INVALID');
    }

    const parsed = deterministicRenderManifestSchema.safeParse(input.manifest);
    if (!parsed.success) deny('THE_PARTY_WRITEBACK_MANIFEST_INVALID');
    const ready = assertCreativeReadyForPublication(parsed.data);

    if (ready.contentItemId !== contentItemId) {
      deny('THE_PARTY_WRITEBACK_CONTENT_ITEM_MISMATCH');
    }
    if (ready.outputSha256.toLowerCase() !== observedOutputSha256) {
      deny('THE_PARTY_WRITEBACK_OUTPUT_SHA256_MISMATCH');
    }

    const initial = await this.orchestration.get(contentItemId);
    const manifestContext = validateManifestAgainstRecord(
      initial,
      ready,
      observedOutputSha256,
    );

    if (hasFinalEvidence(initial)) {
      if (isSameFinalEvidence(initial, observedOutputSha256)) {
        return buildResult('IDEMPOTENT', initial, manifestContext, observedOutputSha256);
      }
      conflict('THE_PARTY_APPROVED_CREATIVE_REVISION_REQUIRED');
    }

    if (!this.writer) {
      throw new ExecutionError(
        'CAPABILITY_UNAVAILABLE',
        'THE_PARTY_CONTENT_WRITEBACK_UNAVAILABLE',
        false,
      );
    }

    const revalidated = await this.orchestration.get(contentItemId);
    if (recordFingerprint(revalidated) !== recordFingerprint(initial)) {
      conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
    }
    validateManifestAgainstRecord(revalidated, ready, observedOutputSha256);

    const snapshot = await this.readContentRow(contentItemId);
    assertSnapshotMatchesRecord(snapshot, revalidated);

    const updates = buildWritebackUpdates(
      snapshot,
      revalidated,
      manifestContext,
      observedOutputSha256,
    );
    await this.writer.updateRanges(THE_PARTY_CONTENT_REGISTRY_DRIVE_ID, updates);

    let readback: ThePartyContentOrchestrationRecord;
    try {
      readback = await this.orchestration.get(contentItemId);
    } catch (error) {
      throw new ExecutionError(
        'PROVIDER_READBACK_FAILED',
        `THE_PARTY_WRITEBACK_READBACK_FAILED:${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }
    assertWritebackReadback(readback, revalidated, manifestContext, observedOutputSha256);

    return buildResult('WRITTEN', readback, manifestContext, observedOutputSha256);
  }

  private async readContentRow(contentItemId: string): Promise<ContentRowSnapshot> {
    const rows = await this.client.readRange(
      THE_PARTY_CONTENT_REGISTRY_DRIVE_ID,
      CONTENT_ITEMS_RANGE,
    );
    if (rows.length === 0) conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');

    const headers = buildHeaderIndex(rows[0] ?? []);
    for (const column of ['content_item_id', 'edition_id', 'the_party_intent', 'creative_standard_id',
      'visual_standard_status', 'hero_brand_asset_id', 'venue_asset_id', 'creative_truth_policy_id',
      'brand_integrity_status', 'venue_fidelity_status', 'quality_gate_status', 'exact_asset_binding',
      'output_sha256', 'the_party_environment']) {
      if (!headers.has(column)) conflict(`THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK:${column}`);
    }

    const contentItemColumn = headers.get('content_item_id')!;
    const matches: ContentRowSnapshot[] = [];
    rows.slice(1).forEach((row, index) => {
      if (cell(row[contentItemColumn]) === contentItemId) {
        matches.push({ rowNumber: index + 2, headers, row });
      }
    });
    if (matches.length !== 1) conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
    return matches[0]!;
  }
}

function validateManifestAgainstRecord(
  record: ThePartyContentOrchestrationRecord,
  manifest: DeterministicRenderManifest,
  observedOutputSha256: string,
): ValidatedManifestContext {
  if (manifest.outputSha256.toLowerCase() !== observedOutputSha256) {
    deny('THE_PARTY_WRITEBACK_OUTPUT_SHA256_MISMATCH');
  }
  if (!manifest.brandAssetIds.includes(THE_PARTY_HERO_BRAND_ASSET_ID)) {
    deny('THE_PARTY_WRITEBACK_HERO_BRAND_MISSING');
  }
  if (manifest.creativeMode !== 'GENERATIVE_EXCEPTION' && manifest.masterAssetIds.length === 0) {
    deny('THE_PARTY_WRITEBACK_MASTER_LINEAGE_REQUIRED');
  }

  const qualityGate = manifest.gates.find((gate) => gate.gate === 'QUALITY');
  const venueGate = manifest.gates.find((gate) => gate.gate === 'VENUE_FIDELITY');
  if (!qualityGate || !venueGate) deny('THE_PARTY_WRITEBACK_GATE_EVIDENCE_REQUIRED');

  const visualStandardId = evidenceString(qualityGate.evidence.visualStandardApplied);
  if (!visualStandardId || visualStandardId !== record.standardId) {
    deny('THE_PARTY_WRITEBACK_VISUAL_STANDARD_MISMATCH');
  }
  if (
    manifest.standardId !== record.standardId &&
    manifest.standardId !== TRANSVERSAL_THUMBNAIL_STANDARD_ID
  ) {
    deny('THE_PARTY_WRITEBACK_MANIFEST_STANDARD_MISMATCH');
  }

  const evidenceEnvironment = evidenceString(qualityGate.evidence.thePartyEnvironment);
  if (record.standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID) {
    if (!record.environment || evidenceEnvironment !== record.environment) {
      deny('THE_PARTY_WRITEBACK_ENVIRONMENT_MISMATCH');
    }
  } else if (evidenceEnvironment && evidenceEnvironment !== MINIMALIST_NEUTRAL) {
    deny('THE_PARTY_WRITEBACK_ENVIRONMENT_MISMATCH');
  }

  const venueAssetId = evidenceString(venueGate.evidence.venueAssetId);
  if (manifest.creativeMode !== 'GENERATIVE_EXCEPTION' && !venueAssetId) {
    deny('THE_PARTY_WRITEBACK_VENUE_ASSET_REQUIRED');
  }
  if (record.venueAssetId && venueAssetId !== record.venueAssetId) {
    deny('THE_PARTY_WRITEBACK_VENUE_ASSET_MISMATCH');
  }

  return {
    manifest,
    visualStandardId,
    ...(venueAssetId ? { venueAssetId } : {}),
  };
}

function buildWritebackUpdates(
  snapshot: ContentRowSnapshot,
  record: ThePartyContentOrchestrationRecord,
  manifestContext: ValidatedManifestContext,
  outputSha256: string,
): readonly SpreadsheetRangeUpdate[] {
  const values = new Map<string, unknown>([
    ['visual_standard_status', 'CREATIVE_TRUTH_PASSED'],
    ['brand_integrity_status', 'PASS'],
    ['venue_fidelity_status', 'PASS'],
    ['quality_gate_status', 'PASS'],
    ['exact_asset_binding', true],
    ['output_sha256', outputSha256],
  ]);

  const persistedEnvironment = valueAt(snapshot, 'the_party_environment');
  if (
    record.environmentSource === 'EDITION_CONTEXT' &&
    record.environment &&
    !persistedEnvironment
  ) {
    values.set('the_party_environment', record.environment);
  }

  const persistedVenueAssetId = valueAt(snapshot, 'venue_asset_id');
  if (!persistedVenueAssetId && manifestContext.venueAssetId) {
    values.set('venue_asset_id', manifestContext.venueAssetId);
  }

  return [...values.entries()].map(([column, value]) => ({
    range: `CONTENT_ITEMS!${columnLetter(snapshot.headers.get(column)!)}${snapshot.rowNumber}`,
    values: [[value]],
  }));
}

function assertSnapshotMatchesRecord(
  snapshot: ContentRowSnapshot,
  record: ThePartyContentOrchestrationRecord,
): void {
  const expected = new Map<string, string>([
    ['content_item_id', record.contentItemId],
    ['edition_id', record.editionId],
    ['the_party_intent', record.intent],
    ['creative_standard_id', record.standardId],
    ['visual_standard_status', record.persistedVisualStandardStatus],
    ['hero_brand_asset_id', record.heroBrandAssetId],
    ['creative_truth_policy_id', record.creativeTruthPolicyId],
    ['brand_integrity_status', record.brandIntegrityStatus],
    ['venue_fidelity_status', record.venueFidelityStatus],
    ['quality_gate_status', record.qualityGateStatus],
  ]);

  for (const [column, expectedValue] of expected) {
    if (valueAt(snapshot, column) !== expectedValue) {
      conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
    }
  }

  const persistedEnvironment = valueAt(snapshot, 'the_party_environment');
  if (record.environmentSource === 'CONTENT_ITEM' && persistedEnvironment !== record.environment) {
    conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
  }
  if (record.environmentSource === 'EDITION_CONTEXT' && persistedEnvironment) {
    conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
  }

  if (valueAt(snapshot, 'venue_asset_id') !== (record.venueAssetId ?? '')) {
    conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
  }
  if (valueAt(snapshot, 'output_sha256').toLowerCase() !== (record.outputSha256 ?? '')) {
    conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
  }
  const rawExactBinding = valueAt(snapshot, 'exact_asset_binding');
  if (rawExactBinding && parseBoolean(rawExactBinding) !== record.exactAssetBinding) {
    conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
  }
}

function assertWritebackReadback(
  readback: ThePartyContentOrchestrationRecord,
  before: ThePartyContentOrchestrationRecord,
  manifestContext: ValidatedManifestContext,
  outputSha256: string,
): void {
  if (
    readback.contentItemId !== before.contentItemId ||
    readback.editionId !== before.editionId ||
    readback.intent !== before.intent ||
    readback.standardId !== before.standardId ||
    readback.heroBrandAssetId !== before.heroBrandAssetId ||
    readback.creativeTruthPolicyId !== before.creativeTruthPolicyId ||
    readback.visualStandardStatus !== 'CREATIVE_TRUTH_PASSED' ||
    readback.brandIntegrityStatus !== 'PASS' ||
    readback.venueFidelityStatus !== 'PASS' ||
    readback.qualityGateStatus !== 'PASS' ||
    readback.exactAssetBinding !== true ||
    readback.outputSha256 !== outputSha256
  ) {
    throw new ExecutionError(
      'PROVIDER_READBACK_FAILED',
      'THE_PARTY_WRITEBACK_READBACK_MISMATCH',
      false,
    );
  }

  if (before.environment && readback.environment !== before.environment) {
    throw new ExecutionError(
      'PROVIDER_READBACK_FAILED',
      'THE_PARTY_WRITEBACK_ENVIRONMENT_READBACK_MISMATCH',
      false,
    );
  }
  if (manifestContext.venueAssetId && readback.venueAssetId !== manifestContext.venueAssetId) {
    throw new ExecutionError(
      'PROVIDER_READBACK_FAILED',
      'THE_PARTY_WRITEBACK_VENUE_READBACK_MISMATCH',
      false,
    );
  }
}

function hasFinalEvidence(record: ThePartyContentOrchestrationRecord): boolean {
  return record.exactAssetBinding !== undefined || record.outputSha256 !== undefined;
}

function isSameFinalEvidence(
  record: ThePartyContentOrchestrationRecord,
  outputSha256: string,
): boolean {
  return (
    record.visualStandardStatus === 'CREATIVE_TRUTH_PASSED' &&
    record.brandIntegrityStatus === 'PASS' &&
    record.venueFidelityStatus === 'PASS' &&
    record.qualityGateStatus === 'PASS' &&
    record.exactAssetBinding === true &&
    record.outputSha256 === outputSha256
  );
}

function buildResult(
  status: 'WRITTEN' | 'IDEMPOTENT',
  record: ThePartyContentOrchestrationRecord,
  manifestContext: ValidatedManifestContext,
  outputSha256: string,
): ThePartyFinalCreativeTruthWritebackResult {
  return {
    status,
    contentItemId: record.contentItemId,
    outputSha256,
    visualStandardId: manifestContext.visualStandardId,
    manifestStandardId: manifestContext.manifest.standardId,
    ...(manifestContext.venueAssetId ? { venueAssetId: manifestContext.venueAssetId } : {}),
    ...(record.environment ? { environment: record.environment } : {}),
  };
}

function recordFingerprint(record: ThePartyContentOrchestrationRecord): string {
  return JSON.stringify({
    contentItemId: record.contentItemId,
    editionId: record.editionId,
    intent: record.intent,
    environment: record.environment ?? '',
    environmentSource: record.environmentSource ?? '',
    editionEnvironmentStatus: record.editionEnvironmentStatus,
    standardId: record.standardId,
    persistedVisualStandardStatus: record.persistedVisualStandardStatus,
    heroBrandAssetId: record.heroBrandAssetId,
    venueAssetId: record.venueAssetId ?? '',
    creativeTruthPolicyId: record.creativeTruthPolicyId,
    brandIntegrityStatus: record.brandIntegrityStatus,
    venueFidelityStatus: record.venueFidelityStatus,
    qualityGateStatus: record.qualityGateStatus,
    exactAssetBinding: record.exactAssetBinding ?? null,
    outputSha256: record.outputSha256 ?? '',
  });
}

function buildHeaderIndex(row: readonly unknown[]): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  row.forEach((entry, column) => {
    const header = cell(entry);
    if (!header) return;
    if (index.has(header)) conflict(`THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK:${header}`);
    index.set(header, column);
  });
  return index;
}

function valueAt(snapshot: ContentRowSnapshot, column: string): string {
  const index = snapshot.headers.get(column);
  if (index === undefined) conflict(`THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK:${column}`);
  return cell(snapshot.row[index]);
}

function evidenceString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function columnLetter(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function parseBoolean(value: string): boolean {
  if (value === 'TRUE' || value === 'true' || value === '1') return true;
  if (value === 'FALSE' || value === 'false' || value === '0') return false;
  conflict('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK:exact_asset_binding');
}

function asBatchWriter(client: SpreadsheetValuesClient): SpreadsheetValuesBatchWriter | undefined {
  const candidate = client as SpreadsheetValuesClient & Partial<SpreadsheetValuesBatchWriter>;
  return typeof candidate.updateRanges === 'function' ? candidate : undefined;
}

function cell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  conflict(`THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK:${typeof value}`);
}

function deny(message: string): never {
  throw new ExecutionError('POLICY_DENIED', message, false);
}

function conflict(message: string): never {
  throw new ExecutionError('STATE_CONFLICT', message, false);
}
