-- One ₹1 trial per person, ever.
--
-- Keyed by a SHA-256 of the Google account id rather than the user row, so the
-- claim survives Delete account: the users row is anonymised then, and signing
-- in again makes a new one. The hash cannot be turned back into the account,
-- and it is kept only to refuse a second trial.
--
-- PostgreSQL only; trials are a server concern, the device stub does not
-- enforce them.

CREATE TABLE IF NOT EXISTS trial_claims (
    google_sub_hash TEXT        PRIMARY KEY,
    claimed_at      TEXT        NOT NULL
);

-- Everyone who has already had a Razorpay subscription has had their trial.
INSERT INTO trial_claims (google_sub_hash, claimed_at)
SELECT DISTINCT encode(sha256(u.google_sub::bytea), 'hex'), MIN(s.started_at)
FROM subscriptions s
JOIN users u ON u.id = s.user_id
WHERE s.provider = 'razorpay' AND u.google_sub IS NOT NULL
GROUP BY u.google_sub
ON CONFLICT DO NOTHING;

-- Cancelling now ends Premium at once. Subscriptions cancelled under the old
-- rule (access until the paid period ran out) end now too.
UPDATE subscriptions SET valid_until = cancelled_at
WHERE status = 'cancelled' AND cancelled_at IS NOT NULL AND valid_until > cancelled_at;
