import { createInstagramPublicationApprovalManifest } from './worker/instagram-publication-approval-manifest.js';

const rawRequest = process.env.INSTAGRAM_PUBLICATION_REQUEST_JSON;
if (!rawRequest?.trim()) throw new Error('INSTAGRAM_PUBLICATION_REQUEST_JSON_REQUIRED');

let payload: unknown;
try {
  payload = JSON.parse(rawRequest);
} catch {
  throw new Error('INSTAGRAM_PUBLICATION_REQUEST_JSON_INVALID');
}

const manifest = createInstagramPublicationApprovalManifest(payload);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
