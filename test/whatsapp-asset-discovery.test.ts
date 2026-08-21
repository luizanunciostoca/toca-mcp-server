import { describe, expect, it } from 'vitest';
import { discoverWhatsAppAssets } from '../src/providers/whatsapp/whatsapp-asset-discovery.js';

type GetCall = { readonly path: string; readonly query: Readonly<Record<string, string>> };

class FakeMetaApi {
  readonly calls: GetCall[] = [];

  constructor(private readonly responses: Readonly<Record<string, unknown>>) {}

  get(path: string, query: Readonly<Record<string, string>> = {}): Promise<unknown> {
    this.calls.push({ path, query });
    const value = this.responses[path];
    if (value instanceof Error) return Promise.reject(value);
    if (value === undefined) return Promise.reject(new Error(`UNEXPECTED_PATH:${path}`));
    return Promise.resolve(value);
  }
}

describe('WhatsApp asset discovery', () => {
  it('discovers the unique Business, WABA and phone-number tuple', async () => {
    const api = new FakeMetaApi({
      'me/businesses': { data: [{ id: 'business-1', name: 'TOCA' }] },
      'business-1/owned_whatsapp_business_accounts': {
        data: [{ id: 'waba-1', name: 'TOCA WhatsApp' }],
      },
      'business-1/client_whatsapp_business_accounts': { data: [] },
      'waba-1/phone_numbers': {
        data: [
          {
            id: 'phone-1',
            display_phone_number: '+55 75 99999-0000',
            verified_name: 'Toca do Morcego',
          },
        ],
      },
    });

    const result = await discoverWhatsAppAssets(api as never);
    expect(result).toMatchObject({
      businessId: 'business-1',
      wabaId: 'waba-1',
      phoneNumberId: 'phone-1',
      verifiedName: 'Toca do Morcego',
    });
  });

  it('fails closed on ambiguity unless an explicit selector resolves it', async () => {
    const api = new FakeMetaApi({
      'me/businesses': {
        data: [
          { id: 'business-1', name: 'A' },
          { id: 'business-2', name: 'B' },
        ],
      },
      'business-2/owned_whatsapp_business_accounts': {
        data: [
          { id: 'waba-1', name: 'One' },
          { id: 'waba-2', name: 'Two' },
        ],
      },
      'business-2/client_whatsapp_business_accounts': { data: [] },
      'waba-2/phone_numbers': {
        data: [
          { id: 'phone-1', display_phone_number: '+55 75 90000-0001', verified_name: 'One' },
          { id: 'phone-2', display_phone_number: '+55 75 90000-0002', verified_name: 'Two' },
        ],
      },
    });

    await expect(discoverWhatsAppAssets(api as never)).rejects.toThrow(
      'WHATSAPP_BUSINESS_AMBIGUOUS',
    );

    const result = await discoverWhatsAppAssets(api as never, {
      businessId: 'business-2',
      wabaId: 'waba-2',
      phoneNumberId: 'phone-2',
    });
    expect(result.phoneNumberId).toBe('phone-2');
  });

  it('tolerates one unavailable WABA edge when the other returns a unique candidate', async () => {
    const api = new FakeMetaApi({
      'me/businesses': { data: [{ id: 'business-1', name: 'TOCA' }] },
      'business-1/owned_whatsapp_business_accounts': new Error('EDGE_UNAVAILABLE'),
      'business-1/client_whatsapp_business_accounts': { data: [{ id: 'waba-1', name: 'Client' }] },
      'waba-1/phone_numbers': {
        data: [{ id: 'phone-1', display_phone_number: '+55 75 90000-0000', verified_name: 'TOCA' }],
      },
    });

    const result = await discoverWhatsAppAssets(api as never);
    expect(result.wabaId).toBe('waba-1');
  });
});
