import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/deploy-gcp-staging-canonical.yml';
const configPath = 'infra/environments/staging.json';
const workflow = readFileSync(workflowPath, 'utf8');
const runtimeWorkflow = readFileSync('.github/workflows/staging-runtime-observability.yml', 'utf8');
const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;

type OciPlatform = { os?: string; architecture?: string };
type OciDescriptor = { digest?: string; platform?: OciPlatform };
type OciManifest = { digest?: string; mediaType?: string; manifests?: OciDescriptor[] };
type OciImageConfig = { os?: string; architecture?: string };

const digestPattern = /^sha256:[0-9a-f]{64}$/;

function resolveExpectedRuntimeDigest(
  attestedDigest: string,
  manifest: OciManifest,
  imageConfig?: OciImageConfig,
): string {
  if (!digestPattern.test(attestedDigest) || manifest.digest !== attestedDigest) {
    throw new Error('attested digest mismatch');
  }

  if (
    manifest.mediaType === 'application/vnd.oci.image.index.v1+json' ||
    manifest.mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json'
  ) {
    const matches = (manifest.manifests ?? []).filter(
      (entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64',
    );
    if (matches.length !== 1 || !matches[0]?.digest || !digestPattern.test(matches[0].digest)) {
      throw new Error('linux/amd64 child is missing or ambiguous');
    }
    return matches[0].digest;
  }

  if (
    manifest.mediaType === 'application/vnd.oci.image.manifest.v1+json' ||
    manifest.mediaType === 'application/vnd.docker.distribution.manifest.v2+json'
  ) {
    if (imageConfig?.os !== 'linux' || imageConfig?.architecture !== 'amd64') {
      throw new Error('single manifest platform mismatch');
    }
    return attestedDigest;
  }

  throw new Error('unsupported OCI media type');
}

function assertRuntimeDigest(
  runtimeDigest: string,
  attestedDigest: string,
  manifest: OciManifest,
  imageConfig?: OciImageConfig,
): void {
  if (runtimeDigest !== resolveExpectedRuntimeDigest(attestedDigest, manifest, imageConfig)) {
    throw new Error('runtime digest is not the proven linux/amd64 runtime manifest');
  }
}

describe('canonical isolated staging deployment workflow', () => {
  it('keeps Quality outside the staging deployment environment', () => {
    const qualityStart = workflow.indexOf('  quality:\n');
    const deployStart = workflow.indexOf('  deploy:\n');
    const cleanQuality = workflow.indexOf('Exact-head Quality in clean non-deployment environment');
    const stagingEnvironment = workflow.indexOf('    environment: staging', deployStart);

    expect(qualityStart).toBeGreaterThanOrEqual(0);
    expect(deployStart).toBeGreaterThan(qualityStart);
    expect(cleanQuality).toBeGreaterThan(qualityStart);
    expect(cleanQuality).toBeLessThan(deployStart);
    expect(stagingEnvironment).toBeGreaterThan(deployStart);
    expect(workflow.slice(qualityStart, deployStart)).not.toContain('environment: staging');
    expect(workflow).toContain('    needs: quality');
  });

  it('loads canonical repository coordinates only after Quality', () => {
    const qualityStep = workflow.indexOf('Exact-head Quality in clean non-deployment environment');
    const loadStep = workflow.indexOf('Load repository-canonical staging coordinates');

    expect(loadStep).toBeGreaterThan(qualityStep);
    expect(workflow).toContain(
      'node scripts/export-staging-deploy-config.mjs infra/environments/staging.json',
    );
    expect(workflow).toContain('node scripts/validate-gcp-deploy-environment.mjs');
    expect(workflow).toContain('steps.config.outputs.wif');
    expect(workflow).toContain('steps.config.outputs.deployer_sa');
  });

  it('uses an attestation-capable BuildKit builder without dropping provenance or SBOM', () => {
    const setupBuildx = workflow.indexOf('Setup Docker Buildx for attestations');
    const build = workflow.indexOf('Build push and resolve immutable candidate digest');

    expect(setupBuildx).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(setupBuildx);
    expect(workflow).toContain(
      'docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c',
    );
    expect(workflow).toContain('driver: docker-container');
    expect(workflow).toContain('--provenance=mode=max');
    expect(workflow).toContain('--sbom=true');
  });

  it('has no production coordinate dependency or provider activation', () => {
    expect(workflow).not.toContain('PRODUCTION_GCP_');
    expect(workflow).not.toContain('toca-mcp-production');
    expect(workflow).toContain('"META_ENABLED=false"');
    expect(workflow).toContain('"WHATSAPP_ENABLED=false"');
    expect(workflow).toContain('"EMAIL_SENDGRID_ENABLED=false"');
    expect(workflow).toContain('"GOOGLE_ADS_PHASE=OFF"');
    expect(workflow).toContain('"AG01_MODEL_ENABLED=false"');
  });

  it('binds the database through Secret Manager references and never embeds a payload', () => {
    expect(workflow).toContain(
      'RUNTIME_SECRETS=DATABASE_URL=${GCP_DATABASE_URL_SECRET}:${GCP_DATABASE_URL_SECRET_VERSION}',
    );
    expect(workflow).toContain('gcloud secrets versions access "$GCP_DATABASE_URL_SECRET_VERSION"');
    expect(workflow.toLowerCase()).not.toContain('postgresql://');

    expect(config.secretReferences).toEqual({
      databaseUrl: {
        id: 'toca-next-staging-database-url',
        version: 'latest',
      },
    });
  });

  it('does not use unsupported Cloud Run readiness-probe and keeps readiness fail-closed', () => {
    expect(workflow).not.toContain('--readiness-probe');
    expect(workflow).toContain("--startup-probe 'httpGet.path=/readyz");
    expect(workflow).toContain("--liveness-probe 'httpGet.path=/healthz");
    expect(workflow).toContain(
      'Verify candidate health readiness and public route confinement before traffic',
    );
    expect(workflow).toContain('$MCP_URL/ready');
    expect(workflow).toContain('$WEBHOOK_URL/ready');
    expect(workflow).toContain('$MCP_URL/health');
    expect(workflow).toContain('$WEBHOOK_URL/health');
    expect(workflow).not.toContain('$MCP_URL/healthz');
    expect(workflow).not.toContain('$MCP_URL/readyz');
    expect(workflow).not.toContain('$WEBHOOK_URL/healthz');
    expect(workflow).not.toContain('$WEBHOOK_URL/readyz');
    expect(workflow).toContain('.status == "ready" and (.checks | all(.ok == true))');
  });

  it('keeps the webhook traffic tag within the Cloud Run combined 46-character limit', () => {
    const webhookService = 'toca-webhook-next-staging';
    const webhookTag = 'wh-abcdef0';

    expect(webhookService.length + webhookTag.length).toBeLessThanOrEqual(46);
    expect(workflow).toContain('WEBHOOK_TAG=wh-${GITHUB_SHA::7}');
    expect(workflow).not.toContain('WEBHOOK_TAG=staging-webhook-${GITHUB_SHA::7}');
  });

  it('uses replay-safe exact-candidate revision names within the Cloud Run limit', () => {
    const mcpService = 'toca-mcp-next-staging';
    const webhookService = 'toca-webhook-next-staging';
    const runIdSuffix = '3038062235';
    const runAttempt = '999';
    const mcpSuffix = `mcp-9f144b08-${runIdSuffix}-${runAttempt}`;
    const webhookSuffix = `webhook-9f144b08-${runIdSuffix}-${runAttempt}`;

    expect(workflow).toContain('RUN_ID_SUFFIX="${GITHUB_RUN_ID: -10}"');
    expect(workflow).toContain('[[ "$RUN_ID_SUFFIX" =~ ^[0-9]{1,10}$ ]]');
    expect(workflow).toContain('[[ "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]{1,3}$ ]]');
    expect(workflow).toContain(
      'MCP_REVISION_SUFFIX=mcp-${GITHUB_SHA::8}-${RUN_ID_SUFFIX}-${GITHUB_RUN_ATTEMPT}',
    );
    expect(workflow).toContain(
      'WEBHOOK_REVISION_SUFFIX=webhook-${GITHUB_SHA::8}-${RUN_ID_SUFFIX}-${GITHUB_RUN_ATTEMPT}',
    );
    expect(mcpService.length + 1 + mcpSuffix.length).toBeLessThanOrEqual(63);
    expect(webhookService.length + 1 + webhookSuffix.length).toBeLessThanOrEqual(63);
  });

  it('waits boundedly for tagged revision propagation and validates the exact revisions', () => {
    expect(workflow).toContain('for attempt in $(seq 1 24); do');
    expect(workflow).toContain('select(.tag == $tag)');
    expect(workflow).toContain('sleep 5');
    expect(workflow).toContain('Timed out resolving Cloud Run traffic tag');
    expect(workflow).toContain('EXPECTED_MCP_REVISION=');
    expect(workflow).toContain('EXPECTED_WEBHOOK_REVISION=');
    expect(workflow).toContain('test "$MCP_REVISION" = "$EXPECTED_MCP_REVISION"');
    expect(workflow).toContain('test "$WEBHOOK_REVISION" = "$EXPECTED_WEBHOOK_REVISION"');
  });

  it('mints Cloud Run ID tokens through pinned staging WIF actions instead of gcloud external-account audiences', () => {
    expect(workflow).not.toContain('gcloud auth print-identity-token');
    expect(workflow).toContain('id: mcp_probe_auth');
    expect(workflow).toContain('token_format: id_token');
    expect(workflow).toContain('echo "mcp_tag_url=$MCP_URL" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "mcp_service_url=$MCP_SERVICE_URL" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('id_token_audience: ${{ steps.candidate.outputs.mcp_service_url }}');
    expect(workflow).not.toContain('id_token_audience: ${{ steps.candidate.outputs.mcp_url }}');
    expect(workflow).toContain('create_credentials_file: false');
    expect(workflow).toContain('export_environment_variables: false');
    expect(runtimeWorkflow).not.toContain('gcloud auth print-identity-token');
    expect(runtimeWorkflow).toContain('id: mcp_probe_auth');
    expect(runtimeWorkflow).toContain('id: webhook_probe_auth');
    expect(runtimeWorkflow).toContain('id: capacity_auth');
    expect(runtimeWorkflow).toContain('${base_url}/health');
    expect(runtimeWorkflow).toContain('${base_url}/ready');
    expect(runtimeWorkflow).not.toContain('/healthz');
    expect(runtimeWorkflow).not.toContain('/readyz');
    expect(runtimeWorkflow).toContain('id_token_audience: ${{ steps.runtime.outputs.mcp_url }}');
    expect(runtimeWorkflow).toContain(
      'id_token_audience: ${{ steps.runtime.outputs.webhook_url }}',
    );
  });

  it('uses the canonical Cloud Run service URL as token audience while probing the tagged candidate URL', () => {
    expect(workflow).toContain(
      'MCP_SERVICE_URL="$(gcloud run services describe "$GCP_CLOUD_RUN_MCP_SERVICE"',
    );
    expect(workflow).toContain('test "$MCP_SERVICE_URL" != "$MCP_URL"');
    expect(workflow).toContain('-H "Authorization: Bearer $MCP_TOKEN" "$MCP_URL/health"');
    expect(workflow).toContain('-H "Authorization: Bearer $MCP_TOKEN" "$MCP_URL/ready"');
  });

  it('resolves exactly one linux/amd64 child from an attested OCI index', () => {
    const indexDigest = `sha256:${'a'.repeat(64)}`;
    const childDigest = `sha256:${'b'.repeat(64)}`;
    const manifest: OciManifest = {
      digest: indexDigest,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [
        { digest: childDigest, platform: { os: 'linux', architecture: 'amd64' } },
        { digest: `sha256:${'c'.repeat(64)}`, platform: { os: 'linux', architecture: 'arm64' } },
      ],
    };

    expect(resolveExpectedRuntimeDigest(indexDigest, manifest)).toBe(childDigest);
    expect(() => assertRuntimeDigest(childDigest, indexDigest, manifest)).not.toThrow();
  });

  it('fails closed when the Cloud Run digest is not the proven child', () => {
    const indexDigest = `sha256:${'a'.repeat(64)}`;
    const childDigest = `sha256:${'b'.repeat(64)}`;
    const manifest: OciManifest = {
      digest: indexDigest,
      mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: [{ digest: childDigest, platform: { os: 'linux', architecture: 'amd64' } }],
    };

    expect(() => assertRuntimeDigest(`sha256:${'d'.repeat(64)}`, indexDigest, manifest)).toThrow(
      'runtime digest is not the proven linux/amd64 runtime manifest',
    );
  });

  it('supports a single linux/amd64 manifest without inventing a child digest', () => {
    const digest = `sha256:${'e'.repeat(64)}`;
    const manifest: OciManifest = {
      digest,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
    };

    expect(
      resolveExpectedRuntimeDigest(digest, manifest, { os: 'linux', architecture: 'amd64' }),
    ).toBe(digest);
  });

  it('fails closed for unknown media types, wrong platforms and ambiguous indexes', () => {
    const digest = `sha256:${'f'.repeat(64)}`;
    const child = `sha256:${'1'.repeat(64)}`;

    expect(() => resolveExpectedRuntimeDigest(digest, { digest, mediaType: 'unknown' })).toThrow(
      'unsupported OCI media type',
    );
    expect(() =>
      resolveExpectedRuntimeDigest(
        digest,
        { digest, mediaType: 'application/vnd.oci.image.manifest.v1+json' },
        { os: 'linux', architecture: 'arm64' },
      ),
    ).toThrow('single manifest platform mismatch');
    expect(() =>
      resolveExpectedRuntimeDigest(digest, {
        digest,
        mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: [
          { digest: child, platform: { os: 'linux', architecture: 'amd64' } },
          { digest: `sha256:${'2'.repeat(64)}`, platform: { os: 'linux', architecture: 'amd64' } },
        ],
      }),
    ).toThrow('linux/amd64 child is missing or ambiguous');
  });

  it('pins OCI readback rollback and routing contracts in the permanent workflows', () => {
    expect(workflow).toContain('PLATFORM_MATCH_COUNT=');
    expect(workflow).toContain('test "$PLATFORM_MATCH_COUNT" = 1');
    expect(workflow).toContain('application/vnd.oci.image.manifest.v1+json');
    expect(workflow).toContain("--format '{{json .Image}}'");
    expect(workflow).toContain('test "$runtime_digest" = "$RUNTIME_IMAGE_DIGEST"');
    expect(runtimeWorkflow).toContain('EXPECTED_RUNTIME_IMAGE_DIGEST');
    expect(runtimeWorkflow).toContain('test "$image_digest" = "$EXPECTED_RUNTIME_IMAGE_DIGEST"');

    expect(workflow).not.toContain('status.traffic[percent=100].revisionName');
    expect(workflow).toContain('PREVIOUS_MCP_REVISION="$(current_revision');
    expect(workflow).toContain('TRAFFIC_PROMOTION_STARTED=true');
    expect(workflow).toContain("if: failure() && env.TRAFFIC_PROMOTION_STARTED == 'true'");
    expect(workflow).toContain('rollback_failures=0');
    expect(workflow).toContain('STAGING_TRAFFIC_ROLLBACK=PASS');

    expect(workflow).toContain(
      '--ingress all --default-url --invoker-iam-check --no-allow-unauthenticated',
    );
    expect(workflow).toContain('--ingress all --default-url --no-invoker-iam-check');
    expect(workflow).not.toContain('--allow-unauthenticated');
  });

  it('requires exact frozen candidate, immutable digest, readiness before promotion and final readback', () => {
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$CANDIDATE_SHA"');
    expect(workflow).toContain('[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]');
    expect(workflow).toContain(
      'Verify candidate health readiness and public route confinement before traffic',
    );
    expect(workflow).toContain('Promote verified candidate to full staging traffic');
    expect(workflow).toContain('Read back exact final staging runtime');
    expect(workflow).toContain('.revisionName == $revision');
    expect(workflow).toContain(
      'Automatic staging traffic rollback after failed post-promotion step',
    );
  });
});
