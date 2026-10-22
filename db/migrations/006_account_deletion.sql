-- When the user tapped Delete account. Accounts that ever paid keep their
-- identity and subscription (only a manual cancel stops the mandate), so
-- signing in again with the same Google account restores them; this marks
-- them as deleted until then. Accounts that never paid are erased as before.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TEXT;
