from pathlib import Path

workflow_path = Path('.github/workflows/instagram-engagement-comment-canary-opportunity-watch.yml')
text = workflow_path.read_text()
old_timeout = '''          if [[ "$MARKERS_COMPLETE" != 'true' ]]; then
            echo "COMMENT_CANARY_OPPORTUNITY_WATCH=BLOCKED_LOG_PROPAGATION" >&2
            exit 1
          fi
'''
new_timeout = '''          if [[ "$MARKERS_COMPLETE" != 'true' ]]; then
            echo 'status=BLOCKED_LOG_PROPAGATION' >> "$GITHUB_OUTPUT"
            echo 'COMMENT_CANARY_OPPORTUNITY_WATCH=BLOCKED_LOG_PROPAGATION' >> "$GITHUB_STEP_SUMMARY"
            echo 'WATCH_REMAINS_ACTIVE=true' >> "$GITHUB_STEP_SUMMARY"
            echo 'PROVIDER_CALLS=false' >> "$GITHUB_STEP_SUMMARY"
            echo 'EXTERNAL_REPLY_WRITES=false' >> "$GITHUB_STEP_SUMMARY"
            exit 0
          fi
'''
if text.count(old_timeout) != 1:
    raise SystemExit(f'timeout block count={text.count(old_timeout)}')
text = text.replace(old_timeout, new_timeout, 1)
anchor = '''          close_watch() {
            local terminal_status="$1"
'''
idx = text.index(anchor, text.index('- name: Handle sanitized eligibility decision'))
insert_at = text.index("          if [[ \"$STATUS\" = 'NO_ELIGIBLE_TARGET' ]]; then", idx)
blocked_branch = '''          if [[ "$STATUS" = 'BLOCKED_LOG_PROPAGATION' ]]; then
            echo 'COMMENT_CANARY_OPPORTUNITY_WATCH_RESULT=BLOCKED_LOG_PROPAGATION' >> "$GITHUB_STEP_SUMMARY"
            echo 'WATCH_REMAINS_ACTIVE=true' >> "$GITHUB_STEP_SUMMARY"
            echo 'PROVIDER_CALLS=false' >> "$GITHUB_STEP_SUMMARY"
            echo 'EXTERNAL_REPLY_WRITES=false' >> "$GITHUB_STEP_SUMMARY"
            exit 0
          fi

'''
text = text[:insert_at] + blocked_branch + text[insert_at:]
workflow_path.write_text(text)

test_path = Path('test/instagram-engagement-comment-canary-opportunity-watch.test.ts')
test_text = test_path.read_text()
needle = "    expect(workflow).toContain('COMMENT_CANARY_OPPORTUNITY_WATCH=BLOCKED_LOG_PROPAGATION');\n"
replacement = needle + "    expect(workflow).toContain(\"echo 'status=BLOCKED_LOG_PROPAGATION' >> \\\"$GITHUB_OUTPUT\\\"\");\n    expect(workflow).toContain('COMMENT_CANARY_OPPORTUNITY_WATCH_RESULT=BLOCKED_LOG_PROPAGATION');\n    expect(workflow).toContain('WATCH_REMAINS_ACTIVE=true');\n"
if test_text.count(needle) != 1:
    raise SystemExit(f'test needle count={test_text.count(needle)}')
test_text = test_text.replace(needle, replacement, 1)
test_path.write_text(test_text)
