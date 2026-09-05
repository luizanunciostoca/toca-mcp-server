from pathlib import Path

workflow_path = Path('.github/workflows/instagram-engagement-comment-provider-canary.yml')
workflow = workflow_path.read_text()
old = '''          BODY="$(jq -r '.issue.body // ""' "$GITHUB_EVENT_PATH")"
          ISSUE_NUMBER="$(jq -r '.issue.number' "$GITHUB_EVENT_PATH")"
          CURRENT_MAIN_SHA="$(gh api "repos/${GITHUB_REPOSITORY}/branches/main" --jq '.commit.sha')"
'''
new = '''          ISSUE_NUMBER="$(jq -r '.issue.number' "$GITHUB_EVENT_PATH")"
          ISSUE_JSON="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${ISSUE_NUMBER}")"
          BODY="$(printf '%s' "$ISSUE_JSON" | jq -r '.body // ""')"
          printf '%s' "$ISSUE_JSON" | jq -e --arg owner "$GITHUB_REPOSITORY_OWNER" '
            (.state == "open") and
            (.user.login == $owner) and
            (.title | startswith("PRODUCTION AUTHORIZATION — Instagram engagement real-write COMMENT CANARY AUTO"))
          ' >/dev/null
          CURRENT_MAIN_SHA="$(gh api "repos/${GITHUB_REPOSITORY}/branches/main" --jq '.commit.sha')"
'''
if workflow.count(old) != 1:
    raise SystemExit('expected exactly one event-payload authorization block')
workflow_path.write_text(workflow.replace(old, new, 1))

runner_path = Path('scripts/instagram-engagement-comment-provider-canary.mjs')
runner = runner_path.read_text()
old_sql = '        and execution_id <> $1'
new_sql = '        and execution_id is distinct from $1'
if runner.count(old_sql) != 1:
    raise SystemExit('expected exactly one non-NULL-safe ambiguity predicate')
runner_path.write_text(runner.replace(old_sql, new_sql, 1))

test_path = Path('test/instagram-engagement-comment-provider-canary.test.ts')
test = test_path.read_text()
anchor = "  it('packages the canary runner into the production runtime image', () => {\n"
regression = '''  it('revalidates single-use authorization live before any provider-side setup', () => {
    expect(workflow).toContain(
      'ISSUE_JSON="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${ISSUE_NUMBER}")"',
    );
    expect(workflow).toContain('(.state == "open") and');
    expect(workflow).toContain('(.user.login == $owner)');
    expect(workflow).not.toContain("jq -r '.issue.body //");
  });

  it('treats NULL execution ids as unresolved ambiguity during execute', () => {
    expect(runner).toContain('and execution_id is distinct from $1');
    expect(runner).not.toContain('and execution_id <> $1');
  });

'''
if test.count(anchor) != 1:
    raise SystemExit('expected exactly one test insertion anchor')
test_path.write_text(test.replace(anchor, regression + anchor, 1))
