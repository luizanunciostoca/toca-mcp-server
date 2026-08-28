import { readFileSync } from 'node:fs';

const command = JSON.parse(readFileSync('control/marketing-publish-now-command.json', 'utf8'));

if (command.action !== 'PUBLISH_NOW') {
  console.log(`PUBLISH_NOW_BRAND_DETERMINISM=SKIP action=${String(command.action)}`);
  process.exit(0);
}

const binding = command.brandDeterminism;
failUnless(binding && typeof binding === 'object', 'BRAND_DETERMINISM_REQUIRED');
failUnless(binding.status === 'VERIFIED', 'BRAND_DETERMINISM_NOT_VERIFIED');
failUnless(
  typeof binding.standardRef === 'string' && binding.standardRef.trim().length > 0,
  'BRAND_DETERMINISM_STANDARD_REQUIRED',
);
failUnless(
  typeof binding.typographyRef === 'string' && binding.typographyRef.trim().length > 0,
  'BRAND_DETERMINISM_TYPOGRAPHY_REQUIRED',
);
failUnless(
  typeof binding.assetSha256 === 'string' && binding.assetSha256 === command.expectedAssetSha256,
  'BRAND_DETERMINISM_ASSET_BINDING_MISMATCH',
);

console.log(
  `PUBLISH_NOW_BRAND_DETERMINISM=PASS standard=${binding.standardRef.trim()} typography=${binding.typographyRef.trim()}`,
);

function failUnless(condition, code) {
  if (condition) return;
  console.error(code);
  process.exit(1);
}
