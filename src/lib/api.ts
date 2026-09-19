import { Capacitor } from '@capacitor/core';
import { SqliteRepository } from '../db/sqlite';
import type { Repository } from '../db/types';
import { APP_VERSION } from './analytics';

/**
 * Backend client.
 *
 * Every call goes through here so there is exactly one place to swap the stub
 * for the real Cloud Functions. When VITE_API_BASE is set the calls go over the
 * network; when it is not, they resolve locally so the app is still fully
 * usable — which is the state it ships in today.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** Until a real SMS provider is wired up. See functions/src/otp.ts. */
export const STATIC_OTP = '1234';
export const OTP_LENGTH = 4;

export interface Session {
  uid: string;
  phone: string;
  /** Present once a real backend issues one; unused by the local stub. */
  token?: string;
}

const backendConfigured = API_BASE !== '';

/**
 * The on-device database. Used while there is no server; once VITE_API_BASE
 * points at the Node API on RDS the same calls go over HTTP instead, and this
 * stays only as the offline cache.
 */
const local: Repository = new SqliteRepository();
let ready: Promise<void> | null = null;

function db(): Promise<void> {
  ready ??= local.init();
  return ready;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function requestOtp(phone: string): Promise<void> {
  if (!backendConfigured) {
    // No SMS is sent; the code is STATIC_OTP.
    console.info(`[api] stub requestOtp(${phone}) — use ${STATIC_OTP}`);
    return;
  }
  await post('/requestOtp', { phone });
}

export async function verifyOtp(phone: string, code: string): Promise<Session> {
  if (!backendConfigured) {
    if (code !== STATIC_OTP) throw new Error('That code did not work. Try again.');
    await db();
    // Registration is implicit: a verified number is a user row.
    const user = await local.registerUser(phone, {
      appVersion: APP_VERSION,
      deviceModel: Capacitor.getPlatform(),
    });
    return { uid: user.id, phone: user.phone };
  }
  return post<Session>('/verifyOtp', { phone, code });
}

export interface PurchaseResult {
  status: 'trial' | 'active';
  validUntil: string;
}

export async function startSubscription(
  session: Session,
  trialDays: number,
): Promise<PurchaseResult | null> {
  if (!backendConfigured) {
    await db();
    const sub = await local.startTrial(session.uid, trialDays);
    return { status: 'trial', validUntil: sub.valid_until };
  }
  return post<PurchaseResult>('/startSubscription', { uid: session.uid, token: session.token });
}

export async function cancelSubscription(session: Session): Promise<void> {
  if (!backendConfigured) {
    await db();
    await local.cancelSubscription(session.uid);
    return;
  }
  await post('/cancelSubscription', { uid: session.uid, token: session.token });
}

