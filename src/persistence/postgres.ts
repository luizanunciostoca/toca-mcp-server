import pg from 'pg';

const { Pool } = pg;

export interface DatabaseConfig {
  readonly connectionString: string;
  readonly max?: number;
  readonly ssl?: boolean;
}

export function createPostgresPool(config: DatabaseConfig): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    application_name: 'toca-mcp-server',
  });
}

export async function checkDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('select 1');
}
