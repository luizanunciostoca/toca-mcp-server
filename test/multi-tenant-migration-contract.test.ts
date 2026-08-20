import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tenancyMigration = readFileSync(
  new URL('../migrations/027_multi_tenant_foundation.sql', import.meta.url),
  'utf8',
);
const crmMigration = readFileSync(new URL('../migrations/012_crm_core_records.sql', import.meta.url), 'utf8');
const workflowMigration = readFileSync(
  new URL('../migrations/007_durable_workflow_persistence.sql', import.meta.url),
  'utf8',
);
const eventMigration = readFileSync(new URL('../migrations/011_event_record.sql', import.meta.url), 'utf8');
const attributionMigration = readFileSync(
  new URL('../migrations/013_measurement_ticketing_attribution.sql', import.meta.url),
  'utf8',
);

describe('multi-tenant persistence contract', () => {
  it('retains tenant ownership in existing CRM, workflow, event and attribution roots', () => {
    expect(crmMigration).toContain('tenant_id text not null');
    expect(workflowMigration).toContain('tenant_id text not null');
    expect(eventMigration).toContain('tenant_id text not null');
    expect(attributionMigration).toContain('tenant_id text not null');
  });

  it('adds tenant configuration and exclusive ownership records', () => {
    for (const table of [
      'tenants',
      'tenant_configurations',
      'tenant_credential_bindings',
      'tenant_provider_bindings',
      'tenant_budget_envelopes',
      'tenant_policy_bindings',
      'tenant_approval_chain_bindings',
      'tenant_rbac_grants',
      'tenant_asset_registry_bindings',
      'tenant_analytics_namespaces',
      'tenant_quotas',
      'tenant_campaign_scopes',
    ]) {
      expect(tenancyMigration).toContain(`create table if not exists ${table}`);
    }
    expect(tenancyMigration).toContain('tenant_provider_bindings_account_owner_uq');
    expect(tenancyMigration).toContain('tenant_credential_bindings_secret_owner_uq');
    expect(tenancyMigration).toContain('unique (provider_id, connected_account_id, campaign_id)');
  });

  it('adds tenant ownership to legacy scheduler, publication, audit and approval roots', () => {
    for (const table of ['scheduled_jobs', 'provider_publications', 'audit_events', 'approval_records']) {
      expect(tenancyMigration).toContain(`alter table ${table}`);
    }
    expect(tenancyMigration).toContain("add column if not exists tenant_id text not null default 'toca'");
  });

  it('preserves append-only audit history while enforcing tenant on new writes', () => {
    expect(tenancyMigration).toContain('audit_ledger_events_tenant_required_new');
    expect(tenancyMigration).toContain('operational_signals_tenant_required_new');
    expect(tenancyMigration).toContain('check (tenant_id is not null) not valid');
  });

  it('contains same-tenant guards for parallel AG-01 and Asset Intelligence records', () => {
    expect(tenancyMigration).toContain('ag01_messages_tenant_conversation_fk');
    expect(tenancyMigration).toContain('asset_intelligence_source_same_tenant_fk');
    expect(tenancyMigration).toContain('asset_intelligence_master_same_tenant_fk');
  });
});
