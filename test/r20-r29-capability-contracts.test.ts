import { describe, expect, it } from 'vitest';
import { CAPABILITY_CATALOG, getCapabilityDefinition } from '../src/governance/capability-catalog.js';
import { getRouteDefinition } from '../src/governance/route-catalog.js';

const requestedCapabilities = [
  'video.brief.create',
  'video.storyboard.generate',
  'video.script.generate',
  'video.asset.select',
  'video.timeline.compose',
  'video.subtitle.generate',
  'video.caption.embed',
  'video.audio.normalize',
  'video.music_rights.validate',
  'video.safe_area.validate',
  'video.duration.validate',
  'video.thumbnail.generate',
  'video.export.reel',
  'video.export.story',
  'video.quality.validate',
  'content_item.version.create',
  'content_item.variant.create',
  'content_item.channel.adapt',
  'content_item.language.localize',
  'content_item.fact.validate',
  'content_item.rights.validate',
  'content_item.accessibility.validate',
  'content_item.event.link',
  'content_item.experiment.link',
  'content.repurpose.plan',
] as const;

describe('R20/R29 capability contracts', () => {
  it('materializes every requested capability as explicit internal implementation', () => {
    expect(requestedCapabilities).toHaveLength(25);
    for (const capabilityId of requestedCapabilities) {
      expect(getCapabilityDefinition(capabilityId), capabilityId).toMatchObject({
        capability_id: capabilityId,
        contract_quality: 'EXPLICIT',
        lifecycle_status: 'IMPLEMENTED',
        execution_surface: 'INTERNAL_ENGINE',
        authentication_mode: 'INTERNAL',
        idempotent: true,
      });
    }
  });

  it('keeps R20 production-only exports off the external publication surface', () => {
    for (const capabilityId of ['video.export.reel', 'video.export.story'] as const) {
      expect(getCapabilityDefinition(capabilityId)).toMatchObject({
        risk_class: 'WRITE_REVERSIBLE',
        side_effects: true,
        approval_required: false,
      });
    }
    expect(requestedCapabilities.some((capabilityId) => capabilityId.includes('publish'))).toBe(false);
    expect(
      CAPABILITY_CATALOG.filter(
        (definition) =>
          requestedCapabilities.includes(definition.capability_id as (typeof requestedCapabilities)[number]) &&
          definition.execution_surface === 'MCP_TOOL',
      ),
    ).toHaveLength(0);
  });

  it('keeps R29 as the content lifecycle backbone and links production through subflows', () => {
    expect(getRouteDefinition('R20').subflows).toEqual(
      expect.arrayContaining(['REEL', 'STORY_VIDEO', 'REPURPOSING', 'SUBTITLES', 'THUMBNAIL']),
    );
    expect(getRouteDefinition('R29').subflows).toEqual(
      expect.arrayContaining([
        'VERSIONING',
        'VARIANT',
        'CHANNEL_ADAPTATION',
        'LOCALIZATION',
        'REPURPOSING',
        'EVENT_LINKAGE',
        'EXPERIMENT_LINKAGE',
      ]),
    );
    expect(getRouteDefinition('R29').capabilityIds).toEqual(
      expect.arrayContaining([
        'content_item.version.create',
        'content_item.variant.create',
        'content_item.channel.adapt',
        'content_item.language.localize',
        'content_item.event.link',
        'content.repurpose.plan',
      ]),
    );
  });
});
