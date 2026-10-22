-- Product events, for seeing where users drop off.
--
-- Until the app sends its own events, the server records the steps it can see
-- from the calls the app already makes: sign-up, each app open, checkout,
-- payment, cancel, renewal, lapse, delete. App-sent events will land in the
-- same table with source = 'app'.
--
-- PostgreSQL only; the on-device stub has no use for it.

CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         TEXT,                   -- NULL for events with no signed-in user
    event           TEXT        NOT NULL,
    source          TEXT        NOT NULL DEFAULT 'server',
    app_version     TEXT,
    props           JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_by_user ON events (user_id, created_at);
CREATE INDEX IF NOT EXISTS events_by_name ON events (event, created_at);

-- Backfill what already happened, from the tables that recorded it, so the
-- funnel starts at launch rather than at this deploy.
INSERT INTO events (user_id, event, app_version, props, created_at)
SELECT id, 'signup', app_version, '{"backfilled":true}', created_at::timestamptz FROM users;

INSERT INTO events (user_id, event, props, created_at)
SELECT user_id,
       CASE WHEN type = 'trial' THEN 'trial_started' ELSE 'renewal_charged' END,
       jsonb_build_object('backfilled', true, 'rupees', round(amount / 100.0, 2)),
       created_at::timestamptz
FROM payments WHERE status = 'success' AND type IN ('trial','renewal');

INSERT INTO events (user_id, event, props, created_at)
SELECT user_id, 'subscription_cancelled', '{"backfilled":true}', cancelled_at::timestamptz
FROM subscriptions WHERE status = 'cancelled' AND cancelled_at IS NOT NULL;

INSERT INTO events (user_id, event, props, created_at)
SELECT id, 'account_deleted', '{"backfilled":true}', deleted_at::timestamptz
FROM users WHERE deleted_at IS NOT NULL;
