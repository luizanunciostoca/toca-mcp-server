from pathlib import Path

workflow_path = Path('.github/workflows/instagram-engagement-comment-canary-opportunity-watch.yml')
text = workflow_path.read_text()
anchor = text.index('      - name: Parse only sanitized eligibility markers')
start = text.index('          LOGS="$(gcloud logging read', anchor)
end = text.index('          read_single_marker() {', start)
replacement = '''          SAFE_LINES=''
          MARKERS_COMPLETE=false
          POLL_ATTEMPTS=0
          required_markers=(
            INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_ELIGIBILITY
            RECENT_COMMENT_COUNT STATE_CANDIDATE_COUNT ELIGIBLE_COUNT ELIGIBLE_TARGET_SHA256
            UNRESOLVED_AMBIGUITY_COUNT ACTIVE_RESERVATION_COUNT
            REJECTED_SCOPE REJECTED_AGE REJECTED_CONFIDENCE REJECTED_PRIORITY
            REJECTED_SENSITIVE REJECTED_COMMERCIAL REJECTED_URGENCY
            REJECTED_KNOWLEDGE REJECTED_POLICY
            CANARY_CHANNEL READ_ONLY_ELIGIBILITY DATABASE_MUTATIONS PROVIDER_CALLS
            EXTERNAL_REPLY_WRITES RAW_USER_DATA_LOGGED
          )

          for attempt in 1 2 3 4 5 6; do
            POLL_ATTEMPTS="$attempt"
            if ! LOGS="$(gcloud logging read "resource.type=\\"cloud_run_job\\" AND resource.labels.job_name=\\"${JOB}\\"" \\
              --project "$GCP_PROJECT_ID" --freshness=1h --limit=300 --order=desc --format=json 2>/dev/null)"; then
              LOGS='[]'
            fi
            SAFE_LINES="$(jq -r '.[] | (.textPayload // .jsonPayload.message // empty)' <<< "$LOGS" \\
              | grep -E '^(INSTAGRAM_ENGAGEMENT_COMMENT_CANARY_ELIGIBILITY|RECENT_COMMENT_COUNT|STATE_CANDIDATE_COUNT|ELIGIBLE_COUNT|ELIGIBLE_TARGET_SHA256|UNRESOLVED_AMBIGUITY_COUNT|ACTIVE_RESERVATION_COUNT|REJECTED_[A-Z_]+|CANARY_CHANNEL|READ_ONLY_ELIGIBILITY|DATABASE_MUTATIONS|PROVIDER_CALLS|EXTERNAL_REPLY_WRITES|RAW_USER_DATA_LOGGED)=' \\
              || true)"

            MARKERS_COMPLETE=true
            for marker in "${required_markers[@]}"; do
              count="$(grep -c "^${marker}=" <<< "$SAFE_LINES" || true)"
              if [[ "$count" != '1' ]]; then
                MARKERS_COMPLETE=false
                break
              fi
            done
            if [[ "$MARKERS_COMPLETE" == 'true' ]]; then
              break
            fi
            if [[ "$attempt" != '6' ]]; then
              sleep 10
            fi
          done

          if [[ "$MARKERS_COMPLETE" != 'true' ]]; then
            echo "COMMENT_CANARY_OPPORTUNITY_WATCH=BLOCKED_LOG_PROPAGATION" >&2
            exit 1
          fi

'''
text = text[:start] + replacement + text[end:]
old = '''          if [[ "$STATUS" = 'READY' ]]; then
            test "$ELIGIBLE_COUNT" = '1'
            test "$AMBIGUITY_COUNT" = '0'
            test "$RESERVATION_COUNT" = '0'
            [[ "$TARGET_SHA" =~ ^[0-9a-f]{64}$ ]]
          fi
'''
new = '''          if [[ "$STATUS" = 'READY' ]]; then
            test "$ELIGIBLE_COUNT" = '1'
            test "$AMBIGUITY_COUNT" = '0'
            test "$RESERVATION_COUNT" = '0'
            [[ "$TARGET_SHA" =~ ^[0-9a-f]{64}$ ]]
          else
            test "$TARGET_SHA" = 'NONE'
          fi
'''
if text.count(old) != 1:
    raise SystemExit(f'READY target block count={text.count(old)}')
text = text.replace(old, new, 1)
workflow_path.write_text(text)

test_path = Path('test/instagram-engagement-comment-canary-opportunity-watch.test.ts')
test_text = test_path.read_text()
insert_before = "  it('creates only a sanitized opportunity and never dispatches or performs a real canary', () => {"
regression = '''  it('polls Cloud Logging boundedly and treats transient reads as retryable evidence gaps', () => {
    expect(workflow).toContain('for attempt in 1 2 3 4 5 6; do');
    expect(workflow).toContain('sleep 10');
    expect(workflow).toContain('--order=desc');
    expect(workflow).not.toContain('--order=asc');
    expect(workflow).toContain('if ! LOGS="$(gcloud logging read');
    expect(workflow).toContain("LOGS='[]'");
    expect(workflow).toContain('MARKERS_COMPLETE=false');
    expect(workflow).toContain("if [[ \\"$count\\" != '1' ]]");
    expect(workflow).toContain('COMMENT_CANARY_OPPORTUNITY_WATCH=BLOCKED_LOG_PROPAGATION');
    expect(workflow).toContain('test "$TARGET_SHA" = \\'NONE\\'');
  });

'''
if test_text.count(insert_before) != 1:
    raise SystemExit(f'test anchor count={test_text.count(insert_before)}')
test_text = test_text.replace(insert_before, regression + insert_before, 1)
test_path.write_text(test_text)
