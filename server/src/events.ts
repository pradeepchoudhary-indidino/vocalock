import { query } from './db';

/**
 * Records a product event (see db/migrations/007_events.sql). Fire and forget:
 * analytics must never slow down or fail the call that triggered it.
 */
export function logEvent(
  userId: string | null,
  event: string,
  props: Record<string, unknown> = {},
  appVersion: unknown = null,
): void {
  query('INSERT INTO events (user_id, event, app_version, props) VALUES ($1, $2, $3, $4);', [
    userId,
    event,
    appVersion ? String(appVersion).slice(0, 32) : null,
    JSON.stringify(props),
  ]).catch((error) => console.error('[events]', event, (error as Error).message));
}

const EVENT_NAME = /^[a-z][a-z0-9_]{1,47}$/;
const MAX_BATCH = 100;
const MAX_PROPS_BYTES = 2048;
/** Client clocks are trusted this far back (an offline queue) and forward. */
const MAX_AGE_MS = 14 * 86_400_000;
const MAX_SKEW_MS = 10 * 60_000;

export interface AppEvent {
  event: string;
  props: Record<string, unknown>;
  at: Date;
}

/**
 * Validates a batch the app sent. Anything malformed is dropped, not rejected:
 * one bad event must not lose the rest of the batch.
 */
export function parseAppEvents(body: unknown, now = Date.now()): AppEvent[] {
  const list = (body as { events?: unknown })?.events;
  if (!Array.isArray(list)) return [];
  const out: AppEvent[] = [];
  for (const raw of list.slice(0, MAX_BATCH)) {
    const item = raw as { event?: unknown; props?: unknown; ts?: unknown };
    if (typeof item?.event !== 'string' || !EVENT_NAME.test(item.event)) continue;
    const props =
      item.props && typeof item.props === 'object' && !Array.isArray(item.props)
        ? (item.props as Record<string, unknown>)
        : {};
    if (JSON.stringify(props).length > MAX_PROPS_BYTES) continue;
    const ts = typeof item.ts === 'number' ? item.ts : Date.parse(String(item.ts ?? ''));
    const at = Number.isFinite(ts) && ts > now - MAX_AGE_MS && ts < now + MAX_SKEW_MS ? new Date(ts) : new Date(now);
    out.push({ event: item.event, props, at });
  }
  return out;
}

/** One insert for the whole batch, tagged source = 'app'. */
export async function insertAppEvents(
  userId: string | null,
  appVersion: unknown,
  events: AppEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const version = appVersion ? String(appVersion).slice(0, 32) : null;
  const params: unknown[] = [];
  const rows = events.map((e, i) => {
    params.push(userId, e.event, version, JSON.stringify(e.props), e.at.toISOString());
    const b = i * 5;
    return `($${b + 1}, $${b + 2}, 'app', $${b + 3}, $${b + 4}, $${b + 5})`;
  });
  await query(
    `INSERT INTO events (user_id, event, source, app_version, props, created_at) VALUES ${rows.join(', ')};`,
    params,
  );
}
