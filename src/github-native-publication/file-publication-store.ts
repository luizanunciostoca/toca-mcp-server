import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import type { PublicationExecutionStore } from '../providers/instagram/instagram-publication-executor.js';
import type {
  PublicationRecord,
  PublicationState,
} from '../providers/instagram/publication-state.js';

const publicationStates = new Set<PublicationState>([
  'DRAFT',
  'SCHEDULED',
  'CREATING_CONTAINER',
  'PROCESSING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELED',
]);

export class FilePublicationExecutionStore implements PublicationExecutionStore {
  constructor(private readonly directory: string) {}

  async reserve(request: InstagramPublishRequest, nowIso: string): Promise<PublicationRecord> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(request.idempotencyKey);
    try {
      const existing = parsePublicationRecord(JSON.parse(await readFile(path, 'utf8')));
      if (existing.idempotencyKey !== request.idempotencyKey) {
        throw new Error('GITHUB_NATIVE_PUBLICATION_IDEMPOTENCY_MISMATCH');
      }
      if (existing.correlationId !== request.correlationId) {
        throw new Error('GITHUB_NATIVE_PUBLICATION_CORRELATION_MISMATCH');
      }
      return existing;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    const digest = digestKey(request.idempotencyKey);
    const created: PublicationRecord = {
      publicationId: `github-native-${digest.slice(0, 24)}`,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      state: 'DRAFT',
      updatedAt: nowIso,
    };
    await this.save(created);
    return created;
  }

  async save(record: PublicationRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(record.idempotencyKey);
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, path);
  }

  private pathFor(idempotencyKey: string): string {
    return join(this.directory, `${digestKey(idempotencyKey)}.json`);
  }
}

function digestKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parsePublicationRecord(value: unknown): PublicationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_STATE_INVALID');
  }
  const record = value as Record<string, unknown>;
  const state = record.state;
  if (
    typeof record.publicationId !== 'string' ||
    typeof record.correlationId !== 'string' ||
    typeof record.idempotencyKey !== 'string' ||
    typeof state !== 'string' ||
    !publicationStates.has(state as PublicationState) ||
    typeof record.updatedAt !== 'string'
  ) {
    throw new Error('GITHUB_NATIVE_PUBLICATION_STATE_INVALID');
  }
  return value as PublicationRecord;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
