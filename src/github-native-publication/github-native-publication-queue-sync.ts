import { readFile, writeFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { creativeTruthPublicationBindingSchema } from '../contracts/creative-truth.js';
import {
  GITHUB_NATIVE_PUBLICATION_QUEUE_SCHEMA_VERSION,
  GITHUB_NATIVE_PUBLICATION_TIMEZONE,
  parseGithubNativePublicationQueue,
  type GithubNativePublicationItem,
  type GithubNativePublicationQueue,
} from './github-native-publication-contracts.js';

export const CANONICAL_CONTENT_REGISTRY_SPREADSHEET_ID =
  '1r02HLhmnTijFNkmZv4o1yeZPxCEUMXZC_QreDFB6yTw' as const;
export const CANONICAL_CONTENT_REGISTRY_SHEET_NAME = 'CONTENT_ITEMS' as const;
export const GITHUB_NATIVE_QUEUE_SYNC_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const GITHUB_NATIVE_QUEUE_SYNC_MAX_STALENESS_MS = 15 * 60 * 1000;
export const GITHUB_NATIVE_QUEUE_SYNC_MINIMUM_LEAD_MS = 30 * 60 * 1000;
export const GITHUB_NATIVE_QUEUE_SYNC_MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const driveFileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,}$/);
const explicitOffsetTimestampSchema = z
  .string()
  .regex(/T.*(?:Z|[+-]\d{2}:\d{2})$/i, 'timestamp must include Z or an explicit numeric offset')
  .refine((value) => Number.isFinite(Date.parse(value)), 'timestamp must be valid ISO-8601');

const canonicalRegistryCandidateSchema = z.object({
  rowRef: z.string().min(1),
  contentItemId: z.string().min(1),
  scheduledAt: explicitOffsetTimestampSchema,
  expiresAt: explicitOffsetTimestampSchema.optional(),
  operation: z.string().min(1),
  channel: z.string().min(1),
  format: z.string().min(1),
  status: z.string().min(1),
  approvalStatus: z.string().min(1).optional(),
  publicationIntent: z.string().min(1).optional(),
  instagramAccountId: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  caption: z.string().optional(),
  finalDriveFileId: driveFileIdSchema.optional(),
  finalAssetSha256: sha256Schema.optional(),
  correlationId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  creativeTruthBinding: creativeTruthPublicationBindingSchema.optional(),
});

export const githubNativePublicationRegistrySnapshotSchema = z.object({
  schemaVersion: z.literal(GITHUB_NATIVE_QUEUE_SYNC_SNAPSHOT_SCHEMA_VERSION),
  source: z.object({
    spreadsheetId: z.literal(CANONICAL_CONTENT_REGISTRY_SPREADSHEET_ID),
    sheetName: z.literal(CANONICAL_CONTENT_REGISTRY_SHEET_NAME),
    fetchedAt: explicitOffsetTimestampSchema,
    registryRevision: z.string().min(1).optional(),
  }),
  candidates: z.array(canonicalRegistryCandidateSchema),
});

export type GithubNativePublicationRegistrySnapshot = z.infer<
  typeof githubNativePublicationRegistrySnapshotSchema
>;

type QueueSyncDecision = {
  readonly contentItemId: string;
  readonly rowRef: string;
  readonly decision: 'MIRRORED' | 'SKIPPED';
  readonly reason: string;
};

export type GithubNativeQueueSyncEvidence = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly source: GithubNativePublicationRegistrySnapshot['source'];
  readonly mirroredCount: number;
  readonly skippedCount: number;
  readonly decisions: readonly QueueSyncDecision[];
};

export type GithubNativeQueueSyncResult = {
  readonly queue: GithubNativePublicationQueue;
  readonly evidence: GithubNativeQueueSyncEvidence;
};

type CompileOptions = {
  readonly minimumLeadMs?: number;
  readonly maxStalenessMs?: number;
};

const publicationAssetsBaseUrl =
  'https://raw.githubusercontent.com/luizanunciostoca/toca-mcp-server/publication-assets/publication-assets';

export function compileGithubNativePublicationQueue(
  value: unknown,
  nowIso: string,
  options: CompileOptions = {},
): GithubNativeQueueSyncResult {
  const snapshot = githubNativePublicationRegistrySnapshotSchema.parse(value);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new Error('GITHUB_NATIVE_QUEUE_SYNC_NOW_INVALID');

  const fetchedAt = Date.parse(snapshot.source.fetchedAt);
  const maxStalenessMs = options.maxStalenessMs ?? GITHUB_NATIVE_QUEUE_SYNC_MAX_STALENESS_MS;
  const minimumLeadMs = options.minimumLeadMs ?? GITHUB_NATIVE_QUEUE_SYNC_MINIMUM_LEAD_MS;
  if (fetchedAt - now > GITHUB_NATIVE_QUEUE_SYNC_MAX_FUTURE_CLOCK_SKEW_MS) {
    throw new Error('GITHUB_NATIVE_QUEUE_SYNC_SNAPSHOT_FROM_FUTURE');
  }
  if (now - fetchedAt > maxStalenessMs) {
    throw new Error('GITHUB_NATIVE_QUEUE_SYNC_SNAPSHOT_STALE');
  }

  const items: GithubNativePublicationItem[] = [];
  const decisions: QueueSyncDecision[] = [];

  for (const candidate of snapshot.candidates) {
    const skipReason = getSkipReason(candidate, now, minimumLeadMs);
    if (skipReason) {
      decisions.push({
        contentItemId: candidate.contentItemId,
        rowRef: candidate.rowRef,
        decision: 'SKIPPED',
        reason: skipReason,
      });
      continue;
    }

    const item = buildEligibleQueueItem(candidate);
    items.push(item);
    decisions.push({
      contentItemId: candidate.contentItemId,
      rowRef: candidate.rowRef,
      decision: 'MIRRORED',
      reason: 'ELIGIBLE_CANONICAL_ITEM',
    });
  }

  const queue = parseGithubNativePublicationQueue({
    schemaVersion: GITHUB_NATIVE_PUBLICATION_QUEUE_SCHEMA_VERSION,
    timezone: GITHUB_NATIVE_PUBLICATION_TIMEZONE,
    generatedAt: new Date(now).toISOString(),
    items,
  });

  return {
    queue,
    evidence: {
      schemaVersion: 1,
      generatedAt: new Date(now).toISOString(),
      source: snapshot.source,
      mirroredCount: decisions.filter((decision) => decision.decision === 'MIRRORED').length,
      skippedCount: decisions.filter((decision) => decision.decision === 'SKIPPED').length,
      decisions,
    },
  };
}

export async function runGithubNativePublicationQueueSync(
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): Promise<GithubNativeQueueSyncResult> {
  const snapshotPath =
    env.TOCA_PUBLICATION_REGISTRY_SNAPSHOT_PATH?.trim() ||
    'control/github-native-publication-registry-snapshot.json';
  const queuePath =
    env.TOCA_PUBLICATION_QUEUE_PATH?.trim() || 'control/github-native-publication-queue.json';
  const evidencePath =
    env.TOCA_PUBLICATION_QUEUE_SYNC_EVIDENCE_PATH?.trim() ||
    'github-native-publication-queue-sync-evidence.json';

  const snapshot: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const result = compileGithubNativePublicationQueue(snapshot, now().toISOString());
  await writeFile(queuePath, `${JSON.stringify(result.queue, null, 2)}\n`, 'utf8');
  await writeFile(evidencePath, `${JSON.stringify(result.evidence, null, 2)}\n`, 'utf8');
  return result;
}

function getSkipReason(
  candidate: z.infer<typeof canonicalRegistryCandidateSchema>,
  now: number,
  minimumLeadMs: number,
): string | undefined {
  if (candidate.channel !== 'INSTAGRAM') return 'CHANNEL_NOT_INSTAGRAM';
  if (candidate.status !== 'PRODUCED') return 'STATUS_NOT_PRODUCED';
  if (candidate.approvalStatus !== 'APPROVED') return 'APPROVAL_NOT_APPROVED';
  if (candidate.publicationIntent !== 'SCHEDULED') return 'PUBLICATION_INTENT_NOT_SCHEDULED';
  if (candidate.operation !== 'SUNSET' && candidate.operation !== 'THE_PARTY') {
    return 'OPERATION_NOT_SUPPORTED';
  }
  if (candidate.format !== 'FEED' && candidate.format !== 'STORY') {
    return 'FORMAT_NOT_SUPPORTED';
  }

  const scheduledAt = Date.parse(candidate.scheduledAt);
  if (scheduledAt <= now) return 'SCHEDULE_NOT_FUTURE';
  if (scheduledAt - now < minimumLeadMs) return 'INSUFFICIENT_LEAD_TIME';
  if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= scheduledAt) {
    throw new Error(`GITHUB_NATIVE_QUEUE_SYNC_INVALID_EXPIRY:${candidate.contentItemId}`);
  }
  return undefined;
}

function buildEligibleQueueItem(
  candidate: z.infer<typeof canonicalRegistryCandidateSchema>,
): GithubNativePublicationItem {
  const instagramAccountId = requireField(
    candidate.instagramAccountId,
    candidate.contentItemId,
    'INSTAGRAM_ACCOUNT_ID',
  );
  const finalDriveFileId = requireField(
    candidate.finalDriveFileId,
    candidate.contentItemId,
    'FINAL_DRIVE_FILE_ID',
  );
  const finalAssetSha256 = requireField(
    candidate.finalAssetSha256,
    candidate.contentItemId,
    'FINAL_ASSET_SHA256',
  ).toLowerCase();
  const correlationId = requireField(
    candidate.correlationId,
    candidate.contentItemId,
    'CORRELATION_ID',
  );
  const idempotencyKey = requireField(
    candidate.idempotencyKey,
    candidate.contentItemId,
    'IDEMPOTENCY_KEY',
  );
  const creativeTruthBinding = candidate.creativeTruthBinding;
  if (!creativeTruthBinding) {
    throw new Error(`GITHUB_NATIVE_QUEUE_SYNC_CREATIVE_TRUTH_REQUIRED:${candidate.contentItemId}`);
  }
  if (creativeTruthBinding.outputSha256.toLowerCase() !== finalAssetSha256) {
    throw new Error(
      `GITHUB_NATIVE_QUEUE_SYNC_CREATIVE_TRUTH_HASH_MISMATCH:${candidate.contentItemId}`,
    );
  }

  return {
    contentItemId: candidate.contentItemId,
    scheduledAt: candidate.scheduledAt,
    ...(candidate.expiresAt ? { expiresAt: candidate.expiresAt } : {}),
    operation: candidate.operation as 'SUNSET' | 'THE_PARTY',
    channel: 'INSTAGRAM',
    contentStatus: 'PRODUCED',
    approvalStatus: 'APPROVED',
    publicationIntent: 'SCHEDULED',
    mediaType: candidate.format === 'STORY' ? 'STORY' : 'IMAGE',
    instagramAccountId,
    ...(candidate.pageId ? { pageId: candidate.pageId } : {}),
    ...(candidate.caption !== undefined ? { caption: candidate.caption } : {}),
    asset: {
      url: `${publicationAssetsBaseUrl}/${finalAssetSha256}.jpg`,
      contentType: 'image/jpeg',
      sha256: finalAssetSha256,
      sourceDriveFileId: finalDriveFileId,
    },
    correlationId,
    idempotencyKey,
    creativeTruthBinding,
    sourceRegistry: {
      driveFileId: CANONICAL_CONTENT_REGISTRY_SPREADSHEET_ID,
      sheetName: CANONICAL_CONTENT_REGISTRY_SHEET_NAME,
      rowRef: candidate.rowRef,
    },
  };
}

function requireField(value: string | undefined, contentItemId: string, field: string): string {
  if (!value?.trim()) {
    throw new Error(`GITHUB_NATIVE_QUEUE_SYNC_${field}_REQUIRED:${contentItemId}`);
  }
  return value;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_GITHUB_NATIVE_QUEUE_SYNC_ERROR';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGithubNativePublicationQueueSync().catch((error: unknown) => {
    console.error(normalizeError(error));
    process.exitCode = 1;
  });
}
