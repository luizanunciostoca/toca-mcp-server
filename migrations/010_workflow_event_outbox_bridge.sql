create or replace function enqueue_workflow_event_outbox()
returns trigger
language plpgsql
as $$
declare
  instance_row workflow_instances%rowtype;
begin
  select * into strict instance_row
  from workflow_instances
  where workflow_id = new.workflow_id;

  insert into event_outbox (
    event_id,
    event_key,
    event_type,
    schema_version,
    aggregate_type,
    aggregate_id,
    aggregate_version,
    tenant_id,
    workspace_id,
    organization_id,
    correlation_id,
    causation_id,
    occurred_at,
    payload,
    evidence,
    status,
    available_at,
    attempts,
    max_attempts,
    claimed_by,
    claim_execution_id,
    claimed_at,
    delivered_at,
    last_error_code,
    version
  ) values (
    'evt_workflow_' || new.event_id,
    new.event_id,
    'workflow.' || lower(new.event_type),
    '1.0.0',
    'workflow',
    new.workflow_id,
    instance_row.version,
    instance_row.tenant_id,
    instance_row.workspace_id,
    instance_row.organization_id,
    new.correlation_id,
    null,
    new.occurred_at,
    jsonb_build_object(
      'workflow_event_id', new.event_id,
      'step_id', new.step_id,
      'workflow_event_type', new.event_type,
      'payload', new.payload
    ),
    to_jsonb(array['workflow_event:' || new.event_id]),
    'PENDING',
    new.occurred_at,
    0,
    5,
    null,
    null,
    null,
    null,
    null,
    1
  )
  on conflict (event_id) do nothing;

  return new;
end;
$$;

drop trigger if exists workflow_events_to_event_outbox on workflow_events;

create trigger workflow_events_to_event_outbox
after insert on workflow_events
for each row
execute function enqueue_workflow_event_outbox();
