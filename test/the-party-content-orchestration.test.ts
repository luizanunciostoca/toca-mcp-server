import { describe, expect, it } from 'vitest';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';
import {
  GoogleSheetsThePartyContentOrchestration,
  THE_PARTY_CONTENT_REGISTRY_DRIVE_ID,
  THE_PARTY_EDITION_REGISTRY_DRIVE_ID,
} from '../src/providers/google-sheets/the-party-content-orchestration.js';

const headers = [
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

const editionHeaders = [
  'edition_id',
  'visual_family_policy',
  'the_party_environment',
  'environment_status',
  'environment_decision_source',
  'environment_decision_at',
  'environment_decision_by',
] as const;

function row(
  overrides: Partial<Record<(typeof headers)[number], unknown>> = {},
): readonly unknown[] {
  const values: Record<(typeof headers)[number], unknown> = {
    content_item_id: 'MKT-TP-001',
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
    quality_gate_status: 'PENDING',
    exact_asset_binding: '',
    output_sha256: '',
  };
  Object.assign(values, overrides);
  return headers.map((header) => values[header]);
}

function editionRow(
  overrides: Partial<Record<(typeof editionHeaders)[number], unknown>> = {},
): readonly unknown[] {
  const values: Record<(typeof editionHeaders)[number], unknown> = {
    edition_id: 'TP-20260822',
    visual_family_policy: 'RESOLVE_BY_INTENT',
    the_party_environment: '',
    environment_status: 'PENDING_DECISION',
    environment_decision_source: '',
    environment_decision_at: '',
    environment_decision_by: '',
  };
  Object.assign(values, overrides);
  return editionHeaders.map((header) => values[header]);
}

function decidedEdition(environment: 'INTERNATIONAL' | 'NATIONAL'): readonly unknown[] {
  return editionRow({
    the_party_environment: environment,
    environment_status: 'DECIDED',
    environment_decision_source: 'EDITION_DOSSIER',
    environment_decision_at: '2026-08-18T02:30:00-03:00',
    environment_decision_by: 'LUIZ_EXPLICIT_DECISION',
  });
}

function clientFor(
  rows: readonly (readonly unknown[])[],
  editionRows: readonly (readonly unknown[])[] = [editionRow()],
): SpreadsheetValuesClient {
  return {
    readRange: async (spreadsheetId, range) => {
      if (spreadsheetId === THE_PARTY_CONTENT_REGISTRY_DRIVE_ID) {
        expect(range).toBe('CONTENT_ITEMS!A1:BX2000');
        return [headers, ...rows];
      }
      if (spreadsheetId === THE_PARTY_EDITION_REGISTRY_DRIVE_ID) {
        expect(range).toBe('EDITIONS!A1:P2000');
        return [editionHeaders, ...editionRows];
      }
      throw new Error(`unexpected spreadsheet: ${spreadsheetId}`);
    },
    appendRow: async () => undefined,
  };
}

describe('GoogleSheetsThePartyContentOrchestration', () => {
  it('builds a Creative Truth request from a canonical minimalist content item', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(clientFor([row()]));

    const record = await adapter.get('MKT-TP-001');
    expect(record.editionId).toBe('TP-20260822');
    expect(record.editionEnvironmentStatus).toBe('PENDING_DECISION');
    expect(record.environment).toBeUndefined();

    const result = await adapter.buildCreativeTruthResolutionInput('MKT-TP-001', {
      requiredBrands: ['TOCA_DO_MORCEGO', 'THE_PARTY'],
      requestedMode: 'REAL_COMPOSITE',
    });

    expect(result).toEqual({
      contentItemId: 'MKT-TP-001',
      standardId: 'THE_PARTY_HYBRID_MINIMALIST_V1',
      operation: 'THE_PARTY',
      requestedMode: 'REAL_COMPOSITE',
      venueAssetId: 'VENUE-TP-0087',
      requiredBrands: ['THE_PARTY', 'TOCA_DO_MORCEGO'],
      thePartyIntent: 'PEOPLE_FIRST_CONVERSION',
    });
  });

  it('preserves an explicit item-level Networks environment while the edition decision is pending', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor([
        row({
          the_party_intent: 'LINEUP',
          the_party_environment: 'INTERNATIONAL',
          creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1',
          visual_standard_status: 'RESOLVED',
          venue_asset_id: 'VENUE-TP-0071',
        }),
      ]),
    );

    const record = await adapter.get('MKT-TP-001');
    expect(record.environmentSource).toBe('CONTENT_ITEM');
    expect(record.editionEnvironmentStatus).toBe('PENDING_DECISION');

    const result = await adapter.buildCreativeTruthResolutionInput('MKT-TP-001');
    expect(result).toMatchObject({
      standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
      thePartyIntent: 'LINEUP',
      thePartyEnvironment: 'INTERNATIONAL',
      venueAssetId: 'VENUE-TP-0071',
      requiredBrands: ['THE_PARTY'],
    });
  });

  it('keeps a blocked Networks item blocked while its exact edition decision is pending', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor([
        row({
          the_party_intent: 'SOCIAL_PROMOTION',
          creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1',
          visual_standard_status: 'BLOCKED_NEEDS_ENVIRONMENT',
          venue_asset_id: '',
        }),
      ]),
    );

    const record = await adapter.get('MKT-TP-001');
    expect(record.editionId).toBe('TP-20260822');
    expect(record.visualStandardStatus).toBe('BLOCKED_NEEDS_ENVIRONMENT');
    expect(record.persistedVisualStandardStatus).toBe('BLOCKED_NEEDS_ENVIRONMENT');
    expect(record.environment).toBeUndefined();

    await expect(adapter.buildCreativeTruthResolutionInput('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_ENVIRONMENT_REQUIRED',
    );
  });

  it('derives a Networks environment only from a DECIDED same-edition context with decision evidence', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor(
        [
          row({
            the_party_intent: 'SOCIAL_PROMOTION',
            creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1',
            visual_standard_status: 'BLOCKED_NEEDS_ENVIRONMENT',
            venue_asset_id: '',
          }),
        ],
        [decidedEdition('NATIONAL')],
      ),
    );

    const record = await adapter.get('MKT-TP-001');
    expect(record.environment).toBe('NATIONAL');
    expect(record.environmentSource).toBe('EDITION_CONTEXT');
    expect(record.editionEnvironmentStatus).toBe('DECIDED');
    expect(record.persistedVisualStandardStatus).toBe('BLOCKED_NEEDS_ENVIRONMENT');
    expect(record.visualStandardStatus).toBe('RESOLVED');

    const result = await adapter.buildCreativeTruthResolutionInput('MKT-TP-001');
    expect(result).toMatchObject({
      contentItemId: 'MKT-TP-001',
      standardId: 'THE_PARTY_HYBRID_NETWORKS_V1',
      thePartyIntent: 'SOCIAL_PROMOTION',
      thePartyEnvironment: 'NATIONAL',
      requiredBrands: ['THE_PARTY'],
    });
    expect(result.venueAssetId).toBeUndefined();
  });

  it('rejects DECIDED edition context without provenance fields', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor(
        [
          row({
            the_party_intent: 'SOCIAL_PROMOTION',
            creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1',
            visual_standard_status: 'BLOCKED_NEEDS_ENVIRONMENT',
          }),
        ],
        [editionRow({ the_party_environment: 'NATIONAL', environment_status: 'DECIDED' })],
      ),
    );

    await expect(adapter.get('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_EDITION_ENVIRONMENT_DECISION_EVIDENCE_REQUIRED',
    );
  });

  it('rejects an explicit item environment that conflicts with a DECIDED edition environment', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor(
        [
          row({
            the_party_intent: 'LINEUP',
            the_party_environment: 'INTERNATIONAL',
            creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1',
            visual_standard_status: 'RESOLVED',
          }),
        ],
        [decidedEdition('NATIONAL')],
      ),
    );

    await expect(adapter.get('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_CONTENT_EDITION_ENVIRONMENT_CONFLICT',
    );
  });

  it('never resolves an environment from another edition', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor(
        [
          row({
            the_party_intent: 'LINEUP',
            creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1',
            visual_standard_status: 'BLOCKED_NEEDS_ENVIRONMENT',
          }),
        ],
        [
          editionRow({
            edition_id: 'TP-20260829',
            the_party_environment: 'INTERNATIONAL',
            environment_status: 'DECIDED',
            environment_decision_source: 'EDITION_DOSSIER',
            environment_decision_at: '2026-08-18T02:30:00-03:00',
            environment_decision_by: 'LUIZ_EXPLICIT_DECISION',
          }),
        ],
      ),
    );

    await expect(adapter.get('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_EDITION_CONTEXT_NOT_FOUND',
    );
  });

  it('fails closed when intent and standard disagree in Drive', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor([row({ creative_standard_id: 'THE_PARTY_HYBRID_NETWORKS_V1' })]),
    );

    await expect(adapter.get('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_CONTENT_STANDARD_INTENT_MISMATCH',
    );
  });

  it('fails closed when the official The Party hero asset is not the canonical one', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor([row({ hero_brand_asset_id: 'BRAND-THE-PARTY-FAKE' })]),
    );

    await expect(adapter.get('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_CONTENT_HERO_BRAND_MISMATCH',
    );
  });

  it('rejects premature or partial exact-output evidence', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor([
        row({
          exact_asset_binding: true,
          output_sha256: 'a'.repeat(64),
          brand_integrity_status: 'PASS',
          venue_fidelity_status: 'PENDING',
          quality_gate_status: 'PASS',
        }),
      ]),
    );

    await expect(adapter.get('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_CONTENT_FINAL_BINDING_INCOMPLETE',
    );
  });

  it('accepts exact-output evidence only when every Creative Truth gate passed', async () => {
    const adapter = new GoogleSheetsThePartyContentOrchestration(
      clientFor([
        row({
          visual_standard_status: 'CREATIVE_TRUTH_PASSED',
          exact_asset_binding: true,
          output_sha256: 'b'.repeat(64),
          brand_integrity_status: 'PASS',
          venue_fidelity_status: 'PASS',
          quality_gate_status: 'PASS',
        }),
      ]),
    );

    const record = await adapter.get('MKT-TP-001');
    expect(record.exactAssetBinding).toBe(true);
    expect(record.outputSha256).toBe('b'.repeat(64));
  });

  it('fails closed when a required orchestration column disappears', async () => {
    const incompleteHeaders = headers.filter((header) => header !== 'quality_gate_status');
    const client: SpreadsheetValuesClient = {
      readRange: async (spreadsheetId) => {
        if (spreadsheetId === THE_PARTY_CONTENT_REGISTRY_DRIVE_ID) {
          return [incompleteHeaders, row()];
        }
        return [editionHeaders, editionRow()];
      },
      appendRow: async () => undefined,
    };
    const adapter = new GoogleSheetsThePartyContentOrchestration(client);

    await expect(adapter.get('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_CONTENT_ORCHESTRATION_COLUMN_MISSING:quality_gate_status',
    );
  });

  it('fails closed when the edition decision schema loses provenance columns', async () => {
    const incompleteEditionHeaders = editionHeaders.filter(
      (header) => header !== 'environment_decision_source',
    );
    const client: SpreadsheetValuesClient = {
      readRange: async (spreadsheetId) => {
        if (spreadsheetId === THE_PARTY_CONTENT_REGISTRY_DRIVE_ID) return [headers, row()];
        return [incompleteEditionHeaders, editionRow()];
      },
      appendRow: async () => undefined,
    };
    const adapter = new GoogleSheetsThePartyContentOrchestration(client);

    await expect(adapter.get('MKT-TP-001')).rejects.toThrow(
      'THE_PARTY_EDITION_CONTEXT_COLUMN_MISSING:environment_decision_source',
    );
  });
});
