import { describe, expect, it } from 'vitest';
import type { DeterministicRenderManifest } from '../src/contracts/creative-truth.js';
import type {
  SpreadsheetRangeUpdate,
  SpreadsheetValuesBatchWriter,
  SpreadsheetValuesClient,
} from '../src/providers/google-sheets/media-assets.js';
import {
  THE_PARTY_CONTENT_REGISTRY_DRIVE_ID,
  THE_PARTY_EDITION_REGISTRY_DRIVE_ID,
} from '../src/providers/google-sheets/the-party-content-orchestration.js';
import { GoogleSheetsThePartyContentWriteback } from '../src/providers/google-sheets/the-party-content-writeback.js';

const CONTENT_RANGE = 'CONTENT_ITEMS!A1:BX2000';
const EDITION_RANGE = 'EDITIONS!A1:P2000';
const OUTPUT_SHA = 'a'.repeat(64);

const contentHeaders = [
  'quality_gate_status',
  'content_item_id',
  'output_sha256',
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
  'exact_asset_binding',
] as const;

const editionHeaders = [
  'environment_decision_by',
  'edition_id',
  'visual_family_policy',
  'the_party_environment',
  'environment_status',
  'environment_decision_source',
  'environment_decision_at',
] as const;

type ContentHeader = (typeof contentHeaders)[number];
type EditionHeader = (typeof editionHeaders)[number];

function contentRow(
  overrides: Partial<Record<ContentHeader, unknown>> = {},
): unknown[] {
  const values: Record<ContentHeader, unknown> = {
    quality_gate_status: 'PENDING',
    content_item_id: 'MKT-TP-001',
    output_sha256: '',
    operation: 'THE_PARTY',
    edition_id: 'TP-20260822',
    the_party_intent: 'PEOPLE_FIRST_CONVERSION',
    the_party_environment: '',
    creative_standard_id: 'THE_PARTY_HYBRID_MINIMALIST_V1',
    creative_standard_version: '1.0',
    visual_standard_status: 'RESOLVED',
    hero_brand_asset_id: 'BRAND-THE-PARTY-WHITE-V1',
    venue_asset_id: 'VENUE-TP-0087',
    creative_truth_policy_id: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    brand_integrity_status: 'PENDING',
    venue_fidelity_status: 'PENDING',
    exact_asset_binding: '',
  };
  Object.assign(values, overrides);
  return contentHeaders.map((header) => values[header]);
}

function editionRow(
  overrides: Partial<Record<EditionHeader, unknown>> = {},
): unknown[] {
  const values: Record<EditionHeader, unknown> = {
    environment_decision_by: '',
    edition_id: 'TP-20260822',
    visual_family_policy: 'RESOLVE_BY_INTENT',
    the_party_environment: '',
    environment_status: 'PENDING_DECISION',
    environment_decision_source: '',
    environment_decision_at: '',
  };
  Object.assign(values, overrides);
  return editionHeaders.map((header) => values[header]);
}

function decidedEdition(environment: 'INTERNATIONAL' | 'NATIONAL'): unknown[] {
  return editionRow({
    the_party_environment: environment,
    environment_status: 'DECIDED',
    environment_decision_source: 'EDITION_DOSSIER',
    environment_decision_at: '2026-08-18T02:30:00-03:00',
    environment_decision_by: 'LUIZ_EXPLICIT_DECISION',
  });
}

class MutableSheetsClient implements SpreadsheetValuesClient, SpreadsheetValuesBatchWriter {
  readonly updates: SpreadsheetRangeUpdate[][] = [];
  contentReadCount = 0;
  beforeContentRead?: (count: number, row: unknown[]) => void;

  constructor(
    readonly content: unknown[][],
    readonly editions: unknown[][],
  ) {}

  async readRange(spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]> {
    if (spreadsheetId === THE_PARTY_CONTENT_REGISTRY_DRIVE_ID) {
      expect(range).toBe(CONTENT_RANGE);
      this.contentReadCount += 1;
      this.beforeContentRead?.(this.contentReadCount, this.content[1]!);
      return this.content;
    }
    if (spreadsheetId === THE_PARTY_EDITION_REGISTRY_DRIVE_ID) {
      expect(range).toBe(EDITION_RANGE);
      return this.editions;
    }
    throw new Error(`unexpected spreadsheet ${spreadsheetId}`);
  }

  async appendRow(): Promise<void> {
    throw new Error('appendRow must not be used by writeback');
  }

  async updateRanges(
    spreadsheetId: string,
    updates: readonly SpreadsheetRangeUpdate[],
  ): Promise<void> {
    expect(spreadsheetId).toBe(THE_PARTY_CONTENT_REGISTRY_DRIVE_ID);
    this.updates.push(updates.map((update) => ({ ...update, values: [...update.values] })));
    for (const update of updates) applyUpdate(this.content, update);
  }
}

function applyUpdate(rows: unknown[][], update: SpreadsheetRangeUpdate): void {
  const match = /^CONTENT_ITEMS!([A-Z]+)(\d+)$/.exec(update.range);
  if (!match) throw new Error(`unexpected update range ${update.range}`);
  const column = columnIndex(match[1]!);
  const row = Number(match[2]!) - 1;
  const value = update.values[0]?.[0];
  if (!rows[row]) throw new Error(`missing row ${row + 1}`);
  rows[row]![column] = value;
}

function columnIndex(letters: string): number {
  let value = 0;
  for (const character of letters) value = value * 26 + character.charCodeAt(0) - 64;
  return value - 1;
}

function manifest(options: {
  readonly standardId?: string;
  readonly visualStandardId?: string;
  readonly environment?: string;
  readonly venueAssetId?: string;
  readonly outputSha256?: string;
  readonly gateFailure?: boolean;
} = {}): DeterministicRenderManifest {
  const visualStandardId = options.visualStandardId ?? 'THE_PARTY_HYBRID_MINIMALIST_V1';
  const venueAssetId = options.venueAssetId ?? 'VENUE-TP-0087';
  return {
    contentItemId: 'MKT-TP-001',
    creativeId: 'TP-FINAL-001',
    policyId: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    standardId: options.standardId ?? visualStandardId,
    creativeMode: 'REAL_COMPOSITE',
    sourceAssetIds: ['TP-0087'],
    masterAssetIds: ['MM-TP-0087-V1'],
    brandAssetIds: ['BRAND-THE-PARTY-WHITE-V1'],
    outputSha256: options.outputSha256 ?? OUTPUT_SHA,
    outputDimensions: '1080x1920',
    exactAssetBinding: true,
    gates: [
      {
        gate: 'BRAND_INTEGRITY',
        status: 'PASSED',
        failureCodes: [],
        evidence: {},
      },
      {
        gate: 'VENUE_FIDELITY',
        status: 'PASSED',
        failureCodes: [],
        evidence: { venueAssetId },
      },
      options.gateFailure
        ? {
            gate: 'QUALITY',
            status: 'FAILED',
            failureCodes: ['FAILED_QUALITY_GATE'],
            evidence: {
              visualStandardApplied: visualStandardId,
              ...(options.environment ? { thePartyEnvironment: options.environment } : {}),
            },
          }
        : {
            gate: 'QUALITY',
            status: 'PASSED',
            failureCodes: [],
            evidence: {
              visualStandardApplied: visualStandardId,
              ...(options.environment
                ? { thePartyEnvironment: options.environment }
                : { thePartyEnvironment: 'MINIMALIST_NEUTRAL' }),
            },
          },
    ],
    createdAt: '2026-08-18T02:45:00-03:00',
  };
}

function minimalistClient(
  overrides: Partial<Record<ContentHeader, unknown>> = {},
): MutableSheetsClient {
  return new MutableSheetsClient(
    [contentHeaders as unknown as unknown[], contentRow(overrides)],
    [editionHeaders as unknown as unknown[], editionRow()],
  );
}

describe('GoogleSheetsThePartyContentWriteback', () => {
  it('writes only exact final gate evidence and verifies provider readback', async () => {
    const client = minimalistClient();
    const service = new GoogleSheetsThePartyContentWriteback(client);

    const result = await service.writeFinalCreativeTruthEvidence({
      contentItemId: 'MKT-TP-001',
      manifest: manifest(),
      observedOutputSha256: OUTPUT_SHA,
    });

    expect(result).toEqual({
      status: 'WRITTEN',
      contentItemId: 'MKT-TP-001',
      outputSha256: OUTPUT_SHA,
      visualStandardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
      manifestStandardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
      venueAssetId: 'VENUE-TP-0087',
    });
    expect(client.updates).toHaveLength(1);
    expect(client.updates[0]?.map((entry) => entry.values[0]?.[0])).toEqual(
      expect.arrayContaining(['CREATIVE_TRUTH_PASSED', 'PASS', true, OUTPUT_SHA]),
    );
  });

  it('accepts TOCA_THUMBNAIL_V1 only when the inherited The Party family matches', async () => {
    const client = minimalistClient();
    const service = new GoogleSheetsThePartyContentWriteback(client);

    const result = await service.writeFinalCreativeTruthEvidence({
      contentItemId: 'MKT-TP-001',
      manifest: manifest({ standardId: 'TOCA_THUMBNAIL_V1' }),
      observedOutputSha256: OUTPUT_SHA,
    });

    expect(result.manifestStandardId).toBe('TOCA_THUMBNAIL_V1');
    expect(result.visualStandardId).toBe('THE_PARTY_HYBRID_MINIMALIST_V1');
  });

  it('propagates a DECIDED same-edition Networks environment and binds the exact venue selected', async () => {
    const client = new MutableSheetsClient(
      [
        contentHeaders as unknown as unknown[],
        contentRow({
          the_party_intent: 'LINEUP',
          creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1',
          visual_standard_status: 'BLOCKED_NEEDS_ENVIRONMENT',
          venue_asset_id: '',
        }),
      ],
      [editionHeaders as unknown as unknown[], decidedEdition('INTERNATIONAL')],
    );
    const service = new GoogleSheetsThePartyContentWriteback(client);

    const result = await service.writeFinalCreativeTruthEvidence({
      contentItemId: 'MKT-TP-001',
      manifest: manifest({
        visualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
        environment: 'INTERNATIONAL',
        venueAssetId: 'VENUE-TP-0071',
      }),
      observedOutputSha256: OUTPUT_SHA,
    });

    expect(result).toMatchObject({
      status: 'WRITTEN',
      environment: 'INTERNATIONAL',
      venueAssetId: 'VENUE-TP-0071',
      visualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
    });
    const writtenValues = client.updates[0]?.map((entry) => entry.values[0]?.[0]) ?? [];
    expect(writtenValues).toContain('INTERNATIONAL');
    expect(writtenValues).toContain('VENUE-TP-0071');
  });

  it('is idempotent for the same exact final output and does not rewrite Drive', async () => {
    const client = minimalistClient({
      visual_standard_status: 'CREATIVE_TRUTH_PASSED',
      brand_integrity_status: 'PASS',
      venue_fidelity_status: 'PASS',
      quality_gate_status: 'PASS',
      exact_asset_binding: true,
      output_sha256: OUTPUT_SHA,
    });
    const service = new GoogleSheetsThePartyContentWriteback(client);

    const result = await service.writeFinalCreativeTruthEvidence({
      contentItemId: 'MKT-TP-001',
      manifest: manifest(),
      observedOutputSha256: OUTPUT_SHA,
    });

    expect(result.status).toBe('IDEMPOTENT');
    expect(client.updates).toHaveLength(0);
  });

  it('requires a new revision instead of overwriting an already approved different output', async () => {
    const oldSha = 'b'.repeat(64);
    const client = minimalistClient({
      visual_standard_status: 'CREATIVE_TRUTH_PASSED',
      brand_integrity_status: 'PASS',
      venue_fidelity_status: 'PASS',
      quality_gate_status: 'PASS',
      exact_asset_binding: true,
      output_sha256: oldSha,
    });
    const service = new GoogleSheetsThePartyContentWriteback(client);

    await expect(
      service.writeFinalCreativeTruthEvidence({
        contentItemId: 'MKT-TP-001',
        manifest: manifest(),
        observedOutputSha256: OUTPUT_SHA,
      }),
    ).rejects.toThrow('THE_PARTY_APPROVED_CREATIVE_REVISION_REQUIRED');
    expect(client.updates).toHaveLength(0);
  });

  it('rejects output substitution before any sheet write', async () => {
    const client = minimalistClient();
    const service = new GoogleSheetsThePartyContentWriteback(client);

    await expect(
      service.writeFinalCreativeTruthEvidence({
        contentItemId: 'MKT-TP-001',
        manifest: manifest(),
        observedOutputSha256: 'c'.repeat(64),
      }),
    ).rejects.toThrow('THE_PARTY_WRITEBACK_OUTPUT_SHA256_MISMATCH');
    expect(client.updates).toHaveLength(0);
  });

  it('rejects failed Creative Truth gates before any sheet write', async () => {
    const client = minimalistClient();
    const service = new GoogleSheetsThePartyContentWriteback(client);

    await expect(
      service.writeFinalCreativeTruthEvidence({
        contentItemId: 'MKT-TP-001',
        manifest: manifest({ gateFailure: true }),
        observedOutputSha256: OUTPUT_SHA,
      }),
    ).rejects.toThrow('CREATIVE_TRUTH_PUBLICATION_BLOCKED');
    expect(client.updates).toHaveLength(0);
  });

  it('rejects visual-family substitution, including a thumbnail carrying the wrong family', async () => {
    const client = minimalistClient();
    const service = new GoogleSheetsThePartyContentWriteback(client);

    await expect(
      service.writeFinalCreativeTruthEvidence({
        contentItemId: 'MKT-TP-001',
        manifest: manifest({
          standardId: 'TOCA_THUMBNAIL_V1',
          visualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
          environment: 'INTERNATIONAL',
        }),
        observedOutputSha256: OUTPUT_SHA,
      }),
    ).rejects.toThrow('THE_PARTY_WRITEBACK_VISUAL_STANDARD_MISMATCH');
    expect(client.updates).toHaveLength(0);
  });

  it('rejects Networks environment drift before writeback', async () => {
    const client = new MutableSheetsClient(
      [
        contentHeaders as unknown as unknown[],
        contentRow({
          the_party_intent: 'LINEUP',
          creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1',
          visual_standard_status: 'BLOCKED_NEEDS_ENVIRONMENT',
          venue_asset_id: '',
        }),
      ],
      [editionHeaders as unknown as unknown[], decidedEdition('NATIONAL')],
    );
    const service = new GoogleSheetsThePartyContentWriteback(client);

    await expect(
      service.writeFinalCreativeTruthEvidence({
        contentItemId: 'MKT-TP-001',
        manifest: manifest({
          visualStandardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
          environment: 'INTERNATIONAL',
          venueAssetId: 'VENUE-TP-0071',
        }),
        observedOutputSha256: OUTPUT_SHA,
      }),
    ).rejects.toThrow('THE_PARTY_WRITEBACK_ENVIRONMENT_MISMATCH');
    expect(client.updates).toHaveLength(0);
  });

  it('detects a content-state change between validation and writeback', async () => {
    const client = minimalistClient();
    client.beforeContentRead = (count, mutableRow) => {
      if (count === 2) {
        mutableRow[contentHeaders.indexOf('venue_asset_id')] = 'VENUE-TP-0048';
      }
    };
    const service = new GoogleSheetsThePartyContentWriteback(client);

    await expect(
      service.writeFinalCreativeTruthEvidence({
        contentItemId: 'MKT-TP-001',
        manifest: manifest(),
        observedOutputSha256: OUTPUT_SHA,
      }),
    ).rejects.toThrow('THE_PARTY_CONTENT_CHANGED_BEFORE_WRITEBACK');
    expect(client.updates).toHaveLength(0);
  });

  it('fails closed when the connected client has no batch-write capability', async () => {
    const mutable = minimalistClient();
    const readOnly: SpreadsheetValuesClient = {
      readRange: mutable.readRange.bind(mutable),
      appendRow: async () => undefined,
    };
    const service = new GoogleSheetsThePartyContentWriteback(readOnly);

    await expect(
      service.writeFinalCreativeTruthEvidence({
        contentItemId: 'MKT-TP-001',
        manifest: manifest(),
        observedOutputSha256: OUTPUT_SHA,
      }),
    ).rejects.toThrow('THE_PARTY_CONTENT_WRITEBACK_UNAVAILABLE');
  });
});
