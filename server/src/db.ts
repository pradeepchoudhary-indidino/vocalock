import { Pool } from 'pg';

/**
 * One pool for the process. RDS caps connections by instance size, so a pool
 * per request would exhaust the server long before the database was busy.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // RDS presents an Amazon CA. `rejectUnauthorized: false` keeps the traffic
  // encrypted without bundling the RDS root certificate; bundle it and turn
  // this on before handling real payment data.
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function transaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scoped = async <R>(text: string, params: unknown[] = []): Promise<R[]> =>
      (await client.query(text, params)).rows as R[];
    const out = await fn(scoped as typeof query);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
