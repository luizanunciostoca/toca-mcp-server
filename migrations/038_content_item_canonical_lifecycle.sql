-- Canonical TOCA OS content lifecycle migration.
-- Normal path:
-- PLANNED -> SOURCE_BOUND -> BRIEFED -> PRODUCED -> QA_PASS -> APPROVED ->
-- SCHEDULER_READY -> TOCA_SCHEDULED -> PUBLISHED -> RECONCILED.
-- CANCELED remains an exceptional terminal off-ramp.
-- MISSED_WINDOW and SUPERSEDED are operational dispositions, not lifecycle states.

alter table content_items
  add column if not exists operational_disposition text not null default 'ACTIVE';

update content_items
set operational_disposition = case
  when state = 'CANCELED' then 'CANCELED'
  else operational_disposition
end;

-- Normalize persisted legacy states before tightening the check constraint.
update content_items
set state = case state
  when 'IN_PRODUCTION' then 'BRIEFED'
  when 'REVIEW' then 'PRODUCED'
  when 'READY_FOR_SCHEDULING' then 'SCHEDULER_READY'
  when 'SCHEDULED' then 'TOCA_SCHEDULED'
  when 'MEASURED' then 'RECONCILED'
  when 'ARCHIVED' then 'RECONCILED'
  else state
end
where state in (
  'IN_PRODUCTION',
  'REVIEW',
  'READY_FOR_SCHEDULING',
  'SCHEDULED',
  'MEASURED',
  'ARCHIVED'
);

alter table content_items
  drop constraint if exists content_items_state_check;

alter table content_items
  add constraint content_items_state_check check (
    state in (
      'PLANNED',
      'SOURCE_BOUND',
      'BRIEFED',
      'PRODUCED',
      'QA_PASS',
      'APPROVED',
      'SCHEDULER_READY',
      'TOCA_SCHEDULED',
      'PUBLISHED',
      'RECONCILED',
      'CANCELED'
    )
  );

alter table content_items
  drop constraint if exists content_items_operational_disposition_check;

alter table content_items
  add constraint content_items_operational_disposition_check check (
    operational_disposition in ('ACTIVE', 'MISSED_WINDOW', 'SUPERSEDED', 'CANCELED')
  );

create index if not exists content_items_lifecycle_disposition_idx
  on content_items (tenant_id, state, operational_disposition, updated_at, content_item_id);
