import { describe, expect, it, vi } from 'vitest';
import { GoogleSheetsOperationScopedGenerativeRegistry } from '../src/providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import type { SpreadsheetValuesClient } from '../src/providers/google-sheets/media-assets.js';

function clientFor(ranges: Readonly<Record<string, readonly (readonly unknown[])[]>>) {
  const readRange = vi.fn(
    async (_spreadsheetId: string, range: string): Promise<readonly (readonly unknown[])[]> =>
      ranges[range] ?? [],
  );
  const appendRow = vi.fn(async (): Promise<void> => undefined);
  return {
    client: { readRange, appendRow } satisfies SpreadsheetValuesClient,
    readRange,
  };
}

function approvalRow(referenceSetId: string, exceptionId = 'GEN-1'): readonly unknown[] {
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
  ];
}

describe('GoogleSheetsOperationScopedGenerativeRegistry', () => {
  it.each([
    'TOCA_VENUE_REFERENCE_SET_SUNSET_V1',
    'TOCA_VENUE_REFERENCE_SET_THE_PARTY_V1',
  ])('parses the unique approved operation-scoped exception for %s', async (referenceSetId) => {
    const { client, readRange } = clientFor({
      'GENERATIVE_EXCEPTIONS!A2:N1000': [approvalRow(referenceSetId)],
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    const approval = await registry.getApprovedGenerativeException('CONTENT-1');
    expect(approval).toMatchObject({ contentItemId: 'CONTENT-1', referenceSetId, minReferenceCount: 3 });
    expect(readRange).toHaveBeenCalledWith('sheet', 'GENERATIVE_EXCEPTIONS!A2:N1000');
  });

  it('fails closed on ambiguous approved rows', async () => {
    const { client } = clientFor({
      'GENERATIVE_EXCEPTIONS!A2:N1000': [
        approvalRow('TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'GEN-1'),
        approvalRow('TOCA_VENUE_REFERENCE_SET_SUNSET_V1', 'GEN-2'),
      ],
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.getApprovedGenerativeException('CONTENT-1')).resolves.toBeUndefined();
  });

  it('rejects a deprecated global reference set instead of treating it as production-scoped', async () => {
    const { client } = clientFor({
      'GENERATIVE_EXCEPTIONS!A2:N1000': [approvalRow('TOCA_VENUE_REFERENCE_SET_V1')],
    });
    const registry = new GoogleSheetsOperationScopedGenerativeRegistry(client, {
      spreadsheetId: 'sheet',
    });

    await expect(registry.getApprovedGenerativeException('CONTENT-1')).rejects.toThrow();
  });
});
