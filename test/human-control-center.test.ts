import * as z from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/core/tool-registry.js';
import type { CoreCapabilityRuntimeResolver } from '../src/mcp/core-execution.js';
import {
  CONTROL_CENTER_PANEL_IDS,
  buildControlCenterPanels,
} from '../src/mcp/human-control-center.js';

function runtimeHarness(capabilityIds: readonly string[]) {
  const registry = new ToolRegistry();
  const enabled = new Set(capabilityIds);
  for (const name of capabilityIds) {
    registry.register({
      name,
      version: 'test',
      provider: 'test',
      riskClass: 'READ',
      requiredScopes: [],
      capabilityStatus: 'IMPLEMENTED',
      sideEffects: false,
      idempotent: true,
    });
  }
  const runtimeResolver: CoreCapabilityRuntimeResolver = (capabilityId) =>
    enabled.has(capabilityId)
      ? {
          inputSchema: z.object({}).passthrough(),
          execute: (input) => Promise.resolve(input),
        }
      : undefined;
  return { registry, runtimeResolver };
}

function build(capabilityIds: readonly string[] = []) {
  const runtime = runtimeHarness(capabilityIds);
  return buildControlCenterPanels({
    ...runtime,
    approvalStoreAvailable: true,
    workflowStoreAvailable: true,
    auditStoreAvailable: true,
    eventStoreAvailable: true,
  });
}

describe('Human Control Center governed surface', () => {
  it('exposes exactly the requested operational panels', () => {
    const panels = build();
    expect(panels.map((panel) => panel.id)).toEqual(CONTROL_CENTER_PANEL_IDS);
  });

  it('fails closed for pending approval listing because current Core has no tenant-safe list tool', () => {
    const panel = build().find((candidate) => candidate.id === 'pending-approvals');
    expect(panel).toMatchObject({ state: 'PARTIAL' });
    expect(panel?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'toca.approval.list', available: false }),
        expect.objectContaining({ id: 'toca.approval.get', available: true }),
      ]),
    );
    expect(panel?.dependency).toContain('tenant-safe approval list');
  });

  it('marks publication and dead-letter panels ready only when their existing Core capabilities are bound', () => {
    const panels = build(['instagram.toca_schedule.list', 'instagram.media.list']);
    expect(panels.find((panel) => panel.id === 'publications')?.state).toBe('READY');
    expect(panels.find((panel) => panel.id === 'dead-letters')?.state).toBe('READY');
  });

  it('keeps parallel CRM, experiment, incident and SLO work dependency-pending instead of duplicating it', () => {
    const panels = build();
    for (const id of ['pipeline', 'critical-leads', 'next-actions', 'experiments', 'incidents', 'slo-status']) {
      expect(panels.find((panel) => panel.id === id)?.state).toBe('DEPENDENCY_PENDING');
    }
  });

  it('activates Demand Index and budget recommendations only when the canonical PR #15 capabilities exist in registry and runtime', () => {
    const panels = build([
      'meta_ads.audience.inspect',
      'meta_ads.opportunity.detect',
      'meta_ads.budget.recommend',
    ]);
    expect(panels.find((panel) => panel.id === 'demand-index')?.state).toBe('READY');
    expect(panels.find((panel) => panel.id === 'budget-recommendations')?.state).toBe('READY');
  });

  it('never treats a catalog-only capability as runtime available', () => {
    const runtime = runtimeHarness([]);
    runtime.registry.register({
      name: 'meta_ads.budget.recommend',
      version: 'test',
      provider: 'test',
      riskClass: 'READ',
      requiredScopes: [],
      capabilityStatus: 'IMPLEMENTED',
      sideEffects: false,
      idempotent: true,
    });
    const panels = buildControlCenterPanels({
      ...runtime,
      approvalStoreAvailable: true,
      workflowStoreAvailable: true,
      auditStoreAvailable: true,
      eventStoreAvailable: true,
    });
    expect(panels.find((panel) => panel.id === 'budget-recommendations')?.state).toBe(
      'DEPENDENCY_PENDING',
    );
  });
});
