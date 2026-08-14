import type pg from 'pg';
import type { AuditEvent, AuditSink } from '../core/audit.js';
import type { ToolRegistry } from '../core/tool-registry.js';

export class PostgresAuditSink implements AuditSink {
  constructor(
    private readonly pool: pg.Pool,
    private readonly registry: ToolRegistry,
  ) {}

  async write(event: AuditEvent): Promise<void> {
    const definition = this.registry.get(event.toolName);
    if (!definition) throw new Error(`AUDIT_TOOL_DEFINITION_NOT_FOUND:${event.toolName}`);

    await this.pool.query(
      `insert into audit_events
         (correlation_id, actor_id, tool_name, risk_class, decision, normalized_payload, provider_result)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        event.correlationId,
        event.requester,
        event.toolName,
        definition.riskClass,
        event.status,
        JSON.stringify({
          executionId: event.executionId,
          connectedAccount: event.connectedAccount ?? null,
          createdAt: event.createdAt,
        }),
        JSON.stringify({
          externalResourceId: event.externalResourceId ?? null,
          errorCode: event.errorCode ?? null,
        }),
      ],
    );
  }
}
