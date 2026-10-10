export type PlanStatus = 'trial' | 'active' | 'cancelled' | 'expired' | 'failed';

/** Column names match the SQL exactly, so rows map without a translation layer. */
export interface UserRow {
  id: string;
  /** Null for Google sign-ins; kept for accounts made under phone OTP. */
  phone: string | null;
  google_sub: string | null;
  email: string | null;
  name: string | null;
  created_at: string;
  last_seen_at: string;
  app_version: string | null;
  device_model: string | null;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: string;
  status: PlanStatus;
  /** Paise. */
  trial_price: number;
  /** Paise. */
  price: number;
  currency: string;
  provider: string | null;
  mandate_id: string | null;
  started_at: string;
  valid_until: string;
  cancelled_at: string | null;
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  name: string | null;
}

/**
 * Everything the app needs from persistence.
 *
 * Implemented twice: against the device's SQLite today, and against the HTTP
 * API once the server is on RDS. Nothing above this interface knows which.
 */
export interface Repository {
  init(): Promise<void>;
  registerUser(identity: GoogleIdentity, meta: { appVersion: string; deviceModel: string }): Promise<UserRow>;
  startTrial(userId: string, days: number): Promise<SubscriptionRow>;
  cancelSubscription(userId: string): Promise<SubscriptionRow | null>;
}
