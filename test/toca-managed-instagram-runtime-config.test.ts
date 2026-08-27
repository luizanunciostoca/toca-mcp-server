import { describe, expect, it } from 'vitest';
import { resolveTocaManagedInstagramTenantId } from '../src/scheduler/toca-managed-instagram-runtime-config.js';

describe('resolveTocaManagedInstagramTenantId', () => {
  it('uses the canonical toca tenant when the deploy does not provide an override', () => {
    expect(resolveTocaManagedInstagramTenantId({})).toBe('toca');
  });

  it('preserves an explicit tenant override', () => {
    expect(resolveTocaManagedInstagramTenantId({ TOCA_DEFAULT_TENANT_ID: 'tenant-isolated' })).toBe(
      'tenant-isolated',
    );
  });

  it('falls back when the override contains only whitespace', () => {
    expect(resolveTocaManagedInstagramTenantId({ TOCA_DEFAULT_TENANT_ID: '   ' })).toBe('toca');
  });
});
