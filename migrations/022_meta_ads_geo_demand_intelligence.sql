create table if not exists meta_ads_geo_audience_samples (
  sample_id bigserial primary key,
  tenant_id text not null,
  ad_account_id text not null,
  geo_key text not null,
  lower_bound bigint not null check (lower_bound >= 0),
  upper_bound bigint not null check (upper_bound >= lower_bound),
  midpoint numeric(20,4) not null check (midpoint >= 0),
  estimate_ready boolean not null,
  optimization_goal text not null,
  targeting_spec jsonb not null,
  observed_at timestamptz not null,
  hour_bucket timestamptz not null,
  quality_confidence numeric(5,4) not null check (
    quality_confidence >= 0 and quality_confidence <= 1
  ),
  created_at timestamptz not null default now(),
  unique (tenant_id, ad_account_id, geo_key, observed_at)
);

create index if not exists meta_ads_geo_audience_samples_lookup_idx
  on meta_ads_geo_audience_samples (tenant_id, ad_account_id, geo_key, observed_at desc);

create index if not exists meta_ads_geo_audience_samples_hour_bucket_idx
  on meta_ads_geo_audience_samples (tenant_id, ad_account_id, geo_key, hour_bucket desc);
