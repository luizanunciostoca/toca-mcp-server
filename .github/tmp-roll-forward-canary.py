from pathlib import Path
import json

policy_path = Path('control/marketing-autopilot-scheduler-policy.json')
policy = json.loads(policy_path.read_text(encoding='utf-8'))
daily = policy['dailyRollout']
daily['canaryContentItemId'] = 'MKT-20260916-SUNSET-FEED-1500'
daily['canaryScheduledAt'] = '2026-09-16T15:00:00-03:00'
daily['rollForwardFromContentItemId'] = 'MKT-20260916-SUNSET-FEED-0900'
daily['rollForwardReason'] = 'STALE_WINDOW_NO_SCHEDULE_RUN'
daily['rollForwardAuthorizedAt'] = '2026-09-16T09:30:03-03:00'
daily['rollForwardAuthority'] = 'USER_EXPLICIT_DAILY_PUBLICATION_AUTHORIZATION_2026-09-16'
policy['rollout']['allowedContentItemIds'] = ['MKT-20260916-SUNSET-FEED-1500']
policy_path.write_text(json.dumps(policy, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

test_path = Path('test/marketing-autopilot-scheduler-restoration.test.ts')
text = test_path.read_text(encoding='utf-8')
old_type = '''  dailyRollout?: {\n    canaryContentItemId?: string;\n    promoteToLimitedAfterVerifiedCanary?: boolean;'''
new_type = '''  dailyRollout?: {\n    canaryContentItemId?: string;\n    canaryScheduledAt?: string;\n    rollForwardFromContentItemId?: string;\n    rollForwardReason?: string;\n    promoteToLimitedAfterVerifiedCanary?: boolean;'''
if text.count(old_type) != 1:
    raise SystemExit('dailyRollout type marker mismatch')
text = text.replace(old_type, new_type, 1)

old_const = "const canaryId = 'MKT-20260916-SUNSET-FEED-0900';"
new_const = "const productionCanaryId = 'MKT-20260916-SUNSET-FEED-1500';\nconst canaryId = 'MKT-20260916-SUNSET-FEED-0900';"
if text.count(old_const) != 1:
    raise SystemExit('canary const marker mismatch')
text = text.replace(old_const, new_const, 1)

old_fixture = '''  const fixture = join(directory, 'registry.json');\n  writeFileSync(fixture, `${JSON.stringify(rows)}\\n`, 'utf8');\n  return spawnSync('node', [script, mode], {'''
new_fixture = '''  const fixture = join(directory, 'registry.json');\n  const policyFixture = join(directory, 'policy.json');\n  writeFileSync(fixture, `${JSON.stringify(rows)}\\n`, 'utf8');\n  const testPolicy = JSON.parse(JSON.stringify(policy)) as typeof policy;\n  if (!testPolicy.dailyRollout) throw new Error('AUTOPILOT_TEST_DAILY_ROLLOUT_REQUIRED');\n  testPolicy.dailyRollout.canaryContentItemId = canaryId;\n  testPolicy.dailyRollout.canaryScheduledAt = '2026-09-16T09:00:00-03:00';\n  writeFileSync(policyFixture, `${JSON.stringify(testPolicy)}\\n`, 'utf8');\n  return spawnSync('node', [script, mode], {'''
if text.count(old_fixture) != 1:
    raise SystemExit('fixture marker mismatch')
text = text.replace(old_fixture, new_fixture, 1)

old_env = '''      MARKETING_AUTOPILOT_REGISTRY_FIXTURE: fixture,\n      MARKETING_AUTOPILOT_NOW: now,'''
new_env = '''      MARKETING_AUTOPILOT_REGISTRY_FIXTURE: fixture,\n      MARKETING_AUTOPILOT_POLICY_PATH: policyFixture,\n      MARKETING_AUTOPILOT_NOW: now,'''
if text.count(old_env) != 1:
    raise SystemExit('env marker mismatch')
text = text.replace(old_env, new_env, 1)

old_expect = '''    expect(policy.dailyRollout).toMatchObject({\n      canaryContentItemId: canaryId,\n      promoteToLimitedAfterVerifiedCanary: true,'''
new_expect = '''    expect(policy.dailyRollout).toMatchObject({\n      canaryContentItemId: productionCanaryId,\n      canaryScheduledAt: '2026-09-16T15:00:00-03:00',\n      rollForwardFromContentItemId: canaryId,\n      rollForwardReason: 'STALE_WINDOW_NO_SCHEDULE_RUN',\n      promoteToLimitedAfterVerifiedCanary: true,'''
if text.count(old_expect) != 1:
    raise SystemExit('policy expectation marker mismatch')
text = text.replace(old_expect, new_expect, 1)

test_path.write_text(text, encoding='utf-8')
