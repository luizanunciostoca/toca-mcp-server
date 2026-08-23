from pathlib import Path

path = Path('test/gcp-staging-canonical-workflow.test.ts')
text = path.read_text()


def once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, got {count}')
    return source.replace(old, new, 1)


anchor = "const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;\n"
helper = r'''

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
'''
text = once(text, anchor, anchor + helper, 'OCI test helper')

marker = "  it('requires exact frozen candidate, immutable digest, readiness before promotion and final readback', () => {\n"
cases = r'''  it('resolves exactly one linux/amd64 child from an attested OCI index', () => {
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

    expect(resolveExpectedRuntimeDigest(digest, manifest, { os: 'linux', architecture: 'amd64' })).toBe(
      digest,
    );
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

'''
text = once(text, marker, cases + marker, 'regression tests')
path.write_text(text)
