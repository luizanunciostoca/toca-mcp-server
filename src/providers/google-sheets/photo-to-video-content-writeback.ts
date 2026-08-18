import type { PhotoToVideoRouteType } from '../../contracts/photo-to-video.js';
import { ExecutionError } from '../../core/errors.js';
import type {
  SpreadsheetValuesBatchWriter,
  SpreadsheetValuesClient,
} from './media-assets.js';
import { PHOTO_TO_VIDEO_CONTENT_REGISTRY_ID } from './photo-to-video-registry.js';

const CONTENT_RANGE = 'CONTENT_ITEMS!A1:CF2000';

export interface PhotoToVideoCandidateWriteback {
  readonly contentItemId: string;
  readonly productId: string;
  readonly routeType: PhotoToVideoRouteType;
  readonly standardId: string;
  readonly candidateSha256: string;
  readonly providerJobId?: string;
}

export interface PhotoToVideoFinalWriteback {
  readonly contentItemId: string;
  readonly routeType: PhotoToVideoRouteType;
  readonly standardId: string;
  readonly candidateSha256: string;
  readonly finalAssetSha256: string;
  readonly outputEvidenceId: string;
}

export interface PhotoToVideoContentWriteback {
  writeCandidate(record: PhotoToVideoCandidateWriteback): Promise<void>;
  writeFinal(record: PhotoToVideoFinalWriteback): Promise<void>;
}

export class GoogleSheetsPhotoToVideoContentWriteback implements PhotoToVideoContentWriteback {
  constructor(
    private readonly client: SpreadsheetValuesClient & SpreadsheetValuesBatchWriter,
    private readonly spreadsheetId = PHOTO_TO_VIDEO_CONTENT_REGISTRY_ID,
  ) {}

  async writeCandidate(record: PhotoToVideoCandidateWriteback): Promise<void> {
    assertSha(record.candidateSha256, 'VIDEO_CANDIDATE_SHA256_INVALID');
    const current = await this.resolveRow(record.contentItemId);
    const existingFinalSha = current.value('video_final_asset_sha256');
    if (existingFinalSha) {
      throw new ExecutionError('STATE_CONFLICT', 'VIDEO_CONTENT_ALREADY_FINALIZED', false);
    }
    const existingCandidateSha = current.value('video_candidate_sha256');
    if (
      existingCandidateSha &&
      existingCandidateSha.toLowerCase() !== record.candidateSha256.toLowerCase()
    ) {
      throw new ExecutionError('STATE_CONFLICT', 'VIDEO_DIFFERENT_CANDIDATE_ALREADY_RECORDED', false);
    }
    if (
      existingCandidateSha.toLowerCase() === record.candidateSha256.toLowerCase() &&
      current.value('video_product_id') === record.productId &&
      current.value('video_route_type') === record.routeType &&
      current.value('video_standard_id') === record.standardId &&
      current.value('video_provider_job_id') === (record.providerJobId ?? '') &&
      current.value('video_review_status') === 'GENERATED_REVIEW_REQUIRED'
    ) {
      return;
    }
    await this.client.updateRanges(this.spreadsheetId, [
      update(current, 'video_product_id', record.productId),
      update(current, 'video_route_type', record.routeType),
      update(current, 'video_standard_id', record.standardId),
      update(current, 'video_candidate_sha256', record.candidateSha256),
      update(current, 'video_provider_job_id', record.providerJobId ?? ''),
      update(current, 'video_review_status', 'GENERATED_REVIEW_REQUIRED'),
    ]);
  }

  async writeFinal(record: PhotoToVideoFinalWriteback): Promise<void> {
    assertSha(record.candidateSha256, 'VIDEO_CANDIDATE_SHA256_INVALID');
    assertSha(record.finalAssetSha256, 'VIDEO_FINAL_ASSET_SHA256_INVALID');
    if (!record.outputEvidenceId.trim()) {
      throw new ExecutionError('STATE_CONFLICT', 'VIDEO_OUTPUT_EVIDENCE_ID_REQUIRED', false);
    }
    const current = await this.resolveRow(record.contentItemId);
    if (
      current.value('video_route_type') !== record.routeType ||
      current.value('video_standard_id') !== record.standardId ||
      current.value('video_candidate_sha256').toLowerCase() !== record.candidateSha256.toLowerCase()
    ) {
      throw new ExecutionError('STATE_CONFLICT', 'VIDEO_CONTENT_CANDIDATE_BINDING_CHANGED', false);
    }
    const existingFinalSha = current.value('video_final_asset_sha256');
    const existingEvidenceId = current.value('video_output_evidence_id');
    if (existingFinalSha) {
      if (
        existingFinalSha.toLowerCase() === record.finalAssetSha256.toLowerCase() &&
        existingEvidenceId === record.outputEvidenceId &&
        current.value('video_review_status') === 'VIDEO_CREATIVE_TRUTH_PASSED'
      ) {
        return;
      }
      throw new ExecutionError('STATE_CONFLICT', 'VIDEO_DIFFERENT_FINAL_ASSET_ALREADY_RECORDED', false);
    }
    await this.client.updateRanges(this.spreadsheetId, [
      update(current, 'video_final_asset_sha256', record.finalAssetSha256),
      update(current, 'video_review_status', 'VIDEO_CREATIVE_TRUTH_PASSED'),
      update(current, 'video_output_evidence_id', record.outputEvidenceId),
    ]);
  }

  private async resolveRow(contentItemId: string): Promise<ResolvedContentRow> {
    const id = contentItemId.trim();
    if (!id) throw new ExecutionError('STATE_CONFLICT', 'VIDEO_CONTENT_ITEM_ID_REQUIRED', false);
    const rows = await this.client.readRange(this.spreadsheetId, CONTENT_RANGE);
    if (rows.length === 0) {
      throw new ExecutionError('STATE_CONFLICT', 'VIDEO_CONTENT_WRITEBACK_SCHEMA_INVALID', false);
    }
    const headers = new Map<string, number>();
    for (const [index, value] of (rows[0] ?? []).entries()) {
      const header = cell(value).toLowerCase();
      if (!header) continue;
      if (headers.has(header)) {
        throw new ExecutionError('STATE_CONFLICT', 'VIDEO_CONTENT_WRITEBACK_SCHEMA_INVALID', false);
      }
      headers.set(header, index);
    }
    for (const required of [
      'content_item_id',
      'video_product_id',
      'video_route_type',
      'video_standard_id',
      'video_candidate_sha256',
      'video_provider_job_id',
      'video_final_asset_sha256',
      'video_review_status',
      'video_output_evidence_id',
    ]) {
      if (!headers.has(required)) {
        throw new ExecutionError(
          'STATE_CONFLICT',
          `VIDEO_CONTENT_WRITEBACK_SCHEMA_INVALID:${required}`,
          false,
        );
      }
    }
    const idIndex = headers.get('content_item_id')!;
    const matches = rows
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter(({ row }) => cell(row[idIndex]) === id);
    if (matches.length !== 1) {
      throw new ExecutionError(
        'STATE_CONFLICT',
        matches.length === 0
          ? 'VIDEO_CONTENT_WRITEBACK_ITEM_NOT_FOUND'
          : 'VIDEO_CONTENT_WRITEBACK_ITEM_AMBIGUOUS',
        false,
      );
    }
    const match = matches[0]!;
    return {
      headers,
      row: match.row,
      rowNumber: match.rowNumber,
      value: (header: string) => {
        const index = headers.get(header);
        return index === undefined ? '' : cell(match.row[index]);
      },
    };
  }
}

interface ResolvedContentRow {
  readonly headers: ReadonlyMap<string, number>;
  readonly row: readonly unknown[];
  readonly rowNumber: number;
  readonly value: (header: string) => string;
}

function update(
  row: ResolvedContentRow,
  header: string,
  value: string,
): { readonly range: string; readonly values: readonly (readonly unknown[])[] } {
  const index = row.headers.get(header);
  if (index === undefined) {
    throw new ExecutionError(
      'STATE_CONFLICT',
      `VIDEO_CONTENT_WRITEBACK_SCHEMA_INVALID:${header}`,
      false,
    );
  }
  return {
    range: `CONTENT_ITEMS!${columnName(index)}${row.rowNumber}`,
    values: [[value]],
  };
}

function columnName(zeroBasedIndex: number): string {
  let value = zeroBasedIndex + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function assertSha(value: string, error: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new ExecutionError('STATE_CONFLICT', error, false);
}

function cell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  throw new Error(`Unsupported spreadsheet value type: ${typeof value}`);
}
