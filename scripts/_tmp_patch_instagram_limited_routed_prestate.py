from pathlib import Path

workflow_path = Path('.github/workflows/instagram-engagement-limited-activation.yml')
workflow = workflow_path.read_text()
old = '''          SERVICE_JSON="$(gcloud run services describe "$DAEMON_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          PRE_IMAGE="$(printf '%s' "$SERVICE_JSON" | jq -r '.spec.template.spec.containers[0].image')"
          PRE_REVISION="$(current_revision "$DAEMON_SERVICE_NAME")"
          DAEMON_URL="$(printf '%s' "$SERVICE_JSON" | jq -r '.status.url // empty')"
          test -n "$PRE_IMAGE"
          test -n "$PRE_REVISION"
          test -n "$DAEMON_URL"
          printf '%s' "$SERVICE_JSON" | jq -e '
            .spec.template.spec.containers[0] as $c |
            ([$c.env[]? | select(.name=="INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED") | .value] | last) == "true" and
            ([$c.env[]? | select(.name=="INSTAGRAM_ENGAGEMENT_WRITES_ENABLED") | .value] | last // "false") == "false"
          ' >/dev/null
'''
new = '''          SERVICE_JSON="$(gcloud run services describe "$DAEMON_SERVICE_NAME" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          PRE_REVISION="$(current_revision "$DAEMON_SERVICE_NAME")"
          DAEMON_URL="$(printf '%s' "$SERVICE_JSON" | jq -r '.status.url // empty')"
          test -n "$PRE_REVISION"
          test -n "$DAEMON_URL"

          PRE_REVISION_JSON="$(gcloud run revisions describe "$PRE_REVISION" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format=json)"
          PRE_IMAGE="$(printf '%s' "$PRE_REVISION_JSON" | jq -r '.spec.containers[0].image // empty')"
          test -n "$PRE_IMAGE"
          printf '%s' "$PRE_REVISION_JSON" | jq -e --arg sa "$GCP_RUNTIME_SERVICE_ACCOUNT" '
            .spec.containers[0] as $c |
            (([.status.conditions[]? | select(.type == "Ready") | .status] | last) == "True") and
            (.spec.serviceAccountName == $sa) and
            (([($c.env // [])[] | select(.name == "INSTAGRAM_ENGAGEMENT_RUNTIME_ENABLED") | .value] | last) == "true") and
            (([($c.env // [])[] | select(.name == "INSTAGRAM_ENGAGEMENT_WRITES_ENABLED") | .value] | last // "false") == "false") and
            (([($c.env // [])[] | select(.name == "INSTAGRAM_PUBLICATION_WRITES_ENABLED") | .value] | last // "false") == "false")
          ' >/dev/null
'''
if old not in workflow:
    raise SystemExit('expected prestate block not found')
workflow_path.write_text(workflow.replace(old, new, 1))

test_path = Path('test/instagram-engagement-limited-activation.test.ts')
test_text = test_path.read_text()
anchor = "  it('keeps the serving fail-closed revision until the named candidate is verified', () => {\n"
addition = '''  it('derives fail-closed prestate from the routed revision instead of the service template', () => {
    expect(workflow).toContain('PRE_REVISION_JSON="$(gcloud run revisions describe "$PRE_REVISION"');
    expect(workflow).toContain('printf \'%s\' "$PRE_REVISION_JSON" | jq -e');
    expect(workflow).toContain('(.spec.serviceAccountName == $sa)');
    expect(workflow).not.toContain(
      'PRE_IMAGE="$(printf \'%s\' "$SERVICE_JSON" | jq -r \'.spec.template.spec.containers[0].image\')"',
    );
    expect(workflow).not.toContain('.spec.template.spec.containers[0] as $c |');
  });

'''
if anchor not in test_text:
    raise SystemExit('test anchor not found')
test_path.write_text(test_text.replace(anchor, addition + anchor, 1))
