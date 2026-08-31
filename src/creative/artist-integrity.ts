import { createHash } from 'node:crypto';
import type {
  ArtistAsset,
  ArtistIntegrityEvidence,
  ArtistIntegrityFailureCode,
  ArtistIntegrityGateResult,
  ArtistTransform,
} from '../contracts/artist-integrity.js';
import { ExecutionError } from '../core/errors.js';

export function sha256Artist(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function evaluateArtistIntegrity(input: {
  asset: ArtistAsset;
  sourceBytes: Uint8Array;
  evidence: ArtistIntegrityEvidence;
}): ArtistIntegrityGateResult {
  const failures = new Set<ArtistIntegrityFailureCode>();
  const observed = sha256Artist(input.sourceBytes);

  if (input.asset.status !== 'ACTIVE_APPROVED') failures.add('FAILED_ARTIST_ASSET_REVOKED');
  if (observed.toLowerCase() !== input.asset.sourceSha256.toLowerCase()) {
    failures.add('FAILED_ARTIST_SOURCE_MISMATCH');
  }
  if (input.evidence.sourceSha256Observed.toLowerCase() !== observed.toLowerCase()) {
    failures.add('FAILED_ARTIST_LINEAGE_MISSING');
  }
  if (input.evidence.aiOperationUsed || input.asset.aiModificationAllowed !== false) {
    failures.add('FAILED_ARTIST_AI_MODIFICATION');
  }
  if (input.evidence.physicalGeometryChanged || input.asset.physicalModificationAllowed !== false) {
    failures.add('FAILED_ARTIST_GEOMETRY_MODIFICATION');
  }
  if (input.evidence.unapprovedRetouchDetected) {
    failures.add('FAILED_ARTIST_UNAPPROVED_RETOUCH');
  }
  if (input.evidence.maskIntrusionDetected) failures.add('FAILED_ARTIST_MASK_INTRUSION');

  for (const transform of input.evidence.allowedTransformsApplied) {
    if (!isTransformAllowed(input.asset, transform)) {
      failures.add('FAILED_ARTIST_UNAPPROVED_RETOUCH');
    }
  }

  return {
    gate: 'ARTIST_INTEGRITY',
    status: failures.size === 0 ? 'PASSED' : 'FAILED',
    failureCodes: [...failures],
    evidence: input.evidence,
  };
}

export function requireArtistIntegrity(result: ArtistIntegrityGateResult): void {
  if (result.status === 'PASSED') return;
  throw new ExecutionError(
    'POLICY_DENIED',
    result.failureCodes[0] ?? 'FAILED_ARTIST_LINEAGE_MISSING',
    false,
  );
}

function isTransformAllowed(asset: ArtistAsset, transform: ArtistTransform): boolean {
  if (transform === 'CROP') return asset.cropAllowed;
  if (transform === 'SCALE' || transform === 'POSITION') return asset.compositionAllowed;
  if (transform === 'CONVENTIONAL_COLOR_CORRECTION') {
    return asset.conventionalTreatmentAllowed;
  }
  return false;
}
