import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('control/capability-validation-evidence.v1.json', 'utf8'));
failUnless(manifest.schemaVersion === '1.0.0', 'CAPABILITY_EVIDENCE_SCHEMA_INVALID');
failUnless(
  manifest.manifestId === 'TOCA_CAPABILITY_VALIDATION_EVIDENCE_V1',
  'CAPABILITY_EVIDENCE_MANIFEST_ID_INVALID',
);
failUnless(manifest.status === 'ACTIVE_CANONICAL', 'CAPABILITY_EVIDENCE_MANIFEST_NOT_CANONICAL');
failUnless(
  /^[a-f0-9]{40}$/.test(manifest.exactHeadSha),
  'CAPABILITY_EVIDENCE_MANIFEST_SHA_INVALID',
);
failUnless(Array.isArray(manifest.validations), 'CAPABILITY_EVIDENCE_VALIDATIONS_INVALID');

const capabilityIds = new Set();
for (const validation of manifest.validations) {
  failUnless(
    !capabilityIds.has(validation.capabilityId),
    `CAPABILITY_EVIDENCE_DUPLICATE:${validation.capabilityId}`,
  );
  capabilityIds.add(validation.capabilityId);
  failUnless(
    validation.status === 'PRODUCTION_VALIDATED',
    `CAPABILITY_EVIDENCE_STATUS_INVALID:${validation.capabilityId}`,
  );
  failUnless(
    validation.environment === 'production',
    `CAPABILITY_EVIDENCE_ENVIRONMENT_INVALID:${validation.capabilityId}`,
  );
  failUnless(
    validation.exactHeadSha === manifest.exactHeadSha,
    `CAPABILITY_EVIDENCE_HEAD_MISMATCH:${validation.capabilityId}`,
  );
  failUnless(
    validation.checks?.providerWriteSucceeded === true &&
      validation.checks?.providerReadbackVerified === true &&
      validation.checks?.idempotencyVerified === true &&
      validation.checks?.reconciliationVerified === true &&
      validation.checks?.unknownOutcomeFailClosed === true,
    `CAPABILITY_EVIDENCE_CHECKS_INCOMPLETE:${validation.capabilityId}`,
  );
  failUnless(
    Array.isArray(validation.evidence) &&
      validation.evidence.some((value) => String(value).startsWith('provider:')) &&
      validation.evidence.some((value) => String(value).startsWith('readback:')) &&
      validation.evidence.some((value) => String(value).startsWith('acceptance:')),
    `CAPABILITY_EVIDENCE_REQUIRED_CLASSES_MISSING:${validation.capabilityId}`,
  );
}

const registry = readFileSync('src/registry.ts', 'utf8');
for (const marker of [
  'instagramPublicationValidationEvidence',
  'indexProviderCapabilityEvidence',
  'if (!evidence) return tool',
]) {
  failUnless(registry.includes(marker), `CAPABILITY_EVIDENCE_REGISTRY_GUARD_MISSING:${marker}`);
}
for (const [path, marker] of [
  ['src/server.ts', 'loadCapabilityValidationEvidenceManifest'],
  ['src/governance/capability-catalog.ts', 'loadCapabilityValidationEvidenceManifest'],
]) {
  failUnless(
    readFileSync(path, 'utf8').includes(marker),
    `CAPABILITY_EVIDENCE_MANIFEST_CONSUMER_MISSING:${path}`,
  );
}
failUnless(
  !registry.includes(
    'options.instagramPublicationWritesEnabled === undefined &&\n      options.tocaManagedInstagramSchedulerEnabled === true',
  ),
  'CAPABILITY_EVIDENCE_SCHEDULER_FLAG_PROMOTION_FORBIDDEN',
);

console.log(`CAPABILITY_VALIDATION_EVIDENCE_CHECK=PASS validations=${manifest.validations.length}`);

function failUnless(condition, code) {
  if (condition) return;
  console.error(code);
  process.exit(1);
}
