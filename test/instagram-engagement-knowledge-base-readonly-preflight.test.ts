import { describe, expect, it, vi } from 'vitest';
import {
  runInstagramKnowledgeReadOnlyPreflight,
  sanitizeInstagramKnowledgePreflightError,
} from '../src/ops/preflight-instagram-engagement-knowledge-base.js';
import { INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID } from '../src/instagram-engagement/knowledge-snapshot-current.js';

const registry = [
  ['source_id', 'titulo', 'drive_id', 'escopo', 'precedencia', 'status', 'unused', 'unused2'],
  ['SRC-OPS-001', 'Operações', 'drive-ops', 'OPERACIONAL', 'FAQ', 'CANONICO', '', ''],
  ['SRC-MENU-002', 'Menu', 'drive-menu', 'MENU', 'KB', 'ATIVO', '', ''],
  ['SRC-LOC-001', 'Localização', 'drive-loc', 'LOCATION', 'KB', 'ACTIVE', '', ''],
] as const;

describe('Instagram engagement knowledge-base read-only preflight', () => {
  it('reads exactly the allowlisted sources without database or provider writes', async () => {
    const readRange = vi.fn(() => Promise.resolve(registry));
    const readText = vi.fn((fileId: string) =>
      Promise.resolve({
        id: fileId,
        name: 'source',
        mimeType: 'text/plain',
        text: `validated content for ${fileId}`,
      }),
    );

    const result = await runInstagramKnowledgeReadOnlyPreflight(
      { readRange },
      { readText },
      INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
      ['SRC-OPS-001', 'SRC-MENU-002', 'SRC-LOC-001'],
    );

    expect(result.status).toBe('PASS');
    expect(result.sourceCount).toBe(3);
    expect(result.databaseTouched).toBe(false);
    expect(result.providerWritesUsed).toBe(false);
    expect(result.sourceContentPrinted).toBe(false);
    expect(result.documents.map((item) => item.sourceId)).toEqual([
      'SRC-OPS-001',
      'SRC-MENU-002',
      'SRC-LOC-001',
    ]);
    expect(readRange).toHaveBeenCalledOnce();
    expect(readText).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain('validated content');
    expect(JSON.stringify(result)).not.toContain('drive-ops');
  });

  it('fails closed when the canonical source registry is incomplete', async () => {
    const incomplete = registry.slice(0, 3);
    await expect(
      runInstagramKnowledgeReadOnlyPreflight(
        { readRange: () => Promise.resolve(incomplete) },
        {
          readText: () => Promise.resolve({ id: '', name: '', mimeType: '', text: 'x' }),
        },
        INSTAGRAM_ENGAGEMENT_CANONICAL_SPREADSHEET_ID,
        ['SRC-OPS-001', 'SRC-MENU-002', 'SRC-LOC-001'],
      ),
    ).rejects.toThrow('INSTAGRAM_ENGAGEMENT_KB_SOURCE_SET_MISMATCH');
  });

  it('sanitizes provider failures to bounded error codes', () => {
    expect(
      sanitizeInstagramKnowledgePreflightError(
        new Error('GOOGLE_WORKSPACE_SCOPED_TOKEN_FAILED:403'),
      ),
    ).toBe('GOOGLE_WORKSPACE_SCOPED_TOKEN_FAILED:403');
    expect(
      sanitizeInstagramKnowledgePreflightError(
        new Error('Google Sheets read range failed with HTTP 403: sensitive provider detail'),
      ),
    ).toBe('GOOGLE_SHEETS_READ_RANGE_FAILED:403');
    expect(sanitizeInstagramKnowledgePreflightError(new Error('secret private text'))).toBe(
      'INSTAGRAM_ENGAGEMENT_KB_PREFLIGHT_UNCLASSIFIED_FAILURE',
    );
  });
});
