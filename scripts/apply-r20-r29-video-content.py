from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise RuntimeError(f'anchor not found in {path}: {old[:80]!r}')
    file.write_text(text.replace(old, new, 1))


replace_once(
    'src/governance/capability-ids.ts',
    """  R19: [
    'instagram.toca_schedule.prepare',
    'instagram.toca_schedule.create',
    'instagram.toca_schedule.reschedule',
    'instagram.toca_schedule.cancel',
    'instagram.toca_schedule.status',
    'instagram.toca_schedule.list',
  ],
};""",
    """  R19: [
    'instagram.toca_schedule.prepare',
    'instagram.toca_schedule.create',
    'instagram.toca_schedule.reschedule',
    'instagram.toca_schedule.cancel',
    'instagram.toca_schedule.status',
    'instagram.toca_schedule.list',
  ],
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
};""",
)

replace_once(
    'src/governance/route-catalog.ts',
    """    name: 'STORY_CREATIVE_PRODUCTION',
    purpose: 'Produzir conjuntos de Stories com master-first, formato e brand gates.',""",
    """    name: 'VIDEO_REELS_CREATIVE_PRODUCTION',
    purpose:
      'Produzir Stories e vídeos curtos com master-first, lineage, direitos, acessibilidade e quality gates.',""",
)
replace_once(
    'src/governance/route-catalog.ts',
    """      'POS_EVENTO',
    ],
    initialState: 'PLAN_REQUIRED',
    terminalStates: ['STORY_READY', 'APPROVED', 'SCHEDULED', 'PUBLISHED'],""",
    """      'POS_EVENTO',
      'REEL',
      'STORY_VIDEO',
      'REPURPOSING',
      'SUBTITLES',
      'THUMBNAIL',
    ],
    initialState: 'PLAN_REQUIRED',
    terminalStates: ['VIDEO_READY', 'REEL_READY', 'STORY_READY', 'APPROVED', 'SCHEDULED', 'PUBLISHED'],""",
)
replace_once(
    'src/governance/route-catalog.ts',
    """    subflows: ['SINGLE_IMAGE', 'CAROUSEL', 'STORY', 'REEL', 'AD_CREATIVE'],""",
    """    subflows: [
      'SINGLE_IMAGE',
      'CAROUSEL',
      'STORY',
      'REEL',
      'AD_CREATIVE',
      'VERSIONING',
      'VARIANT',
      'CHANNEL_ADAPTATION',
      'LOCALIZATION',
      'REPURPOSING',
      'EVENT_LINKAGE',
      'EXPERIMENT_LINKAGE',
    ],""",
)

replace_once(
    'src/governance/capability-contract-overrides.ts',
    "import type { RiskClass } from '../core/tool-registry.js';",
    "import { VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES } from '../content/capability-contracts.js';\nimport type { RiskClass } from '../core/tool-registry.js';",
)
replace_once(
    'src/governance/capability-contract-overrides.ts',
    "export const CAPABILITY_CONTRACT_OVERRIDES: Readonly<Record<string, CapabilityContractOverride>> = {\n  'system.health': {",
    "export const CAPABILITY_CONTRACT_OVERRIDES: Readonly<Record<string, CapabilityContractOverride>> = {\n  ...VIDEO_CONTENT_CAPABILITY_CONTRACT_OVERRIDES,\n  'system.health': {",
)

new_internal = """  'video.brief.create',
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
"""
replace_once(
    'src/governance/capability-catalog.ts',
    'const implementedInternal = new Set([\n',
    'const implementedInternal = new Set([\n' + new_internal,
)
replace_once(
    'src/governance/capability-catalog.ts',
    "  if (/^(design|image|copy|presentation|story)\\./.test(capabilityId)) return 'ChatGPT+TOCA_OS';",
    "  if (/^(design|image|copy|presentation|story|video)\\./.test(capabilityId)) return 'ChatGPT+TOCA_OS';",
)
replace_once(
    'src/governance/capability-catalog.ts',
    "  if (knownRuntimeTools.has(capabilityId)) return ['src/registry.ts'];\n  if (capabilityId.startsWith('approval.'))",
    "  if (knownRuntimeTools.has(capabilityId)) return ['src/registry.ts'];\n  if (capabilityId.startsWith('video.')) return ['src/content/video.ts', 'src/content/capability-contracts.ts'];\n  if (capabilityId.startsWith('content_item.') || capabilityId === 'content.repurpose.plan')\n    return ['src/content/content-item.ts', 'src/content/capability-contracts.ts'];\n  if (capabilityId.startsWith('approval.'))",
)

replace_once(
    'test/governance-catalog.test.ts',
    "it('materializes the 731-capability catalog using contract v1.1 without pretending inference is explicit'",
    "it('materializes the 756-capability catalog using contract v1.1 without pretending inference is explicit'",
)
replace_once(
    'test/governance-catalog.test.ts',
    'expect(CAPABILITY_CATALOG).toHaveLength(731);',
    'expect(CAPABILITY_CATALOG).toHaveLength(756);',
)
replace_once(
    'docs/architecture/routes-capabilities-v1.md',
    '`src/governance/capability-catalog.ts`: normalized metadata for all 731 catalog entries;',
    '`src/governance/capability-catalog.ts`: normalized metadata for the 731 compatibility entries plus 25 R20/R29 technical extensions (756 total);',
)

Path('scripts/apply-r20-r29-video-content.py').unlink()
Path('.github/workflows/r20-r29-one-shot.yml').unlink()
