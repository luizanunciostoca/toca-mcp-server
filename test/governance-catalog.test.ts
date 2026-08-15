import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CATALOG,
  CAPABILITY_CATALOG_VERSION,
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

  it('materializes the 756-capability catalog using contract v1.1 without pretending inference is explicit', () => {
    expect(() => validateCapabilityCatalog()).not.toThrow();
    expect(CAPABILITY_CATALOG).toHaveLength(756);
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

  it('corrects known risk-classification errors with explicit contracts', () => {
    expect(getCapabilityDefinition('drive.file.copy')).toMatchObject({
      contract_quality: 'EXPLICIT',
      risk_class: 'WRITE_EXTERNAL',
      side_effects: true,
      approval_required: true,
    });
    expect(getCapabilityDefinition('operations.opening.checklist.execute')).toMatchObject({
      contract_quality: 'EXPLICIT',
      risk_class: 'WRITE_REVERSIBLE',
      side_effects: true,
    });
    expect(getCapabilityDefinition('operations.closing.checklist.execute')).toMatchObject({
      contract_quality: 'EXPLICIT',
      risk_class: 'WRITE_REVERSIBLE',
      side_effects: true,
    });
    expect(getCapabilityDefinition('story.export')).toMatchObject({
      contract_quality: 'EXPLICIT',
      risk_class: 'WRITE_REVERSIBLE',
      side_effects: true,
    });
  });

  it('uses the real bootstrap output contracts instead of requiring status/correlation_id universally', () => {
    const health = getCapabilityDefinition('system.health');
    expect(health).toMatchObject({ contract_quality: 'EXPLICIT' });
    expect(health?.output_schema).toMatchObject({
      additionalProperties: false,
      required: ['status', 'service', 'version', 'phase'],
    });
    expect(health?.output_schema.required).not.toContain('correlation_id');

    const capabilities = getCapabilityDefinition('system.capabilities');
    expect(capabilities?.output_schema).toMatchObject({
      additionalProperties: false,
      required: ['tools'],
    });
    expect(capabilities?.output_schema.required).not.toContain('status');
    expect(capabilities?.output_schema.required).not.toContain('correlation_id');
  });

  it('models Instagram provider permissions by authentication mode instead of one guessed scope', () => {
    const publication = getCapabilityDefinition('instagram.publish.image');
    const facebookLogin = publication?.permission_requirements.find(
      (requirement) => requirement.authentication_mode === 'META_FACEBOOK_LOGIN',
    );
    const instagramLogin = publication?.permission_requirements.find(
      (requirement) => requirement.authentication_mode === 'META_INSTAGRAM_LOGIN',
    );

    expect(facebookLogin).toBeDefined();
    expect(facebookLogin?.scopes).toContain('instagram_basic');
    expect(facebookLogin?.scopes).toContain('instagram_content_publish');
    expect(instagramLogin).toBeDefined();
    expect(instagramLogin?.scopes).toContain('instagram_business_basic');
    expect(instagramLogin?.scopes).toContain('instagram_business_content_publish');
  });

  it('keeps the runtime registry narrower than the canonical catalog and labels runtime contracts honestly', () => {
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
      expect(catalogDefinition?.contract_quality, tool.name).not.toBe('LEGACY_INFERRED');
    }
    expect(runtime.get('meta_ads.campaign.activate')).toBeUndefined();
    expect(
      CAPABILITY_CATALOG.filter((definition) => definition.execution_surface === 'MCP_TOOL'),
    ).toHaveLength(runtime.list().length);
  });
});
