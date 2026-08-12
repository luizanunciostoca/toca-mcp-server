import type { InstagramPublishRequest } from '../providers/instagram/instagram-contracts.js';
import { hashInstagramPublicationApprovalPayload } from './instagram-publication-boundary.js';
import { parseInstagramPublishRequest } from './instagram-publication-job.js';

export interface InstagramPublicationApprovalManifest {
  readonly request: InstagramPublishRequest;
  readonly requestSha256: string;
}

export function createInstagramPublicationApprovalManifest(
  value: unknown,
): InstagramPublicationApprovalManifest {
  const request = parseInstagramPublishRequest(value);
  return {
    request,
    requestSha256: hashInstagramPublicationApprovalPayload(request),
  };
}
