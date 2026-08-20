-- Tenant-scope ApprovalRecord persistence without changing the canonical ApprovalRecord payload.
-- Migration 031 already introduced tenant_id on approval_records for V1 compatibility.

alter table approval_records
  add column if not exists tenant_id text not null default 'toca';

alter table approval_records
  add column if not exists workspace_id text not null default 'toca';

alter table approval_records
  add column if not exists organization_id text not null default 'toca';

create index if not exists approval_records_tenant_status_requested_idx
  on approval_records (
    tenant_id,
    workspace_id,
    organization_id,
    status,
    requested_at desc
  );

create index if not exists approval_records_tenant_correlation_idx
  on approval_records (
    tenant_id,
    workspace_id,
    organization_id,
    correlation_id,
    updated_at desc
  );


do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'approval_records_tenant_fk'
  ) then
    alter table approval_records
      add constraint approval_records_tenant_fk
      foreign key (tenant_id) references tenants (tenant_id) on delete restrict;
  end if;
end;
$$;
