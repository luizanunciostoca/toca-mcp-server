from pathlib import Path

path = Path('.github/workflows/deploy-gcp-staging-canonical.yml')
text = path.read_text()


def once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, got {count}')
    return source.replace(old, new, 1)


oci_anchor = '          test "$REMOTE_DIGEST" = "$IMAGE_DIGEST"\n'
oci_insert = r'''          OCI_MANIFEST_JSON="$(docker buildx imagetools inspect "${IMAGE_REPOSITORY}@${IMAGE_DIGEST}" --format '{{json .Manifest}}')"
          RESOLVED_IMAGE_DIGEST="$(jq -r '.digest // empty' <<<"$OCI_MANIFEST_JSON")"
          MEDIA_TYPE="$(jq -r '.mediaType // empty' <<<"$OCI_MANIFEST_JSON")"
          test "$RESOLVED_IMAGE_DIGEST" = "$IMAGE_DIGEST"
          case "$MEDIA_TYPE" in
            application/vnd.oci.image.index.v1+json|application/vnd.docker.distribution.manifest.list.v2+json)
              PLATFORM_MATCH_COUNT="$(jq '[.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "amd64")] | length' <<<"$OCI_MANIFEST_JSON")"
              test "$PLATFORM_MATCH_COUNT" = 1
              RUNTIME_IMAGE_DIGEST="$(jq -r 'first(.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest) // empty' <<<"$OCI_MANIFEST_JSON")"
              ;;
            application/vnd.oci.image.manifest.v1+json|application/vnd.docker.distribution.manifest.v2+json)
              OCI_IMAGE_JSON="$(docker buildx imagetools inspect "${IMAGE_REPOSITORY}@${IMAGE_DIGEST}" --format '{{json .Image}}')"
              test "$(jq -r '.os // empty' <<<"$OCI_IMAGE_JSON")" = linux
              test "$(jq -r '.architecture // empty' <<<"$OCI_IMAGE_JSON")" = amd64
              RUNTIME_IMAGE_DIGEST="$IMAGE_DIGEST"
              ;;
            *)
              echo "Unsupported or unknown OCI media type: $MEDIA_TYPE" >&2
              exit 1
              ;;
          esac
          [[ "$RUNTIME_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
'''
text = once(text, oci_anchor, oci_anchor + oci_insert, 'OCI resolver')

build_start = text.index('      - name: Build push and resolve immutable candidate digest\n')
build_end = text.index('\n      - name: Build provider-disabled runtime configuration\n', build_start)
build = text[build_start:build_end]
build = once(
    build,
    '          echo "IMAGE_DIGEST=$IMAGE_DIGEST" >> "$GITHUB_ENV"\n          echo "MCP_TAG=staging-mcp-${GITHUB_SHA::7}" >> "$GITHUB_ENV"\n',
    '          echo "IMAGE_DIGEST=$IMAGE_DIGEST" >> "$GITHUB_ENV"\n          echo "RUNTIME_IMAGE_DIGEST=$RUNTIME_IMAGE_DIGEST" >> "$GITHUB_ENV"\n          echo "MCP_TAG=staging-mcp-${GITHUB_SHA::7}" >> "$GITHUB_ENV"\n',
    'runtime digest export',
)
text = text[:build_start] + build + text[build_end:]

capture_start = text.index('      - name: Capture current rollback targets\n')
capture_end = text.index('\n      - name: Deploy private MCP candidate by digest with no traffic\n', capture_start)
capture = r'''      - name: Capture current rollback targets
        shell: bash
        run: |
          set -euo pipefail
          current_revision() {
            local service="$1" payload count traffic_sum revision
            payload="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
            count="$(jq '[.status.traffic[]? | select((.percent // 0) == 100 and (.revisionName // "") != "")] | length' <<<"$payload")"
            traffic_sum="$(jq '[.status.traffic[]?.percent // 0] | add // 0' <<<"$payload")"
            revision="$(jq -r 'first(.status.traffic[]? | select((.percent // 0) == 100 and (.revisionName // "") != "") | .revisionName) // empty' <<<"$payload")"
            test "$count" = 1
            test "$traffic_sum" = 100
            test -n "$revision"
            printf '%s\n' "$revision"
          }
          PREVIOUS_MCP_REVISION="$(current_revision "$GCP_CLOUD_RUN_MCP_SERVICE")"
          PREVIOUS_WEBHOOK_REVISION="$(current_revision "$GCP_CLOUD_RUN_WEBHOOK_SERVICE")"
          test -n "$PREVIOUS_MCP_REVISION"
          test -n "$PREVIOUS_WEBHOOK_REVISION"
          echo "PREVIOUS_MCP_REVISION=$PREVIOUS_MCP_REVISION" >> "$GITHUB_ENV"
          echo "PREVIOUS_WEBHOOK_REVISION=$PREVIOUS_WEBHOOK_REVISION" >> "$GITHUB_ENV"
'''
text = text[:capture_start] + capture + text[capture_end:]

text = once(
    text,
    '            --min-instances 0 --max-instances 1 --cpu-throttling --memory 512Mi --cpu 1 --no-allow-unauthenticated',
    '            --min-instances 0 --max-instances 1 --cpu-throttling --memory 512Mi --cpu 1 \\\n            --ingress all --default-url --invoker-iam-check --no-allow-unauthenticated',
    'private MCP routing',
)
text = once(
    text,
    '            --min-instances 0 --max-instances 2 --cpu-throttling --memory 512Mi --cpu 1 --allow-unauthenticated',
    '            --min-instances 0 --max-instances 2 --cpu-throttling --memory 512Mi --cpu 1 \\\n            --ingress all --default-url --no-invoker-iam-check',
    'public webhook routing',
)

promotion = '          gcloud run services update-traffic "$GCP_CLOUD_RUN_MCP_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "${MCP_REVISION}=100"\n'
text = once(
    text,
    promotion,
    '          echo \'TRAFFIC_PROMOTION_STARTED=true\' >> "$GITHUB_ENV"\n' + promotion,
    'promotion start marker',
)

path.write_text(text)
