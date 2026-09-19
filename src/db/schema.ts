/**
 * The schema, inlined so the app can create its database with no file I/O.
 *
 * Kept identical in meaning to db/migrations/001_init.sql — that file is what
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
];

export const DB_NAME = 'vocalock';

/** Money is paise everywhere. Never a float. */
export const RUPEE = 100;
