import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handlePayPalRecoverFulfillment, handlePayPalWebhook } from '../paypal-orders.js';
import worker from '../worker.js';

// Recovery of a PAID order stuck in FULFILLING (docs/stuck-fulfilling-recovery-design-2026-10-14.md).
// Real SQLite shaped like production (pre-0002 DDL + migrations 0002 and 0003), a fake PayPal and a fake
// mail provider. No network, no secrets. The fake counts every request so "no capture, no charge" is proven.

const migration0002 = await readFile(new URL('../migrations/0002_paypal_security_hardening.sql', import.meta.url), 'utf8');
const migration0003 = await readFile(new URL('../migrations/0003_after_sale_and_reissue.sql', import.meta.url), 'utf8');
const PRE_0002 = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, r2_key TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO photos VALUES ('photo-1', 'Photo One', 'photo-1.jpg');
`;

const ORDER = 'PAYPALORDER12345';
const CAPTURE = 'CAPTURE1234567';
const LOCAL = 'local-order-1';
const TOKEN = 'stored-fulfillment-token-1';
const PRICE = 10000;
const INBOX = 'test-inbox@example.com';
const ADMIN = 'a-test-admin-password';

function setup({ status = 'FULFILLING', capture = CAPTURE, token = TOKEN, type = 'digital', mail = false, wrap } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(PRE_0002);
  sqlite.exec(migration0002);
  sqlite.exec(migration0003);
  sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, fulfillment_token, created_at) VALUES (?, ?, ?, 'photo-1', 'large', ?, 'ILS', ?, ?, ?, '2026-10-01T00:00:00Z')")
    .run(LOCAL, ORDER, type, PRICE, status, capture, token);
  const base = {
    prepare(sql) {
      const run = args => ({
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => run(args), ...run([]) };
    },
  };
  const env = {
    sqlite, DB: base, ADMIN_PASSWORD: ADMIN,
    PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id',
    PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false',
    ...(mail ? { RESEND_API_KEY: 'fake-resend-key', DOWNLOAD_EMAIL_ENABLED: 'true', DOWNLOAD_EMAIL_OVERRIDE_TO: INBOX, PUBLIC_BASE_URL: 'https://amitphotos.com' } : {}),
  };
  if (wrap) env.DB = wrap(base, sqlite);
  return env;
}

// Fake PayPal + fake mail provider in one fetch; every request is recorded.
function fakes({ lookup = {}, onLookup, orderFails = false, networkError = false } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  const mails = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    calls.push((options.method || 'GET') + ' ' + u.hostname + u.pathname);
    if (u.hostname === 'api.resend.com') { mails.push(JSON.parse(options.body)); return Response.json({ id: 'mail-1' }); }
    if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
    if (u.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
    if (u.pathname.startsWith('/v2/checkout/orders/') && !u.pathname.endsWith('/capture')) {
      if (networkError) throw new Error('network down');
      if (orderFails) return Response.json({ message: 'internal ' + CAPTURE }, { status: 500 });
      const capture = { id: CAPTURE, status: 'COMPLETED', custom_id: LOCAL, amount: { currency_code: 'ILS', value: '100.00' }, ...(lookup.capture || {}) };
      const body = {
        id: ORDER, status: 'COMPLETED', payer: { email_address: 'payer@example.com' },
        purchase_units: [{ custom_id: LOCAL, payments: { captures: [capture] }, ...(lookup.unit || {}) }], ...(lookup.order || {}),
      };
      if (onLookup) await onLookup();
      return Response.json(body);
    }
    return Response.json({}, { status: 404 });   // any other PayPal path (including a capture) is not allowed to exist
  };
  return {
    calls, mails,
    paypalCalls: () => calls.filter(c => c.includes('paypal.com')),
    restore() { globalThis.fetch = original; },
  };
}

const recover = (env, key, body = {}, headers = {}) => handlePayPalRecoverFulfillment(
  new Request('https://amitphotos.com/api/admin/paypal/recover-fulfillment', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...headers },
    body: JSON.stringify({ paypalOrderId: ORDER, reason: 'stuck paid order', ...body }),
  }), env);
const order = env => env.sqlite.prepare('SELECT status, fulfillment_json AS f, paypal_capture_id AS c, fulfillment_token AS t FROM paypal_orders WHERE id = ?').get(LOCAL);
const tokens = env => env.sqlite.prepare('SELECT token, used, tx FROM download_tokens').all();
const actions = env => env.sqlite.prepare("SELECT status, request_id AS k, reason FROM paypal_order_actions WHERE action = 'RECOVER_FULFILLMENT' ORDER BY id").all();
const setOrder = (env, sql) => env.sqlite.exec('UPDATE paypal_orders SET ' + sql + " WHERE id = '" + LOCAL + "'");
const KEY = n => 'recover-key-' + String(n).padStart(4, '0');
const noCapture = net => assert.ok(!net.calls.some(c => /capture/i.test(c) && !c.startsWith('GET')) && !net.calls.some(c => c.endsWith('/capture')), 'no capture request of any kind: ' + net.calls.join(' | '));

// ----- happy path -------------------------------------------------------------------------------------------------------------

test('a verified paid order stuck in FULFILLING is completed through the shared path: one token, read-only PayPal, nothing sensitive in the response or the audit', async () => {
  const env = setup();
  env.sqlite.prepare("INSERT INTO settings (key, value) VALUES ('digital_checkout_switch', ?)").run(JSON.stringify({ state: 'frozen', closedAt: '2026-10-14T00:00:00.000Z' }));
  const net = fakes();
  try {
    const res = await recover(env, KEY(1));
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text), { ok: true, replayed: false, status: 'COMPLETED' });
    for (const hidden of [TOKEN, CAPTURE, '/api/download', 'payer@example.com', 'fake-secret', 'token']) assert.ok(!text.includes(hidden), 'response must not contain ' + hidden);
    assert.equal(order(env).status, 'COMPLETED');
    assert.deepEqual(tokens(env).map(t => [t.token, t.used, t.tx]), [[TOKEN, 0, CAPTURE]], 'exactly the stored token');
    assert.equal(JSON.parse(order(env).f).url, '/api/download/' + TOKEN);
    assert.deepEqual(net.paypalCalls(), ['POST api-m.sandbox.paypal.com/v1/oauth2/token', 'GET api-m.sandbox.paypal.com/v2/checkout/orders/' + ORDER]);
    noCapture(net);
    const rows = actions(env);
    assert.deepEqual(rows.map(r => [r.status, r.k]), [['DONE', KEY(1)]]);
    assert.ok(/outcome=COMPLETED/.test(rows[0].reason));
    const audit = JSON.stringify(env.sqlite.prepare('SELECT * FROM paypal_order_actions').all());
    for (const hidden of [TOKEN, '/api/download', 'fake-secret', 'payer@example.com']) assert.ok(!audit.includes(hidden), 'audit must not contain ' + hidden);
  } finally { net.restore(); }
});

test('payment flags false and a frozen switch do not block it; the same key replays, a new key after completion changes nothing and asks PayPal nothing', async () => {
  const env = setup();
  const net = fakes();
  try {
    assert.equal((await recover(env, KEY(1))).status, 200);
    const calls = net.calls.length;
    const replay = await recover(env, KEY(1));
    assert.deepEqual(await replay.json(), { ok: true, replayed: true, status: 'COMPLETED' });
    const other = await recover(env, KEY(2));
    assert.deepEqual(await other.json(), { ok: true, alreadyCompleted: true, status: 'COMPLETED' });
    assert.equal(net.calls.length, calls, 'no further PayPal request');
    assert.equal(tokens(env).length, 1);
  } finally { net.restore(); }
});

test('the completion mail goes out once, from the shared path, to the explicit test recipient only; a replay sends nothing', async () => {
  const env = setup({ mail: true });
  const net = fakes();
  try {
    assert.equal((await recover(env, KEY(1))).status, 200);
    assert.equal(net.mails.length, 1);
    assert.equal(net.mails[0].to, INBOX);
    await recover(env, KEY(1));
    await recover(env, KEY(2));
    assert.equal(net.mails.length, 1);
  } finally { net.restore(); }
});

// ----- input: no manual capture --------------------------------------------------------------------------------------------

test('a capture id (or token, or any extra field) cannot be supplied: refused before anything is read or called, nothing audited', async () => {
  const env = setup();
  const net = fakes();
  try {
    for (const extra of [{ captureId: 'EVIL12345678' }, { paypalCaptureId: 'EVIL12345678' }, { fulfillmentToken: 'x'.repeat(36) }, { amount: 1 }]) {
      const res = await recover(env, KEY(7), extra);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'UNEXPECTED_FIELDS');
    }
    assert.deepEqual(net.calls, []);
    assert.equal(order(env).status, 'FULFILLING');
    assert.deepEqual(actions(env), []);
    assert.equal((await recover(env, 'short')).status, 400, 'key format');
    assert.equal((await recover(env, KEY(8), { reason: '' })).status, 400, 'reason required');
    assert.equal((await recover(env, KEY(8), { paypalOrderId: 'bad id!' })).status, 400);
  } finally { net.restore(); }
});

// ----- authentication, through the real router ---------------------------------------------------------------------------

test('the route is admin-only: no password / wrong password is 401 and touches nothing; the right one works', async () => {
  const env = setup();
  const net = fakes();
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = headers => worker.fetch(new Request('https://amitphotos.com/api/admin/paypal/recover-fulfillment', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY(1), ...headers },
    body: JSON.stringify({ paypalOrderId: ORDER, reason: 'stuck paid order' }),
  }), env, ctx);
  try {
    assert.equal((await call({})).status, 401);
    assert.equal((await call({ 'X-Admin-Password': 'wrong' })).status, 401);
    assert.deepEqual(net.calls, []);
    assert.equal(order(env).status, 'FULFILLING');
    assert.deepEqual(actions(env), []);
    assert.equal((await call({ 'X-Admin-Password': ADMIN })).status, 200);
    assert.equal(order(env).status, 'COMPLETED');
    const get = await worker.fetch(new Request('https://amitphotos.com/api/admin/paypal/recover-fulfillment', { headers: { 'X-Admin-Password': ADMIN } }), env, ctx);
    assert.equal(get.status, 405);
  } finally { net.restore(); }
});

// ----- PayPal verification failures -------------------------------------------------------------------------------------

test('PayPal lookup failing (error, network, garbage) completes nothing, is audited as FAILED, never blocks a later attempt, and leaks no PayPal text', async () => {
  for (const mode of [{ orderFails: true }, { networkError: true }]) {
    const env = setup();
    const net = fakes(mode);
    try {
      const res = await recover(env, KEY(1));
      const text = await res.text();
      assert.equal(res.status, 502);
      assert.deepEqual(JSON.parse(text), { error: 'PAYPAL_LOOKUP_FAILED' });
      assert.ok(!text.includes(CAPTURE) && !text.includes('internal'));
      assert.equal(order(env).status, 'FULFILLING');
      assert.deepEqual(tokens(env), []);
      assert.deepEqual(actions(env).map(r => r.status), ['FAILED']);
      noCapture(net);
      net.restore();
      const healthy = fakes();
      try {
        const retry = await recover(env, KEY(2));
        assert.equal(retry.status, 200, 'a failed attempt does not lock the order');
        assert.equal(tokens(env).length, 1);
      } finally { healthy.restore(); }
      const reuse = await recover(env, KEY(1));
      assert.equal(reuse.status, 409);
      assert.equal((await reuse.json()).error, 'KEY_ALREADY_USED_USE_A_NEW_KEY');
    } finally { net.restore(); }
  }
});

test('PayPal says the payment is not what we recorded (amount, currency, order, custom id, capture id, order or capture status): nothing is minted', async () => {
  const cases = {
    'amount differs': { capture: { amount: { currency_code: 'ILS', value: '99.00' } } },
    'currency differs': { capture: { amount: { currency_code: 'USD', value: '100.00' } } },
    'different capture id': { capture: { id: 'OTHERCAPTURE99' } },
    'capture belongs to another order': { capture: { custom_id: 'someone-else' }, unit: { custom_id: 'someone-else' } },
    'unit custom id differs': { unit: { custom_id: 'someone-else' } },
    'order id differs': { order: { id: 'ANOTHERORDER123' } },
    'order not completed': { order: { status: 'APPROVED' } },
    'capture pending': { capture: { status: 'PENDING' } },
    'capture declined': { capture: { status: 'DECLINED' } },
    'capture fully refunded': { capture: { status: 'REFUNDED' } },
    'capture partially refunded': { capture: { status: 'PARTIALLY_REFUNDED' } },
    'no captures at all': { unit: { payments: { captures: [] } } },
  };
  for (const [label, lookup] of Object.entries(cases)) {
    const env = setup();
    const net = fakes({ lookup });
    try {
      const res = await recover(env, KEY(1));
      assert.equal(res.status, 409, label);
      assert.deepEqual(await res.json(), { error: 'PAYMENT_NOT_VERIFIED' }, label);
      assert.equal(order(env).status, 'FULFILLING', label);
      assert.deepEqual(tokens(env), [], label);
      assert.deepEqual(actions(env).map(r => r.status), ['FAILED'], label);
      noCapture(net);
    } finally { net.restore(); }
  }
});

// ----- refunds, disputes, eligibility -------------------------------------------------------------------------------------

test('refunded, reversed, revoked, in review or disputed orders are refused before PayPal is even asked', async () => {
  for (const [label, sql, code] of [
    ['refunded', "after_sale_state = 'REFUNDED'", 'ORDER_REFUNDED'],
    ['reversed', "after_sale_state = 'REVERSED'", 'ORDER_REFUNDED'],
    ['revoked', "after_sale_state = 'REVOKED_MANUAL'", 'ORDER_REFUNDED'],
    ['review required', "after_sale_state = 'REVIEW_REQUIRED'", 'AFTER_SALE_OPEN'],
    ['dispute open', 'dispute_open = 1', 'AFTER_SALE_OPEN'],
  ]) {
    const env = setup();
    setOrder(env, sql);
    const net = fakes();
    try {
      const res = await recover(env, KEY(1));
      assert.equal(res.status, 409, label);
      assert.equal((await res.json()).error, code, label);
      assert.deepEqual(net.calls, [], label + ': PayPal not asked');
      assert.deepEqual(tokens(env), [], label);
      assert.equal(order(env).status, 'FULFILLING', label);
      assert.deepEqual(actions(env).map(r => r.status), ['REFUSED'], label + ' is audited');
    } finally { net.restore(); }
  }
});

test('a refund or a dispute that lands WHILE PayPal is being asked stops the recovery (the state is re-read afterwards)', async () => {
  for (const [label, sql, code] of [['refund', "after_sale_state = 'REFUNDED'", 'ORDER_REFUNDED'], ['dispute', "dispute_open = 1, after_sale_state = 'REVIEW_REQUIRED'", 'AFTER_SALE_OPEN']]) {
    const env = setup();
    const net = fakes({ onLookup: () => setOrder(env, sql) });
    try {
      const res = await recover(env, KEY(1));
      assert.equal(res.status, 409, label);
      assert.equal((await res.json()).error, code, label);
      assert.deepEqual(tokens(env), [], label);
      assert.equal(order(env).status, 'FULFILLING', label);
      assert.deepEqual(actions(env).map(r => r.status), ['FAILED'], label);
    } finally { net.restore(); }
  }
});

test('a refund that lands between minting the link and finishing revokes the link and leaves the order unfinished', async () => {
  const env = setup({
    wrap: (base, sqlite) => ({
      prepare(sql) {
        const statement = base.prepare(sql);
        if (!sql.startsWith('INSERT OR IGNORE INTO download_tokens')) return statement;
        return { bind: (...args) => ({ ...statement.bind(...args), async run() { const r = await statement.bind(...args).run(); sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REFUNDED'"); return r; } }) };
      },
    }),
  });
  const net = fakes();
  try {
    const res = await recover(env, KEY(1));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'ORDER_REFUNDED');
    assert.equal(order(env).status, 'FULFILLING');
    assert.deepEqual(tokens(env).map(t => t.used), [2], 'the minted link was revoked');
    assert.deepEqual(actions(env).map(r => r.status), ['FAILED']);
  } finally { net.restore(); }
});

test('ineligible orders are refused and audited: unknown, not digital, not FULFILLING, capture or token missing', async () => {
  const unknown = setup();
  let net = fakes();
  try {
    const res = await recover(unknown, KEY(1), { paypalOrderId: 'NOSUCHORDER123' });
    assert.equal(res.status, 404);
    assert.equal(unknown.sqlite.prepare("SELECT order_ref AS o, status FROM paypal_order_actions WHERE action = 'RECOVER_FULFILLMENT'").get().status, 'REFUSED');
  } finally { net.restore(); }
  for (const [label, options, reason] of [
    ['print order', { type: 'print' }, 'NOT_DIGITAL'],
    ['still created', { status: 'CREATED' }, 'NOT_FULFILLING'],
    ['approved', { status: 'APPROVED' }, 'NOT_FULFILLING'],
  ]) {
    const env = setup(options);
    net = fakes();
    try {
      const res = await recover(env, KEY(1));
      const body = await res.json();
      assert.equal(res.status, 409, label);
      assert.deepEqual([body.error, body.reason], ['ORDER_NOT_ELIGIBLE', reason], label);
      assert.deepEqual(net.calls, [], label);
      assert.deepEqual(actions(env).map(r => r.status), ['REFUSED'], label);
    } finally { net.restore(); }
  }
  for (const [label, sql] of [['no capture id', 'paypal_capture_id = NULL'], ['no token', 'fulfillment_token = NULL']]) {
    const env = setup();
    setOrder(env, sql);
    net = fakes();
    try {
      const res = await recover(env, KEY(1));
      assert.equal(res.status, 409, label);
      assert.equal((await res.json()).error, 'STATE_INCOMPLETE', label);
      assert.deepEqual(net.calls, [], label + ': a capture id is never adopted from anywhere');
      assert.equal(order(env).c, label === 'no capture id' ? null : CAPTURE);
    } finally { net.restore(); }
  }
});

// ----- concurrency ---------------------------------------------------------------------------------------------------------

test('parallel requests with different keys: one completes, the others are refused or see it done; one token, one mail, no capture', async () => {
  const env = setup({ mail: true });
  const net = fakes();
  try {
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(n => recover(env, KEY(n))));
    const bodies = await Promise.all(results.map(r => r.json()));
    const completed = bodies.filter(b => b.ok && b.replayed === false);
    assert.equal(completed.length, 1, JSON.stringify(bodies));
    for (const [index, body] of bodies.entries()) {
      assert.ok(body.ok || body.error === 'RECOVERY_IN_PROGRESS_OR_NOT_ELIGIBLE', JSON.stringify(body));
      assert.ok(results[index].status === 200 || results[index].status === 409);
    }
    assert.equal(order(env).status, 'COMPLETED');
    assert.deepEqual(tokens(env).map(t => t.token), [TOKEN]);
    assert.equal(net.mails.length, 1);
    noCapture(net);
  } finally { net.restore(); }
});

test('parallel requests with the SAME key: one token, one mail, every caller gets a success or a clean refusal', async () => {
  const env = setup({ mail: true });
  const net = fakes();
  try {
    const results = await Promise.all([1, 2, 3, 4].map(() => recover(env, KEY(1))));
    for (const r of results) assert.ok([200, 409].includes(r.status));
    assert.equal(order(env).status, 'COMPLETED');
    assert.equal(tokens(env).length, 1);
    assert.equal(net.mails.length, 1);
    assert.equal(actions(env).length, 1);
  } finally { net.restore(); }
});

test('a PAYMENT.CAPTURE.COMPLETED webhook arriving at the same time as the recovery (both orders) gives exactly one token and one mail', async () => {
  for (const webhookFirst of [false, true]) {
    const env = setup({ mail: true });
    const net = fakes();
    const event = {
      id: 'WH-EVT-' + (webhookFirst ? 'A' : 'B'), event_type: 'PAYMENT.CAPTURE.COMPLETED', create_time: '2026-10-14T10:00:00.000Z',
      resource: {
        id: CAPTURE, status: 'COMPLETED', custom_id: LOCAL, amount: { currency_code: 'ILS', value: '100.00' },
        links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + CAPTURE }],
        supplementary_data: { related_ids: { order_id: ORDER } },
      },
    };
    const hook = () => handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', {
      method: 'POST', body: JSON.stringify(event),
      headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't1', 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': '2026-10-14T10:00:00Z' },
    }), env);
    try {
      const [first, second] = webhookFirst ? [hook(), recover(env, KEY(1))] : [recover(env, KEY(1)), hook()];
      const responses = await Promise.all([first, second]);
      for (const r of responses) assert.ok(r.status < 500, 'status ' + r.status);
      assert.equal(order(env).status, 'COMPLETED');
      assert.deepEqual(tokens(env).map(t => t.token), [TOKEN], 'one token');
      assert.equal(net.mails.length, 1, 'one mail');
      noCapture(net);
    } finally { net.restore(); }
  }
});

// ----- interruption ---------------------------------------------------------------------------------------------------------

test('interrupted while completing: the same key resumes safely (still one token, one mail); another key is held off for 10 minutes', async () => {
  let breakOnce = true;
  const env = setup({
    mail: true,
    wrap: (base) => ({
      prepare(sql) {
        if (breakOnce && sql.startsWith("UPDATE paypal_orders SET status='COMPLETED'")) { breakOnce = false; throw new Error('simulated crash: ' + CAPTURE); }
        return base.prepare(sql);
      },
    }),
  });
  const net = fakes();
  try {
    const crashed = await recover(env, KEY(1));
    const text = await crashed.text();
    assert.equal(crashed.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'RECOVERY_INTERRUPTED', retryWithSameKey: true });
    assert.ok(!text.includes('simulated') && !text.includes(CAPTURE));
    assert.equal(order(env).status, 'FULFILLING');
    assert.equal(tokens(env).length, 1, 'the link was minted before the crash');
    assert.deepEqual(actions(env).map(r => r.status), ['STARTED']);
    assert.equal(net.mails.length, 0);

    const blocked = await recover(env, KEY(2));
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).error, 'RECOVERY_IN_PROGRESS_OR_NOT_ELIGIBLE');

    const resumed = await recover(env, KEY(1));
    assert.equal(resumed.status, 200);
    assert.equal(order(env).status, 'COMPLETED');
    assert.deepEqual(tokens(env).map(t => t.token), [TOKEN]);
    assert.equal(net.mails.length, 1);
    assert.deepEqual(actions(env).map(r => r.status).filter(s => s !== 'REFUSED'), ['DONE']);
    noCapture(net);
  } finally { net.restore(); }
});

test('an interrupted attempt that a webhook then completes is closed as DONE on the next call of the same key and holds no slot', async () => {
  let breakOnce = true;
  const env = setup({
    wrap: (base) => ({
      prepare(sql) {
        if (breakOnce && sql.startsWith("UPDATE paypal_orders SET status='COMPLETED'")) { breakOnce = false; throw new Error('crash'); }
        return base.prepare(sql);
      },
    }),
  });
  const net = fakes();
  try {
    assert.equal((await recover(env, KEY(1))).status, 500);
    assert.deepEqual(actions(env).map(r => r.status), ['STARTED']);
    env.sqlite.exec("UPDATE paypal_orders SET status = 'COMPLETED', fulfillment_json = '{}' WHERE id = '" + LOCAL + "'");   // the webhook finished it
    const again = await recover(env, KEY(1));
    assert.deepEqual(await again.json(), { ok: true, alreadyCompleted: true, status: 'COMPLETED' });
    assert.deepEqual(actions(env).map(r => r.status), ['DONE']);
  } finally { net.restore(); }
});

test('after the 10-minute window a stale interrupted attempt no longer blocks a new key', async () => {
  let breakOnce = true;
  const env = setup({
    wrap: (base) => ({
      prepare(sql) {
        if (breakOnce && sql.startsWith("UPDATE paypal_orders SET status='COMPLETED'")) { breakOnce = false; throw new Error('crash'); }
        return base.prepare(sql);
      },
    }),
  });
  const net = fakes();
  try {
    assert.equal((await recover(env, KEY(1))).status, 500);
    env.sqlite.exec("UPDATE paypal_order_actions SET created_at = '2000-01-01T00:00:00.000Z' WHERE action = 'RECOVER_FULFILLMENT'");
    assert.equal((await recover(env, KEY(2))).status, 200);
    assert.deepEqual(tokens(env).map(t => t.token), [TOKEN]);
  } finally { net.restore(); }
});

// ----- the audit text and the wiring ------------------------------------------------------------------------------------

test('the audit keeps the admin reason short and scrubbed: a pasted download link or token never reaches the table', async () => {
  const env = setup();
  const net = fakes();
  try {
    const reason = 'customer sent https://amitphotos.com/checkout/download/#t=0b0e7f3a-1111-2222-3333-444455556666 and ' + 'x'.repeat(80);
    assert.equal((await recover(env, KEY(1), { reason })).status, 200);
    const stored = actions(env)[0].reason;
    for (const forbidden of ['https://', '0b0e7f3a', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx']) assert.ok(!stored.includes(forbidden), forbidden);
    assert.ok(stored.includes('customer sent'));
  } finally { net.restore(); }
});

test('source guarantees: the handler never reaches a capture endpoint or any PayPal POST, and the old advice is gone from the alert and the legacy doc is marked obsolete', async () => {
  const source = await readFile(new URL('../paypal-orders.js', import.meta.url), 'utf8');
  const start = source.indexOf('export async function handlePayPalRecoverFulfillment');
  const handler = source.slice(start, source.indexOf('// Admin: read or change the D1 checkout switch', start));
  assert.ok(handler.length > 1000);
  assert.ok(!/\/capture|method: 'POST'|createOrder|payments\/captures/.test(handler), 'no capture endpoint, no POST to PayPal');
  assert.ok(/finalizeDigitalPayPalOrder\(/.test(handler), 'goes through the shared completion path');
  assert.ok(!/body\??\.(captureId|paypalCaptureId|capture_id)/.test(handler), 'no capture id read from the request');
  const alert = await readFile(new URL('../paypal-monitoring.js', import.meta.url), 'utf8');
  const stuck = alert.slice(alert.indexOf('stuckFulfilling: id'), alert.indexOf('\n', alert.indexOf('stuckFulfilling: id')));
  assert.ok(stuck.includes('recover-fulfillment') && stuck.includes('PAYMENT.CAPTURE.COMPLETED'));
  assert.ok(!stuck.includes('והפעילו הנפקה מחדש לאחר אימות'));
  const legacy = await readFile(new URL('../docs/paypal-flow.md', import.meta.url), 'utf8');
  const section = legacy.slice(legacy.indexOf('**יצירת טוקן ידנית ב-D1:**') - 700, legacy.indexOf('**יצירת טוקן ידנית ב-D1:**') + 40);
  assert.ok(section.includes('מיושן') && section.includes('recover-fulfillment'));
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /PAYMENTS_ENABLED = "false"/);
  assert.match(toml, /DIGITAL_PAYPAL_ENABLED = "false"/);
});
