import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

/**
 * Amazon's RDS root certificates, bundled so the connection verifies it is
 * really talking to RDS. Refresh from
 * https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem when AWS
 * rotates its CAs.
 */
const RDS_CA = join(__dirname, '..', 'certs', 'rds-global-bundle.pem');

/**
 * One pool for the process. RDS caps connections by instance size, so a pool
 * per request would exhaust the server long before the database was busy.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // PGSSL=false only for a local postgres with no TLS.
  ssl: process.env.PGSSL === 'false' ? false : { ca: readFileSync(RDS_CA, 'utf8'), rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30_000,
});

// An idle pooled connection that the database drops (restart, RDS failover,
// maintenance) is reported as an 'error' event on the pool. With no listener
// Node treats it as fatal and the whole API goes down; the pool already
// discards the dead client and opens a fresh one on the next query.
pool.on('error', (error) => console.error('[pg pool] idle client error', error.message));

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
