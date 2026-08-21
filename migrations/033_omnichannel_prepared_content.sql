-- Provider-neutral immutable prepared-content authority for controlled Omnichannel outbound.
-- Serialized after 032. The historical 027 gap remains intentionally untouched.

create table if not exists omnichannel_prepared_content (
  prepared_content_ref text primary key,
  tenant_id text not null references tenants (tenant_id) on delete restrict,
  workspace_id text not null,
  organization_id text not null,
  content_kind text not null check (content_kind in ('EMAIL_CAMPAIGN', 'WHATSAPP_MESSAGE')),
  schema_version integer not null check (schema_version >= 1),
  payload jsonb not null,
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  check (length(trim(prepared_content_ref)) > 0),
  check (length(trim(workspace_id)) > 0),
  check (length(trim(organization_id)) > 0),
  check (jsonb_typeof(payload) = 'object'),
  check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0),
  unique (tenant_id, workspace_id, organization_id, content_kind, content_sha256)
);

create index if not exists omnichannel_prepared_content_scope_created_idx
  on omnichannel_prepared_content (
    tenant_id,
    workspace_id,
    organization_id,
    content_kind,
    created_at desc
  );

comment on table omnichannel_prepared_content is
  'Append-only provider-neutral prepared content. Runtime APIs intentionally expose no update/delete path.';
