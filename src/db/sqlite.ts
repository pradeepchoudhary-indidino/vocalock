import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { DB_NAME, MIGRATIONS, RUPEE } from './schema';
import type {
  PaymentRow,
  Repository,
  SubscriptionRow,
  UserRow,
} from './types';

const PRICE_PAISE = { trial: 1 * RUPEE, monthly: 499 * RUPEE };

function nowIso(): string {
  return new Date().toISOString();
}

function plusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Ids are generated here so device rows can be copied to the server as-is. */
function newId(prefix: string): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

/**
 * The device's own database.
 *
 * Deliberately written in plain SQL rather than through an ORM: the same
 * statements have to run against PostgreSQL on RDS later, and an abstraction
 * that hides the SQL would hide exactly the thing that needs to stay portable.
 */
export class SqliteRepository implements Repository {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    if (Capacitor.getPlatform() === 'web') {
      // The web build runs against wa-sqlite in the browser so the UI is still
      // developable without a phone (spec hard rule 2).
      await this.sqlite.initWebStore();
    }

    const existing = (await this.sqlite.isConnection(DB_NAME, false)).result;
    this.db = existing
      ? await this.sqlite.retrieveConnection(DB_NAME, false)
      : await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

    await this.db.open();
    await this.migrate();
  }

  /**
   * user_version is SQLite's own counter, so migrations are idempotent and a
   * partially-applied upgrade cannot be re-run halfway.
   */
  private async migrate(): Promise<void> {
    const db = this.require();
    const current = (await db.query('PRAGMA user_version;')).values?.[0]?.user_version ?? 0;

    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      for (const statement of migration.statements) {
        await db.execute(statement);
      }
      await db.execute(`PRAGMA user_version = ${migration.version};`);
    }
    await db.execute('PRAGMA foreign_keys = ON;');
  }

  private require(): SQLiteDBConnection {
    if (!this.db) throw new Error('Database is not open. Call init() first.');
    return this.db;
  }

  // ----- users -----

  async registerUser(
    phone: string,
    meta: { appVersion: string; deviceModel: string },
  ): Promise<UserRow> {
    const db = this.require();
    const existing = await this.findUserByPhone(phone);
    const now = nowIso();

    if (existing) {
      await db.run(
        'UPDATE users SET last_seen_at = ?, app_version = ?, device_model = ? WHERE id = ?;',
        [now, meta.appVersion, meta.deviceModel, existing.id],
      );
      return { ...existing, last_seen_at: now };
    }

    const user: UserRow = {
      id: newId('usr'),
      phone,
      created_at: now,
      last_seen_at: now,
      app_version: meta.appVersion,
      device_model: meta.deviceModel,
    };
    await db.run(
      `INSERT INTO users (id, phone, created_at, last_seen_at, app_version, device_model)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [user.id, user.phone, user.created_at, user.last_seen_at, user.app_version, user.device_model],
    );
    return user;
  }

  async findUserByPhone(phone: string): Promise<UserRow | null> {
    const rows = await this.require().query('SELECT * FROM users WHERE phone = ? LIMIT 1;', [phone]);
    return (rows.values?.[0] as UserRow) ?? null;
  }

  async touchUser(userId: string): Promise<void> {
    await this.require().run('UPDATE users SET last_seen_at = ? WHERE id = ?;', [nowIso(), userId]);
  }

  // ----- subscriptions -----

  async startTrial(userId: string, days: number): Promise<SubscriptionRow> {
    const db = this.require();
    const now = nowIso();

    // The partial unique index allows only one live subscription per user, so
    // retire whatever is there before inserting.
    await db.run(
      `UPDATE subscriptions SET status = 'expired'
       WHERE user_id = ? AND status IN ('trial','active','cancelled');`,
      [userId],
    );

    const subscription: SubscriptionRow = {
      id: newId('sub'),
      user_id: userId,
      plan: 'monthly_premium',
      status: 'trial',
      trial_price: PRICE_PAISE.trial,
      price: PRICE_PAISE.monthly,
      currency: 'INR',
      // No gateway yet, so there is no provider or mandate to record.
      provider: null,
      mandate_id: null,
      started_at: now,
      valid_until: plusDays(days),
      cancelled_at: null,
    };
    await db.run(
      `INSERT INTO subscriptions
        (id, user_id, plan, status, trial_price, price, currency, provider, mandate_id,
         started_at, valid_until, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        subscription.id, subscription.user_id, subscription.plan, subscription.status,
        subscription.trial_price, subscription.price, subscription.currency,
        subscription.provider, subscription.mandate_id, subscription.started_at,
        subscription.valid_until, subscription.cancelled_at,
      ],
    );

    // The ledger records the trial even though nothing was charged, so the
    // table is already correct in shape when a gateway is added.
    await db.run(
      `INSERT INTO payments
        (id, user_id, subscription_id, amount, currency, type, status,
         provider, provider_txn_id, created_at)
       VALUES (?, ?, ?, ?, 'INR', 'trial', 'simulated', NULL, NULL, ?);`,
      [newId('pay'), userId, subscription.id, PRICE_PAISE.trial, now],
    );

    return subscription;
  }

  async cancelSubscription(userId: string): Promise<SubscriptionRow | null> {
    const db = this.require();
    const current = await this.currentSubscription(userId);
    if (!current) return null;
    const cancelledAt = nowIso();
    // Access continues until valid_until, which is what the paywall promises.
    await db.run(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = ? WHERE id = ?;`,
      [cancelledAt, current.id],
    );
    return { ...current, status: 'cancelled', cancelled_at: cancelledAt };
  }

  async currentSubscription(userId: string): Promise<SubscriptionRow | null> {
    const rows = await this.require().query(
      `SELECT * FROM subscriptions
       WHERE user_id = ? AND status IN ('trial','active','cancelled')
       ORDER BY started_at DESC LIMIT 1;`,
      [userId],
    );
    return (rows.values?.[0] as SubscriptionRow) ?? null;
  }

  async listPayments(userId: string, limit = 20): Promise<PaymentRow[]> {
    const rows = await this.require().query(
      'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?;',
      [userId, limit],
    );
    return (rows.values as PaymentRow[]) ?? [];
  }
}
