import { describe, expect, it, vi } from 'vitest';
import { VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_IDS } from '../src/content/capability-ids.js';
import type {
  VideoContentRuntimeInput,
  VideoContentRuntimeService,
} from '../src/content/runtime.js';
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

class FakeVideoContentRuntime implements VideoContentRuntimeService {
  readonly execute = vi.fn(async (capabilityId: string, input: VideoContentRuntimeInput) => ({
    capabilityId,
    contentItemId: input.content_item_id,
  }));

  readonly readback = vi.fn(
    async (capabilityId: string, _result: unknown, input: VideoContentRuntimeInput) => ({
      verified: true,
      evidence: [`test:readback:${capabilityId}`],
      externalResourceId: `toca://r29/content/${input.content_item_id}`,
    }),
  );
}

describe('Video/R29 current TOCA Core runtime integration', () => {
  it('keeps the public MCP facade fixed at the 12 TOCA Core tools', () => {
    expect(CORE_MCP_TOOL_NAMES).toHaveLength(12);
    expect(CORE_MCP_TOOL_NAMES).toContain('toca.execute');
    expect(CORE_MCP_TOOL_NAMES.some((name) => name.includes('video'))).toBe(false);
  });

  it('registers all 25 technical capabilities only when the durable Postgres runtime is enabled', () => {
    expect(R29_VIDEO_CAPABILITIES).toHaveLength(25);

    const disabled = createToolRegistry();
    const enabled = createToolRegistry({ videoContentRuntimeEnabled: true });

    for (const capabilityId of R29_VIDEO_CAPABILITIES) {
      expect(disabled.get(capabilityId), capabilityId).toBeUndefined();
      expect(enabled.get(capabilityId), capabilityId).toMatchObject({
        name: capabilityId,
        capabilityStatus: 'IMPLEMENTED',
        idempotent: true,
      });
    }
  });

  it('fails closed without the Video/R29 runtime service', () => {
    const resolver = createRuntimeCapabilityResolver({});
    for (const capabilityId of R29_VIDEO_CAPABILITIES) {
      expect(resolver(capabilityId), capabilityId).toBeUndefined();
    }
  });

  it('binds all 25 capabilities through the current core resolver', () => {
    const videoContent = new FakeVideoContentRuntime();
    const resolver = createRuntimeCapabilityResolver({ videoContent });

    for (const capabilityId of R29_VIDEO_CAPABILITIES) {
      const binding = resolver(capabilityId);
      expect(binding, capabilityId).toBeDefined();
      expect(() => binding!.inputSchema.parse(validInput), capabilityId).not.toThrow();
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
