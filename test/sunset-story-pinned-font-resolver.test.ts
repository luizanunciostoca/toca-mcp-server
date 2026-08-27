import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RepositorySunsetStoryPinnedFontResolver } from '../src/creative/sunset-story-pinned-font-resolver.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('RepositorySunsetStoryPinnedFontResolver', () => {
  const resolver = new RepositorySunsetStoryPinnedFontResolver();

  it('resolves the manual-approved Bodoni Moda candidate for editorial Didone roles', async () => {
    const font = await resolver.resolve('EDITORIAL_DIDONE_HEADLINE');

    expect(font.family).toBe('Bodoni Moda');
    expect(font.mimeType).toBe('font/ttf');
    expect(font.sha256).toBe('550f5e34ee0a828d7941b1fe9bc58b34e5260d3f33a61532e6d0a0114e79a5cf');
    expect(sha256(font.bytes)).toBe(font.sha256);
    expect(font.bytes.byteLength).toBe(162104);
  });

  it('resolves the same pinned Montserrat binary for all manual-derived sans roles', async () => {
    const roles = [
      'GEOMETRIC_SANS_DISPLAY_HEAVY',
      'GEOMETRIC_SANS_SUPPORT',
      'CLEAN_SANS_TIME',
      'CLEAN_SANS_CTA',
      'CLEAN_SANS_HASHTAG',
    ] as const;

    for (const role of roles) {
      const font = await resolver.resolve(role);
      expect(font.family).toBe('Montserrat');
      expect(font.sha256).toBe('0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7');
      expect(sha256(font.bytes)).toBe(font.sha256);
      expect(font.bytes.byteLength).toBe(744936);
    }
  });

  it('fails closed for an unknown font role', async () => {
    await expect(resolver.resolve('UNKNOWN_ROLE')).rejects.toThrow(
      'SUNSET_FONT_ROLE_UNSUPPORTED:UNKNOWN_ROLE',
    );
  });
});
