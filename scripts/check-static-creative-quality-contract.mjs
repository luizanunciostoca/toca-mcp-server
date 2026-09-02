import { readFile } from 'node:fs/promises';

const policyPath = new URL(
  '../control/creative-standards/static-creative-quality-policy.v1.json',
  import.meta.url,
);
const gatePath = new URL('../src/creative/static-creative-quality-gate.ts', import.meta.url);
const composerPath = new URL('../src/providers/local/local-story-composer.ts', import.meta.url);
const schedulerPath = new URL(
  '../src/scheduler/toca-managed-instagram-scheduler.ts',
  import.meta.url,
);

const [policyRaw, gate, composer, scheduler] = await Promise.all([
  readFile(policyPath, 'utf8'),
  readFile(gatePath, 'utf8'),
  readFile(composerPath, 'utf8'),
  readFile(schedulerPath, 'utf8'),
]);

const policy = JSON.parse(policyRaw);

assert(policy.policyId === 'TOCA_STATIC_CREATIVE_QUALITY_POLICY_V1', 'policy id drift');
assert(policy.failureMode === 'FAIL_CLOSED', 'quality policy must fail closed');
assert(
  policy.sourcePolicy?.referenceTemplatesMayBeFinalSource === false,
  'reference templates must never be final static sources',
);
assert(
  policy.sourcePolicy?.exactSourceMasterBindingRequired === true,
  'exact source-master binding must remain mandatory',
);
assert(
  policy.resolutionPolicy?.maxEffectiveUpscaleRatio === 1.5,
  'static max upscale ratio drifted',
);
assert(
  policy.formats?.STORY_9_16?.safeArea?.topPx === 250 &&
    policy.formats?.STORY_9_16?.safeArea?.bottomPx === 250,
  'Story safe-area contract drifted',
);
assert(
  policy.visualArtifactPolicy?.forbiddenOverlayStyles?.includes('HARD_FULL_WIDTH_PANEL'),
  'hard full-width render bands must remain forbidden',
);
assert(
  policy.typographyPolicy?.canonicalFontPinRequiredWhenTypographyIsPresent === true,
  'canonical typography pin must remain mandatory',
);
assert(
  policy.publicationPolicy?.newStaticScheduleRequiresExactQualityEvidence === true,
  'new static schedules must require exact QA evidence',
);

for (const required of [
  "'ORIGINAL_MASTER'",
  "'REFERENCE_TEMPLATE'",
  'STATIC_CREATIVE_MAX_UPSCALE_RATIO = 1.5',
  "'STORY_9_16'",
  "'FEED_4_5'",
  "'FEED_1_1'",
  "candidate.overlayStyle === 'HARD_FULL_WIDTH_PANEL'",
  'STATIC_CREATIVE_QUALITY_OUTPUT_SHA256_MISMATCH',
]) {
  assert(gate.includes(required), `runtime gate missing contract marker: ${required}`);
}

assert(!composer.includes('rectangle 0,1250 1080,1920'), 'legacy hard Story band reintroduced');
assert(
  composer.includes('gradient:rgba(13,13,13,0)-rgba(13,13,13,0.78)'),
  'Story renderer must retain soft readability treatment',
);
assert(
  composer.includes("format: 'STORY_9_16'"),
  'Story renderer must declare the Story QA profile',
);
assert(
  composer.includes("input.publicationIntent === 'FINAL'"),
  'Story renderer must distinguish review from final output',
);
assert(
  composer.includes('LOCAL_STORY_COMPOSER_CANONICAL_TYPOGRAPHY_REQUIRED'),
  'Story renderer must fail closed on unpinned final typography',
);
assert(
  scheduler.includes('assertStaticCreativeEvidenceForNewSchedule(parsed)'),
  'scheduler static QA guard missing',
);
assert(
  scheduler.includes('TOCA_MANAGED_INSTAGRAM_STATIC_CREATIVE_QUALITY_REQUIRED'),
  'scheduler must fail closed when static QA evidence is missing',
);
assert(
  scheduler.includes('assertStaticCreativePublicationReady(item'),
  'scheduler must bind exact asset/hash to static QA evidence',
);

console.log('static creative quality architecture contract: PASS');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`STATIC_CREATIVE_QUALITY_CONTRACT_FAILED:${message}`);
  }
}
