import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { paymentHealthSnapshot, runPaymentHealthCheck, sendPaymentAlert, paymentAlertsEnabled } from '../paypal-monitoring.js';
import { handlePayPalHealth, handlePayPalWebhook, handlePayPalTestAlert } from '../paypal-orders.js';

// Monitoring and alerts on a REAL SQLite database shaped like production (pre-0002 + 0002 + 0003).
// CallMeBot, the mail provider and PayPal are fakes; ids are fake; no network.

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const migration0002 = await read('../migrations/0002_paypal_security_hardening.sql');
const migration0003 = await read('../migrations/0003_after_sale_and_reissue.sql');
const PRE_0002 = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, r2_key TEXT);
INSERT INTO photos VALUES ('photo-1', 'Photo One', 'photo-1.jpg');
`;
const ago = ms => new Date(Date.now() - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function setup({ migrate = true, env: extra = {} } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(PRE_0002); sqlite.exec(migration0002); if (migrate) sqlite.exec(migration0003);
  const DB = {
    prepare(sql) {
      const run = args => ({
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => run(args), ...run([]) };
    },
  };
  return { sqlite, DB, PAYMENT_ALERTS_ENABLED: 'true', CALLMEBOT_TELEGRAM_USER: 'fake-telegram-user', RESEND_API_KEY: 'fake-mail-key', ADMIN_EMAIL: 'owner@example.com',
    PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id', ...extra };
}
let n = 0;
function addOrder(env, { status = 'COMPLETED', created = ago(30 * MIN), completed = ago(10 * MIN), state = 'NONE', dispute = 0, token = true, capture = true } = {}) {
  n++;
  const id = 'local-' + n; const po = 'PAYPALORD' + String(n).padStart(4, '0'); const cap = capture ? 'CAPTURE' + String(n).padStart(6, '0') : null;
  env.sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, created_at, completed_at, after_sale_state, dispute_open) VALUES (?, ?, 'digital', 'photo-1', 'large', 10000, 'ILS', ?, ?, ?, ?, ?, ?)")
    .run(id, po, status, cap, created, status === 'COMPLETED' ? completed : null, state, dispute);
  if (token && cap) env.sqlite.prepare("INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES (?, '[]', 'large', ?, 0, ?, 1, 100)").run('tok-' + n, cap, Math.floor(Date.now() / 1000) + 3600);
  return { id, po, cap };
}
const addEvent = (env, id, { type = 'PAYMENT.CAPTURE.REFUNDED', received = ago(20 * MIN), processed = 0, attempts = 3 } = {}) =>
  env.sqlite.prepare('INSERT INTO paypal_webhook_events (event_id, event_type, received_at, processed, attempts) VALUES (?, ?, ?, ?, ?)').run(id, type, received, processed, attempts);
const addMailRows = (env, order, statuses) => statuses.forEach((status, i) =>
  env.sqlite.prepare("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, created_at) VALUES (?, ?, 'LINK_EMAIL', ?, ?, 'system', ?)").run(order.id, order.po, 'auto-' + (i + 1), status, ago(HOUR)));
const alertRows = env => env.sqlite.prepare("SELECT order_ref, paypal_order_id AS po, request_id AS key, status, reason FROM paypal_order_actions WHERE action = 'ALERT' ORDER BY id").all().map(r => ({ ...r }));

function fakes({ telegram = 'ok', email = 'ok' } = {}) {
  const original = globalThis.fetch;
  const calls = { telegram: [], email: [], other: [] };
  const state = { telegram, email, captureStatus: 'REFUNDED', customId: null };
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.callmebot.com') {
      calls.telegram.push({ user: u.searchParams.get('user'), text: u.searchParams.get('text') });
      if (state.telegram === 'throw') throw new Error('network');
      return new Response('', { status: state.telegram === 'ok' ? 200 : 500 });
    }
    if (u.hostname === 'api.resend.com') {
      const body = JSON.parse(options.body);
      calls.email.push({ to: body.to, subject: body.subject, text: body.text });
      if (state.email === 'throw') throw new Error('network');
      return new Response('{}', { status: state.email === 'ok' ? 200 : 500 });
    }
    calls.other.push(u.pathname);
    if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
    if (u.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
    if (u.pathname.startsWith('/v2/payments/captures/')) {
      return Response.json({ id: u.pathname.split('/').pop(), status: state.captureStatus, custom_id: state.customId, amount: { currency_code: 'ILS', value: '100.00' } });
    }
    return Response.json({}, { status: 404 });
  };
  return { calls, state, restore() { globalThis.fetch = original; } };
}
const allText = calls => JSON.stringify([calls.telegram, calls.email]);

// ----- snapshot ---------------------------------------------------------------------------------

test('a healthy database reports nothing and sends nothing', async () => {
  const env = setup();
  addOrder(env);                                            // paid, link issued, recent
  addOrder(env, { status: 'FULFILLING', created: ago(10 * MIN) });   // still within the normal window
  addEvent(env, 'WH-FRESH', { received: ago(5 * MIN) });
  addEvent(env, 'WH-DONE', { processed: 1, received: ago(5 * HOUR) });
  const net = fakes();
  try {
    const snapshot = await paymentHealthSnapshot(env);
    assert.equal(snapshot.healthy, true);
    assert.deepEqual(Object.values(snapshot.counts), [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(await runPaymentHealthCheck(env), { checked: true, healthy: true, sent: 0, failed: 0 });
    assert.deepEqual([net.calls.telegram, net.calls.email], [[], []]);
    assert.deepEqual(alertRows(env), []);
  } finally { net.restore(); }
});

test('the snapshot finds each problem class and ignores healthy look-alikes', async () => {
  const env = setup();
  const stuck = addOrder(env, { status: 'FULFILLING', created: ago(3 * HOUR) });
  const review = addOrder(env, { state: 'REVIEW_REQUIRED' });
  const dispute = addOrder(env, { dispute: 1, state: 'REVIEW_REQUIRED' });
  const mailDead = addOrder(env); addMailRows(env, mailDead, ['FAILED', 'FAILED', 'FAILED', 'FAILED']);
  const mailOk = addOrder(env); addMailRows(env, mailOk, ['FAILED', 'FAILED', 'FAILED', 'SENT']);
  const mailBusy = addOrder(env); addMailRows(env, mailBusy, ['FAILED', 'FAILED', 'FAILED', 'SENDING']);
  const noLink = addOrder(env, { token: false });
  const oldNoLink = addOrder(env, { token: false, completed: ago(9 * 24 * HOUR) });
  addEvent(env, 'WH-STUCK1', { received: ago(20 * MIN), processed: 0, attempts: 3 });
  addEvent(env, 'WH-STALE-LEASE', { received: ago(40 * MIN), processed: 2, attempts: 1 });
  addEvent(env, 'WH-FRESH', { received: ago(5 * MIN), processed: 0, attempts: 1 });
  const snapshot = await paymentHealthSnapshot(env);
  assert.deepEqual(snapshot.items.stuckFulfilling.map(r => r.id), [stuck.po]);
  assert.deepEqual(snapshot.items.reviewRequired.map(r => r.id).sort(), [review.po, dispute.po].sort());
  assert.deepEqual(snapshot.items.openDisputes.map(r => r.id), [dispute.po]);
  assert.deepEqual(snapshot.items.emailExhausted.map(r => r.id), [mailDead.po], 'only an order with 4 finished failures and no success');
  assert.deepEqual(snapshot.items.paidWithoutLink.map(r => r.id), [noLink.po], 'old orders are outside the 7-day window');
  assert.deepEqual(snapshot.items.unprocessedWebhooks.map(r => r.id).sort(), ['WH-STALE-LEASE', 'WH-STUCK1']);
  assert.equal(snapshot.healthy, false);
  assert.ok(![mailOk.po, mailBusy.po, oldNoLink.po].some(po => JSON.stringify(snapshot.items).includes(po)));
});

// ----- alerts: once, only ids, resilient ----------------------------------------------------------

test('each condition alerts exactly once across repeated runs; texts carry ids only, no link, address or secret', async () => {
  const env = setup();
  const stuck = addOrder(env, { status: 'FULFILLING', created: ago(3 * HOUR) });
  const dispute = addOrder(env, { dispute: 1, state: 'REVIEW_REQUIRED' });
  addEvent(env, 'WH-STUCK1');
  const net = fakes();
  try {
    const first = await runPaymentHealthCheck(env);
    assert.equal(first.sent, 4, 'stuck, webhook, review, dispute');
    const second = await runPaymentHealthCheck(env);
    assert.equal(second.sent, 0);
    assert.equal(net.calls.telegram.length, 4);
    assert.equal(net.calls.email.length, 4);
    assert.ok(net.calls.email.every(m => m.to === 'owner@example.com'));
    assert.ok(net.calls.telegram.every(m => m.user === '@fake-telegram-user'));
    const text = JSON.stringify([net.calls.telegram.map(m => m.text), net.calls.email.map(m => [m.subject, m.text])]);   // message content only (the recipient field is not content)
    for (const needle of [stuck.po, dispute.po, 'WH-STUCK1']) assert.ok(text.includes(needle), needle);
    for (const forbidden of ['http', '/api/download', 'checkout/download', 'tok-', 'fake-mail-key', 'fake-secret', 'fake-webhook-id', '@example.com', 'amount']) {
      assert.ok(!text.includes(forbidden), 'alert text must not contain ' + forbidden);
    }
    assert.deepEqual(alertRows(env).map(r => r.status), ['SENT', 'SENT', 'SENT', 'SENT']);
  } finally { net.restore(); }
});

test('alerts are off unless explicitly enabled with a channel', async () => {
  const net = fakes();
  try {
    for (const extra of [{ PAYMENT_ALERTS_ENABLED: undefined }, { PAYMENT_ALERTS_ENABLED: 'TRUE' }, { CALLMEBOT_TELEGRAM_USER: undefined, RESEND_API_KEY: undefined }]) {
      const env = setup({ env: extra });
      addOrder(env, { status: 'FULFILLING', created: ago(3 * HOUR) });
      assert.equal(paymentAlertsEnabled(env), false);
      assert.deepEqual(await runPaymentHealthCheck(env), { checked: false });
      assert.equal((await sendPaymentAlert(env, { kind: 'X', key: 'k', text: 't' })).reason, 'NOT_ENABLED');
      assert.deepEqual(alertRows(env), []);
    }
    assert.deepEqual([net.calls.telegram, net.calls.email], [[], []]);
  } finally { net.restore(); }
});

test('delivery failures release the claim so the next run retries; one working channel is enough; nothing throws', async () => {
  const env = setup();
  addOrder(env, { status: 'FULFILLING', created: ago(3 * HOUR) });
  const net = fakes({ telegram: 'throw', email: 'fail' });
  try {
    const failed = await runPaymentHealthCheck(env);
    assert.deepEqual([failed.sent, failed.failed], [0, 1]);
    assert.deepEqual(alertRows(env), [], 'claim released');
    net.state.email = 'ok';
    const retried = await runPaymentHealthCheck(env);
    assert.equal(retried.sent, 1);
    assert.deepEqual(alertRows(env).map(r => [r.status, r.reason]), [['SENT', 'STUCK_FULFILLING:email']]);
    assert.equal((await runPaymentHealthCheck(env)).sent, 0);
  } finally { net.restore(); }
});

test('a database that is behind the code (no 0003) is reported, once a day, instead of throwing', async () => {
  const env = setup({ migrate: false });
  const net = fakes();
  try {
    const snapshot = await paymentHealthSnapshot(env);
    assert.ok(snapshot.schemaProblems.length > 0);
    assert.equal(snapshot.healthy, false);
    assert.equal((await runPaymentHealthCheck(env)).sent, 0, 'cannot record the claim without the table, and must not throw');
  } finally { net.restore(); }
});

// ----- real-time: webhook path ---------------------------------------------------------------------------

function webhook(env, id, type, resource, options) {
  const event = { id, event_type: type, create_time: '2026-10-14T10:00:00Z', resource };
  return handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', {
    method: 'POST', body: JSON.stringify(event),
    headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't' + id, 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': 't' },
  }), env, options);
}
const refund = (cap, amount = '100.00') => ({ id: 'REFUND-' + cap, status: 'COMPLETED', amount: { currency_code: 'ILS', value: amount },
  links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/' + cap }] });

test('refund, partial refund, reversal and dispute alert the owner once each, even if PayPal redelivers', async () => {
  const net = fakes();
  try {
    const full = setup(); const o1 = addOrder(full);
    net.state.customId = o1.id; net.state.captureStatus = 'REFUNDED';
    assert.equal((await webhook(full, 'WH-REFUND-1', 'PAYMENT.CAPTURE.REFUNDED', refund(o1.cap))).status, 200);
    assert.equal((await webhook(full, 'WH-REFUND-1', 'PAYMENT.CAPTURE.REFUNDED', refund(o1.cap))).status, 200);   // redelivery
    assert.deepEqual(alertRows(full).map(r => [r.key, r.reason.split(':')[0]]), [['evt-WH-REFUND-1', 'AFTER_SALE_REFUNDED']]);

    const partial = setup(); const o2 = addOrder(partial);
    net.state.customId = o2.id; net.state.captureStatus = 'PARTIALLY_REFUNDED';
    await webhook(partial, 'WH-PART-1', 'PAYMENT.CAPTURE.REFUNDED', refund(o2.cap, '40.00'));
    assert.deepEqual(alertRows(partial).map(r => r.reason.split(':')[0]), ['AFTER_SALE_REVIEW_REQUIRED']);

    const reversed = setup(); const o3 = addOrder(reversed);
    net.state.customId = o3.id;
    await webhook(reversed, 'WH-REV-1', 'PAYMENT.CAPTURE.REVERSED', { id: o3.cap, status: 'REVERSED', amount: { currency_code: 'ILS', value: '100.00' } });
    assert.deepEqual(alertRows(reversed).map(r => r.reason.split(':')[0]), ['AFTER_SALE_REVERSED']);

    const disputed = setup(); const o4 = addOrder(disputed);
    await webhook(disputed, 'WH-DISP-1', 'CUSTOMER.DISPUTE.CREATED', { dispute_id: 'PP-D-1', status: 'OPEN', update_time: '2026-10-14T10:00:00Z', disputed_transactions: [{ seller_transaction_id: o4.cap }] });
    assert.deepEqual(alertRows(disputed).map(r => r.reason.split(':')[0]), ['AFTER_SALE_REVIEW_REQUIRED']);

    const text = allText(net.calls);
    for (const po of [o1.po, o2.po, o3.po, o4.po]) assert.ok(text.includes(po));
    assert.ok(!text.includes('http'));
    assert.equal(net.calls.telegram.length, 4, 'one message per distinct event');
  } finally { net.restore(); }
});

test('a webhook event that keeps failing alerts at the third failure, once; below that it stays quiet', async () => {
  const env = setup();
  const order = addOrder(env);
  const net = fakes();
  net.state.customId = 'some-other-local-order';       // identity mismatch -> 409 every time
  try {
    const statuses = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      statuses.push((await webhook(env, 'WH-BAD-1', 'PAYMENT.CAPTURE.REFUNDED', refund(order.cap))).status);
      assert.equal(alertRows(env).length, attempt >= 3 ? 1 : 0, 'attempt ' + attempt);
    }
    assert.deepEqual(statuses, [409, 409, 409, 409, 409]);
    assert.equal(net.calls.telegram.length, 1);
    assert.equal(alertRows(env)[0].key, 'wh-WH-BAD-1');
  } finally { net.restore(); }
});

test('broken alert delivery never changes the webhook outcome, and background delivery is used when the runtime offers it', async () => {
  const net = fakes({ telegram: 'throw', email: 'throw' });
  try {
    const env = setup(); const order = addOrder(env);
    net.state.customId = order.id;
    const response = await webhook(env, 'WH-REFUND-2', 'PAYMENT.CAPTURE.REFUNDED', refund(order.cap));
    assert.equal(response.status, 200);
    assert.equal(env.sqlite.prepare('SELECT after_sale_state AS s FROM paypal_orders WHERE id = ?').get(order.id).s, 'REFUNDED');

    net.state.telegram = 'ok'; net.state.email = 'ok';
    const bg = setup(); const second = addOrder(bg);
    net.state.customId = second.id;
    const pending = [];
    const result = await webhook(bg, 'WH-REFUND-3', 'PAYMENT.CAPTURE.REFUNDED', refund(second.cap), { waitUntil: p => pending.push(p) });
    assert.equal(result.status, 200);
    assert.ok(pending.length >= 1, 'the alert was handed to waitUntil');
    await Promise.all(pending);
    assert.equal(alertRows(bg).length, 1);
  } finally { net.restore(); }
});

// ----- admin health route ------------------------------------------------------------------------------------

test('the health route is read-only, needs a valid configuration, and returns no addresses, links or secrets', async () => {
  const env = setup();
  addOrder(env, { status: 'FULFILLING', created: ago(3 * HOUR) });
  addEvent(env, 'WH-STUCK1');
  const net = fakes();
  try {
    const before = JSON.stringify(env.sqlite.prepare('SELECT * FROM paypal_orders').all());
    const response = await handlePayPalHealth(new Request('https://amitphotos.com/api/admin/paypal/health'), env);
    const text = await response.text();
    assert.equal(response.status, 200);
    const body = JSON.parse(text);
    assert.equal(body.healthy, false);
    assert.deepEqual(body.counts, { stuckFulfilling: 1, unprocessedWebhooks: 1, reviewRequired: 0, openDisputes: 0, emailExhausted: 0, paidWithoutLink: 0 });
    assert.deepEqual(body.alerts, { enabled: true, channels: { telegram: true, email: true } });
    for (const forbidden of ['@', 'http', 'fake-mail-key', 'fake-secret', 'fake-webhook-id', 'tok-']) assert.ok(!text.includes(forbidden), forbidden);
    assert.equal(JSON.stringify(env.sqlite.prepare('SELECT * FROM paypal_orders').all()), before, 'nothing was modified');
    assert.deepEqual([net.calls.telegram, net.calls.email, net.calls.other], [[], [], []], 'no alert and no PayPal call');
    assert.equal((await handlePayPalHealth(new Request('https://amitphotos.com/x', { method: 'POST' }), env)).status, 405);
    assert.equal((await handlePayPalHealth(new Request('https://amitphotos.com/x'), { ...env, PAYPAL_ENVIRONMENT: 'prod' })).status, 503);
  } finally { net.restore(); }
});

// ----- admin test alert (proves the channels and the de-duplication without any real event) ------------------

const testAlert = (env, key, body = { reason: 'channel check' }, method = 'POST') => handlePayPalTestAlert(new Request('https://amitphotos.com/api/admin/paypal/test-alert', {
  method, headers: key ? { 'Idempotency-Key': key } : {}, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
}), env);

test('the test alert sends one harmless message through the real channels, a replay sends nothing, and it touches no order', async () => {
  const env = setup();
  addOrder(env);
  const net = fakes();
  try {
    const before = JSON.stringify(env.sqlite.prepare('SELECT * FROM paypal_orders').all());
    const first = await testAlert(env, 'alert-test-0001');
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, status: 'SENT', channels: ['telegram', 'email'] });
    assert.equal(net.calls.telegram.length, 1);
    assert.equal(net.calls.email.length, 1);
    const text = JSON.stringify([net.calls.telegram.map(m => m.text), net.calls.email.map(m => [m.subject, m.text])]);
    assert.match(text, /בדיקת התראה \(sandbox\)/);
    for (const forbidden of ['PAYPALORD', 'CAPTURE', 'http', '@', 'tok-', 'fake-']) assert.ok(!text.includes(forbidden), 'test alert must not contain ' + forbidden);
    const replay = await testAlert(env, 'alert-test-0001');
    assert.deepEqual(await replay.json(), { ok: true, status: 'SKIPPED', replayed: true });
    assert.equal(net.calls.telegram.length, 1, 'no second message for the same key');
    assert.equal(net.calls.email.length, 1);
    await testAlert(env, 'alert-test-0002');
    assert.equal(net.calls.telegram.length, 2, 'a new key is a new test');
    assert.equal(JSON.stringify(env.sqlite.prepare('SELECT * FROM paypal_orders').all()), before);
    assert.deepEqual(net.calls.other, [], 'no PayPal call');
  } finally { net.restore(); }
});

test('the test alert needs alerts enabled, a key and a reason, a valid configuration and POST; a dead channel reports 502 and can be retried', async () => {
  const net = fakes();
  try {
    assert.equal((await testAlert(setup({ env: { PAYMENT_ALERTS_ENABLED: undefined } }), 'alert-test-0001')).status, 409);
    const env = setup();
    assert.equal((await testAlert(env, '')).status, 400);
    assert.equal((await testAlert(env, 'short')).status, 400);
    assert.equal((await testAlert(env, 'alert-test-0001', { reason: '   ' })).status, 400);
    assert.equal((await testAlert(env, 'alert-test-0001', undefined, 'GET')).status, 405);
    assert.equal((await testAlert({ ...env, PAYPAL_ENVIRONMENT: 'prod' }, 'alert-test-0001')).status, 503);
    assert.deepEqual([net.calls.telegram, net.calls.email], [[], []]);
    net.state.telegram = 'throw'; net.state.email = 'fail';
    const dead = await testAlert(env, 'alert-test-0003');
    assert.equal(dead.status, 502);
    net.state.email = 'ok';
    assert.equal((await testAlert(env, 'alert-test-0003')).status, 200, 'the failed claim was released, so the same key can be retried');
    assert.equal(alertRows(env).length, 1);
  } finally { net.restore(); }
});
