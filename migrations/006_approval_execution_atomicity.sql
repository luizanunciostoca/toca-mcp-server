alter table approval_records
  add column if not exists reservation_execution_id text,
  add column if not exists reservation_principal_id text,
  add column if not exists reservation_correlation_id text,
  add column if not exists reserved_at timestamptz,
  add column if not exists executing_at timestamptz,
  add column if not exists provider_readback_at timestamptz,
  add column if not exists provider_readback_evidence jsonb not null default '[]'::jsonb,
  add column if not exists released_at timestamptz,
  add column if not exists release_reason text,
  add column if not exists failed_review_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidation_reason text;

alter table approval_records
  drop constraint if exists approval_records_status_check;

alter table approval_records
  add constraint approval_records_status_check check (
    status in (
      'REQUESTED',
      'APPROVED',
      'RESERVED',
      'EXECUTING',
      'PROVIDER_READBACK',
      'CONSUMED',
      'RELEASED',
      'FAILED_REVIEW_REQUIRED',
      'INVALIDATED',
      'REVOKED',
      'EXPIRED'
    )
  );

-- Historical CONSUMED rows created before M-FOUND-05 do not have reservation/readback
-- columns. Preserve those rows while requiring every new execution-lifecycle state to
-- carry its atomic reservation binding. Application code forbids direct writes into a
-- new CONSUMED state, so this compatibility exception cannot authorize new bypasses.
alter table approval_records
  drop constraint if exists approval_records_execution_binding_check;

alter table approval_records
  add constraint approval_records_execution_binding_check check (
    status not in (
      'RESERVED',
      'EXECUTING',
      'PROVIDER_READBACK',
      'RELEASED',
      'FAILED_REVIEW_REQUIRED'
    )
    and not (status = 'CONSUMED' and reservation_execution_id is not null)
    or (
      reservation_execution_id is not null
      and reservation_principal_id is not null
      and reservation_correlation_id is not null
      and reserved_at is not null
    )
  );

alter table approval_records
  drop constraint if exists approval_records_execution_started_check;

alter table approval_records
  add constraint approval_records_execution_started_check check (
    status not in ('EXECUTING', 'PROVIDER_READBACK', 'FAILED_REVIEW_REQUIRED')
    and not (status = 'CONSUMED' and reservation_execution_id is not null)
    or executing_at is not null
  );

alter table approval_records
  drop constraint if exists approval_records_provider_readback_check;

alter table approval_records
  add constraint approval_records_provider_readback_check check (
    status <> 'PROVIDER_READBACK'
    and not (status = 'CONSUMED' and reservation_execution_id is not null)
    or (
      provider_readback_at is not null
      and jsonb_typeof(provider_readback_evidence) = 'array'
      and jsonb_array_length(provider_readback_evidence) > 0
    )
  );

alter table approval_records
  drop constraint if exists approval_records_release_check;

alter table approval_records
  add constraint approval_records_release_check check (
    status <> 'RELEASED'
    or (released_at is not null and release_reason is not null and length(trim(release_reason)) > 0)
  );

alter table approval_records
  drop constraint if exists approval_records_failed_review_check;

alter table approval_records
  add constraint approval_records_failed_review_check check (
    status <> 'FAILED_REVIEW_REQUIRED'
    or (
      failed_review_at is not null
      and failure_reason is not null
      and length(trim(failure_reason)) > 0
    )
  );

alter table approval_records
  drop constraint if exists approval_records_invalidation_check;

alter table approval_records
  add constraint approval_records_invalidation_check check (
    status <> 'INVALIDATED'
    or (
      invalidated_at is not null
      and invalidation_reason is not null
      and length(trim(invalidation_reason)) > 0
    )
  );

alter table approval_records
  drop constraint if exists approval_records_execution_issued_check;

alter table approval_records
  add constraint approval_records_execution_issued_check check (
    status not in (
      'RESERVED',
      'EXECUTING',
      'PROVIDER_READBACK',
      'RELEASED',
      'FAILED_REVIEW_REQUIRED'
    )
    and not (status = 'CONSUMED' and reservation_execution_id is not null)
    or (approver is not null and issued_at is not null)
  );

create table if not exists approval_execution_claims (
  execution_id text primary key,
  approval_id text not null references approval_records (approval_id) on delete restrict,
  principal_id text not null,
  correlation_id text not null,
  claimed_at timestamptz not null,
  check (length(trim(execution_id)) > 0),
  check (length(trim(principal_id)) > 0),
  check (length(trim(correlation_id)) > 0)
);

create index if not exists approval_execution_claims_approval_idx
  on approval_execution_claims (approval_id, claimed_at desc);

create index if not exists approval_records_execution_status_idx
  on approval_records (status, reserved_at desc)
  where status in ('RESERVED', 'EXECUTING', 'PROVIDER_READBACK', 'FAILED_REVIEW_REQUIRED');
