import { randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { query } from './db';
import { sha256 as hash } from './util';

/**
 * Who is calling.
 *
 * Sign-in: the app sends the ID token Google's account picker gave it. Google
 * signed it, so verifying it proves the caller controls that Google account.
 * The server then issues its own random session token, and from there on the
 * uid every route acts on comes from that token — never from the request body.
 */
const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID ?? '';
const SESSION_TTL_MS = 180 * 86_400_000;

const google = new OAuth2Client();

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  name: string | null;
}

/** Throws unless the token is Google-signed, unexpired, and issued for this app. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!GOOGLE_WEB_CLIENT_ID) throw new Error('GOOGLE_WEB_CLIENT_ID is not set');
  const ticket = await google.verifyIdToken({ idToken, audience: GOOGLE_WEB_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error('ID token has no subject');
  return {
    sub: payload.sub,
    email: payload.email_verified ? (payload.email ?? null) : null,
    name: payload.name ?? null,
  };
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  await query(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4);',
    [hash(token), userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString()],
  );
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1;', [hash(token)]);
}

export function bearerToken(req: Request): string {
  return (req.header('authorization') ?? '').replace(/^Bearer /, '');
}

/** The signed-in user behind the request's session token, or null. */
export async function sessionUser(req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const [session] = await query<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > $2;',
    [hash(token), new Date().toISOString()],
  );
  return session?.user_id ?? null;
}

/** Sets `res.locals.uid` from the session token, or answers 401. */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  let uid: string | null;
  try {
    uid = await sessionUser(req);
  } catch (error) {
    next(error); // Express 4 does not catch a rejected async middleware itself
    return;
  }
  if (!uid) {
    res.status(401).send('Please sign in again.');
    return;
  }
  res.locals.uid = uid;
  next();
}
