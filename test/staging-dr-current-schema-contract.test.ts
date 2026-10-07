import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/staging-dr-current-schema.yml', 'utf8');
const bootstrap = readFileSync('ops/staging-dr/bootstrap.sh', 'utf8');
const drill = readFileSync('ops/staging-dr/drill.sh', 'utf8');
const psqlShim = readFileSync('ops/staging-dr/psql-shim.sh', 'utf8');

describe('current-schema staging DR harness', () => {
  it('is manual-only and requires an explicit owner-authored authorization issue', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('branches:');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).toContain('authorization_issue:');
    expect(workflow).toContain("require_exact_line_once 'DR_EXECUTION_AUTHORIZATION=ACTIVE'");
    expect(workflow).toContain("require_exact_line_once 'AUTHORIZATION_STATE=ACTIVE'");
    expect(workflow).toContain(
      "require_exact_line_absent 'DR_EXECUTION_AUTHORIZATION=PENDING'",
    );
    expect(workflow).toContain(
      "require_exact_line_absent 'AUTHORIZATION_STATE=PENDING_HUMAN_APPROVAL'",
    );
    expect(workflow).toContain(
      "require_exact_line_absent 'FINANCIAL_CEILING=PENDING_OWNER_APPROVAL'",
    );
    expect(workflow).toContain("grep -c '^FINANCIAL_CEILING='");
    expect(workflow).toContain('^(USD|BRL):([0-9]+([.][0-9]{1,2})?)');
    expect(workflow).not.toContain("grep -Fxq 'DR_EXECUTION_AUTHORIZATION=ACTIVE'");
    expect(workflow).toContain('AUTHORIZED_CANDIDATE_SHA=$CANDIDATE_SHA');
    expect(workflow).toContain('AUTHORIZED_ENVIRONMENT=toca-mcp-next-staging');
    expect(workflow).toContain('PRODUCTION_MUTATION_AUTHORIZED=false');
    expect(workflow).toContain('PROVIDER_MUTATION_AUTHORIZED=false');
  });

  it('binds execution to exact main, exact repository migration set and staging only', () => {
    expect(workflow).toContain('test "$CANDIDATE_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('expected_max_migration:');
    expect(bootstrap).toContain('[[ "$PROJECT_ID" == \'toca-mcp-next-staging\' ]]');
    expect(bootstrap).toContain('[[ "$SOURCE_INSTANCE" == \'toca-mcp-next-staging-db\' ]]');
    expect(bootstrap).toContain('[[ "$PROJECT_ID" != "$PRODUCTION_PROJECT_ID" ]]');
    expect(drill).toContain(
      'diff -u /tmp/repo-migrations.txt dr-v3-evidence/restored-migrations.txt',
    );
    expect(drill).toContain(
      '[[ "$(tail -n1 /tmp/repo-migrations.txt)" == "$EXPECTED_MAX_MIGRATION" ]]',
    );
    expect(drill).toContain(
      '[[ "$(tail -n1 dr-v3-evidence/restored-migrations.txt)" == "$EXPECTED_MAX_MIGRATION" ]]',
    );
    expect(drill).toContain("! grep -Eq '^027_' dr-v3-evidence/restored-migrations.txt");
  });

  it('covers the critical tables and append-only triggers added after migration 033', () => {
    for (const table of [
      'instagram_engagement_actions',
      'instagram_engagement_knowledge',
      'instagram_engagement_knowledge_documents',
      'instagram_engagement_knowledge_chunks',
      'instagram_engagement_threads',
      'instagram_engagement_message_groups',
      'instagram_engagement_human_queue',
      'instagram_engagement_follow_up_queue',
      'instagram_engagement_faq_signals_scoped',
      'instagram_engagement_classification_feedback_scoped',
      'instagram_engagement_response_qa_scoped',
      'finops_cost_events',
      'finops_billing_snapshots',
    ]) {
      expect(drill).toContain(table);
    }
    expect(drill).toContain('finops_cost_events_append_only');
    expect(drill).toContain('finops_billing_snapshots_append_only');
  });

  it('keeps provider/production/secret payload mutation outside the drill', () => {
    expect(drill).toContain('productionMutation:false');
    expect(drill).toContain('providerMutation:false');
    expect(drill).toContain('trafficMutation:false');
    expect(drill).toContain('secretManagerRead:false');
    expect(drill).toContain('secretManagerMutation:false');
    expect(workflow).toContain('graph\\.facebook\\.com');
    expect(workflow).toContain('api\\.sendgrid\\.com');
    expect(workflow).toContain('googleads\\.googleapis\\.com');
  });

  it('keeps temporary-target and IAM cleanup mandatory', () => {
    expect(workflow).toContain('cleanup-target:');
    expect(workflow).toContain('cleanup-iam:');
    expect(workflow).toContain('test "$D" = success');
    expect(workflow).toContain('test "$E" = success');
    expect(drill).toContain('[[ "$TARGET_INSTANCE" != "$SOURCE_INSTANCE" ]]');
  });

  it('uses schema presence for app DB discovery instead of a historical hardcoded migration', () => {
    expect(psqlShim).toContain('select 1 from schema_migrations where version=');
    expect(psqlShim).not.toContain('033_omnichannel_prepared_content.sql');
    expect(psqlShim).not.toContain('033_omnichannel_prepared_content.sql');
  });
});
