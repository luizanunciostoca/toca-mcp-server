import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  SunsetStoryOverlayAsset,
  SunsetStoryOverlayResolverPort,
} from '../../creative/sunset-story-overlay.js';
import type { SunsetStoryTemplateId } from '../../creative/sunset-story-template-registry.js';
import { ExecutionError } from '../../core/errors.js';

interface OverlayManifestEntry {
  readonly templateId: SunsetStoryTemplateId;
  readonly status: 'PENDING_ASSET_PIN' | 'APPROVED_PINNED';
  readonly path?: string;
  readonly sha256?: string;
  readonly width?: number;
  readonly height?: number;
}

interface OverlayManifest {
  readonly schemaVersion: '1.0';
  readonly entries: readonly OverlayManifestEntry[];
}

export class FilesystemSunsetStoryOverlayResolver implements SunsetStoryOverlayResolverPort {
  constructor(
    private readonly manifestPath = resolve(
      process.cwd(),
      'control/creative-standards/sunset-overlays.v1.json',
    ),
  ) {}

  async resolve(templateId: SunsetStoryTemplateId): Promise<SunsetStoryOverlayAsset> {
    const manifest = await this.loadManifest();
    const entry = manifest.entries.find((candidate) => candidate.templateId === templateId);
    if (!entry) {
      throw new ExecutionError('CAPABILITY_UNAVAILABLE', `SUNSET_OVERLAY_NOT_REGISTERED:${templateId}`, false);
    }
    if (entry.status !== 'APPROVED_PINNED') {
      throw new ExecutionError('CAPABILITY_UNAVAILABLE', `SUNSET_OVERLAY_NOT_PINNED:${templateId}`, false);
    }
    if (
      !entry.path?.trim() ||
      !entry.sha256?.match(/^[a-f0-9]{64}$/) ||
      entry.width !== 1080 ||
      entry.height !== 1920
    ) {
      throw new ExecutionError('QUALITY_GATE_FAILED', `SUNSET_OVERLAY_MANIFEST_INVALID:${templateId}`, false);
    }

    const root = dirname(this.manifestPath);
    const absolutePath = resolve(root, entry.path);
    const rootPrefix = root.endsWith('/') ? root : `${root}/`;
    if (absolutePath !== root && !absolutePath.startsWith(rootPrefix)) {
      throw new ExecutionError('POLICY_DENIED', `SUNSET_OVERLAY_PATH_ESCAPE:${templateId}`, false);
    }
    const overlayBytes = Uint8Array.from(await readFile(absolutePath));
    return {
      templateId,
      overlayBytes,
      sha256: entry.sha256,
      width: 1080,
      height: 1920,
      source: 'PINNED_APPROVED_OVERLAY',
    };
  }

  private async loadManifest(): Promise<OverlayManifest> {
    try {
      const raw = await readFile(this.manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<OverlayManifest>;
      if (parsed.schemaVersion !== '1.0' || !Array.isArray(parsed.entries)) {
        throw new Error('manifest shape invalid');
      }
      return parsed as OverlayManifest;
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      throw new ExecutionError(
        'CAPABILITY_UNAVAILABLE',
        `SUNSET_OVERLAY_MANIFEST_UNAVAILABLE:${error instanceof Error ? error.message : String(error)}`,
        false,
      );
    }
  }
}
