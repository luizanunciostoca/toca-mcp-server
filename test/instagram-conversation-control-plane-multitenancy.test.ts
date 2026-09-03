import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'migrations/040_instagram_conversation_control_plane_multitenancy.sql',
  'utf8',
);

describe('Instagram conversation control-plane multitenancy hardening', () => {
  it('creates a tenant, workspace and organization scoped FAQ analytics surface', () => {
    expect(migration).toContain(
      'create table if not exists instagram_engagement_faq_signals_scoped',
    );
    expect(migration).toContain('tenant_id text not null');
    expect(migration).toContain('workspace_id text not null');
    expect(migration).toContain('organization_id text not null');
    expect(migration).toContain(
      'primary key (tenant_id, workspace_id, organization_id, normalized_question_sha256)',
    );
    expect(migration).toContain('instagram_engagement_faq_signals_scoped_frequency_idx');
  });

  it('creates scoped classifier feedback and response QA surfaces', () => {
    expect(migration).toContain(
      'create table if not exists instagram_engagement_classification_feedback_scoped',
    );
    expect(migration).toContain(
      'create table if not exists instagram_engagement_response_qa_scoped',
    );
    expect(migration).toContain('instagram_engagement_classification_feedback_scoped_matrix_idx');
    expect(migration).toContain('instagram_engagement_response_qa_scoped_reviewed_idx');
  });

  it('does not mutate the legacy analytics table keys during scoped rollout', () => {
    expect(migration).not.toContain('alter table instagram_engagement_faq_signals');
    expect(migration).not.toContain('alter table instagram_engagement_classification_feedback');
    expect(migration).not.toContain('alter table instagram_engagement_response_qa');
    expect(migration).not.toContain('drop constraint');
  });
});
