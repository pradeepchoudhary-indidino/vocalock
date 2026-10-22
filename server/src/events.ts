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
