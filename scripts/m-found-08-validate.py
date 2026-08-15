from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"PATCH_ANCHOR_COUNT_INVALID:{path}:{count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "src/persistence/postgres-audit-sink.ts",
    "function asRoles(value: unknown): AuditEvent['authorizationRoles'] {",
    "function asRoles(value: unknown): NonNullable<AuditEvent['authorizationRoles']> {",
)
replace_once(
    "test/audit-ledger.test.ts",
    "    expect(normalizeAuditEvidence({ ...base, evidence: undefined })).toEqual([\n      'audit:started:exec-1',\n    ]);",
    "    expect(\n      normalizeAuditEvidence({\n        executionId: base.executionId,\n        correlationId: base.correlationId,\n        toolName: base.toolName,\n        requester: base.requester,\n        status: base.status,\n        createdAt: base.createdAt,\n      }),\n    ).toEqual(['audit:started:exec-1']);",
)

file = Path("test/p0-production-readiness.test.ts")
text = file.read_text()
start = text.find(
    "  it('persists identity-aware execution audit using the registered risk class', async () => {"
)
end_marker = "\n  });\n});\n\ndescribe('RuntimeTelemetry'"
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("P0_AUDIT_TEST_BOUNDARY_INVALID")
replacement = """  it('persists identity-aware execution audit using the registered risk class', async () => {
    const registry = createToolRegistry({ tocaManagedInstagramSchedulerEnabled: true });
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    let released = false;
    const client = {
      query: (sql: string, values: readonly unknown[] = []) => {
        calls.push({ sql, values: [...values] });
        if (sql.includes('select * from audit_ledger_heads')) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
      release: () => {
        released = true;
      },
    } as unknown as pg.PoolClient;
    const pool = {
      connect: () => Promise.resolve(client),
    } as unknown as pg.Pool;
    const ids = ['audit-event-1', 'signal-1'];
    const sink = new PostgresAuditSink(pool, registry, {
      createId: () => ids.shift() ?? 'unexpected-id',
    });
    const event: AuditEvent = {
      executionId: 'exec-1',
      correlationId: 'corr-1',
      toolName: 'instagram.toca_schedule.create',
      requester: 'test-mcp-client',
      principalType: 'SERVICE',
      tenantId: 'toca-do-morcego',
      workspaceId: 'toca-do-morcego',
      organizationId: 'toca-do-morcego',
      authenticationMethod: 'INFRASTRUCTURE_IDENTITY',
      authorizationRoles: ['OPERATOR'],
      status: 'SUCCEEDED',
      createdAt: '2026-08-14T01:00:00.000Z',
    };

    await sink.write(event);

    const ledger = calls.find(({ sql }) => sql.includes('insert into audit_ledger_events'));
    expect(ledger?.values[15]).toBe('WRITE_REVERSIBLE');
    const legacy = calls.find(({ sql }) => sql.includes('insert into audit_events'));
    expect(legacy?.values.slice(0, 5)).toEqual([
      'corr-1',
      'test-mcp-client',
      'instagram.toca_schedule.create',
      'WRITE_REVERSIBLE',
      'SUCCEEDED',
    ]);
    const normalized = JSON.parse(String(legacy?.values[5])) as Record<string, unknown>;
    expect(normalized).toMatchObject({
      executionId: 'exec-1',
      ledgerEventId: 'audit-event-1',
      principalType: 'SERVICE',
      tenantId: 'toca-do-morcego',
      authorizationRoles: ['OPERATOR'],
      evidence: ['audit:succeeded:exec-1'],
    });
    expect(calls.some(({ sql }) => sql.includes('insert into operational_signals'))).toBe(true);
    expect(released).toBe(true);
  });"""
file.write_text(text[:start] + replacement + text[end + len("\n  });") :])
