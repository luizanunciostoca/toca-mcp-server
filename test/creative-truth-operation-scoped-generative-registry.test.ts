import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsOperationScopedGenerativeRegistry } from '../src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

function clientFor(ranges: Readonly<Record<string, readonly (readonly unknown[])[]>>) {
  const readRange = vi.fn(
    async (
      _spreadsheetId: string,
      range: string,
    ): Promise<readonly (readonly unknown[])[]> => ranges[range] ?? [],
  );
  const appendRow = vi.fn(async (): Promise<void> => undefined);
  return {
    client: { readRange, appendRow } satisfies SpreadsheetValuesClient,
    readRange,
  };
}

function approvalRow(
  referenceSetId: string,
  operation: string,
  exceptionId = 'GEN-1',
): readonly unknown[] {
  return [
    exceptionId,
    'CONTENT-1',
    'LUIZ',
    'LUIZ',
    `approval:${exceptionId}`,
    'Explicit controlled static generation',
    referenceSetId,
    3,
    false,
    false,
    false,
    'APPROVED',
    '2026-08-19T03:00:00Z',
    '2026-08-18T03:00:00Z',
    operation,
  ];
}

function canonicalPolicyRow(overrides: Partial<Record<number, unknown>> = {}): unknown[] {
  const row: unknown[] = [
    'TOCA_CREATIVE_TRUTH_POLICY_V1',
    '1.3',
    'ACTIVE_CANONICAL',
    'TOCA_DO_MORCEGO',
    'REAL_COMPOSITE|REAL_PLUS_ENHANCEMENT',
    'GENERATIVE_EXCEPTION',
    true,
    true,
    true,
    true,
    true,
    true,
    '1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM',
    '2026-08-18T13:58:00-03:00',
    true,
    'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE',
    'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
    'SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1',
    'OPERATION_SCOPED_ONLY_V1',
    'TOCA_VENUE_REFERENCE_SET_V1',
    'DEPRECATED',
    'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
    'FORBIDDEN',
    'REQUIRED',
    'DENY',
    'UNSUPPORTED_V1',
    'TOCA_PHOTO_TO_VIDEO_POLICY_V1',
    'ACTIVE_V1',
    'DENY',
    'NON_FINAL_BACKGROUND_CANDIDATE_ONLY',
    true,
    'DENY',
    'DENY',
    'FAIL_CLOSED_NO_FINAL_ASSET',
    'ENFORCED',
    'FAILED_DIRECT_GENERATIVE_FINALIZATION',
  ];
  for (const [key, value] of Object.entries(overrides)) row[Number(key)] = value;
  return row;
}

function referenceRow(
  referenceSetId: string,
  referenceId: string,
  operationScope: 'SUNSET' | 'THE_PARTY' | 'LEGACY_DEPRECATED',
  status = 'ACTIVE',
): readonly unknown[] {
  return [
    referenceSetId,
    referenceId,
    `ASSET-${referenceId}`,
    `drive-${referenceId}`,
    'VENUE_REFERENCE',
    'GENERATIVE_VENUE_TRUTH',
    true,
    true,
    'DECK|ARCHITECTURE',
    status,
    operationScope,
  ];
}

function canonicalReferenceRows(): readonly (readonly unknown[])[] {
  return [
    referenceRow(
      'TOCA_VENUE_REFERENCE_SET_V1',
      'LEGACY-1',
      'LEGACY_DEPRECATED',
      'DEPRECATED',
    ),
    referenceRow('TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUN-1', 'SUNSET'),
    referenceRow('TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUN-2', 'SUNSET'),
    referenceRow('TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUN-3', 'SUNSET'),
    referenceRow('TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1', 'TP-1', 'THE_PARTY'),
    referenceRow('TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1', 'TP-2', 'THE_PARTY'),
    referenceRow('TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1', 'TP-3', 'THE_PARTY'),
  ];
}

function policyRanges(
  policyRow: readonly unknown[] = canonicalPolicyRow(),
  referenceRows: readonly (readonly unknown[])[] = canonicalReferenceRows(),
): Readonly<Record<string, readonly (readonly unknown[])[]>> {
  return {
    'POLICY!A2:AK20': [policyRow],
    'POLICY!A2:Z20': [policyRow],
    'VENUE_REFERENCE_SET!A2:K1000': referenceRows,
  };
}

function contentContextRows(
  standardId = 'SUNSET_FEED_V1',
): readonly (readonly unknown[])[] {
  const header: unknown[] = Array.from({ length: 65 }, () => '');
  header[0] = 'content_item_id';
  header[64] = 'creative_standard_id';
  const row: unknown[] = Array.from({ length: 65 }, () => '');
  row[0] = 'CONTENT-1';
  row[64] = standardId;
  return [header, row];
}

describe('GoogleSheetsOperationScopedGenerativeRegistry', () => {
  it.each([
    ['TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUNSET'],
    ['TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1', 'THE_PARTY'],
  ] as const)(
    'parses the unique approved operation-scoped exception for %s',
    async (referenceSetId, operation) => {
      const { client, readRange } = clientFor({
        'GENERATIVE_EXCEPTIONS!A2:O1000': [approvalRow(referenceSetId, operation)],
      });
      const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
        spreadsheetId: 'sheet',
      });

      const approval = await registry.getApprovedGenerativeException('CONTENT-1');
      expect(approval).toMatchObject({
        contentItemId: 'CONTENT-1',
        referenceSetId,
        operation,
        minReferenceCount: 3,
      });
      expect(readRange).toHaveBeenCalledWith('sheet', 'GENERATIVE_EXCEPTIONS!A2:O1000');
    },
  );

  it('resolves creative_standard_id by canonical header name instead of a hard-coded column guess', async () => {
    const { client, readRange } = clientFor({
      'CONTENT_ITEMS!A1:BX2000': contentContextRows(),
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
      contentSpreadsheetId: 'content-sheet',
    });

    await expect(registry.getContentItemCreativeStandardId('CONTENT-1')).resolves.toBe(
      'SUNSET_FEED_V1',
    );
    expect(readRange).toHaveBeenCalledWith('content-sheet', 'CONTENT_ITEMS!A1:BX2000');
  });

  it('returns no content standard when the canonical content row exists but standard is not assigned', async () => {
    const { client } = clientFor({
      'CONTENT_ITEMS!A1:BX2000': contentContextRows(''),
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
      contentSpreadsheetId: 'content-sheet',
    });

    await expect(registry.getContentItemCreativeStandardId('CONTENT-1')).resolves.toBeUndefined();
  });

  it('fails closed if the content registry schema does not expose creative_standard_id', async () => {
    const { client } = clientFor({
      'CONTENT_ITEMS!A1:BX2000': [['content_item_id'], ['CONTENT-1']],
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
      contentSpreadsheetId: 'content-sheet',
    });

    await expect(registry.getContentItemCreativeStandardId('CONTENT-1')).rejects.toThrow(
      'FAILED_GENERATIVE_CONTENT_STANDARD_SCHEMA_INVALID',
    );
  });

  it('fails closed on ambiguous approved rows', async () => {
    const { client } = clientFor({
      'GENERATIVE_EXCEPTIONS!A2:O1000': [
        approvalRow('TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUNSET', 'GEN-1'),
        approvalRow('TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUNSET', 'GEN-2'),
      ],
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.getApprovedGenerativeException('CONTENT-1')).resolves.toBeUndefined();
  });

  it('rejects a deprecated global reference set instead of treating it as production-scoped', async () => {
    const { client } = clientFor({
      'GENERATIVE_EXCEPTIONS!A2:O1000': [
        approvalRow('TOCA_VENUE_REFERENCE_SET_V1', 'SUNSET'),
      ],
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.getApprovedGenerativeException('CONTENT-1')).rejects.toThrow(
      'FAILED_UNAPPROVED_GENERATIVE_EXCEPTION',
    );
  });

  it('rejects an approval whose explicit operation conflicts with its active reference set', async () => {
    const { client } = clientFor({
      'GENERATIVE_EXCEPTIONS!A2:O1000': [
        approvalRow('TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'THE_PARTY'),
      ],
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.getApprovedGenerativeException('CONTENT-1')).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
    );
  });

  it('accepts only the canonical v1.3 operation-scoped policy and reference topology', async () => {
    const { client, readRange } = clientFor(policyRanges());
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.assertCanonicalPolicy()).resolves.toBeUndefined();
    expect(readRange).toHaveBeenCalledWith('sheet', 'POLICY!A2:AK20');
    expect(readRange).toHaveBeenCalledWith('sheet', 'POLICY!A2:Z20');
    expect(readRange).toHaveBeenCalledWith('sheet', 'VENUE_REFERENCE_SET!A2:K1000');
  });

  it('fails closed when the scoped policy permits cross-operation reference reuse', async () => {
    const { client } = clientFor(policyRanges(canonicalPolicyRow({ 23: 'ALLOWED' })));
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.assertCanonicalPolicy()).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_SET_POLICY_DRIFT',
    );
  });

  it('fails closed when the legacy set is not explicitly deprecated', async () => {
    const rows = canonicalReferenceRows().map((row) => [...row]);
    rows[0]![9] = 'ACTIVE';
    const { client } = clientFor(policyRanges(canonicalPolicyRow(), rows));
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.assertCanonicalPolicy()).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_SET_DEPRECATED',
    );
  });

  it('fails closed when The Party reference rows claim Sunset operation scope', async () => {
    const rows = canonicalReferenceRows().map((row) => [...row]);
    const partyRow = rows.find(
      (row) => row[0] === 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
    );
    if (!partyRow) throw new Error('fixture missing The Party reference');
    partyRow[10] = 'SUNSET';
    const { client } = clientFor(policyRanges(canonicalPolicyRow(), rows));
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.assertCanonicalPolicy()).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_SET_OPERATION_MISMATCH',
    );
  });

  it('fails closed when an active operation-scoped set has fewer than three active references', async () => {
    const rows = canonicalReferenceRows().filter((row) => row[1] !== 'TP-3');
    const { client } = clientFor(policyRanges(canonicalPolicyRow(), rows));
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.assertCanonicalPolicy()).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_MISSING',
    );
  });
});
