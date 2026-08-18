import * as z from 'zod/v4';
import { GcsPublicationAssetStager } from './providers/gcp/gcs-publication-asset-stager.js';

const envSchema = z.object({
  GCP_PROJECT_ID: z.string().min(1),
  INSTAGRAM_PUBLICATION_ASSET_BUCKET: z.string().min(1),
  INSTAGRAM_PUBLICATION_ASSET_ID: z.string().min(1),
  INSTAGRAM_PUBLICATION_CORRELATION_ID: z.string().min(1),
  INSTAGRAM_PUBLICATION_ASSET_SOURCE_PATH: z.string().min(1),
  INSTAGRAM_PUBLICATION_ASSET_CONTENT_TYPE: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
  ]),
});

const env = envSchema.parse(process.env);
const stager = new GcsPublicationAssetStager({
  projectId: env.GCP_PROJECT_ID,
  bucketName: env.INSTAGRAM_PUBLICATION_ASSET_BUCKET,
});

const result = await stager.stage({
  assetId: env.INSTAGRAM_PUBLICATION_ASSET_ID,
  correlationId: env.INSTAGRAM_PUBLICATION_CORRELATION_ID,
  sourcePath: env.INSTAGRAM_PUBLICATION_ASSET_SOURCE_PATH,
  contentType: env.INSTAGRAM_PUBLICATION_ASSET_CONTENT_TYPE,
});

process.stdout.write(`${JSON.stringify(result)}\n`);
