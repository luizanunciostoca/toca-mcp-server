import { describe, expect, it } from 'vitest';
import { CAPABILITY_CATALOG, CAPABILITY_CATALOG_VERSION, getCapabilityDefinition, validateCapabilityCatalog } from '../src/governance/capability-catalog.js';
import { ROUTE_CATALOG, getRouteDefinition } from '../src/governance/route-catalog.js';
import { ROUTE_IDS } from '../src/governance/types.js';

const googleAdsCapabilities = [
  'google_ads.customers.discover',
  'google_ads.account.verify',
  'google_ads.account.inspect',
  'google_ads.campaigns.list',
  'google_ads.insights.get',
  'google_ads.conversion_actions.list',
  'google_ads.campaign.prepare',
  'google_ads.campaign.create_paused',
  'google_ads.campaign.readback',
  'google_ads.campaign.activate',
  'google_ads.campaign.pause',
  'google_ads.campaign.update_budget',
  'google_ads.targeting.validate',
  'google_ads.spend.monitor',
  'google_ads.conversions.monitor',
] as const;

describe('TOCA OS route and capability catalogs', () => {
  it('registers exactly R01-R32 as stable macroprocesses', () => {
    expect(ROUTE_IDS).toHaveLength(32);
    expect(ROUTE_CATALOG).toHaveLength(32);
    expect(ROUTE_IDS[0]).toBe('R01');
    expect(ROUTE_IDS.at(-1)).toBe('R32');

    expect(getRouteDefinition('R07').subflows).toEqual(
      expect.arrayContaining(['LOCAL_DISCOVERY', 'GOOGLE_EVENT_POST', 'PROFILE_FRESHNESS']),
    );
    expect(getRouteDefinition('R30').subflows).toContain('REVIEW_RESPONSE');
    expect(getRouteDefinition('R31').subflows).toContain('LOCAL_PERFORMANCE');
    for (const capabilityId of googleAdsCapabilities) {
      expect(getRouteDefinition('R28').capabilityIds).toContain(capabilityId);
    }
  });

  it('materializes the canonical capability catalog using contract v1.1 without pretending inference is explicit', () => {
    expect(() => validateCapabilityCatalog()).not.toThrow();
    expect(CAPABILITY_CATALOG).toHaveLength(798);
    expect(CAPABILITY_CATALOG_VERSION).toBe('1.1.0');
    expect(CAPABILITY_CATALOG.every((definition) => definition.version === '1.1.0')).toBe(true);

    expect(getCapabilityDefinition('approval.consume')).toMatchObject({
      route_id: 'R27',
      primary_route_id: 'R27',
      lifecycle_status: 'IMPLEMENTED',
      execution_surface: 'INTERNAL_ENGINE',
      contract_quality: 'RUNTIME_BOUND',
    });
    expect(getCapabilityDefinition('meta_ads.campaign.activate')).toMatchObject({
      route_id: 'R28',
      lifecycle_status: 'PLANNED',
      risk_class: 'FINANCIAL_IMPACT',
      side_effects: true,
      approval_required: true,
      provider: 'Meta Marketing API',
    });
  });

  it('keeps Google Ads inside R28 with OAuth scope and fail-closed write lifecycle', () => {
    for (const capabilityId of googleAdsCapabilities) {
      const definition = getCapabilityDefinition(capabilityId);
      expect(definition, capabilityId).toBeDefined();
      expect(definition?.route_id).toBe('R28');
      expect(definition?.provider).toBe('Google Ads API');
      expect(definition?.required_scopes).toContain('https://www.googleapis.com/auth/adwords');
      expect(definition?.authentication_mode).toBe('OAUTH2');
    }

    expect(getCapabilityDefinition('google_ads.campaigns.list')).toMatchObject({
      risk_class: 'READ',
      side_effects: false,
      approval_required: false,
      lifecycle_status: 'IMPLEMENTED',
    });
    expect(getCapabilityDefinition('google_ads.campaign.activate')).toMatchObject({
      risk_class: 'FINANCIAL_IMPACT',
      side_effects: true,
      approval_required: true,
    });
  });

  it('corrects known risk-classification errors with explicit contracts', () => {
    expect(getCapabilityDefinition('drive.file.archive')).toMatchObject({
      risk_class: 'WRITE_REVERSIBLE',
      side_effects: true,
    });
    expect(getCapabilityDefinition('social.response.send')).toMatchObject({
      risk_class: 'WRITE_EXTERNAL',
      side_effects: true,
    });
    expect(getCapabilityDefinition('finance.cashflow.import')).toMatchObject({
      risk_class: 'WRITE_REVERSIBLE',
      side_effects: true,
    });
  });

  it('uses the real bootstrap output contracts instead of requiring status/correlation_id universally', () => {
    expect(getCapabilityDefinition('system.health')?.output_schema).toMatchObject({
      type: 'object',
    });
    expect(getCapabilityDefinition('system.capabilities')?.output_schema).toMatchObject({
      type: 'object',
    });
  });

  it('models Instagram provider permissions by authentication mode instead of one guessed scope', () => {
    const definition = getCapabilityDefinition('instagram.media.list');
    expect(definition?.permission_requirements.length).toBeGreaterThan(0);
    expect(definition?.provider).toBe('Meta/Instagram');
  });

  it('keeps the runtime registry narrower than the canonical catalog and labels runtime contracts honestly', async () => {
    const { createToolRegistry } = await import('../src/registry.js');
    const runtime = createToolRegistry({
      instagramReadsEnabled: true,
      instagramPublicationWritesEnabled: true,
      metaAdsReadsEnabled: true,
      metaAdsWritesEnabled: true,
      paidMediaDecisionEnabled: true,
      googleAdsPhase: 'MANAGE',
      googleAdsActivateEnabled: true,
      tocaManagedInstagramSchedulerEnabled: true,
      crmSalesRuntimeEnabled: true,
      omnichannelReadbacksEnabled: true,
    });

    expect(runtime.list().length).toBeLessThan(CAPABILITY_CATALOG.length);
    for (const tool of runtime.list()) {
      const catalogDefinition = getCapabilityDefinition(tool.name);
      expect(catalogDefinition, tool.name).toBeDefined();
      if (catalogDefinition?.lifecycle_status !== tool.capabilityStatus) {
        // The canonical catalog may be promoted by provider-backed evidence while a
        // runtime declaration intentionally keeps the narrower implementation state.
        expect(catalogDefinition?.lifecycle_status).toBe('PRODUCTION_VALIDATED');
        expect(tool.capabilityStatus).toBe('IMPLEMENTED');
      }
      expect(catalogDefinition?.execution_surface).toBe('MCP_TOOL');
      expect(catalogDefinition?.contract_quality).not.toBe('LEGACY_INFERRED');
    }
  });
});
