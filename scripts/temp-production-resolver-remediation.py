from __future__ import annotations

import base64
import subprocess
import tempfile
from pathlib import Path

ROOT = Path.cwd()
WORKFLOW = ROOT / ".github/workflows/deploy-gcp.yml"
CONTRACT_TEST = ROOT / "test/gcp-production-bootstrap-contract.test.ts"


def patch_workflow(source: str) -> str:
    start_marker = "      - name: Resolve production Meta token to exact numeric secret version\n"
    end_marker = "      - name: Require exact numeric production provider secret versions after resolution\n"
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    replacement = r'''      - name: Resolve production Meta token to exact numeric secret version
        if: inputs.operation == 'deploy' && inputs.environment == 'production' && env.GCP_META_ACCESS_TOKEN_SECRET_VERSION == 'RESOLVE_RUNTIME'
        run: |
          set -euo pipefail
          JOB_NAME="toca-meta-secret-version-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          cleanup() {
            set +e
            gcloud run jobs delete "$JOB_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --quiet >/dev/null 2>&1
            REMAINING_CLEANUP="$(gcloud run jobs list --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --filter="metadata.name=${JOB_NAME}" --format='value(metadata.name)' 2>/dev/null)"
            if [[ -n "$REMAINING_CLEANUP" ]]; then
              echo "Meta resolver cleanup could not prove job absence: $JOB_NAME" >&2
            else
              echo 'META_RESOLVER_CLEANUP=PASS'
            fi
            set -e
          }
          trap cleanup EXIT

          gcloud run services describe "$GCP_CLOUD_RUN_MCP_SERVICE" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \
            > /tmp/meta-resolver-service.json
          SERVING_REVISION="$(jq -r '
            [(.status.traffic // [])[]
              | select((.percent // 0) == 100)
              | (.revisionName // empty)]
            | unique
            | if length == 1 then .[0] else empty end
          ' /tmp/meta-resolver-service.json)"
          if [[ -z "$SERVING_REVISION" ]]; then
            echo 'Meta resolver could not identify exactly one 100%-serving MCP revision' >&2
            jq -c '{traffic:(.status.traffic // [])}' /tmp/meta-resolver-service.json >&2
            exit 1
          fi

          gcloud run revisions describe "$SERVING_REVISION" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json \
            > /tmp/meta-resolver-revision.json
          SERVING_IMAGE="$(jq -r '.spec.containers[0].image // empty' /tmp/meta-resolver-revision.json)"
          SERVING_DIGEST="$(jq -r '.status.imageDigest // empty' /tmp/meta-resolver-revision.json)"
          [[ -n "$SERVING_IMAGE" ]] || { echo "Meta resolver serving revision has no container image: $SERVING_REVISION" >&2; exit 1; }
          [[ "$SERVING_DIGEST" == sha256:* ]] || { echo "Meta resolver serving revision has no resolved image digest: $SERVING_REVISION" >&2; exit 1; }
          CURRENT_IMAGE="$(SERVING_IMAGE="$SERVING_IMAGE" SERVING_DIGEST="$SERVING_DIGEST" node --input-type=module -e '
            const image = process.env.SERVING_IMAGE;
            const digest = process.env.SERVING_DIGEST;
            const slash = image.lastIndexOf("/");
            const at = image.lastIndexOf("@");
            const colon = image.lastIndexOf(":");
            const cut = at > slash ? at : colon > slash ? colon : image.length;
            process.stdout.write(`${image.slice(0, cut)}@${digest}`);
          ')"
          jq -n \
            --arg revision "$SERVING_REVISION" \
            --arg image "$CURRENT_IMAGE" \
            --arg digest "$SERVING_DIGEST" \
            '{schemaVersion:"toca.platform.meta-resolver-source.v1",servingRevision:$revision,immutableImage:$image,imageDigest:$digest}' \
            > platform-evidence/meta-resolver-source.json
          echo "META_RESOLVER_SOURCE_REVISION=$SERVING_REVISION"

          read -r -d '' RESOLVER_JS <<'JS' || true
          const metadataHeaders = {'Metadata-Flavor': 'Google'};
          const tokenResponse = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {headers: metadataHeaders});
          if (!tokenResponse.ok) throw new Error(`metadata token status ${tokenResponse.status}`);
          const {access_token: accessToken} = await tokenResponse.json();
          const url = `https://secretmanager.googleapis.com/v1/projects/${process.env.RESOLVER_PROJECT}/secrets/${process.env.RESOLVER_SECRET}/versions/latest:access`;
          const response = await fetch(url, {headers: {Authorization: `Bearer ${accessToken}`}});
          if (!response.ok) throw new Error(`secret resolver status ${response.status}`);
          const body = await response.json();
          const match = String(body.name ?? '').match(/\/versions\/(\d+)$/);
          if (!match) throw new Error('numeric secret version missing from resolver response name');
          console.log(`META_SECRET_VERSION=${match[1]}`);
          JS

          gcloud run jobs deploy "$JOB_NAME" \
            --image "$CURRENT_IMAGE" \
            --project "$GCP_PROJECT_ID" \
            --region "$GCP_REGION" \
            --service-account "$GCP_MCP_RUNTIME_SERVICE_ACCOUNT" \
            --set-env-vars "RESOLVER_PROJECT=$GCP_PROJECT_ID,RESOLVER_SECRET=$GCP_META_ACCESS_TOKEN_SECRET" \
            --command node \
            --args="^@^--input-type=module@--eval@${RESOLVER_JS}" \
            --tasks 1 \
            --max-retries 0 \
            --task-timeout 120s \
            --quiet
          gcloud run jobs execute "$JOB_NAME" \
            --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --wait --quiet

          LOGS="$(gcloud logging read \
            "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${JOB_NAME}\"" \
            --project "$GCP_PROJECT_ID" --freshness=10m --limit=100 --order=asc \
            --format='value(textPayload)' || true)"
          VERSION="$(printf '%s\n' "$LOGS" | sed -n 's/.*META_SECRET_VERSION=\([0-9][0-9]*\).*/\1/p' | tail -n1)"
          [[ "$VERSION" =~ ^[0-9]+$ ]] || { echo 'Meta secret numeric version could not be resolved' >&2; exit 1; }
          echo "GCP_META_ACCESS_TOKEN_SECRET_VERSION=$VERSION" >> "$GITHUB_ENV"
          jq -n \
            --arg secret "$GCP_META_ACCESS_TOKEN_SECRET" \
            --arg version "$VERSION" \
            --arg sourceRevision "$SERVING_REVISION" \
            --arg sourceImage "$CURRENT_IMAGE" \
            '{schemaVersion:"toca.platform.secret-version-evidence.v2",secretId:$secret,numericVersion:$version,resolverIdentity:"production-runtime",sourceRevision:$sourceRevision,sourceImage:$sourceImage,secretPayloadDisclosed:false,providerCallExecuted:false}' \
            > platform-evidence/meta-secret-version.json

          cleanup
          trap - EXIT
          REMAINING="$(gcloud run jobs list --project "$GCP_PROJECT_ID" --region "$GCP_REGION" \
            --filter="metadata.name=${JOB_NAME}" --format='value(metadata.name)')"
          [[ -z "$REMAINING" ]] || { echo "Meta resolver job still exists after cleanup: $JOB_NAME" >&2; exit 1; }

'''
    return source[:start] + replacement + source[end:]


def patch_contract_test(source: str) -> str:
    start_marker = "  it('resolves the Meta token numerically without provider calls or payload evidence', () => {\n"
    end_marker = "  it('scopes META_APP_ID to META_ENABLED instead of Meta Ads read-only mode', () => {\n"
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    replacement = '''  it('resolves the Meta token numerically from the exact serving revision without silent readback failure', () => {
    const resolverStart = workflow.indexOf(
      'Resolve production Meta token to exact numeric secret version',
    );
    const resolverEnd = workflow.indexOf(
      'Require exact numeric production provider secret versions after resolution',
      resolverStart,
    );
    const resolver = workflow.slice(resolverStart, resolverEnd);

    expect(resolver).toContain('--format=json');
    expect(resolver).toContain('/tmp/meta-resolver-service.json');
    expect(resolver).toContain(
      'Meta resolver could not identify exactly one 100%-serving MCP revision',
    );
    expect(resolver).toContain('/tmp/meta-resolver-revision.json');
    expect(resolver).toContain('.status.imageDigest // empty');
    expect(resolver).toContain('META_RESOLVER_SOURCE_REVISION=');
    expect(resolver).toContain('@${digest}');
    expect(resolver).toContain('META_RESOLVER_CLEANUP=PASS');
    expect(resolver).toContain('META_SECRET_VERSION=');
    expect(resolver).toContain('GCP_META_ACCESS_TOKEN_SECRET_VERSION=$VERSION');
    expect(resolver).toContain('secretPayloadDisclosed:false');
    expect(resolver).toContain('providerCallExecuted:false');
    expect(resolver).not.toContain(
      "--format='value(status.traffic[percent=100].revisionName)'",
    );
    expect(resolver).not.toContain('test -n "$SERVING_REVISION"');
    expect(resolver).not.toContain('test -n "$CURRENT_IMAGE"');
    expect(workflow).toContain('Production Meta token must be pinned to a numeric version');
  });

'''
    return source[:start] + replacement + source[end:]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="toca-resolver-remediation-") as temp_dir:
        temp = Path(temp_dir)
        workflow_out = temp / "deploy-gcp.yml"
        test_out = temp / "gcp-production-bootstrap-contract.test.ts"
        workflow_out.write_text(patch_workflow(WORKFLOW.read_text()))
        test_out.write_text(patch_contract_test(CONTRACT_TEST.read_text()))
        subprocess.run(
            [
                "pnpm",
                "exec",
                "prettier",
                "--config",
                ".prettierrc.json",
                "--write",
                str(workflow_out),
                str(test_out),
            ],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        workflow_bytes = workflow_out.read_bytes()
        test_bytes = test_out.read_bytes()
        print("PATCH_WORKFLOW_BASE64=" + base64.b64encode(workflow_bytes).decode("ascii"))
        print("PATCH_TEST_BASE64=" + base64.b64encode(test_bytes).decode("ascii"))


if __name__ == "__main__":
    main()
