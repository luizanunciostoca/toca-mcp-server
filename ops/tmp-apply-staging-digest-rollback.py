from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, got {count}")
    return text.replace(old, new)


deploy_path = Path('.github/workflows/deploy-gcp-staging-canonical.yml')
runtime_path = Path('.github/workflows/staging-runtime-observability.yml')
test_path = Path('test/gcp-staging-canonical-workflow.test.ts')
deploy = deploy_path.read_text()
runtime = runtime_path.read_text()
test = test_path.read_text()

deploy = replace_once(
    deploy,
    '''          REMOTE_DIGEST="$(gcloud artifacts docker images describe "$IMAGE_TAG" --project "$GCP_PROJECT_ID" --format='value(image_summary.digest)')"
          test "$REMOTE_DIGEST" = "$IMAGE_DIGEST"
          echo "IMAGE=${IMAGE_REPOSITORY}@${IMAGE_DIGEST}" >> "$GITHUB_ENV"
          echo "IMAGE_DIGEST=$IMAGE_DIGEST" >> "$GITHUB_ENV"
''',
    '''          REMOTE_DIGEST="$(gcloud artifacts docker images describe "$IMAGE_TAG" --project "$GCP_PROJECT_ID" --format='value(image_summary.digest)')"
          test "$REMOTE_DIGEST" = "$IMAGE_DIGEST"
          OCI_MANIFEST_JSON="$(docker buildx imagetools inspect "${IMAGE_REPOSITORY}@${IMAGE_DIGEST}" --format '{{json .Manifest}}')"
          RESOLVED_INDEX_DIGEST="$(jq -r '.digest // empty' <<<"$OCI_MANIFEST_JSON")"
          test "$RESOLVED_INDEX_DIGEST" = "$IMAGE_DIGEST"
          RUNTIME_IMAGE_DIGEST="$(jq -r 'if .mediaType == "application/vnd.oci.image.index.v1+json" then (first(.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest) // empty) else (.digest // empty) end' <<<"$OCI_MANIFEST_JSON")"
          [[ "$RUNTIME_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
          echo "IMAGE=${IMAGE_REPOSITORY}@${IMAGE_DIGEST}" >> "$GITHUB_ENV"
          echo "IMAGE_DIGEST=$IMAGE_DIGEST" >> "$GITHUB_ENV"
          echo "RUNTIME_IMAGE_DIGEST=$RUNTIME_IMAGE_DIGEST" >> "$GITHUB_ENV"
''',
    'build digest anchor',
)

deploy = replace_once(
    deploy,
    '''      - name: Capture current rollback targets
        shell: bash
        run: |
          set -euo pipefail
          current_revision() {
            gcloud run services describe "$1" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format='value(status.traffic[percent=100].revisionName)' 2>/dev/null || true
          }
          echo "PREVIOUS_MCP_REVISION=$(current_revision "$GCP_CLOUD_RUN_MCP_SERVICE")" >> "$GITHUB_ENV"
          echo "PREVIOUS_WEBHOOK_REVISION=$(current_revision "$GCP_CLOUD_RUN_WEBHOOK_SERVICE")" >> "$GITHUB_ENV"
''',
    '''      - name: Capture current rollback targets
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
            printf '%s\\n' "$revision"
          }
          PREVIOUS_MCP_REVISION="$(current_revision "$GCP_CLOUD_RUN_MCP_SERVICE")"
          PREVIOUS_WEBHOOK_REVISION="$(current_revision "$GCP_CLOUD_RUN_WEBHOOK_SERVICE")"
          test -n "$PREVIOUS_MCP_REVISION"
          test -n "$PREVIOUS_WEBHOOK_REVISION"
          echo "PREVIOUS_MCP_REVISION=$PREVIOUS_MCP_REVISION" >> "$GITHUB_ENV"
          echo "PREVIOUS_WEBHOOK_REVISION=$PREVIOUS_WEBHOOK_REVISION" >> "$GITHUB_ENV"
''',
    'rollback capture anchor',
)

deploy = replace_once(
    deploy,
    '''      - name: Promote verified candidate to full staging traffic
        if: ${{ inputs.promote_full }}
        shell: bash
        run: |
          set -euo pipefail
          gcloud run services update-traffic "$GCP_CLOUD_RUN_MCP_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "${MCP_REVISION}=100"
          gcloud run services update-traffic "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "${WEBHOOK_REVISION}=100"
          echo 'TRAFFIC_PROMOTED=true' >> "$GITHUB_ENV"
''',
    '''      - name: Promote verified candidate to full staging traffic
        if: ${{ inputs.promote_full }}
        shell: bash
        run: |
          set -euo pipefail
          echo 'TRAFFIC_PROMOTION_STARTED=true' >> "$GITHUB_ENV"
          gcloud run services update-traffic "$GCP_CLOUD_RUN_MCP_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "${MCP_REVISION}=100"
          gcloud run services update-traffic "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "${WEBHOOK_REVISION}=100"
          echo 'TRAFFIC_PROMOTED=true' >> "$GITHUB_ENV"
''',
    'promotion anchor',
)

deploy = replace_once(
    deploy,
    '''          verify_service() {
            local service="$1" revision="$2" expected_sa="$3" evidence="$4"
            gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json > "/tmp/${service}-final.json"
            test "$(jq --arg revision "$revision" '[.status.traffic[]? | select((.percent // 0) == 100 and .revisionName == $revision)] | length' "/tmp/${service}-final.json")" = 1
            test "$(jq '[.status.traffic[]?.percent // 0] | add // 0' "/tmp/${service}-final.json")" = 100
            gcloud run revisions describe "$revision" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json > "/tmp/${revision}.json"
            release_sha="$(jq -r 'first(.spec.containers[0].env[]? | select(.name == "TOCA_RELEASE_SHA") | .value) // empty' "/tmp/${revision}.json")"
            runtime_sa="$(jq -r '.spec.serviceAccountName // empty' "/tmp/${revision}.json")"
            image="$(jq -r '.spec.containers[0].image // empty' "/tmp/${revision}.json")"
            test "$release_sha" = "$CANDIDATE_SHA"
            test "$runtime_sa" = "$expected_sa"
            test "${image##*@}" = "$IMAGE_DIGEST"
            jq -n --arg service "$service" --arg revision "$revision" --arg releaseSha "$release_sha" --arg runtimeIdentity "$runtime_sa" --arg imageDigest "$IMAGE_DIGEST" '{service:$service,revision:$revision,trafficPercent:100,releaseSha:$releaseSha,runtimeIdentity:$runtimeIdentity,imageDigest:$imageDigest}' > "staging-deploy-evidence/${evidence}"
          }
''',
    '''          verify_service() {
            local service="$1" revision="$2" expected_sa="$3" evidence="$4"
            local traffic_ready=false
            for attempt in $(seq 1 24); do
              gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json > "/tmp/${service}-final.json"
              traffic_count="$(jq --arg revision "$revision" '[.status.traffic[]? | select((.percent // 0) == 100 and .revisionName == $revision)] | length' "/tmp/${service}-final.json")"
              traffic_sum="$(jq '[.status.traffic[]?.percent // 0] | add // 0' "/tmp/${service}-final.json")"
              if [[ "$traffic_count" == 1 && "$traffic_sum" == 100 ]]; then
                traffic_ready=true
                break
              fi
              sleep 5
            done
            test "$traffic_ready" = true
            gcloud run revisions describe "$revision" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json > "/tmp/${revision}.json"
            release_sha="$(jq -r 'first(.spec.containers[0].env[]? | select(.name == "TOCA_RELEASE_SHA") | .value) // empty' "/tmp/${revision}.json")"
            runtime_sa="$(jq -r '.spec.serviceAccountName // empty' "/tmp/${revision}.json")"
            image="$(jq -r '.spec.containers[0].image // empty' "/tmp/${revision}.json")"
            runtime_digest="${image##*@}"
            test "$release_sha" = "$CANDIDATE_SHA"
            test "$runtime_sa" = "$expected_sa"
            test "$runtime_digest" = "$RUNTIME_IMAGE_DIGEST"
            jq -n --arg service "$service" --arg revision "$revision" --arg releaseSha "$release_sha" --arg runtimeIdentity "$runtime_sa" --arg imageIndexDigest "$IMAGE_DIGEST" --arg runtimeImageDigest "$runtime_digest" '{service:$service,revision:$revision,trafficPercent:100,releaseSha:$releaseSha,runtimeIdentity:$runtimeIdentity,imageIndexDigest:$imageIndexDigest,runtimeImageDigest:$runtimeImageDigest}' > "staging-deploy-evidence/${evidence}"
          }
''',
    'final readback anchor',
)

deploy = replace_once(
    deploy,
    '''      - name: Automatic staging traffic rollback after failed post-promotion step
        if: failure() && env.TRAFFIC_PROMOTED == 'true' && env.PREVIOUS_MCP_REVISION != '' && env.PREVIOUS_WEBHOOK_REVISION != ''
        shell: bash
        run: |
          set -euo pipefail
          gcloud run services update-traffic "$GCP_CLOUD_RUN_MCP_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "${PREVIOUS_MCP_REVISION}=100"
          gcloud run services update-traffic "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "${PREVIOUS_WEBHOOK_REVISION}=100"
''',
    '''      - name: Automatic staging traffic rollback after failed post-promotion step
        if: failure() && env.TRAFFIC_PROMOTION_STARTED == 'true'
        shell: bash
        run: |
          set -euo pipefail
          test -n "$PREVIOUS_MCP_REVISION"
          test -n "$PREVIOUS_WEBHOOK_REVISION"
          rollback_service() {
            local service="$1" revision="$2"
            gcloud run services update-traffic "$service" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --to-revisions "${revision}=100"
            for attempt in $(seq 1 24); do
              payload="$(gcloud run services describe "$service" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
              count="$(jq --arg revision "$revision" '[.status.traffic[]? | select((.percent // 0) == 100 and .revisionName == $revision)] | length' <<<"$payload")"
              traffic_sum="$(jq '[.status.traffic[]?.percent // 0] | add // 0' <<<"$payload")"
              if [[ "$count" == 1 && "$traffic_sum" == 100 ]]; then
                return 0
              fi
              sleep 5
            done
            echo "Timed out verifying staging rollback for $service to $revision" >&2
            return 1
          }
          rollback_service "$GCP_CLOUD_RUN_MCP_SERVICE" "$PREVIOUS_MCP_REVISION"
          rollback_service "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" "$PREVIOUS_WEBHOOK_REVISION"
          echo 'STAGING_TRAFFIC_ROLLBACK=PASS'
''',
    'rollback action anchor',
)

runtime = replace_once(
    runtime,
    '  WEBHOOK_RUNTIME_SA: toca-next-stg-webhook@toca-mcp-next-staging.iam.gserviceaccount.com\n',
    '  WEBHOOK_RUNTIME_SA: toca-next-stg-webhook@toca-mcp-next-staging.iam.gserviceaccount.com\n  ARTIFACT_REPOSITORY: toca-mcp-staging\n',
    'runtime env anchor',
)

setup_anchor = '''      - name: Setup gcloud
        uses: google-github-actions/setup-gcloud@e427ad8a34f8676edf47cf7d7925499adf3eb74f # v2

'''
image_step = '''      - name: Resolve expected Cloud Run runtime manifest from attested image index
        id: image
        env:
          EXPECTED_IMAGE_DIGEST: ${{ inputs.expected_image_digest }}
        shell: bash
        run: |
          set -euo pipefail
          gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
          IMAGE_REPOSITORY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/server"
          OCI_MANIFEST_JSON="$(docker buildx imagetools inspect "${IMAGE_REPOSITORY}@${EXPECTED_IMAGE_DIGEST}" --format '{{json .Manifest}}')"
          RESOLVED_INDEX_DIGEST="$(jq -r '.digest // empty' <<<"$OCI_MANIFEST_JSON")"
          test "$RESOLVED_INDEX_DIGEST" = "$EXPECTED_IMAGE_DIGEST"
          RUNTIME_IMAGE_DIGEST="$(jq -r 'if .mediaType == "application/vnd.oci.image.index.v1+json" then (first(.manifests[]? | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest) // empty) else (.digest // empty) end' <<<"$OCI_MANIFEST_JSON")"
          [[ "$RUNTIME_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
          echo "runtime_digest=$RUNTIME_IMAGE_DIGEST" >> "$GITHUB_OUTPUT"

'''
runtime = replace_once(runtime, setup_anchor, setup_anchor + image_step, 'runtime setup anchor')

runtime = replace_once(
    runtime,
    '''        env:
          EXPECTED_CANDIDATE_SHA: ${{ inputs.expected_candidate_sha }}
          EXPECTED_IMAGE_DIGEST: ${{ inputs.expected_image_digest }}
''',
    '''        env:
          EXPECTED_CANDIDATE_SHA: ${{ inputs.expected_candidate_sha }}
          EXPECTED_IMAGE_INDEX_DIGEST: ${{ inputs.expected_image_digest }}
          EXPECTED_RUNTIME_IMAGE_DIGEST: ${{ steps.image.outputs.runtime_digest }}
''',
    'runtime verify env anchor',
)
runtime = replace_once(
    runtime,
    '            test "$image_digest" = "$EXPECTED_IMAGE_DIGEST"\n',
    '            test "$image_digest" = "$EXPECTED_RUNTIME_IMAGE_DIGEST"\n',
    'runtime digest comparison',
)
runtime = replace_once(
    runtime,
    '''              --arg imageDigest "$image_digest" \\
              --arg serviceUrl "$service_url" \\
              '{service:$service,revision:$revision,trafficPercent:100,releaseSha:$releaseSha,runtimeIdentity:$runtimeIdentity,imageDigest:$imageDigest,serviceUrl:$serviceUrl}' \\
''',
    '''              --arg imageIndexDigest "$EXPECTED_IMAGE_INDEX_DIGEST" \\
              --arg runtimeImageDigest "$image_digest" \\
              --arg serviceUrl "$service_url" \\
              '{service:$service,revision:$revision,trafficPercent:100,releaseSha:$releaseSha,runtimeIdentity:$runtimeIdentity,imageIndexDigest:$imageIndexDigest,runtimeImageDigest:$runtimeImageDigest,serviceUrl:$serviceUrl}' \\
''',
    'runtime evidence anchor',
)

marker = "  it('requires exact frozen candidate, immutable digest, readiness before promotion and final readback', () => {"
added = '''  it('validates the Cloud Run runtime manifest as the linux/amd64 child of the attested OCI index', () => {
    expect(workflow).toContain('docker buildx imagetools inspect');
    expect(workflow).toContain('RUNTIME_IMAGE_DIGEST=');
    expect(workflow).toContain('test "$runtime_digest" = "$RUNTIME_IMAGE_DIGEST"');
    expect(runtimeWorkflow).toContain('Resolve expected Cloud Run runtime manifest from attested image index');
    expect(runtimeWorkflow).toContain('EXPECTED_RUNTIME_IMAGE_DIGEST');
    expect(runtimeWorkflow).toContain('test "$image_digest" = "$EXPECTED_RUNTIME_IMAGE_DIGEST"');
  });

  it('captures rollback targets from JSON and cannot silently skip rollback after promotion starts', () => {
    expect(workflow).not.toContain("status.traffic[percent=100].revisionName");
    expect(workflow).toContain('PREVIOUS_MCP_REVISION="$(current_revision');
    expect(workflow).toContain('test -n "$PREVIOUS_MCP_REVISION"');
    expect(workflow).toContain('TRAFFIC_PROMOTION_STARTED=true');
    expect(workflow).toContain("if: failure() && env.TRAFFIC_PROMOTION_STARTED == 'true'");
    expect(workflow).toContain('STAGING_TRAFFIC_ROLLBACK=PASS');
    expect(workflow).toContain('Timed out verifying staging rollback');
  });

  it('waits boundedly for final traffic convergence before exact runtime readback', () => {
    const finalReadback = workflow.indexOf('Read back exact final staging runtime');
    const finalSection = workflow.slice(finalReadback, workflow.indexOf('Publish sanitized deployment evidence'));
    expect(finalSection).toContain('for attempt in $(seq 1 24); do');
    expect(finalSection).toContain('traffic_ready=true');
    expect(finalSection).toContain('test "$traffic_ready" = true');
  });

'''
if test.count(marker) != 1:
    raise SystemExit(f'test marker mismatch: {test.count(marker)}')
test = test.replace(marker, added + marker)

deploy_path.write_text(deploy)
runtime_path.write_text(runtime)
test_path.write_text(test)
