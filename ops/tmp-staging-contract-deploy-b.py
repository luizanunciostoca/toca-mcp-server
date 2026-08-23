from pathlib import Path

path = Path('.github/workflows/deploy-gcp-staging-canonical.yml')
text = path.read_text()


def once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, got {count}')
    return source.replace(old, new, 1)


readback = text.index('      - name: Read back exact final staging runtime\n')
verify_start = text.index('          verify_service() {\n', readback)
verify_end = text.index('          verify_service "$GCP_CLOUD_RUN_MCP_SERVICE"', verify_start)
verify = r'''          verify_service() {
            local service="$1" revision="$2" expected_sa="$3" evidence="$4"
            local traffic_ready=false traffic_count traffic_sum release_sha runtime_sa image runtime_digest
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
'''
text = text[:verify_start] + verify + text[verify_end:]

text = once(
    text,
    '            --arg imageDigest "$IMAGE_DIGEST" \\\n',
    '            --arg imageIndexDigest "$IMAGE_DIGEST" \\\n            --arg runtimeImageDigest "$RUNTIME_IMAGE_DIGEST" \\\n',
    'manifest digest args',
)
text = once(
    text,
    '{schemaVersion:"toca.staging.canonical-deploy.v1",candidateSha:$candidateSha,imageDigest:$imageDigest,mcpRevision:$mcpRevision,webhookRevision:$webhookRevision,canonicalConfigSha256:$configSha,trafficPercent:100,providersEnabled:false,providerAccess:false,productionAccess:false,result:"PASS"}',
    '{schemaVersion:"toca.staging.canonical-deploy.v1",candidateSha:$candidateSha,imageIndexDigest:$imageIndexDigest,runtimeImageDigest:$runtimeImageDigest,mcpRevision:$mcpRevision,webhookRevision:$webhookRevision,canonicalConfigSha256:$configSha,trafficPercent:100,providersEnabled:false,providerAccess:false,productionAccess:false,result:"PASS"}',
    'manifest digest fields',
)

rollback_start = text.index('      - name: Automatic staging traffic rollback after failed post-promotion step\n')
rollback_end = text.index('\n      - name: Stop Cloud SQL Auth Proxy\n', rollback_start)
rollback = r'''      - name: Automatic staging traffic rollback after failed post-promotion step
        if: failure() && env.TRAFFIC_PROMOTION_STARTED == 'true'
        shell: bash
        run: |
          set -euo pipefail
          test -n "$PREVIOUS_MCP_REVISION"
          test -n "$PREVIOUS_WEBHOOK_REVISION"
          rollback_service() {
            local service="$1" revision="$2" payload count traffic_sum
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
          rollback_failures=0
          rollback_service "$GCP_CLOUD_RUN_MCP_SERVICE" "$PREVIOUS_MCP_REVISION" || rollback_failures=1
          rollback_service "$GCP_CLOUD_RUN_WEBHOOK_SERVICE" "$PREVIOUS_WEBHOOK_REVISION" || rollback_failures=1
          test "$rollback_failures" = 0
          echo 'STAGING_TRAFFIC_ROLLBACK=PASS'
'''
text = text[:rollback_start] + rollback + text[rollback_end:]

path.write_text(text)
