import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { META_ADS_PRIMARY_ACCOUNT_ID } from '../src/providers/meta-ads/meta-ads-account-binding.js';
import { THE_PARTY_2026_08_15_ACCOUNT_ID } from '../src/providers/meta-ads/meta-ads-the-party-2026-08-15-plan.js';

describe('Meta Ads primary account binding', () => {
  it('keeps canonical code and provider-validation workflow on the same primary account', () => {
    expect(META_ADS_PRIMARY_ACCOUNT_ID).toBe('311793958882290');
    expect(THE_PARTY_2026_08_15_ACCOUNT_ID).toBe(META_ADS_PRIMARY_ACCOUNT_ID);

    const workflow = readFileSync('.github/workflows/meta-ads-create-paused-provider-smoke.yml', 'utf8');
    expect(workflow).toContain(`META_ADS_ACCOUNT_ID: '${META_ADS_PRIMARY_ACCOUNT_ID}'`);
  });
});
