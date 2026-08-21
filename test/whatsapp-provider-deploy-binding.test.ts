import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');

describe('WhatsApp provider deploy binding', () => {
  it('binds the canonical Business selector from environment configuration', () => {
    expect(workflow).toContain('WHATSAPP_BUSINESS_ID: ${{ vars.WHATSAPP_BUSINESS_ID }}');
    expect(workflow).toContain(
      `test -n "$WHATSAPP_BUSINESS_ID" || { echo 'WHATSAPP_BUSINESS_ID is required when WhatsApp is enabled' >&2; exit 1; }`,
    );
    expect(workflow).toContain('add_both WHATSAPP_BUSINESS_ID "$WHATSAPP_BUSINESS_ID"');
  });

  it('does not hardcode the selected production Business ID in the deploy workflow', () => {
    expect(workflow).not.toContain('232421267344387');
  });
});
