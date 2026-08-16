import type { RouteId } from '../governance/types.js';

export const VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_IDS: Readonly<
  Partial<Record<RouteId, readonly string[]>>
> = {
  R20: [
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
  ],
  R29: [
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
  ],
};

export const VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_SET = new Set(
  Object.values(VIDEO_CONTENT_TECHNICAL_EXTENSION_CAPABILITY_IDS).flatMap(
    (capabilityIds) => capabilityIds ?? [],
  ),
);
