import { readFileSync } from 'node:fs';

const REQUIRED = 'RIGHTS_CLEARANCE_REQUIRED';
const NOT_CLEARED = 'RIGHTS_CLEARANCE_NOT_CLEARED';
const BAD_SCOPE = 'RIGHTS_CLEARANCE_SCOPE_INVALID';
const NO_EVIDENCE = 'RIGHTS_CLEARANCE_EVIDENCE_REQUIRED';
const NO_AUTHORITY = 'RIGHTS_CLEARANCE_AUTHORITY_REQUIRED';
const BAD_TIMESTAMP = 'RIGHTS_CLEARANCE_TIMESTAMP_INVALID';
const BAD_ASSET = 'RIGHTS_CLEARANCE_ASSET_BINDING_MISMATCH';
const BAD_EXPIRY = 'RIGHTS_CLEARANCE_EXPIRY_INVALID';
const EXPIRED = 'RIGHTS_CLEARANCE_EXPIRED';

const path = 'control/marketing-publish-now-command.json';
const command = JSON.parse(readFileSync(path, 'utf8'));

if (command.action !== 'PUBLISH_NOW') {
  console.log('PUBLISH_NOW_RIGHTS_CLEARANCE=SKIP');
  process.exit(0);
}

const clearance = command.rightsClearance;
fail(clearance && typeof clearance === 'object', REQUIRED);
fail(clearance.status === 'CLEARED', NOT_CLEARED);
fail(clearance.scope === 'INSTAGRAM_ORGANIC_PUBLICATION', BAD_SCOPE);

const evidenceRef = clearance.evidenceRef;
const evidenceOk = typeof evidenceRef === 'string' && evidenceRef.trim();
fail(Boolean(evidenceOk), NO_EVIDENCE);

const authority = clearance.authority;
const authorityOk = typeof authority === 'string' && authority.trim();
fail(Boolean(authorityOk), NO_AUTHORITY);

const clearedAt = clearance.clearedAt;
const timestamp = typeof clearedAt === 'string' && Date.parse(clearedAt);
fail(Number.isFinite(timestamp), BAD_TIMESTAMP);

const assetSha = clearance.assetSha256;
const assetOk =
  typeof assetSha === 'string' && assetSha === command.expectedAssetSha256;
fail(assetOk, BAD_ASSET);

if (clearance.expiresAt !== undefined) {
  const expiresAt = clearance.expiresAt;
  const expiry = typeof expiresAt === 'string' && Date.parse(expiresAt);
  fail(Number.isFinite(expiry), BAD_EXPIRY);
  fail(Date.parse(expiresAt) > Date.now(), EXPIRED);
}

console.log('PUBLISH_NOW_RIGHTS_CLEARANCE=PASS');

function fail(ok, code) {
  if (ok) return;
  console.error(code);
  process.exit(1);
}
