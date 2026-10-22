// End-to-end API test against a real Postgres. Google token verification and
// Razorpay's REST API are faked at the network edge; everything else — SQL,
// signatures, sessions, CORS, rate limits — runs for real.
//
//   createdb vocalock_test && TEST_DATABASE_URL=postgres://...vocalock_test npm run test:e2e
//
// Wipes the database it is given, so never point it at a real one. Set
// PG_DATA_DIR (a local cluster's data directory) to also run the
// "database goes down" check, which stops and restarts that cluster.
const crypto = require('crypto');
const path = require('path');
const SERVER = path.join(__dirname, '..');
if (!process.env.TEST_DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL to a throwaway database.');
  process.exit(2);
}

Object.assign(process.env, {
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  PGSSL: 'false',
  PORT: '8798',
  GOOGLE_WEB_CLIENT_ID: 'test-client',
  RAZORPAY_KEY_ID: 'rzp_test_fake',
  RAZORPAY_KEY_SECRET: 'key_secret',
  RAZORPAY_PLAN_ID: 'plan_fake',
  RAZORPAY_WEBHOOK_SECRET: 'wh_secret',
  META_DATASET_ID: 'ds_test',
  META_ACCESS_TOKEN: 'meta_token',
});

// --- fake Google: the ID token string is the Google `sub`
const { OAuth2Client } = require(`${SERVER}/node_modules/google-auth-library`);
OAuth2Client.prototype.verifyIdToken = async ({ idToken, audience }) => {
  if (audience !== 'test-client' || idToken.startsWith('forged')) throw new Error('bad token');
  return { getPayload: () => ({ sub: idToken, email: `${idToken}@example.com`, email_verified: true, name: `User ${idToken}` }) };
};

// --- fake Razorpay
const subs = new Map();
const metaCalls = [];
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  if (String(url).startsWith('https://graph.facebook.com/')) {
    metaCalls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response('{"events_received":1}', { status: 200 });
  }
  if (!String(url).startsWith('https://api.razorpay.com/v1')) return realFetch(url, init);
  const path = String(url).replace('https://api.razorpay.com/v1', '');
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (init.method === 'POST' && path === '/subscriptions') {
    const body = JSON.parse(init.body);
    const sub = { id: `sub_${crypto.randomBytes(4).toString('hex')}`, status: 'created', plan_id: body.plan_id,
      start_at: body.start_at, current_start: null, current_end: null, charge_at: body.start_at, ended_at: null, notes: body.notes, _addons: body.addons, _total: body.total_count };
    subs.set(sub.id, sub);
    return json(200, sub);
  }
  let m = path.match(/^\/subscriptions\/([^/]+)$/);
  if (m) return subs.has(m[1]) ? json(200, subs.get(m[1])) : json(400, { error: { description: 'not found' } });
  m = path.match(/^\/subscriptions\/([^/]+)\/cancel$/);
  if (m) {
    const sub = subs.get(m[1]);
    if (sub.status === 'cancelled') return json(400, { error: { description: 'Subscription is not cancellable in cancelled status' } });
    sub.status = 'cancelled';
    return json(200, sub);
  }
  if (path.startsWith('/invoices?subscription_id=')) {
    const id = decodeURIComponent(path.split('=')[1]);
    const sub = subs.get(id);
    const paid = sub && ['authenticated', 'active'].includes(sub.status)
      ? [{ status: 'paid', payment_id: 'pay_inv_' + id, amount: 100, date: 1 }]
      : [];
    return json(200, { items: sub?._invoices ?? paid });
  }
  return json(404, { error: { description: 'unhandled fake route ' + path } });
};

require(`${SERVER}/dist/index.js`);

const BASE = 'http://127.0.0.1:8798';
const { Client } = require(`${SERVER}/node_modules/pg`);
const db = new Client({ connectionString: process.env.DATABASE_URL });

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ← ' + detail}`);
  if (!ok) failures++;
}
async function call(path, { token, body, headers = {}, method = 'POST' } = {}) {
  const res = await realFetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
const sign = (msg, secret) => crypto.createHmac('sha256', secret).update(msg).digest('hex');
async function webhook(event, sub, payment) {
  const raw = JSON.stringify({ event, payload: { subscription: { entity: sub }, ...(payment ? { payment: { entity: payment } } : {}) } });
  return realFetch(BASE + '/webhooks/razorpay', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sign(raw, 'wh_secret') }, body: raw });
}
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;

(async () => {
  await new Promise((r) => setTimeout(r, 500));
  await db.connect();
  await db.query('TRUNCATE users, sessions, subscriptions, payments, trial_claims CASCADE;');

  // CORS
  const pre = await realFetch(BASE + '/startSubscription', { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  check('CORS preflight from the app answers 204 with allow-origin', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://localhost', `${pre.status} ${pre.headers.get('access-control-allow-origin')}`);
  const evil = await realFetch(BASE + '/health', { headers: { Origin: 'https://evil.example' } });
  check('CORS: unknown origin gets no allow-origin header', !evil.headers.get('access-control-allow-origin'));

  // Auth
  check('no session → 401', (await call('/getEntitlement')).status === 401);
  check('forged Google token → 401', (await call('/auth/google', { body: { idToken: 'forged-1' } })).status === 401);
  const alice = (await call('/auth/google', { body: { idToken: 'alice', appVersion: '1.0', deviceModel: 'android' } })).data;
  const bob = (await call('/auth/google', { body: { idToken: 'bob' } })).data;
  check('sign-in returns uid + token', Boolean(alice.uid && alice.token && bob.token), JSON.stringify(alice));
  const alice2 = (await call('/auth/google', { body: { idToken: 'alice' } })).data;
  check('same Google account → same user', alice2.uid === alice.uid);
  check('first sign-in says created, the second does not', alice.created === true && alice2.created === false, JSON.stringify([alice.created, alice2.created]));
  const att = await call('/me/attribution', { token: alice.token, body: { anonId: 'XZ-anon-alice', advertiserId: 'gaid-alice', trackingLimited: false, osVersion: '14', deviceModel: 'Pixel 7', appVersion: '1.2' } });
  check('attribution stored', att.status === 200 && (await rows('SELECT meta_anon_id, meta_advertiser_id, meta_tracking_limited FROM users WHERE id=$1', [alice.uid]))[0].meta_advertiser_id === 'gaid-alice');
  const [hashRow] = await rows('SELECT token_hash FROM sessions WHERE user_id = $1 LIMIT 1', [alice.uid]);
  check('session stored hashed, not raw', hashRow && hashRow.token_hash !== alice.token);

  // Purchase
  const start = await call('/startSubscription', { token: alice.token });
  const subId = start.data?.checkout?.subscriptionId;
  check('startSubscription returns checkout payload', Boolean(subId) && start.data.checkout.keyId === 'rzp_test_fake', JSON.stringify(start.data));
  const fakeSub = subs.get(subId);
  const startIn = fakeSub.start_at - Date.now() / 1000;
  check('Razorpay sub: plan, ₹1 addon, start ~1 day out, uid in notes',
    fakeSub.plan_id === 'plan_fake' && fakeSub._addons[0].item.amount === 100 && startIn > 86_000 && startIn < 86_500 && fakeSub.notes.uid === alice.uid,
    JSON.stringify({ startIn, addons: fakeSub._addons, notes: fakeSub.notes }));

  const payId = 'pay_trial_1';
  const goodSig = sign(`${payId}|${subId}`, 'key_secret');
  check('verify with bad signature → 400', (await call('/verifySubscription', { token: alice.token, body: { paymentId: payId, subscriptionId: subId, signature: 'bad' } })).status === 400);
  check("bob verifying alice's subscription → 403", (await call('/verifySubscription', { token: bob.token, body: { paymentId: payId, subscriptionId: subId, signature: goodSig } })).status === 403);
  const v = await call('/verifySubscription', { token: alice.token, body: { paymentId: payId, subscriptionId: subId, signature: goodSig } });
  check('verify → trial', v.status === 200 && v.data.status === 'trial' && v.data.provider === 'razorpay', JSON.stringify(v.data));
  check('trial valid_until = Razorpay start_at', v.data.validUntil === new Date(fakeSub.start_at * 1000).toISOString());
  await call('/verifySubscription', { token: alice.token, body: { paymentId: payId, subscriptionId: subId, signature: goodSig } });
  fakeSub.status = 'authenticated';
  await webhook('subscription.authenticated', fakeSub, { id: payId, amount: 100, currency: 'INR', status: 'captured' });
  check('verify ×2 + authenticated webhook → one sub row, one ₹1 payment',
    (await rows('SELECT 1 FROM subscriptions WHERE user_id=$1', [alice.uid])).length === 1 &&
    (await rows("SELECT amount FROM payments WHERE user_id=$1", [alice.uid])).map((r) => r.amount).join() === '100');
  check('the server does not report the trial (the app does)', metaCalls.length === 0, String(metaCalls.length));
  check('second purchase while in trial → 409', (await call('/startSubscription', { token: alice.token })).status === 409);

  // Renewal
  const cycleEnd = Math.floor(Date.now() / 1000) + 31 * 86_400;
  Object.assign(fakeSub, { status: 'active', current_start: fakeSub.start_at, current_end: cycleEnd });
  const renewal = { id: 'pay_renew_1', amount: 19900, currency: 'INR', status: 'captured' };
  await webhook('subscription.charged', fakeSub, renewal);
  await webhook('subscription.charged', fakeSub, renewal); // retry
  const [afterCharge] = await rows('SELECT status, valid_until FROM subscriptions WHERE user_id=$1', [alice.uid]);
  check('charged → active, valid_until = cycle end', afterCharge.status === 'active' && afterCharge.valid_until === new Date(cycleEnd * 1000).toISOString(), JSON.stringify(afterCharge));
  const pays = await rows('SELECT type, amount FROM payments WHERE user_id=$1 ORDER BY created_at', [alice.uid]);
  check('retried charged webhook → still one ₹199 renewal', pays.map((p) => `${p.type}:${p.amount}`).join() === 'trial:100,renewal:19900', JSON.stringify(pays));
  await new Promise((r) => setTimeout(r, 300));
  const renewalEvents = metaCalls.filter((c) => c.body.data[0].event_id === 'renewal:pay_renew_1');
  const ev = renewalEvents[0]?.body.data[0];
  check('renewal reported to Meta once, despite the retry', renewalEvents.length === 1, String(renewalEvents.length));
  check('…as fb_mobile_purchase, ₹199.00 INR, action_source app, to dataset v26.0',
    ev && ev.event_name === 'fb_mobile_purchase' && ev.custom_data.value === '199.00' && ev.custom_data.currency === 'INR' && ev.action_source === 'app'
      && renewalEvents[0].url.includes('/v26.0/ds_test/events'), JSON.stringify(ev));
  check('…with the install id, advertising id and a 16-field extinfo',
    ev && ev.user_data.anon_id === 'XZ-anon-alice' && ev.user_data.madid === 'gaid-alice' && ev.app_data.extinfo.length === 16 && ev.app_data.extinfo[4] === '14' && ev.app_data.extinfo[2] === '1.2' && ev.app_data.advertiser_tracking_enabled === 1, JSON.stringify(ev?.user_data));
  const badHook = await realFetch(BASE + '/webhooks/razorpay', { method: 'POST', headers: { 'X-Razorpay-Signature': 'nope' }, body: '{}' });
  check('webhook with bad signature → 400', badHook.status === 400);
  // Another app on the shared Razorpay account: same uid shape in notes, different plan.
  const foreign = { id: 'sub_other_app', status: 'authenticated', plan_id: 'plan_calory', start_at: fakeSub.start_at,
    current_start: null, current_end: null, charge_at: null, ended_at: null, notes: { uid: bob.uid } };
  const fh = await webhook('subscription.authenticated', foreign, { id: 'pay_other_app', amount: 9900, currency: 'INR', status: 'captured' });
  await webhook('subscription.charged', foreign, { id: 'pay_other_app2', amount: 9900, currency: 'INR', status: 'captured' });
  check("another app's events → 200 and ignored", fh.status === 200 &&
    (await rows("SELECT 1 FROM subscriptions WHERE mandate_id='sub_other_app'")).length === 0 &&
    (await rows("SELECT 1 FROM payments WHERE provider_txn_id LIKE 'pay_other_app%'")).length === 0);
  const ent = (await call('/getEntitlement', { token: alice.token })).data;
  check('entitlement: premium, active', ent.premium === true && ent.status === 'active', JSON.stringify(ent));

  // Isolation + cancel
  check("bob's cancel does not touch alice", (await call('/cancelSubscription', { token: bob.token })).data.cancelled === false &&
    (await rows('SELECT status FROM subscriptions WHERE user_id=$1', [alice.uid]))[0].status === 'active');
  const c = await call('/cancelSubscription', { token: alice.token });
  check('cancel → stopped at Razorpay and marked cancelled', c.data.cancelled === true && fakeSub.status === 'cancelled');
  const ent2 = (await call('/getEntitlement', { token: alice.token })).data;
  check('cancel ends premium immediately', ent2.premium === false && ent2.status === 'cancelled', JSON.stringify(ent2));
  check('…and the paywall offers no second trial', ent2.trialEligible === false, JSON.stringify(ent2));

  // Coming back: no ₹1 trial, the first 30 days are charged now.
  const back = await call('/startSubscription', { token: alice.token });
  const paidSub = subs.get(back.data.checkout?.subscriptionId);
  check('returning user → checkout without trial', back.data.trial === false && paidSub && !paidSub.start_at && !paidSub._addons && paidSub.notes.trial === '0', JSON.stringify({ trial: back.data.trial, start_at: paidSub?.start_at, addons: paidSub?._addons, notes: paidSub?.notes }));
  paidSub.status = 'authenticated';
  const pv = await call('/verifySubscription', { token: alice.token, body: { paymentId: 'pay_a199', subscriptionId: paidSub.id, signature: sign(`pay_a199|${paidSub.id}`, 'key_secret') } });
  check('returning user pays → active for 30 days', pv.data.status === 'active' && Math.abs(Date.parse(pv.data.validUntil) - Date.now() - 30 * 86_400_000) < 60_000, JSON.stringify(pv.data));
  check('…recorded as a ₹199 charge', (await rows("SELECT amount FROM payments WHERE provider_txn_id = 'pay_a199'")).map((r) => r.amount).join() === '19900');
  await call('/cancelSubscription', { token: alice.token });

  const fresh = (await call('/auth/google', { body: { idToken: 'erin' } })).data;
  check('new user → trial offered', (await call('/getEntitlement', { token: fresh.token })).data.trialEligible === true);

  // Halted renewal for bob
  const bs = await call('/startSubscription', { token: bob.token });
  const bobSub = subs.get(bs.data.checkout.subscriptionId);
  await call('/verifySubscription', { token: bob.token, body: { paymentId: 'pay_b1', subscriptionId: bobSub.id, signature: sign(`pay_b1|${bobSub.id}`, 'key_secret') } });
  bobSub.status = 'halted';
  await webhook('subscription.halted', bobSub);
  check('halted → failed, premium off', (await call('/getEntitlement', { token: bob.token })).data.premium === false);

  // Missed webhook: the paid period ran out but Razorpay renewed it.
  const dave = (await call('/auth/google', { body: { idToken: 'dave' } })).data;
  const ds = await call('/startSubscription', { token: dave.token });
  const daveSub = subs.get(ds.data.checkout.subscriptionId);
  await call('/verifySubscription', { token: dave.token, body: { paymentId: 'pay_d1', subscriptionId: daveSub.id, signature: sign(`pay_d1|${daveSub.id}`, 'key_secret') } });
  await db.query("UPDATE subscriptions SET valid_until = '2020-01-01T00:00:00.000Z' WHERE user_id = $1", [dave.uid]);
  const nextEnd = Math.floor(Date.now() / 1000) + 30 * 86_400;
  Object.assign(daveSub, { status: 'active', current_end: nextEnd, _invoices: [
    { status: 'paid', payment_id: 'pay_d1', amount: 100, date: 1 },
    { status: 'paid', payment_id: 'pay_d2', amount: 19900, date: 2 },
  ] });
  const de = (await call('/getEntitlement', { token: dave.token })).data;
  check('missed renewal webhook → entitlement asks Razorpay, stays premium', de.premium === true && de.status === 'active' && de.validUntil === new Date(nextEnd * 1000).toISOString(), JSON.stringify(de));
  check('…and records the ₹199 it missed, once', (await rows("SELECT amount FROM payments WHERE user_id=$1 AND type='renewal'", [dave.uid])).map((r) => r.amount).join() === '19900');
  await db.query("UPDATE subscriptions SET valid_until = '2020-01-01T00:00:00.000Z' WHERE user_id = $1", [dave.uid]);
  daveSub.status = 'halted';
  const dh = (await call('/getEntitlement', { token: dave.token })).data;
  check('missed halted webhook → entitlement asks Razorpay, premium off', dh.premium === false, JSON.stringify(dh));

  // Lost redirect: checkout paid at Razorpay, but the app never called verify.
  const carol = (await call('/auth/google', { body: { idToken: 'carol' } })).data;
  const cs = await call('/startSubscription', { token: carol.token });
  const carolSub = subs.get(cs.data.checkout.subscriptionId);
  check('sync before paying → pending', (await call('/syncSubscription', { token: carol.token, body: { subscriptionId: carolSub.id } })).data.status === 'pending');
  check("sync someone else's subscription → 403", (await call('/syncSubscription', { token: bob.token, body: { subscriptionId: carolSub.id } })).status === 403);
  carolSub.status = 'authenticated';
  const synced = await call('/syncSubscription', { token: carol.token, body: { subscriptionId: carolSub.id } });
  check('sync after paying → trial, no signature needed', synced.data.status === 'trial' && synced.data.provider === 'razorpay', JSON.stringify(synced.data));
  await call('/syncSubscription', { token: carol.token, body: { subscriptionId: carolSub.id } });
  check('sync twice → still one subscription row', (await rows('SELECT 1 FROM subscriptions WHERE user_id=$1', [carol.uid])).length === 1);

  // Account deletion: never cancels; paid accounts are kept and restorable
  const carolStatusBefore = carolSub.status;
  const dc = await call('/deleteAccount', { token: carol.token, body: { appVersion: '1.4.0' } });
  check('deleteAccount (live trial) → deleted', dc.data.deleted === true, JSON.stringify(dc.data));
  check('old session no longer works', (await call('/getEntitlement', { token: carol.token })).status === 401);
  check('…mandate NOT stopped at Razorpay', carolSub.status === carolStatusBefore && carolSub.status !== 'cancelled', carolSub.status);
  check('…subscription row untouched', (await rows('SELECT status FROM subscriptions WHERE user_id=$1', [carol.uid]))[0].status === 'trial');
  const [cu] = await rows('SELECT google_sub, email, deleted_at FROM users WHERE id=$1', [carol.uid]);
  check('…identity kept, marked deleted', cu.google_sub !== null && cu.email !== null && cu.deleted_at !== null, JSON.stringify(cu));
  const carol2 = (await call('/auth/google', { body: { idToken: 'carol' } })).data;
  check('same Google account afterwards → same user', carol2.uid === carol.uid, JSON.stringify(carol2));
  check('…Premium restored', (await call('/getEntitlement', { token: carol2.token })).data.premium === true);
  check('…no longer marked deleted', (await rows('SELECT deleted_at FROM users WHERE id=$1', [carol.uid]))[0].deleted_at === null);

  const d = await call('/deleteAccount', { token: alice.token, body: { appVersion: '1.4.0' } });
  check('deleteAccount (paid, cancelled) → deleted', d.data.deleted === true, JSON.stringify(d.data));
  check('payment records kept', (await rows('SELECT 1 FROM payments WHERE user_id=$1', [alice.uid])).length === 3);
  const again = (await call('/auth/google', { body: { idToken: 'alice' } })).data;
  check('paid account comes back on sign-in', again.uid === alice.uid);
  check('…still no second trial', (await call('/getEntitlement', { token: again.token })).data.trialEligible === false);

  const frank = (await call('/auth/google', { body: { idToken: 'frank' } })).data;
  await call('/deleteAccount', { token: frank.token, body: { appVersion: '1.4.0' } });
  const [fu] = await rows('SELECT google_sub, email, name, deleted_at FROM users WHERE id=$1', [frank.uid]);
  check('never-paid account → personal data erased', fu.google_sub === null && fu.email === null && fu.name === null && fu.deleted_at !== null, JSON.stringify(fu));
  const frank2 = (await call('/auth/google', { body: { idToken: 'frank' } })).data;
  check('…and signing in again makes a fresh user', frank2.uid && frank2.uid !== frank.uid);

  // A 1.3 app promised "cancelled straight away": it still gets that.
  const gina = (await call('/auth/google', { body: { idToken: 'gina' } })).data;
  const gs = await call('/startSubscription', { token: gina.token });
  const ginaSub = subs.get(gs.data.checkout.subscriptionId);
  ginaSub.status = 'authenticated';
  await call('/syncSubscription', { token: gina.token, body: { subscriptionId: ginaSub.id } });
  await call('/deleteAccount', { token: gina.token, body: { appVersion: '1.3.0' } });
  check('1.3 delete → mandate stopped at Razorpay', ginaSub.status === 'cancelled', ginaSub.status);
  check('…subscription expired', (await rows('SELECT status FROM subscriptions WHERE user_id=$1', [gina.uid]))[0].status === 'expired');
  check('…personal data erased', (await rows('SELECT email FROM users WHERE id=$1', [gina.uid]))[0].email === null);

  // Rate limit on sign-in (30 / 15 min / IP; this run has used 11)
  let limited = 0;
  for (let i = 0; i < 30; i++) if ((await call('/auth/google', { body: { idToken: 'forged-x' } })).status === 429) limited++;
  check('sign-in rate limit kicks in', limited > 0, `429s: ${limited}`);

  // Database outage must not kill the process
  await db.end();
  const DATA = process.env.PG_DATA_DIR;
  if (!DATA) {
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED (database-outage check skipped: set PG_DATA_DIR)');
    process.exit(failures ? 1 : 0);
  }
  const { execSync } = require('child_process');
  // pg_ctl from PATH, or from PG_BIN (e.g. $(brew --prefix postgresql@16)/bin).
  const PG = process.env.PG_BIN ? `${process.env.PG_BIN}/` : '';
  execSync(`${PG}pg_ctl -D ${DATA} stop -m fast`, { stdio: 'ignore' });
  const down = await call('/getEntitlement', { token: bob.token });
  check('DB down → 500, generic message', down.status === 500 && !String(down.data).includes('ECONNREFUSED'), `${down.status} ${down.data}`);
  check('server still alive after DB error', (await call('/health', { method: 'GET' })).status === 200);
  execSync(`${PG}pg_ctl -D ${DATA} -o "-p ${new URL(process.env.TEST_DATABASE_URL).port || 5432} -k ''" -l ${DATA}/../pg.log start`, { stdio: 'ignore' });

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
