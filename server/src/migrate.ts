import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pool, query } from './db';

/**
 * Applies db/migrations/*.sql in filename order, once each.
 *
 * Deliberately not an ORM's migration tool: the same .sql files are the source
 * of truth for the SQLite schema inside the app, so they have to stay plain SQL
 * that a human can read and both engines can run.
 */
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

async function main(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
     filename TEXT PRIMARY KEY,
     applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );`);

  const applied = new Set(
    (await query<{ filename: string }>('SELECT filename FROM schema_migrations;'))
      .map((r) => r.filename),
  );

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      // Each migration is one transaction: a failure leaves nothing half-done.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1);', [file]);
      await client.query('COMMIT');
      console.log(`  apply ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
