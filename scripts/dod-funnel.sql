-- VocaLock day-over-day: sign-up -> Rs1 trial -> Rs199 paid (IST days)
-- Signups from events (backfilled + live; survives erased never-paid accounts).
-- Trials = successful trial payments; paid = successful renewal >= Rs199 for that trial's user.
-- Excludes the known in-house test accounts.
WITH su AS (
  SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date d, count(DISTINCT user_id) signups
  FROM events WHERE event = 'signup' AND user_id NOT IN ('usr_2431c5ba348afc86','usr_10f9544deef315b5')
  GROUP BY 1
), tr AS (
  SELECT user_id, min(created_at::timestamptz) t
  FROM payments WHERE type = 'trial' AND status = 'success'
    AND user_id NOT IN ('usr_2431c5ba348afc86','usr_10f9544deef315b5')
  GROUP BY 1
), pd AS (
  SELECT user_id, min(created_at::timestamptz) p
  FROM payments WHERE type = 'renewal' AND status = 'success' AND amount >= 19900
  GROUP BY 1
), tc AS (
  SELECT (tr.t AT TIME ZONE 'Asia/Kolkata')::date d,
         count(*) trials,
         count(pd.p) paid,
         count(*) FILTER (WHERE tr.t <= now() - interval '3 days') matured
  FROM tr LEFT JOIN pd ON pd.user_id = tr.user_id AND pd.p > tr.t
  GROUP BY 1
)
SELECT d AS day_ist,
       coalesce(su.signups,0) AS signups,
       coalesce(tc.trials,0)  AS trials,
       round(100.0*coalesce(tc.trials,0)/nullif(su.signups,0),1) AS "signup->trial %",
       coalesce(tc.paid,0)    AS paid_199,
       round(100.0*coalesce(tc.paid,0)/nullif(tc.trials,0),1) AS "trial->paid %",
       CASE WHEN coalesce(tc.trials,0) > coalesce(tc.matured,0) THEN 'immature (<3d)' ELSE '' END AS note
FROM su FULL JOIN tc USING (d)
ORDER BY d;
