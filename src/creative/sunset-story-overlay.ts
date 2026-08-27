import { createHash } from 'node:crypto';
import type { SunsetStoryTemplateId } from './sunset-story-template-registry.js';
import { ExecutionError } from '../core/errors.js';

export interface SunsetStoryOverlayAsset {
  readonly templateId: SunsetStoryTemplateId;
  readonly overlayBytes: Uint8Array;
  readonly sha256: string;
  readonly width: 1080;
  readonly height: 1920;
  readonly source: 'PINNED_APPROVED_OVERLAY';
}

export interface SunsetStoryOverlayResolverPort {
  resolve(templateId: SunsetStoryTemplateId): Promise<SunsetStoryOverlayAsset>;
}

export function validateSunsetStoryOverlayAsset(
  asset: SunsetStoryOverlayAsset,
  expectedTemplateId: SunsetStoryTemplateId,
): void {
  if (asset.templateId !== expectedTemplateId) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'SUNSET_OVERLAY_TEMPLATE_MISMATCH', false);
  }
  if (asset.width !== 1080 || asset.height !== 1920) {
    throw new ExecutionError(
      'OUTPUT_TECH_SPEC_MISMATCH',
      'SUNSET_OVERLAY_DIMENSIONS_INVALID',
      false,
    );
  }
  if (asset.source !== 'PINNED_APPROVED_OVERLAY') {
    throw new ExecutionError('POLICY_DENIED', 'SUNSET_OVERLAY_SOURCE_NOT_APPROVED', false);
  }
  if (!isPng(asset.overlayBytes)) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'SUNSET_OVERLAY_NOT_PNG', false);
  }
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'SUNSET_OVERLAY_SHA256_INVALID', false);
  }
  const actualSha256 = createHash('sha256').update(asset.overlayBytes).digest('hex');
  if (actualSha256 !== asset.sha256) {
    throw new ExecutionError('QUALITY_GATE_FAILED', 'SUNSET_OVERLAY_SHA256_MISMATCH', false);
  }
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}
