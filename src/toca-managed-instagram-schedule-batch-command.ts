import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { createPostgresPool } from './persistence/postgres.js';
import { GcsPublicationAssetStager } from './providers/gcp/gcs-publication-asset-stager.js';
import { PostgresScheduler } from './scheduler/postgres-scheduler.js';
import {
  TocaManagedInstagramScheduler,
  hashTocaManagedInstagramApprovalDescriptor,
  parseTocaManagedInstagramSchedulePayload,
} from './scheduler/toca-managed-instagram-scheduler.js';

interface SchedulingBatchBundle {
  readonly schemaVersion: 1;
  readonly timezone: 'America/Bahia';
  readonly account: {
    readonly pageId: string;
    readonly instagramAccountId: string;
  };
  readonly state: {
    readonly eligibleCount: number;
  };
  readonly items: readonly SchedulingBatchItem[];
}

interface SchedulingBatchItem {
  readonly contentItemId: string;
  readonly sourceDriveFileId: string;
  readonly assetStaging: {
    readonly bucket: string;
    readonly objectName: string;
    readonly assetId: string;
    readonly sha256: string;
    readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  };
  readonly approvedDescriptorSha256: string;
  readonly createPayload: unknown;
}

interface BatchReceipt {
  readonly contentItemId: string;
  readonly jobId: string;
  readonly status: string;
  readonly runAt: string;
  readonly timezone: string;
  readonly idempotencyKey: string;
  readonly assetObjectName: string;
  readonly assetSha256: string;
  readonly recovered: boolean;
}

const bundlePath = requiredEnv('TOCA_SCHEDULE_BATCH_BUNDLE_PATH');
const assetDirectory = requiredEnv('TOCA_SCHEDULE_BATCH_ASSET_DIR');
const expectedBundleSha256 = requiredSha256('TOCA_SCHEDULE_BATCH_EXPECTED_SHA256');
const expectedItemCount = positiveIntegerEnv('TOCA_SCHEDULE_BATCH_EXPECTED_ITEM_COUNT');

const bundleBytes = await readFile(bundlePath);
const actualBundleSha256 = createHash('sha256').update(bundleBytes).digest('hex');
if (actualBundleSha256 !== expectedBundleSha256) {
  throw new Error('TOCA_SCHEDULE_BATCH_BUNDLE_SHA256_MISMATCH');
}
const bundle = parseBundle(JSON.parse(bundleBytes.toString('utf8')));
if (bundle.items.length !== expectedItemCount || bundle.state.eligibleCount !== expectedItemCount) {
  throw new Error('TOCA_SCHEDULE_BATCH_ITEM_COUNT_MISMATCH');
}

const config = loadConfig(process.env);
if (!config.TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED) {
  throw new Error('TOCA_MANAGED_INSTAGRAM_SCHEDULER_REQUIRED');
}
if (!config.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
const projectId = requiredEnv('GCP_PROJECT_ID');
const publicationBucket = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const tenantId = requiredEnv('TOCA_DEFAULT_TENANT_ID');

const pool = createPostgresPool({ connectionString: config.DATABASE_URL, max: 4 });
const scheduler = new TocaManagedInstagramScheduler(new PostgresScheduler(pool, tenantId));
const stager = new GcsPublicationAssetStager({ projectId, bucketName: publicationBucket });
const receipts: BatchReceipt[] = [];

console.log(
  `TOCA_SCHEDULE_BATCH_START=${JSON.stringify({
    schemaVersion: 1,
    bundleSha256: actualBundleSha256,
    itemCount: bundle.items.length,
    timezone: bundle.timezone,
    instagramAccountId: bundle.account.instagramAccountId,
    providerCallDuringScheduleCreate: false,
  })}`,
);

try {
  const existingJobs = await scheduler.list();
  const existingByIdempotency = new Map(existingJobs.map((job) => [job.idempotencyKey, job]));

  for (const item of bundle.items) {
    validateItem(item, bundle);
    const localAssetPath = join(assetDirectory, item.contentItemId);
    const staged = await stager.stage({
      assetId: item.assetStaging.assetId,
      correlationId: correlationIdFromPayload(item.createPayload),
      sourcePath: localAssetPath,
      contentType: item.assetStaging.contentType,
    });
    if (staged.sha256 !== item.assetStaging.sha256) {
      throw new Error(`TOCA_SCHEDULE_BATCH_ASSET_SHA256_MISMATCH:${item.contentItemId}`);
    }
    if (staged.objectName !== item.assetStaging.objectName) {
      throw new Error(`TOCA_SCHEDULE_BATCH_ASSET_OBJECT_NAME_MISMATCH:${item.contentItemId}`);
    }
    if (staged.contentType !== item.assetStaging.contentType) {
      throw new Error(`TOCA_SCHEDULE_BATCH_ASSET_CONTENT_TYPE_MISMATCH:${item.contentItemId}`);
    }

    const payload = parseTocaManagedInstagramSchedulePayload(item.createPayload);
    if (payload.contentItemId !== item.contentItemId) {
      throw new Error(`TOCA_SCHEDULE_BATCH_CONTENT_ITEM_MISMATCH:${item.contentItemId}`);
    }
    const descriptorSha256 = hashTocaManagedInstagramApprovalDescriptor(payload);
    if (
      descriptorSha256 !== item.approvedDescriptorSha256 ||
      payload.approval.approvedDescriptorSha256 !== item.approvedDescriptorSha256
    ) {
      throw new Error(`TOCA_SCHEDULE_BATCH_APPROVAL_SHA256_MISMATCH:${item.contentItemId}`);
    }
    if (
      payload.account.instagramAccountId !== bundle.account.instagramAccountId ||
      payload.account.pageId !== bundle.account.pageId ||
      payload.timezone !== bundle.timezone
    ) {
      throw new Error(`TOCA_SCHEDULE_BATCH_ACCOUNT_OR_TIMEZONE_MISMATCH:${item.contentItemId}`);
    }

    const expectedIdempotencyKey =
      `internal:instagram:toca-managed:${payload.contentItemId}:${descriptorSha256}`;
    const existing = existingByIdempotency.get(expectedIdempotencyKey);
    if (existing) {
      if (existing.status !== 'SCHEDULED') {
        throw new Error(
          `TOCA_SCHEDULE_BATCH_EXISTING_JOB_NOT_SCHEDULED:${item.contentItemId}:${existing.status}`,
        );
      }
      receipts.push({
        contentItemId: item.contentItemId,
        jobId: existing.id,
        status: existing.status,
        runAt: existing.runAt,
        timezone: existing.timezone,
        idempotencyKey: existing.idempotencyKey,
        assetObjectName: staged.objectName,
        assetSha256: staged.sha256,
        recovered: true,
      });
      continue;
    }

    if (Date.parse(payload.scheduledFor) <= Date.now()) {
      throw new Error(`TOCA_SCHEDULE_BATCH_UNCREATED_SLOT_NOT_FUTURE:${item.contentItemId}`);
    }

    const created = await scheduler.schedule(payload);
    const confirmed = await scheduler.status(created.id);
    if (!confirmed || confirmed.status !== 'SCHEDULED') {
      throw new Error(`TOCA_SCHEDULE_BATCH_PERSISTENCE_READBACK_FAILED:${item.contentItemId}`);
    }
    if (confirmed.idempotencyKey !== expectedIdempotencyKey) {
      throw new Error(`TOCA_SCHEDULE_BATCH_IDEMPOTENCY_READBACK_MISMATCH:${item.contentItemId}`);
    }
    existingByIdempotency.set(expectedIdempotencyKey, confirmed);
    receipts.push({
      contentItemId: item.contentItemId,
      jobId: confirmed.id,
      status: confirmed.status,
      runAt: confirmed.runAt,
      timezone: confirmed.timezone,
      idempotencyKey: confirmed.idempotencyKey,
      assetObjectName: staged.objectName,
      assetSha256: staged.sha256,
      recovered: false,
    });
  }

  if (receipts.length !== expectedItemCount) {
    throw new Error('TOCA_SCHEDULE_BATCH_RECEIPT_COUNT_MISMATCH');
  }
  const uniqueJobIds = new Set(receipts.map((receipt) => receipt.jobId));
  if (uniqueJobIds.size !== receipts.length) {
    throw new Error('TOCA_SCHEDULE_BATCH_DUPLICATE_JOB_ID');
  }

  const result = {
    schemaVersion: 1,
    bundleSha256: actualBundleSha256,
    itemCount: receipts.length,
    createdCount: receipts.filter((receipt) => !receipt.recovered).length,
    recoveredCount: receipts.filter((receipt) => receipt.recovered).length,
    status: 'SCHEDULED',
    providerCallDuringScheduleCreate: false,
    receipts,
  };
  console.log(`TOCA_SCHEDULE_BATCH_RESULT=${JSON.stringify(result)}`);
} finally {
  await pool.end();
}

function parseBundle(value: unknown): SchedulingBatchBundle {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('TOCA_SCHEDULE_BATCH_BUNDLE_SCHEMA_INVALID');
  }
  if (value.timezone !== 'America/Bahia') {
    throw new Error('TOCA_SCHEDULE_BATCH_TIMEZONE_INVALID');
  }
  if (!isRecord(value.account) || !isRecord(value.state) || !Array.isArray(value.items)) {
    throw new Error('TOCA_SCHEDULE_BATCH_BUNDLE_STRUCTURE_INVALID');
  }
  const pageId = requiredText(value.account.pageId, 'TOCA_SCHEDULE_BATCH_PAGE_ID_REQUIRED');
  const instagramAccountId = requiredText(
    value.account.instagramAccountId,
    'TOCA_SCHEDULE_BATCH_INSTAGRAM_ACCOUNT_ID_REQUIRED',
  );
  const eligibleCount = value.state.eligibleCount;
  if (typeof eligibleCount !== 'number' || !Number.isInteger(eligibleCount) || eligibleCount < 1) {
    throw new Error('TOCA_SCHEDULE_BATCH_ELIGIBLE_COUNT_INVALID');
  }
  return {
    schemaVersion: 1,
    timezone: 'America/Bahia',
    account: { pageId, instagramAccountId },
    state: { eligibleCount },
    items: value.items.map(parseItem),
  };
}

function parseItem(value: unknown): SchedulingBatchItem {
  if (!isRecord(value) || !isRecord(value.assetStaging)) {
    throw new Error('TOCA_SCHEDULE_BATCH_ITEM_INVALID');
  }
  const contentType = value.assetStaging.contentType;
  if (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp') {
    throw new Error('TOCA_SCHEDULE_BATCH_CONTENT_TYPE_INVALID');
  }
  const contentItemId = requiredSafeSegment(
    value.contentItemId,
    'TOCA_SCHEDULE_BATCH_CONTENT_ITEM_ID_INVALID',
  );
  return {
    contentItemId,
    sourceDriveFileId: requiredText(
      value.sourceDriveFileId,
      'TOCA_SCHEDULE_BATCH_DRIVE_FILE_ID_REQUIRED',
    ),
    assetStaging: {
      bucket: requiredText(value.assetStaging.bucket, 'TOCA_SCHEDULE_BATCH_BUCKET_REQUIRED'),
      objectName: requiredText(
        value.assetStaging.objectName,
        'TOCA_SCHEDULE_BATCH_OBJECT_NAME_REQUIRED',
      ),
      assetId: requiredSafeSegment(
        value.assetStaging.assetId,
        'TOCA_SCHEDULE_BATCH_ASSET_ID_INVALID',
      ),
      sha256: requireSha256(
        value.assetStaging.sha256,
        'TOCA_SCHEDULE_BATCH_ASSET_SHA256_INVALID',
      ),
      contentType,
    },
    approvedDescriptorSha256: requireSha256(
      value.approvedDescriptorSha256,
      'TOCA_SCHEDULE_BATCH_DESCRIPTOR_SHA256_INVALID',
    ),
    createPayload: value.createPayload,
  };
}

function validateItem(item: SchedulingBatchItem, bundle: SchedulingBatchBundle): void {
  if (item.assetStaging.bucket !== requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET')) {
    throw new Error(`TOCA_SCHEDULE_BATCH_BUCKET_MISMATCH:${item.contentItemId}`);
  }
  if (!item.sourceDriveFileId.match(/^[A-Za-z0-9_-]{10,128}$/)) {
    throw new Error(`TOCA_SCHEDULE_BATCH_DRIVE_FILE_ID_INVALID:${item.contentItemId}`);
  }
  if (!bundle.account.instagramAccountId.match(/^\d+$/) || !bundle.account.pageId.match(/^\d+$/)) {
    throw new Error('TOCA_SCHEDULE_BATCH_ACCOUNT_ID_INVALID');
  }
}

function correlationIdFromPayload(payload: unknown): string {
  if (!isRecord(payload)) throw new Error('TOCA_SCHEDULE_BATCH_CREATE_PAYLOAD_INVALID');
  return requiredSafeSegment(payload.correlationId, 'TOCA_SCHEDULE_BATCH_CORRELATION_ID_INVALID');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`TOCA_SCHEDULE_BATCH_ENV_REQUIRED:${name}`);
  return value;
}

function positiveIntegerEnv(name: string): number {
  const value = Number(requiredEnv(name));
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`TOCA_SCHEDULE_BATCH_ENV_INTEGER_INVALID:${name}`);
  }
  return value;
}

function requiredSha256(name: string): string {
  return requireSha256(requiredEnv(name), `TOCA_SCHEDULE_BATCH_ENV_SHA256_INVALID:${name}`);
}

function requireSha256(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(code);
  return value;
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function requiredSafeSegment(value: unknown, code: string): string {
  const normalized = requiredText(value, code);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
