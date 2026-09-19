export type PlanStatus = 'trial' | 'active' | 'cancelled' | 'expired' | 'failed';
export type PaymentType = 'trial' | 'renewal' | 'refund';
export type PaymentStatus = 'pending' | 'success' | 'failed' | 'simulated';

/** Column names match the SQL exactly, so rows map without a translation layer. */
export interface UserRow {
  id: string;
  phone: string;
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

export interface PaymentRow {
  id: string;
  user_id: string;
  subscription_id: string | null;
  /** Paise. */
  amount: number;
  currency: string;
  type: PaymentType;
  status: PaymentStatus;
  provider: string | null;
  provider_txn_id: string | null;
  created_at: string;
}

/**
 * Everything the app needs from persistence.
 *
 * Implemented twice: against the device's SQLite today, and against the HTTP
 * API once the server is on RDS. Nothing above this interface knows which.
 */
export interface Repository {
  init(): Promise<void>;
  registerUser(phone: string, meta: { appVersion: string; deviceModel: string }): Promise<UserRow>;
  findUserByPhone(phone: string): Promise<UserRow | null>;
  touchUser(userId: string): Promise<void>;
  startTrial(userId: string, days: number): Promise<SubscriptionRow>;
  cancelSubscription(userId: string): Promise<SubscriptionRow | null>;
  currentSubscription(userId: string): Promise<SubscriptionRow | null>;
  listPayments(userId: string, limit?: number): Promise<PaymentRow[]>;
}
