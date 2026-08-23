from pathlib import Path

path = Path('.github/workflows/staging-runtime-observability.yml')
text = path.read_text()


def once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, got {count}')
    return source.replace(old, new, 1)


text = once(
    text,
    '  WEBHOOK_RUNTIME_SA: toca-next-stg-webhook@toca-mcp-next-staging.iam.gserviceaccount.com\n',
    '  WEBHOOK_RUNTIME_SA: toca-next-stg-webhook@toca-mcp-next-staging.iam.gserviceaccount.com\n  ARTIFACT_REPOSITORY: toca-mcp-staging\n',
    'artifact repository',
)

setup = '      - name: Setup gcloud\n        uses: google-github-actions/setup-gcloud@e427ad8a34f8676edf47cf7d7925499adf3eb74f # v2\n'
resolver = r'''
      - name: Resolve expected Cloud Run runtime manifest from attested image digest
        id: image
        env:
          EXPECTED_IMAGE_DIGEST: ${{ inputs.expected_image_digest }}
        shell: bash
        run: |
          set -euo pipefail
          gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
          IMAGE_REPOSITORY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/server"
          OCI_MANIFEST_JSON="$(docker buildx imagetools inspect "${IMAGE_REPOSITORY}@${EXPECTED_IMAGE_DIGEST}" --format '{{json .Manifest}}')"
          RESOLVED_IMAGE_DIGEST="$(jq -r '.digest // empty' <<<"$OCI_MANIFEST_JSON")"
          MEDIA_TYPE="$(jq -r '.mediaType // empty' <<<"$OCI_MANIFEST_JSON")"
          test "$RESOLVED_IMAGE_DIGEST" = "$EXPECTED_IMAGE_DIGEST"
          case "$MEDIA_TYPE" in
            application/vnd.oci.image.index.v1+json|application/vnd.docker.distribution.manifest.list.v2+json)
              PLATFORM_MATCH_COUNT="$(jq '[.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "amd64")] | length' <<<"$OCI_MANIFEST_JSON")"
              test "$PLATFORM_MATCH_COUNT" = 1
              RUNTIME_IMAGE_DIGEST="$(jq -r 'first(.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest) // empty' <<<"$OCI_MANIFEST_JSON")"
              ;;
            application/vnd.oci.image.manifest.v1+json|application/vnd.docker.distribution.manifest.v2+json)
              OCI_IMAGE_JSON="$(docker buildx imagetools inspect "${IMAGE_REPOSITORY}@${EXPECTED_IMAGE_DIGEST}" --format '{{json .Image}}')"
              test "$(jq -r '.os // empty' <<<"$OCI_IMAGE_JSON")" = linux
              test "$(jq -r '.architecture // empty' <<<"$OCI_IMAGE_JSON")" = amd64
              RUNTIME_IMAGE_DIGEST="$EXPECTED_IMAGE_DIGEST"
              ;;
            *)
              echo "Unsupported or unknown OCI media type: $MEDIA_TYPE" >&2
              exit 1
              ;;
          esac
          [[ "$RUNTIME_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
          echo "runtime_digest=$RUNTIME_IMAGE_DIGEST" >> "$GITHUB_OUTPUT"
'''
text = once(text, setup, setup + resolver, 'OCI resolver insertion')

old_env = '''      - name: Verify exact candidate revisions identities digests and traffic
        id: runtime
        env:
          EXPECTED_CANDIDATE_SHA: ${{ inputs.expected_candidate_sha }}
          EXPECTED_IMAGE_DIGEST: ${{ inputs.expected_image_digest }}
'''
new_env = '''      - name: Verify exact candidate revisions identities digests and traffic
        id: runtime
        env:
          EXPECTED_CANDIDATE_SHA: ${{ inputs.expected_candidate_sha }}
          EXPECTED_IMAGE_INDEX_DIGEST: ${{ inputs.expected_image_digest }}
          EXPECTED_RUNTIME_IMAGE_DIGEST: ${{ steps.image.outputs.runtime_digest }}
'''
text = once(text, old_env, new_env, 'runtime digest env')
text = once(
    text,
    '            test "$image_digest" = "$EXPECTED_IMAGE_DIGEST"\n',
    '            test "$image_digest" = "$EXPECTED_RUNTIME_IMAGE_DIGEST"\n',
    'runtime child comparison',
)
text = once(
    text,
    '              --arg imageDigest "$image_digest" \\\n',
    '              --arg imageIndexDigest "$EXPECTED_IMAGE_INDEX_DIGEST" \\\n              --arg runtimeImageDigest "$image_digest" \\\n',
    'runtime evidence args',
)
text = once(
    text,
    '{service:$service,revision:$revision,trafficPercent:100,releaseSha:$releaseSha,runtimeIdentity:$runtimeIdentity,imageDigest:$imageDigest,serviceUrl:$serviceUrl}',
    '{service:$service,revision:$revision,trafficPercent:100,releaseSha:$releaseSha,runtimeIdentity:$runtimeIdentity,imageIndexDigest:$imageIndexDigest,runtimeImageDigest:$runtimeImageDigest,serviceUrl:$serviceUrl}',
    'runtime evidence fields',
)

path.write_text(text)
