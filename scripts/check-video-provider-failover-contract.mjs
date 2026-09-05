import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'src/providers/video/failover-scene-continuation-video-provider.ts',
  'test/failover-scene-continuation-video-provider.test.ts',
  'test/video-generative-runtime-provider-plan.test.ts',
  'src/mcp/video-generative-runtime.ts',
  'src/mcp/video-generative-surface.ts',
  'src/contracts/photo-to-video.ts',
  'control/photo-to-video-policy.v1.json',
  'docs/architecture/video-generative-mcp-surface-v1.md',
];

for (const path of requiredFiles) {
  if (!existsSync(path)) fail(`Video provider failover contract file missing: ${path}`);
}

requireIncludes('src/providers/video/failover-scene-continuation-video-provider.ts', [
  'FailoverSceneContinuationVideoProvider',
  "error.code === 'PROVIDER_UNAVAILABLE'",
  "error.code === 'PROVIDER_RATE_LIMITED'",
  'error.retryable',
  'VIDEO_PROVIDER_IDENTITY_MISMATCH',
  'providerAttemptChain',
  'providerFallbackUsed',
]);

requireIncludes('src/mcp/video-generative-runtime.ts', [
  'VIDEO_SCENE_CONTINUATION_PROVIDER_ORDER',
  'VIDEO_SCENE_CONTINUATION_FALLBACK_PROVIDER',
  'resolveSceneContinuationProviderIds',
  'FailoverSceneContinuationVideoProvider',
  'sceneContinuationProviderConfigured',
]);

requireIncludes('src/contracts/photo-to-video.ts', [
  'providerAttemptChain',
  'providerFallbackUsed',
  'PHOTO_TO_VIDEO_PROVIDER_ATTEMPT_CHAIN_MISMATCH',
  'PHOTO_TO_VIDEO_PROVIDER_FALLBACK_FLAG_MISMATCH',
  'rightsRecordId',
  'evidenceDriveFileId',
  'generativeDerivationAllowed',
]);

requireIncludes('control/photo-to-video-policy.v1.json', [
  '"policyVersion": "1.4"',
  '"providerStrategy": "ORDERED_FAILOVER"',
  '"primaryProvider": "GOOGLE_VERTEX_VEO"',
  '"OPENAI_VIDEO_API"',
  '"fallbackOnlyOnRetryableProviderFailure": true',
  '"fallbackForbiddenForPolicyApprovalRightsBindingFidelityOrSpecFailures": true',
  '"providerAttemptChainEvidenceRequired": true',
]);

requireIncludes('src/mcp/video-generative-surface.ts', [
  'TOCA_OS governed video provider plan',
  'providerAttemptChain',
  'providerFallbackUsed',
  'Fallback is permitted only for retryable provider availability/rate-limit failures',
]);

requireIncludes('test/failover-scene-continuation-video-provider.test.ts', [
  'fails over only after retryable provider unavailability',
  'does not bypass policy, approval or non-retryable provider failures',
  'fails closed when a provider returns the wrong provider identity',
]);

requireIncludes('test/video-generative-runtime-provider-plan.test.ts', [
  'resolves explicit ordered provider plans',
  'supports the legacy primary plus fallback shape',
  'keeps the historical single-provider default',
  'rejects unsupported providers',
]);

console.log('Video provider failover contract OK');

function requireIncludes(path, markers) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (!content.includes(marker)) {
      fail(`Video provider failover contract missing in ${path}: ${marker}`);
    }
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
