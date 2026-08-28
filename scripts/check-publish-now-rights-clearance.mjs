import { readFileSync } from 'node:fs';

const commandPath = 'control/marketing-publish-now-command.json';
const command = JSON.parse(readFileSync(commandPath, 'utf8'));

if (command.action !== 'PUBLISH_NOW') {
  console.log(`PUBLISH_NOW_RIGHTS_CLEARANCE=SKIP action=${String(command.action)}`);
  process.exit(0);
}

const clearance = command.rightsClearance;
failUnless(clearance && typeof clearance === 'object', 'RIGHTS_CLEARANCE_REQUIRED');
failUnless(clearance.status === 'CLEARED', 'RIGHTS_CLEARANCE_NOT_CLEARED');
failUnless(
  clearance.scope === 'INSTAGRAM_ORGANIC_PUBLICATION',
  'RIGHTS_CLEARANCE_SCOPE_INVALID',
);

const hasEvidenceRef =
  typeof clearance.evidenceRef === 'string' && clearance.evidenceRef.trim().length > 0;
failUnless(hasEvidenceRef, 'RIGHTS_CLEARANCE_EVIDENCE_REQUIRED');

const hasAuthority =
  typeof clearance.authority === 'string' && clearance.authority.trim().length > 0;
failUnless(hasAuthority, 'RIGHTS_CLEARANCE_AUTHORITY_REQUIRED');

const hasValidClearanceTimestamp =
  typeof clearance.clearedAt === 'string' && Number.isFinite(Date.parse(clearance.clearedAt));
failUnless(hasValidClearanceTimestamp, 'RIGHTS_CLEARANCE_TIMESTAMP_INVALID');

const hasExactAssetBinding =
  typeof clearance.assetSha256 === 'string' &&
  clearance.assetSha256 === command.expectedAssetSha256;
failUnless(hasExactAssetBinding, 'RIGHTS_CLEARANCE_ASSET_BINDING_MISMATCH');

if (clearance.expiresAt !== undefined) {
  const hasValidExpiry =
    typeof clearance.expiresAt === 'string' && Number.isFinite(Date.parse(clearance.expiresAt));
  failUnless(hasValidExpiry, 'RIGHTS_CLEARANCE_EXPIRY_INVALID');
  failUnless(Date.parse(clearance.expiresAt) > Date.now(), 'RIGHTS_CLEARANCE_EXPIRED');
}

console.log(
  `PUBLISH_NOW_RIGHTS_CLEARANCE=PASS evidence=${clearance.evidenceRef.trim()} authority=${clearance.authority.trim()}`,
);

function failUnless(condition, code) {
  if (condition) return;
  console.error(code);
  process.exit(1);
}
