import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'migrations/040_instagram_conversation_control_plane_multitenancy.sql',
  'utf8',
);

describe('Instagram conversation control-plane multitenancy hardening', () => {
  it('scopes FAQ signals by tenant, workspace and organization', () => {
    expect(migration).toContain('alter table instagram_engagement_faq_signals');
    expect(migration).toContain('tenant_id text');
    expect(migration).toContain('workspace_id text');
    expect(migration).toContain('organization_id text');
    expect(migration).toContain(
      'add primary key (tenant_id, workspace_id, organization_id, normalized_question_sha256)',
    );
  });

  it('scopes classifier feedback and response QA by tenant, workspace and organization', () => {
    expect(migration).toContain('alter table instagram_engagement_classification_feedback');
    expect(migration).toContain('alter table instagram_engagement_response_qa');
    expect(migration).toContain('instagram_engagement_classification_feedback_scope_matrix_idx');
    expect(migration).toContain('instagram_engagement_response_qa_scope_reviewed_idx');
  });

  it('keeps the migration fail-closed on missing scope after backfill', () => {
    expect(migration).toContain('alter column tenant_id set not null');
    expect(migration).toContain('alter column workspace_id set not null');
    expect(migration).toContain('alter column organization_id set not null');
  });
});
