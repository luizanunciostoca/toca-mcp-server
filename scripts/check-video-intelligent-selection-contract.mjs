import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/contracts/video-asset-selection.ts',
  'src/creative/intelligent-video-asset-selector.ts',
  'src/mcp/video-asset-selection-runtime.ts',
  'src/mcp/video-asset-selection-surface.ts',
  'test/intelligent-video-asset-selector.test.ts',
  'docs/architecture/video-intelligent-asset-selection-v1.md',
];

for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`Video intelligent selection contract file missing: ${path}`);
}

requireIncludes('src/contracts/video-asset-selection.ts', [
  "VIDEO_ASSET_SELECTION_POLICY_VERSION = 'VIDEO-RANK-1.0'",
  "'HOOK'",
  "'PLACE_PROOF'",
  "'CROWD'",
  "'CLIMAX'",
  "'CTA_BACKGROUND'",
  'marketingIntent',
  'sourceLibraryScanUsed: z.literal(false)',
  'intakeAssetsSelected: z.literal(false)',
  'publicationAuthorized: z.literal(false)',
]);

requireIncludes('src/creative/intelligent-video-asset-selector.ts', [
  "const VIDEO_SHOTS_RANGE = 'VIDEO_SHOTS!A1:AV5000'",
  "const VIDEO_POLICY_RANGE = 'VIDEO_RANKING_POLICY!A1:E100'",
  'VIDEO_COVERAGE_GAP',
  'isEligible(',
  'APPROVED_RIGHTS',
  'chooseCoverageFirst',
  'antiRepeatScoreFor',
  'sourceLibraryScanUsed: false',
  'intakeAssetsSelected: false',
  'VIDEO_USAGE_LOG!A:N',
  'last_used_in_reel',
  'last_used_campaign',
]);

requireIncludes('src/mcp/video-asset-selection-surface.ts', [
  "VIDEO_SELECT_ASSETS_TOOL = 'video.select_assets'",
  "VIDEO_RECORD_ASSET_USAGE_TOOL = 'video.record_asset_usage'",
  'never scans or downloads an entire source-library folder',
  'VIDEO_COVERAGE_GAP',
  'publicationAuthorized: false',
]);

requireIncludes('docs/architecture/video-intelligent-asset-selection-v1.md', [
  'LINK_ONLY_NO_PHYSICAL_COPY',
  'VIDEO_LIBRARY_INDEX',
  'VIDEO_SOURCE_INTAKE',
  'DISCOVERABLE',
  'CREATIVE_ELIGIBLE',
  'MARKETING_READY',
  'Story Function: 25%',
  'Technical Quality: 20%',
  'Brief Fit: 20%',
  'Anti-repeat: 10%',
  'EXACT DRIVE FILE IDS',
]);

requireIncludes('test/intelligent-video-asset-selector.test.ts', [
  'never selects intake',
  'VIDEO_COVERAGE_GAP',
  'penalizes recent repeated footage',
  'records exact usage idempotently',
]);

console.log('Video intelligent asset selection contract OK');

function requireIncludes(path, markers) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (!content.includes(marker)) fail(`Video intelligent selection contract missing in ${path}: ${marker}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
