import { describe, expect, it } from 'vitest';
import { AG01_REQUIRED_TABLES, assertAg01PersistenceReady } from '../src/orchestrator/readiness.js';

describe('AG-01 production persistence readiness', () => {
  it('passes only when every AG-01 durable base table exists', async () => {
    let sql = '';
    const query = (statement: string) => {
      sql = statement;
      return Promise.resolve({
        rows: AG01_REQUIRED_TABLES.map((table_name) => ({ table_name })),
      });
    };

    await expect(assertAg01PersistenceReady({ query } as never)).resolves.toBeUndefined();
    expect(sql).toContain("table_schema = 'public'");
    expect(sql).toContain("table_type = 'BASE TABLE'");
  });

  it('fails closed and names missing durable tables', async () => {
    const query = () =>
      Promise.resolve({
        rows: [{ table_name: 'ag01_conversations' }],
      });

    await expect(assertAg01PersistenceReady({ query } as never)).rejects.toThrow(
      'AG01_PERSISTENCE_NOT_READY:ag01_message_records,ag01_runtime_circuits',
    );
  });
});
