import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CATALOG,
  getCapabilityDefinition,
  validateCapabilityCatalog,
} from '../src/governance/capability-catalog.js';
import {
  ROUTE_CATALOG,
  getRouteDefinition,
  validateRouteCatalog,
} from '../src/governance/route-catalog.js';
import { ROUTE_IDS } from '../src/governance/types.js';
import { createToolRegistry } from '../src/registry.js';

describe('TOCA OS route and capability catalogs', () => {
  it('registers exactly R01-R32 as stable macroprocesses', () => {
    expect(() => validateRouteCatalog()).not.toThrow();
    expect(ROUTE_CATALOG.map((route) => route.routeId)).toEqual(ROUTE_IDS);
    expect(getRouteDefinition('R21')).toMatchObject({
      name: 'GOVERNANCE_DRIFT_RECONCILIATION',
      priority: 'P0',
      terminalStates: ['RECONCILED', 'BLOCKED_PENDING_HUMAN_DECISION'],
    });
    expect(getRouteDefinition('R32').capabilityIds).toContain('registry.reconcile');
  });

  it('materializes every requested and technical capability with complete metadata', () => {
    expect(() => validateCapabilityCatalog()).not.toThrow();
    expect(CAPABILITY_CATALOG).toHaveLength(731);
    expect(getCapabilityDefinition('approval.consume')).toMatchObject({
      route_id: 'R27',
      lifecycle_status: 'IMPLEMENTED',
      execution_surface: 'INTERNAL_ENGINE',
    });
    expect(getCapabilityDefinition('meta_ads.campaign.activate')).toMatchObject({
      route_id: 'R28',
      lifecycle_status: 'PLANNED',
      risk_class: 'FINANCIAL_IMPACT',
      approval_required: true,
    });
    expect(getCapabilityDefinition('content_item.state.transition')?.input_schema.$id).toContain(
      'content_item.state.transition',
    );
    expect(getCapabilityDefinition('meta_ads.creative.create')).toMatchObject({
      risk_class: 'WRITE_EXTERNAL',
      approval_required: true,
    });
    expect(getCapabilityDefinition('release.deploy')).toMatchObject({
      risk_class: 'WRITE_EXTERNAL',
      approval_required: true,
    });
  });

  it('keeps the runtime registry narrower than the canonical catalog', () => {
    const runtime = createToolRegistry({
      instagramReadsEnabled: true,
      metaAdsReadsEnabled: true,
      metaAdsWritesEnabled: true,
      tocaManagedInstagramSchedulerEnabled: true,
    });
    expect(runtime.list().length).toBeLessThan(CAPABILITY_CATALOG.length);
    for (const tool of runtime.list()) {
      const catalogDefinition = getCapabilityDefinition(tool.name);
      expect(catalogDefinition, tool.name).toBeDefined();
      expect(catalogDefinition?.lifecycle_status, tool.name).toBe(tool.capabilityStatus);
      expect(catalogDefinition?.risk_class, tool.name).toBe(tool.riskClass);
      expect(catalogDefinition?.side_effects, tool.name).toBe(tool.sideEffects);
      expect(catalogDefinition?.idempotent, tool.name).toBe(tool.idempotent);
      expect(catalogDefinition?.provider, tool.name).toBe(tool.provider);
      expect(catalogDefinition?.required_scopes, tool.name).toEqual(tool.requiredScopes);
    }
    expect(runtime.get('meta_ads.campaign.activate')).toBeUndefined();
    expect(
      CAPABILITY_CATALOG.filter((definition) => definition.execution_surface === 'MCP_TOOL'),
    ).toHaveLength(runtime.list().length);
  });
});
