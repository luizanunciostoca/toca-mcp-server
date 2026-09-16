from pathlib import Path
import re
import textwrap

registry = Path('scripts/marketing-autopilot-registry.mjs')
text = registry.read_text()
text, count = re.subn(
    r"async function recordPrecheck\(\) \{.*?\n\}\n\n(?=async function reconcilePublication\(\) \{)",
    '''async function recordPrecheck() {
  const sheet = await readContentSheet();
  const item = findRow(sheet, contentItemId).object;
  const scheduledAt = text(item.scheduled_at);
  const schedulingStatus = text(item.scheduling_status);
  assert(scheduledAt, 'AUTOPILOT_PRECHECK_SCHEDULED_AT_REQUIRED');
  assert(
    schedulingStatus === 'CANARY_READY' || schedulingStatus === 'LIMITED_READY_AFTER_CANARY',
    `AUTOPILOT_PRECHECK_SCHEDULING_STATUS_INVALID:${schedulingStatus}`,
  );
  const now = formatBahia(new Date());
  await appendSchedulerLog([
    `AUTOPILOT-PRECHECK-${process.env.GITHUB_RUN_ID ?? 'local'}`,
    now,
    contentItemId,
    process.env.GITHUB_RUN_ID ?? '',
    'GITHUB_ACTIONS_CONTROL_PLANE',
    scheduledAt,
    'PRECHECK',
    schedulingStatus,
    '0',
    '0',
    '',
    'NOT_CALLED',
    '',
    '',
    `run=${process.env.GITHUB_RUN_ID ?? ''};sha=${process.env.GITHUB_SHA ?? ''};provider_called=false;writer=${policy.canonicalWriter.workflow}`,
    policy.policyId,
  ]);
}

''',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'recordPrecheck mismatch count={count}')
text, count = re.subn(
    r"  assert\(\s*text\(row\.object\.master_drive_file_id\) === command\.driveFileId,\s*'AUTOPILOT_REGISTRY_DRIVE_FILE_DRIFT',\s*\);",
    '''  const deliveryDriveFileId =
    text(row.object.format) === 'STORY'
      ? text(row.object.story_drive_file_id)
      : text(row.object.master_drive_file_id);
  assert(deliveryDriveFileId === command.driveFileId, 'AUTOPILOT_REGISTRY_DRIVE_FILE_DRIFT');''',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f'drive binding mismatch count={count}')
legacy = "'GCP_PUBLISH_NOW_AUTOPILOT_CANARY'"
if text.count(legacy) != 2:
    raise SystemExit(f'legacy policy mismatch count={text.count(legacy)}')
registry.write_text(text.replace(legacy, 'policy.policyId'))

workflow = Path('.github/workflows/marketing-autopilot-publication.yml')
text = workflow.read_text()
start_marker = '''          baseline_run_id="$(jq -r '.rollout.providerReconciliationBaseline.runId' "$POLICY_PATH")"'''
end_marker = '''          gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${CANONICAL_WRITER_WORKFLOW}/runs?per_page=100" > /tmp/writer-runs.json'''
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit(f'baseline markers missing start={start} end={end}')
baseline_block = '''baseline_run_id="$(jq -r '.rollout.providerReconciliationBaseline.runId' "$POLICY_PATH")"
baseline_completed_at="$(jq -r '.rollout.providerReconciliationBaseline.completedAt' "$POLICY_PATH")"
baseline_content_item="$(jq -r '.rollout.providerReconciliationBaseline.contentItemId' "$POLICY_PATH")"
if [ "$baseline_content_item" = "$CONTENT_ITEM_ID" ]; then
  gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${baseline_run_id}" > /tmp/baseline-run.json
  jq -e \\
    --arg completed "$baseline_completed_at" '
      .name == "Instagram GCP Publication Recovery Preflight" and
      .status == "completed" and
      .conclusion == "success" and
      .updated_at == $completed
    ' /tmp/baseline-run.json >/dev/null
  echo "MARKETING_AUTOPILOT_PROVIDER_BASELINE=VERIFIED run_id=$baseline_run_id"
else
  baseline_completed_at='1970-01-01T00:00:00Z'
  baseline_run_id='NONE'
  echo 'MARKETING_AUTOPILOT_PROVIDER_BASELINE=NOT_APPLICABLE_STRICT_HISTORY_SCAN'
fi

'''
replacement = textwrap.indent(baseline_block, '          ')
workflow.write_text(text[:start] + replacement + text[end:])

test_path = Path('test/marketing-autopilot-scheduler-restoration.test.ts')
text = test_path.read_text()
title = "it('rejects an unapproved Story final instead of falling back to a source asset'"
start = text.find(title)
block_start = text.find('    expect(parseOutput(result.stdout)).toMatchObject({', start)
block_end = text.find('    });', block_start)
if min(start, block_start, block_end) < 0:
    raise SystemExit('Story assertion structural markers missing')
block_end += len('    });')
replacement = '''    const output = parseOutput(result.stdout);
    expect(output).toMatchObject({ status: 'NO_CANDIDATE', rolloutPhase: 'LIMITED' });
    if (typeof output !== 'object' || output === null || !('rejected' in output)) {
      throw new Error('AUTOPILOT_TEST_REJECTIONS_MISSING');
    }
    const rejected = (output as { rejected?: unknown }).rejected;
    expect(Array.isArray(rejected)).toBe(true);
    const storyRejected = (rejected as unknown[]).some((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const record = item as Record<string, unknown>;
      return record.contentItemId === storyId && record.reason === 'AUTOPILOT_STORY_STATUS_INVALID';
    });
    expect(storyRejected).toBe(true);'''
test_path.write_text(text[:block_start] + replacement + text[block_end:])
