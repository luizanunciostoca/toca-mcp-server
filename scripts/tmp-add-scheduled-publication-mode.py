from pathlib import Path

path = Path('scripts/marketing-publish-now.sh')
text = path.read_text(encoding='utf-8')

old_header = '''COMMAND_FILE="control/marketing-publish-now-command.json"
RUN_EVIDENCE="marketing-publish-now-run.json"'''
new_header = '''COMMAND_FILE="${COMMAND_FILE:-control/marketing-publish-now-command.json}"
PUBLICATION_POLICY_MODE="${PUBLICATION_POLICY_MODE:-FAST_PATH}"
case "$PUBLICATION_POLICY_MODE" in
  FAST_PATH|SCHEDULED) ;;
  *) echo "PUBLICATION_POLICY_MODE_INVALID:$PUBLICATION_POLICY_MODE" >&2; exit 1 ;;
esac
RUN_EVIDENCE="marketing-publish-now-run.json"'''
if text.count(old_header) != 1:
    raise SystemExit(f'header anchor count={text.count(old_header)}')
text = text.replace(old_header, new_header, 1)

old_policy = '''  local now_epoch issued_epoch age_seconds hashtag_count
  now_epoch="$(date +%s)"
  issued_epoch="$(date -d "$ISSUED_AT" +%s)"
  age_seconds=$((now_epoch - issued_epoch))
  test "$age_seconds" -ge -120
  test "$age_seconds" -le 1800

  printf '%s' "$CAPTION" | grep -Fq "$REQUIRED_CTA"
  hashtag_count="$(printf '%s\\n' "$CAPTION" | grep -oE '#[A-Za-z0-9_]+' | wc -l | tr -d ' ')"
  test "$hashtag_count" -eq 5

  if [ "$FORMAT" = "FEED_IMAGE" ]; then'''
new_policy = '''  local now_epoch issued_epoch age_seconds hashtag_count scheduled_epoch scheduled_delta scheduled_max_delay_seconds
  SCHEDULED_AT=""
  now_epoch="$(date +%s)"
  issued_epoch="$(date -d "$ISSUED_AT" +%s)"
  age_seconds=$((now_epoch - issued_epoch))
  test "$age_seconds" -ge -120
  test "$age_seconds" -le 1800

  if [ "$PUBLICATION_POLICY_MODE" = "FAST_PATH" ]; then
    printf '%s' "$CAPTION" | grep -Fq "$REQUIRED_CTA"
    hashtag_count="$(printf '%s\\n' "$CAPTION" | grep -oE '#[A-Za-z0-9_]+' | wc -l | tr -d ' ')"
    test "$hashtag_count" -eq 5
  else
    jq -e '
      .schedulingPolicy == "SCHEDULED_GCP" and
      (.scheduledAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}-03:00$"))
    ' "$COMMAND_FILE" >/dev/null
    SCHEDULED_AT="$(jq -r .scheduledAt "$COMMAND_FILE")"
    scheduled_epoch="$(date -d "$SCHEDULED_AT" +%s)"
    scheduled_delta=$((now_epoch - scheduled_epoch))
    scheduled_max_delay_seconds="${SCHEDULED_MAX_DELAY_SECONDS:-1800}"
    printf '%s' "$scheduled_max_delay_seconds" | grep -Eq '^[0-9]+$'
    test "$scheduled_max_delay_seconds" -ge 300
    test "$scheduled_max_delay_seconds" -le 1800
    test "$scheduled_delta" -ge 0
    test "$scheduled_delta" -le "$scheduled_max_delay_seconds"
  fi

  if [ "$FORMAT" = "FEED_IMAGE" ]; then'''
if text.count(old_policy) != 1:
    raise SystemExit(f'policy anchor count={text.count(old_policy)}')
text = text.replace(old_policy, new_policy, 1)

old_evidence = '''  write_run_evidence "COMMAND_VALIDATED" "$(jq -n --arg issuedAt "$ISSUED_AT" '{issuedAt:$issuedAt}')"'''
new_evidence = '''  write_run_evidence "COMMAND_VALIDATED" "$(jq -n \\
    --arg issuedAt "$ISSUED_AT" \\
    --arg policyMode "$PUBLICATION_POLICY_MODE" \\
    --arg scheduledAt "$SCHEDULED_AT" \\
    '{issuedAt:$issuedAt,policyMode:$policyMode} + (if $scheduledAt == "" then {} else {scheduledAt:$scheduledAt} end)')"'''
if text.count(old_evidence) != 1:
    raise SystemExit(f'evidence anchor count={text.count(old_evidence)}')
text = text.replace(old_evidence, new_evidence, 1)

path.write_text(text, encoding='utf-8')
