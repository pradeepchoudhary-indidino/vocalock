-- Google sign-in replaces phone OTP, and the server issues its own sessions.
--
-- PostgreSQL only. SQLite cannot drop a NOT NULL in place, so the device does
-- the same change as a table rebuild (src/db/schema.ts, version 2). The
-- resulting columns are identical on both.

-- Google's stable account id (the ID token's `sub`). Email can change; this
-- cannot, so it is what identifies a user.
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN email      TEXT;
ALTER TABLE users ADD COLUMN name       TEXT;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique
    ON users (google_sub)
    WHERE google_sub IS NOT NULL;

-- One row per signed-in device. Only a SHA-256 of the token is stored, so a
-- copy of this table cannot be replayed as a login.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash      TEXT        PRIMARY KEY,
    user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT        NOT NULL,
    expires_at      TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);

-- Phone OTP is gone.
DROP TABLE IF EXISTS otp_codes;
