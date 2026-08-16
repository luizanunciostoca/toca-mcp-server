create table if not exists content_video_artifacts (
  artifact_id text primary key,
  artifact_ref text not null unique,
  tenant_id text not null,
  workspace_id text not null,
  organization_id text not null,
  content_item_id text not null references content_items (content_item_id) on delete restrict,
  version_id text not null references content_item_versions (version_id) on delete restrict,
  capability_id text not null,
  idempotency_key text not null,
  payload_sha256 text not null,
  payload jsonb not null,
  evidence jsonb not null,
  correlation_id text not null,
  created_at timestamptz not null,
  unique (content_item_id, capability_id, idempotency_key),
  check (length(trim(artifact_id)) > 0),
  check (length(trim(artifact_ref)) > 0),
  check (length(trim(tenant_id)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (length(trim(capability_id)) > 0),
  check (length(trim(idempotency_key)) > 0),
  check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  check (jsonb_typeof(payload) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  check (length(trim(correlation_id)) > 0)
);

create index if not exists content_video_artifacts_lineage_idx
  on content_video_artifacts (content_item_id, version_id, created_at, artifact_id);

create index if not exists content_video_artifacts_capability_idx
  on content_video_artifacts (capability_id, created_at, artifact_id);

create or replace function reject_content_video_artifact_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'CONTENT_VIDEO_ARTIFACT_MUTATION_FORBIDDEN';
end;
$$;

drop trigger if exists content_video_artifacts_append_only on content_video_artifacts;
create trigger content_video_artifacts_append_only
before update or delete on content_video_artifacts
for each row execute function reject_content_video_artifact_mutation();
