create table if not exists approval_records (
  approval_id text primary key,
  requester text not null,
  approver text,
  route_id text not null check (route_id ~ '^R(0[1-9]|[12][0-9]|3[0-2])$'),
  capability_id text not null,
  descriptor_sha256 text not null check (descriptor_sha256 ~ '^[a-f0-9]{64}$'),
  target_account text not null,
  scope jsonb not null check (jsonb_typeof(scope) = 'array' and jsonb_array_length(scope) > 0),
  financial_ceiling jsonb check (
    financial_ceiling is null or (
      jsonb_typeof(financial_ceiling) = 'object'
      and financial_ceiling ? 'amountMinor'
      and financial_ceiling ? 'currency'
    )
  ),
  requested_at timestamptz not null,
  issued_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  status text not null check (status in ('REQUESTED','APPROVED','CONSUMED','REVOKED','EXPIRED')),
  evidence jsonb not null check (
    jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) > 0
  ),
  correlation_id text not null,
  version integer not null check (version > 0),
  updated_at timestamptz not null default now(),
  check (expires_at > requested_at),
  check (status not in ('APPROVED', 'CONSUMED') or (approver is not null and issued_at is not null)),
  check (status <> 'CONSUMED' or consumed_at is not null),
  check (status <> 'REVOKED' or revoked_at is not null)
);

create index if not exists approval_records_status_expiry_idx
  on approval_records (status, expires_at);

create index if not exists approval_records_correlation_idx
  on approval_records (correlation_id, updated_at desc);

create table if not exists approval_record_history (
  approval_id text not null references approval_records (approval_id) on delete restrict,
  version integer not null,
  record jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (approval_id, version)
);
