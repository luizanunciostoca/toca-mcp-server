import { describe, expect, it, vi } from 'vitest';
import { VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_IDS } from '../src/content/capability-ids.js';
import type {
  VideoContentRuntimeInput,
  VideoContentRuntimeService,
} from '../src/content/runtime.js';
import { resolveCapabilityDefinition } from '../src/governance/capability-resolution.js';
import { CORE_MCP_TOOL_NAMES } from '../src/mcp/core-surface.js';
import { createRuntimeCapabilityResolver } from '../src/mcp/runtime-capability-resolver.js';
import { createToolRegistry } from '../src/registry.js';

const R29_VIDEO_CAPABILITIES = [
  ...(VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_IDS.R20 ?? []),
  ...(VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_IDS.R29 ?? []),
] as const;

const validInput: VideoContentRuntimeInput = {
  tenant_id: 'toca-do-morcego',
  workspace_id: 'marketing',
  organization_id: 'toca-do-morcego',
  content_item_id: 'content-r29-runtime-test',
  version_id: 'version-r29-runtime-test',
  correlation_id: 'correlation-r29-runtime-test',
  idempotency_key: 'r29-runtime-test-key',
  evidence: ['test:r29-runtime'],
  payload: { brief: { test: true } },
};

function runtimeInputFor(capabilityId: string): VideoContentRuntimeInput {
  switch (capabilityId) {
    case 'video.export.reel':
    case 'video.export.story':
      return { ...validInput, approval_ref: 'approval-r29-runtime-test' };
    case 'content_item.channel.adapt':
      return { ...validInput, target_channel: 'INSTAGRAM', target_format: 'REEL' };
    case 'content_item.language.localize':
      return { ...validInput, target_language: 'pt-BR' };
    case 'content_item.event.link':
      return { ...validInput, event_id: 'event-r29-runtime-test' };
    case 'content_item.experiment.link':
      return { ...validInput, experiment_id: 'experiment-r29-runtime-test' };
    default:
      return validInput;
  }
}

class FakeVideoContentRuntime implements VideoContentRuntimeService {
  readonly execute = vi.fn((capabilityId: string, input: VideoContentRuntimeInput) =>
    Promise.resolve({
      capabilityId,
      contentItemId: input.content_item_id,
    }),
  );

  readonly readback = vi.fn(
    (capabilityId: string, _result: unknown, input: VideoContentRuntimeInput) =>
      Promise.resolve({
        verified: true,
        evidence: [`test:readback:${capabilityId}`],
        externalResourceId: `toca://r29/content/${input.content_item_id}`,
      }),
  );
}

describe('Video/R29 current TOCA Core runtime integration', () => {
  it('keeps the public MCP facade explicit while allowing governed Core reads', () => {
    expect(CORE_MCP_TOOL_NAMES).toHaveLength(13);
    expect(CORE_MCP_TOOL_NAMES).toContain('toca.execute');
    expect(CORE_MCP_TOOL_NAMES.some((name) => name.includes('video'))).toBe(false);
  });

  it('registers all 25 production-validated technical capabilities only when the durable Postgres runtime is enabled', () => {
    expect(R29_VIDEO_CAPABILITIES).toHaveLength(25);

    const disabled = createToolRegistry();
    const enabled = createToolRegistry({ videoContentRuntimeEnabled: true });

    for (const capabilityId of R29_VIDEO_CAPABILITIES) {
      expect(disabled.get(capabilityId), capabilityId).toBeUndefined();
      expect(enabled.get(capabilityId), capabilityId).toMatchObject({
        name: capabilityId,
        capabilityStatus: 'PRODUCTION_VALIDATED',
        idempotent: true,
      });
    }

    expect(enabled.get('video.caption.embed')).toMatchObject({
      capabilityStatus: 'PRODUCTION_VALIDATED',
      sideEffects: true,
    });
    expect(enabled.get('content_item.channel.adapt')).toMatchObject({
      capabilityStatus: 'PRODUCTION_VALIDATED',
      sideEffects: true,
    });
  });

  it('keeps canonical lifecycle aligned with the production runtime without exposing video as a public MCP tool', () => {
    for (const capabilityId of R29_VIDEO_CAPABILITIES) {
      expect(
        resolveCapabilityDefinition(capabilityId)?.canonical_definition,
        capabilityId,
      ).toMatchObject({
        lifecycle_status: 'PRODUCTION_VALIDATED',
        execution_surface: 'INTERNAL_ENGINE',
      });
    }
  });

  it('fails closed without the Video/R29 runtime service', () => {
    const resolver = createRuntimeCapabilityResolver({});
    for (const capabilityId of R29_VIDEO_CAPABILITIES) {
      expect(resolver(capabilityId), capabilityId).toBeUndefined();
    }
  });

  it('binds all 25 capabilities through the current core resolver with strict schemas', () => {
    const videoContent = new FakeVideoContentRuntime();
    const resolver = createRuntimeCapabilityResolver({ videoContent });

    for (const capabilityId of R29_VIDEO_CAPABILITIES) {
      const binding = resolver(capabilityId);
      expect(binding, capabilityId).toBeDefined();
      expect(
        () => binding!.inputSchema.parse(runtimeInputFor(capabilityId)),
        capabilityId,
      ).not.toThrow();
    }
  });

  it('provides deterministic idempotency and readback for internal side effects', async () => {
    const videoContent = new FakeVideoContentRuntime();
    const resolver = createRuntimeCapabilityResolver({ videoContent });
    const binding = resolver('video.brief.create');

    expect(binding).toBeDefined();
    expect(binding?.sideEffectValidated).toBe(true);
    expect(binding?.idempotencyKey?.(validInput)).toBe('r29-runtime-test-key');

    const result = await binding!.execute(validInput);
    const readback = await binding!.providerReadback!(result, validInput);

    expect(videoContent.execute).toHaveBeenCalledWith('video.brief.create', validInput);
    expect(videoContent.readback).toHaveBeenCalledWith('video.brief.create', result, validInput);
    expect(readback).toMatchObject({
      verified: true,
      externalResourceId: 'toca://r29/content/content-r29-runtime-test',
    });
  });
});
