import {
  TOCA_PHOTO_TO_VIDEO_POLICY_ID,
  type PhotoToVideoRouteType,
} from '../../contracts/photo-to-video.js';
import { ExecutionError } from '../../core/errors.js';
import type { SpreadsheetValuesClient } from './media-assets.js';
import { PHOTO_TO_VIDEO_CREATIVE_TRUTH_REGISTRY_ID } from './photo-to-video-registry.js';

const PARENT_POLICY_RANGE = 'POLICY!A1:AC20';
const PARENT_POLICY_ID = 'TOCA_CREATIVE_TRUTH_POLICY_V1';
const SOURCE_ANCHORED_SCENE_CONTINUATION = 'SOURCE_ANCHORED_SCENE_CONTINUATION_GOVERNED_V1';

export interface PhotoToVideoParentPolicyGuard {
  assertCanonical(routeType: PhotoToVideoRouteType): Promise<void>;
}

export class GoogleSheetsPhotoToVideoParentPolicyGuard implements PhotoToVideoParentPolicyGuard {
  constructor(
    private readonly client: SpreadsheetValuesClient,
    private readonly spreadsheetId: string = PHOTO_TO_VIDEO_CREATIVE_TRUTH_REGISTRY_ID,
  ) {}

  async assertCanonical(routeType: PhotoToVideoRouteType): Promise<void> {
    const rows = await this.client.readRange(this.spreadsheetId, PARENT_POLICY_RANGE);
    const headers = headersFor(rows);
    const matches = rows.slice(1).flatMap((row) => {
      const value = objectFromRow(row, headers);
      return value.policy_id === PARENT_POLICY_ID && value.status === 'ACTIVE_CANONICAL'
        ? [value]
        : [];
    });
    if (matches.length !== 1) deny('PHOTO_TO_VIDEO_PARENT_POLICY_NOT_RESOLVED');
    const policy = matches[0]!;
    if (
      policy.brand_scope !== 'TOCA_DO_MORCEGO' ||
      !bool(policy.official_logo_only) ||
      !bool(policy.venue_fidelity_gate) ||
      !bool(policy.brand_integrity_gate) ||
      !bool(policy.quality_gate) ||
      !bool(policy.fail_closed) ||
      policy.photo_to_video_policy_id !== TOCA_PHOTO_TO_VIDEO_POLICY_ID ||
      policy.full_synthetic_venue_video !== 'UNSUPPORTED_V1'
    ) {
      deny('PHOTO_TO_VIDEO_PARENT_POLICY_DRIFT');
    }
    if (routeType === 'REAL_PHOTO_TO_MOTION_VIDEO' && policy.video_photo_motion !== 'ACTIVE_V1') {
      deny('PHOTO_TO_VIDEO_PARENT_POLICY_ROUTE_DISABLED');
    }
    if (
      routeType === 'GENERATIVE_SCENE_CONTINUATION_VIDEO' &&
      policy.video_generative_exception !== SOURCE_ANCHORED_SCENE_CONTINUATION
    ) {
      deny('PHOTO_TO_VIDEO_PARENT_POLICY_ROUTE_DISABLED');
    }
  }
}

function headersFor(rows: readonly (readonly unknown[])[]): ReadonlyMap<string, number> {
  if (rows.length === 0) deny('PHOTO_TO_VIDEO_PARENT_POLICY_SCHEMA_INVALID');
  const headers = new Map<string, number>();
  for (const [index, raw] of (rows[0] ?? []).entries()) {
    const header = cell(raw).toLowerCase();
    if (!header) continue;
    if (headers.has(header)) deny('PHOTO_TO_VIDEO_PARENT_POLICY_SCHEMA_INVALID');
    headers.set(header, index);
  }
  for (const required of [
    'policy_id',
    'status',
    'brand_scope',
    'official_logo_only',
    'venue_fidelity_gate',
    'brand_integrity_gate',
    'quality_gate',
    'fail_closed',
    'video_generative_exception',
    'full_synthetic_venue_video',
    'photo_to_video_policy_id',
    'video_photo_motion',
  ]) {
    if (!headers.has(required)) deny(`PHOTO_TO_VIDEO_PARENT_POLICY_SCHEMA_INVALID:${required}`);
  }
  return headers;
}

function objectFromRow(
  row: readonly unknown[],
  headers: ReadonlyMap<string, number>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, index] of headers.entries()) result[name] = cell(row[index]);
  return result;
}

function bool(value: unknown): boolean {
  return ['true', '1', 'yes', 'sim'].includes(cell(value).toLowerCase());
}

function cell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).trim();
  }
  throw new Error(`Unsupported spreadsheet value type: ${typeof value}`);
}

function deny(message: string): never {
  throw new ExecutionError('POLICY_DENIED', message, false);
}
