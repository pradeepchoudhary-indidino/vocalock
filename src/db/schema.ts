/**
 * The schema, inlined so the app can create its database with no file I/O.
 *
 * Kept identical in meaning to db/migrations/*.sql — those files are what
 * runs on RDS. Change one, change both: the whole point is that a row written
 * on the device fits the server table without translation.
 */
export const MIGRATIONS: { version: number; statements: string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
         id TEXT PRIMARY KEY,
         phone TEXT NOT NULL UNIQUE,
         created_at TEXT NOT NULL,
         last_seen_at TEXT NOT NULL,
         app_version TEXT,
         device_model TEXT
       );`,
      `CREATE TABLE IF NOT EXISTS subscriptions (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         plan TEXT NOT NULL DEFAULT 'monthly_premium',
         status TEXT NOT NULL CHECK (status IN ('trial','active','cancelled','expired','failed')),
         trial_price INTEGER NOT NULL,
         price INTEGER NOT NULL,
         currency TEXT NOT NULL DEFAULT 'INR',
         provider TEXT,
         mandate_id TEXT,
         started_at TEXT NOT NULL,
         valid_until TEXT NOT NULL,
         cancelled_at TEXT
       );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live_per_user
         ON subscriptions (user_id) WHERE status IN ('trial','active','cancelled');`,
      `CREATE INDEX IF NOT EXISTS subscriptions_due ON subscriptions (status, valid_until);`,
      `CREATE TABLE IF NOT EXISTS payments (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
         amount INTEGER NOT NULL,
         currency TEXT NOT NULL DEFAULT 'INR',
         type TEXT NOT NULL CHECK (type IN ('trial','renewal','refund')),
         status TEXT NOT NULL CHECK (status IN ('pending','success','failed','simulated')),
         provider TEXT,
         provider_txn_id TEXT,
         created_at TEXT NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS payments_by_user ON payments (user_id, created_at DESC);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_txn_unique
         ON payments (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;`,
    ],
  },
  {
    // db/migrations/002_google_sessions.sql. SQLite cannot drop phone's NOT
    // NULL in place, so users is rebuilt. Foreign keys are still off here (the
    // pragma is set after migrating), so dropping the old table is safe.
    version: 2,
    statements: [
      `CREATE TABLE users_v2 (
         id TEXT PRIMARY KEY,
         phone TEXT UNIQUE,
         created_at TEXT NOT NULL,
         last_seen_at TEXT NOT NULL,
         app_version TEXT,
         device_model TEXT,
         google_sub TEXT,
         email TEXT,
         name TEXT
       );`,
      `INSERT INTO users_v2 (id, phone, created_at, last_seen_at, app_version, device_model)
         SELECT id, phone, created_at, last_seen_at, app_version, device_model FROM users;`,
      `DROP TABLE users;`,
      `ALTER TABLE users_v2 RENAME TO users;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
         ON users (google_sub) WHERE google_sub IS NOT NULL;`,
    ],
  },
];

export const DB_NAME = 'vocalock';

/** Money is paise everywhere. Never a float. */
export const RUPEE = 100;
