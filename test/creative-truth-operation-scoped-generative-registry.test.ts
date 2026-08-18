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
  const row: unknown[] = Array.from({ length: 26 }, () => '');
  Object.assign(row, {
    0: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    1: '1.0',
    2: 'ACTIVE_CANONICAL',
    3: 'TOCA_DO_MORCEGO',
    4: 'REAL_COMPOSITE|REAL_PLUS_ENHANCEMENT',
    5: 'GENERATIVE_EXCEPTION',
    6: true,
    7: true,
    8: true,
    9: true,
    10: true,
    11: true,
    12: '1UR_LD8Gw4rlQkGsYh-VGW1ns8AzEx_m4fazpcCW-2wM',
    14: true,
    15: 'FAIL_CLOSED_UNTIL_SHOT_LEVEL_PROVENANCE',
    16: 'VIDEO_ENHANCEMENT_PROVENANCE_UNSUPPORTED',
    17: 'UNSUPPORTED_V1',
    18: 'OPERATION_SCOPED_ONLY_V1',
    19: 'TOCA_VENUE_REFERENCE_SET_V1',
    20: 'DEPRECATED',
    21: 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    22: 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
    23: 'FORBIDDEN',
    24: 'REQUIRED',
    25: 'DENY',
    ...overrides,
  });
  return row;
}

function referenceRow(
  referenceId: string,
  referenceSetId: string,
  operationScope: 'SUNSET' | 'THE_PARTY' | 'LEGACY_DEPRECATED',
  status = 'ACTIVE',
): readonly unknown[] {
  return [
    referenceId,
    referenceSetId,
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
      'LEGACY-1',
      'TOCA_VENUE_REFERENCE_SET_V1',
      'LEGACY_DEPRECATED',
      'DEPRECATED',
    ),
    referenceRow('SUN-1', 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUNSET'),
    referenceRow('SUN-2', 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUNSET'),
    referenceRow('SUN-3', 'TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'SUNSET'),
    referenceRow('TP-1', 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1', 'THE_PARTY'),
    referenceRow('TP-2', 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1', 'THE_PARTY'),
    referenceRow('TP-3', 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1', 'THE_PARTY'),
  ];
}

function policyRanges(
  policyRow: readonly unknown[] = canonicalPolicyRow(),
  referenceRows: readonly (readonly unknown[])[] = canonicalReferenceRows(),
): Readonly<Record<string, readonly (readonly unknown[])[]>> {
  return {
    'POLICY!A2:R20': [policyRow],
    'POLICY!A2:Z20': [policyRow],
    'VENUE_REFERENCE_SET!A2:K1000': referenceRows,
  };
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

  it('accepts only the canonical operation-scoped policy and reference topology', async () => {
    const { client, readRange } = clientFor(policyRanges());
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.assertCanonicalPolicy()).resolves.toBeUndefined();
    expect(readRange).toHaveBeenCalledWith('sheet', 'POLICY!A2:R20');
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
      (row) => row[1] === 'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
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
    const rows = canonicalReferenceRows().filter((row) => row[0] !== 'TP-3');
    const { client } = clientFor(policyRanges(canonicalPolicyRow(), rows));
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.assertCanonicalPolicy()).rejects.toThrow(
      'FAILED_GENERATIVE_REFERENCE_MISSING',
    );
  });
});
