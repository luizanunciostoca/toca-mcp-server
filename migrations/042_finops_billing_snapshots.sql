create table if not exists finops_billing_snapshots (
  snapshot_id text primary key check (btrim(snapshot_id) <> ''),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  tenant_id text not null check (btrim(tenant_id) <> ''),
  workspace_id text not null check (btrim(workspace_id) <> ''),
  organization_id text not null check (btrim(organization_id) <> ''),
  provider text not null check (btrim(provider) <> ''),
  model text check (model is null or btrim(model) <> ''),
  category text not null check (category in (
    'AI_TEXT','AI_IMAGE','AI_VIDEO','COMPUTE','STORAGE','NETWORK','MEDIA_SPEND','OTHER'
  )),
  campaign_id text check (campaign_id is null or btrim(campaign_id) <> ''),
  period_start timestamptz not null,
  period_end timestamptz not null,
  currency text not null check (currency = 'USD'),
  billed_cost_micro_usd bigint not null check (
    billed_cost_micro_usd between 0 and 9007199254740991
  ),
  evidence_ref text not null check (
    btrim(evidence_ref) <> '' and char_length(evidence_ref) <= 256
  ),
  observed_at timestamptz not null,
  check (period_end > period_start)
);

create index if not exists finops_billing_snapshots_scope_period_idx
  on finops_billing_snapshots (
    tenant_id, workspace_id, organization_id, period_start, period_end
  );
create index if not exists finops_billing_snapshots_provider_period_idx
  on finops_billing_snapshots (provider, category, period_start, period_end);
create index if not exists finops_billing_snapshots_campaign_period_idx
  on finops_billing_snapshots (campaign_id, period_start, period_end)
  where campaign_id is not null;

create or replace function reject_finops_billing_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'FINOPS_BILLING_SNAPSHOT_APPEND_ONLY';
end;
$$;

drop trigger if exists finops_billing_snapshots_append_only on finops_billing_snapshots;
create trigger finops_billing_snapshots_append_only
before update or delete on finops_billing_snapshots
for each row execute function reject_finops_billing_snapshot_mutation();

comment on table finops_billing_snapshots is
  'Append-only external billing evidence for read-only FinOps reconciliation. USD only until governed FX support exists.';
