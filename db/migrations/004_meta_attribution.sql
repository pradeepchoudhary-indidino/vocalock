-- Meta ads attribution.
--
-- Renewals happen with the app closed, so the server reports them to Meta's
-- Conversions API itself. To credit them to the ad behind the install it needs
-- the ids the app's Meta SDK uses, which the app sends after sign-in.
--
-- PostgreSQL only; the on-device stub never talks to Meta.

ALTER TABLE users ADD COLUMN IF NOT EXISTS meta_anon_id          TEXT;
-- Google advertising id. Not sent on when the user has limited ad tracking.
ALTER TABLE users ADD COLUMN IF NOT EXISTS meta_advertiser_id    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS meta_tracking_limited BOOLEAN;
