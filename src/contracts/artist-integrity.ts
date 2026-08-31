import * as z from 'zod/v4';

export const ARTIST_INTEGRITY_POLICY_ID = 'TOCA_ARTIST_INTEGRITY_POLICY_V1' as const;

export const artistAssetSchema = z.object({
  artistAssetId: z.string().min(1),
  artist: z.string().min(1),
  sourceAssetId: z.string().min(1),
  sourceDriveFileId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  usageScope: z.array(z.string().min(1)).min(1),
  aiModificationAllowed: z.literal(false),
  physicalModificationAllowed: z.literal(false),
  conventionalTreatmentAllowed: z.boolean(),
  cropAllowed: z.boolean(),
  compositionAllowed: z.boolean(),
  protectedElements: z.array(z.string().min(1)).default([
    'FACE',
    'HAIR',
    'SKIN',
    'BODY',
    'HANDS',
    'CLOTHING',
    'ACCESSORIES',
  ]),
  status: z.enum(['ACTIVE_APPROVED', 'REVOKED']),
});

export const artistIntegrityFailureCodeSchema = z.enum([
  'FAILED_ARTIST_SOURCE_MISMATCH',
  'FAILED_ARTIST_AI_MODIFICATION',
  'FAILED_ARTIST_GEOMETRY_MODIFICATION',
  'FAILED_ARTIST_UNAPPROVED_RETOUCH',
  'FAILED_ARTIST_LINEAGE_MISSING',
  'FAILED_ARTIST_MASK_INTRUSION',
  'FAILED_ARTIST_ASSET_REVOKED',
]);

export const artistTransformSchema = z.enum([
  'CROP',
  'SCALE',
  'POSITION',
  'CONVENTIONAL_COLOR_CORRECTION',
]);

export const artistIntegrityEvidenceSchema = z.object({
  sourceSha256Observed: z.string().regex(/^[a-f0-9]{64}$/i),
  aiOperationUsed: z.boolean(),
  physicalGeometryChanged: z.boolean(),
  unapprovedRetouchDetected: z.boolean(),
  maskIntrusionDetected: z.boolean(),
  allowedTransformsApplied: z.array(artistTransformSchema).default([]),
  verifier: z.string().min(1),
});

export const artistIntegrityGateResultSchema = z.object({
  gate: z.literal('ARTIST_INTEGRITY'),
  status: z.enum(['PASSED', 'FAILED']),
  failureCodes: z.array(artistIntegrityFailureCodeSchema).default([]),
  evidence: artistIntegrityEvidenceSchema,
});

export type ArtistAsset = z.infer<typeof artistAssetSchema>;
export type ArtistTransform = z.infer<typeof artistTransformSchema>;
export type ArtistIntegrityEvidence = z.infer<typeof artistIntegrityEvidenceSchema>;
export type ArtistIntegrityFailureCode = z.infer<typeof artistIntegrityFailureCodeSchema>;
export type ArtistIntegrityGateResult = z.infer<typeof artistIntegrityGateResultSchema>;
