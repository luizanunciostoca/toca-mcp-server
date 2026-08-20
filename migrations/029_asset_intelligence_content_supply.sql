create table if not exists asset_intelligence_assets (
  asset_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  sha256 char(64) not null unique,
  perceptual_hash bit(64) not null,
  source_asset_id text null references asset_intelligence_assets(asset_id),
  master_asset_id text null references asset_intelligence_assets(asset_id),
  lineage_kind text not null check (lineage_kind in ('SOURCE', 'DERIVATIVE', 'MASTER_CANDIDATE', 'MASTER')),
  master_state text not null check (master_state in ('NOT_MASTER', 'CANDIDATE', 'APPROVED_MASTER')),
  master_approval_evidence_id text null,
  rights_status text not null check (rights_status in ('UNKNOWN', 'CLEARED', 'RESTRICTED', 'EXPIRED', 'BLOCKED')),
  rights_expires_at timestamptz null,
  rights_scope jsonb not null default '[]'::jsonb,
  photographer text null,
  owner_name text null,
  venue_id text null,
  area text null,
  time_of_day text not null check (time_of_day in ('UNKNOWN', 'DAWN', 'DAY', 'GOLDEN_HOUR', 'SUNSET', 'NIGHT')),
  crowd_level text not null check (crowd_level in ('UNKNOWN', 'EMPTY', 'LOW', 'MEDIUM', 'HIGH', 'PACKED')),
  quality_score numeric(5,2) not null check (quality_score >= 0 and quality_score <= 100),
  feed_fitness numeric(5,2) not null check (feed_fitness >= 0 and feed_fitness <= 100),
  stories_fitness numeric(5,2) not null check (stories_fitness >= 0 and stories_fitness <= 100),
  reel_cover_fitness numeric(5,2) not null check (reel_cover_fitness >= 0 and reel_cover_fitness <= 100),
  ad_fitness numeric(5,2) not null check (ad_fitness >= 0 and ad_fitness <= 100),
  event_context jsonb not null default '[]'::jsonb,
  restrictions jsonb not null default '[]'::jsonb,
  marketing_readiness text not null check (marketing_readiness in ('NOT_READY', 'REVIEW_REQUIRED', 'READY')),
  creative_truth_venue_fidelity text not null check (creative_truth_venue_fidelity in ('UNKNOWN', 'VERIFIED', 'REJECTED')),
  creative_truth_brand_integrity text not null check (creative_truth_brand_integrity in ('UNKNOWN', 'VERIFIED', 'REJECTED')),
  creative_truth_final_eligibility text not null check (creative_truth_final_eligibility in ('UNKNOWN', 'VERIFIED', 'REJECTED')),
  creative_truth_evidence_ref text null,
  creative_truth_read_at timestamptz null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint asset_no_source_self_reference check (source_asset_id is null or source_asset_id <> asset_id),
  constraint asset_no_master_self_reference check (master_asset_id is null or master_asset_id <> asset_id),
  constraint asset_derivative_requires_source check (lineage_kind <> 'DERIVATIVE' or source_asset_id is not null),
  constraint asset_master_requires_approval check (lineage_kind <> 'MASTER' or master_state = 'APPROVED_MASTER'),
  constraint asset_approved_master_requires_evidence check (
    master_state <> 'APPROVED_MASTER' or master_approval_evidence_id is not null
  ),
  constraint asset_creative_truth_verified_requires_evidence check (
    creative_truth_final_eligibility <> 'VERIFIED' or creative_truth_evidence_ref is not null
  )
);

create index if not exists asset_intelligence_scope_idx
  on asset_intelligence_assets(tenant_id, workspace_id, organization_id);
create index if not exists asset_intelligence_venue_idx
  on asset_intelligence_assets(tenant_id, venue_id);
create index if not exists asset_intelligence_rights_idx
  on asset_intelligence_assets(tenant_id, rights_status, rights_expires_at);
create index if not exists asset_intelligence_creative_truth_idx
  on asset_intelligence_assets(
    tenant_id,
    creative_truth_venue_fidelity,
    creative_truth_brand_integrity,
    creative_truth_final_eligibility
  );

create table if not exists asset_intelligence_sources (
  asset_id text not null references asset_intelligence_assets(asset_id) on delete cascade,
  provider text not null,
  source_ref text not null,
  source_kind text not null,
  is_primary boolean not null default false,
  observed_at timestamptz not null,
  primary key (provider, source_ref)
);

create index if not exists asset_intelligence_sources_asset_idx
  on asset_intelligence_sources(asset_id, observed_at desc);

create table if not exists asset_intelligence_usage (
  usage_id text primary key,
  asset_id text not null references asset_intelligence_assets(asset_id) on delete cascade,
  content_item_id text not null,
  channel text not null,
  format text not null check (format in ('FEED', 'STORIES', 'REEL_COVER', 'AD')),
  used_at timestamptz not null,
  idempotency_key text not null unique
);

create index if not exists asset_intelligence_usage_asset_time_idx
  on asset_intelligence_usage(asset_id, used_at desc);
create index if not exists asset_intelligence_usage_content_idx
  on asset_intelligence_usage(content_item_id, used_at desc);

create table if not exists asset_intelligence_performance (
  performance_id text primary key,
  asset_id text not null references asset_intelligence_assets(asset_id) on delete cascade,
  channel text not null,
  observed_at timestamptz not null,
  performance_score numeric(5,2) not null check (performance_score >= 0 and performance_score <= 100),
  impressions bigint not null check (impressions >= 0),
  reach bigint not null check (reach >= 0),
  engagements bigint not null check (engagements >= 0),
  clicks bigint not null check (clicks >= 0),
  conversions bigint not null check (conversions >= 0)
);

create index if not exists asset_intelligence_performance_asset_time_idx
  on asset_intelligence_performance(asset_id, observed_at desc);
create index if not exists asset_intelligence_performance_score_idx
  on asset_intelligence_performance(asset_id, performance_score desc, observed_at desc);
