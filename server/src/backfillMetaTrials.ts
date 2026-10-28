import { pool, query } from './db';
import { reportTrial } from './meta';

/**
 * One-off: reports to Meta the ₹1 trials the app failed to (1.5's entitlement
 * refresh race; 1.3's SDK never started). Meta takes events up to 7 days old,
 * and the event id matches the live one, so running it twice is harmless.
 *
 *   node --env-file=.env dist/backfillMetaTrials.js          # dry run
 *   node --env-file=.env dist/backfillMetaTrials.js --send
 */
async function main(): Promise<void> {
  const send = process.argv.includes('--send');
  const trials = await query<{ user_id: string; mandate_id: string; amount: number; at: string }>(
    `SELECT p.user_id, s.mandate_id, p.amount, p.created_at AS at
     FROM payments p
     JOIN subscriptions s ON s.id = p.subscription_id
     JOIN users u ON u.id = p.user_id
     WHERE p.type = 'trial' AND p.status = 'success' AND s.mandate_id IS NOT NULL
       AND p.created_at::timestamptz > now() - interval '6 days 23 hours'
       AND u.email NOT ILIKE '%pradeepchoudhary%' AND u.email <> 'pradeep.choudhary@indidino.com'
     ORDER BY p.created_at;`,
  );
  let sent = 0;
  for (const t of trials) {
    const ok = send ? await reportTrial(t.user_id, t.mandate_id, t.amount, new Date(t.at)) : false;
    if (ok) sent++;
    console.log(send ? (ok ? 'sent   ' : 'SKIPPED') : 'would  ', t.at, t.user_id, t.mandate_id);
  }
  console.log(`${trials.length} trials, ${send ? `${sent} accepted by Meta` : 'dry run'}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
