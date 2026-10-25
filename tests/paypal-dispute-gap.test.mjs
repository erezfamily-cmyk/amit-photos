import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { handlePayPalRecoverFulfillment, handlePayPalWebhook, handlePayPalAfterSaleReview, handlePayPalCaptureOrder } from '../paypal-orders.js';

// The "dispute gap" in the shared completion path: a refund/review/dispute that the DATABASE already knows must stop
// minting and completing even when it is recorded between a check and the write. Real SQLite (pre-0002 DDL + 0002 + 0003),
// fake PayPal and mail. No network. A dispute PayPal has not yet reported cannot be seen: see the last test.

const migration0002 = await readFile(new URL('../migrations/0002_paypal_security_hardening.sql', import.meta.url), 'utf8');
const migration0003 = await readFile(new URL('../migrations/0003_after_sale_and_reissue.sql', import.meta.url), 'utf8');
const PRE_0002 = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, r2_key TEXT);
INSERT INTO photos VALUES ('photo-1', 'Photo One', 'photo-1.jpg');
`;

const ORDER = 'PAYPALORDER12345';
const CAPTURE = 'CAPTURE1234567';
const LOCAL = 'local-order-1';
const TOKEN = 'stored-fulfillment-token-1';
const PRICE = 10000;
const INBOX = 'test-inbox@example.com';

// `hooks`: [{ match: sql prefix, when: 'before'|'after', once: true, run: sqlite => void }] fire around matching statements.
function setup({ migrate = true, hooks = [], status = 'FULFILLING' } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(PRE_0002);
  sqlite.exec(migration0002);
  if (migrate) sqlite.exec(migration0003);
  sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, fulfillment_token, created_at) VALUES (?, ?, 'digital', 'photo-1', 'large', ?, 'ILS', ?, ?, ?, '2026-10-01T00:00:00Z')")
    .run(LOCAL, ORDER, PRICE, status, CAPTURE, TOKEN);
  const pending = hooks.map(hook => ({ ...hook, fired: false }));
  const DB = {
    prepare(sql) {
      const fire = when => { for (const hook of pending) if (!hook.fired && hook.when === when && sql.startsWith(hook.match)) { hook.fired = true; hook.run(sqlite); } };
      const run = args => ({
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async run() { fire('before'); const result = sqlite.prepare(sql).run(...args); fire('after'); return { meta: { changes: Number(result.changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => run(args), ...run([]) };
    },
  };
  return {
    sqlite, DB, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id',
    PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false',
    RESEND_API_KEY: 'fake-resend-key', DOWNLOAD_EMAIL_ENABLED: 'true', DOWNLOAD_EMAIL_OVERRIDE_TO: INBOX, PUBLIC_BASE_URL: 'https://amitphotos.com',
  };
}
const openDispute = sqlite => sqlite.exec("UPDATE paypal_orders SET dispute_open = 1, after_sale_state = 'REVIEW_REQUIRED'");

function fakes() {
  const original = globalThis.fetch;
  const calls = [];
  const mails = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    calls.push((options.method || 'GET') + ' ' + u.hostname + u.pathname);
    if (u.hostname === 'api.resend.com') { mails.push(JSON.parse(options.body)); return Response.json({ id: 'mail-1' }); }
    if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
    if (u.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
    const capture = { id: CAPTURE, status: 'COMPLETED', custom_id: LOCAL, amount: { currency_code: 'ILS', value: '100.00' } };
    if (u.pathname.startsWith('/v2/checkout/orders/') && !u.pathname.endsWith('/capture')) {
      return Response.json({ id: ORDER, status: 'COMPLETED', payer: { email_address: 'payer@example.com' }, purchase_units: [{ custom_id: LOCAL, payments: { captures: [capture] } }] });
    }
    if (u.pathname.startsWith('/v2/payments/captures/')) return Response.json(capture);
    return Response.json({}, { status: 404 });
  };
  return { calls, mails, restore() { globalThis.fetch = original; } };
}

let counter = 0;
function webhookRequest(event) {
  return new Request('https://amitphotos.com/api/paypal/webhook', {
    method: 'POST', body: JSON.stringify(event),
    headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't' + (++counter), 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': '2026-10-14T10:00:00Z' },
  });
}
const completedEvent = () => ({
  id: 'WH-DONE-' + (++counter), event_type: 'PAYMENT.CAPTURE.COMPLETED', create_time: '2026-10-14T10:00:00.000Z',
  resource: {
    id: CAPTURE, status: 'COMPLETED', custom_id: LOCAL, amount: { currency_code: 'ILS', value: '100.00' },
    links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + CAPTURE }],
    supplementary_data: { related_ids: { order_id: ORDER } },
  },
});
const disputeEvent = (kind = 'CREATED', update = '2026-10-14T12:00:00Z') => ({
  id: 'WH-DSP-' + (++counter), event_type: 'CUSTOMER.DISPUTE.' + kind, create_time: update,
  resource: { dispute_id: 'PP-D-1', status: kind === 'RESOLVED' ? 'RESOLVED' : 'OPEN', update_time: update, disputed_transactions: [{ seller_transaction_id: CAPTURE }] },
});
const hook = (env, event) => handlePayPalWebhook(webhookRequest(event), env);
const recover = (env, key) => handlePayPalRecoverFulfillment(new Request('https://amitphotos.com/api/admin/paypal/recover-fulfillment', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ paypalOrderId: ORDER, reason: 'stuck paid order' }),
}), env);
const review = (env, key, decision) => handlePayPalAfterSaleReview(new Request('https://amitphotos.com/api/admin/paypal/after-sale-review', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ paypalOrderId: ORDER, decision, reason: 'dispute closed in our favour' }),
}), env);
const order = env => ({ ...env.sqlite.prepare('SELECT status, after_sale_state AS s, dispute_open AS d FROM paypal_orders WHERE id = ?').get(LOCAL) });
const tokens = env => env.sqlite.prepare('SELECT token, used, revoke_reason AS why FROM download_tokens').all();
const actions = env => env.sqlite.prepare("SELECT status, request_id AS k FROM paypal_order_actions WHERE action = 'RECOVER_FULFILLMENT' ORDER BY id").all();
const K = n => 'gap-key-' + String(n).padStart(4, '0');
const noCapture = net => assert.ok(!net.calls.some(c => c.endsWith('/capture')), net.calls.join(' | '));

// ----- a dispute recorded between the last read and the write ----------------------------------------------------------------

test('dispute recorded between the last read and the token write: nothing is minted, nothing completed (recovery and webhook)', async () => {
  for (const via of ['recover', 'webhook']) {
    const env = setup({ hooks: [{ match: 'INSERT OR IGNORE INTO download_tokens', when: 'before', run: openDispute }] });
    const net = fakes();
    try {
      const res = via === 'recover' ? await recover(env, K(1)) : await hook(env, completedEvent());
      assert.equal(res.status, 409, via);
      assert.deepEqual(tokens(env), [], via + ': the guarded insert wrote nothing');
      assert.deepEqual(order(env), { status: 'FULFILLING', s: 'REVIEW_REQUIRED', d: 1 }, via);
      assert.equal(net.mails.length, 0, via);
      noCapture(net);
    } finally { net.restore(); }
  }
});

test('dispute recorded between minting and completing: the order does not flip, the undelivered link is withdrawn, no mail', async () => {
  for (const via of ['recover', 'webhook']) {
    const env = setup({ hooks: [{ match: "UPDATE paypal_orders SET status='COMPLETED'", when: 'before', run: openDispute }] });
    const net = fakes();
    try {
      const res = via === 'recover' ? await recover(env, K(1)) : await hook(env, completedEvent());
      assert.equal(res.status, 409, via);
      assert.equal(order(env).status, 'FULFILLING', via);
      assert.deepEqual(tokens(env).map(t => [t.token, t.used, t.why]), [[TOKEN, 2, 'REVIEW_BEFORE_DELIVERY']], via);
      assert.equal(net.mails.length, 0, via);
      noCapture(net);
    } finally { net.restore(); }
  }
});

test('dispute recorded right after the completion check but before the status write cannot sneak through the WHERE condition', async () => {
  const env = setup({ hooks: [{ match: "UPDATE paypal_orders SET status='COMPLETED'", when: 'before', run: sqlite => sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REFUNDED'") }] });
  const net = fakes();
  try {
    const res = await recover(env, K(1));
    assert.equal(res.status, 409);
    assert.equal(order(env).status, 'FULFILLING');
    assert.deepEqual(tokens(env).map(t => t.used), [2]);
  } finally { net.restore(); }
});

// ----- a dispute EVENT arriving after the token exists ----------------------------------------------------------------------

test('crash after minting, then a dispute event arrives: the undelivered link is withdrawn; a retry is refused; after the human release the SAME link comes back and the order completes once', async () => {
  let crashed = false;
  const env = setup();
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    if (!crashed && sql.startsWith("UPDATE paypal_orders SET status='COMPLETED'")) { crashed = true; throw new Error('simulated crash'); }
    return realPrepare(sql);
  };
  const net = fakes();
  try {
    assert.equal((await recover(env, K(1))).status, 500);
    assert.deepEqual(tokens(env).map(t => t.used), [0], 'minted before the crash');
    assert.equal(order(env).status, 'FULFILLING');

    const event = await hook(env, disputeEvent('CREATED'));
    assert.equal(event.status, 200);
    assert.deepEqual(order(env), { status: 'FULFILLING', s: 'REVIEW_REQUIRED', d: 1 });
    assert.deepEqual(tokens(env).map(t => [t.used, t.why]), [[2, 'REVIEW_BEFORE_DELIVERY']], 'the dispute cancelled the undelivered token');

    const retry = await recover(env, K(1));                          // same key after the interruption
    assert.equal(retry.status, 409);
    assert.equal((await retry.json()).error, 'AFTER_SALE_OPEN');
    assert.deepEqual(actions(env).map(r => r.status), ['REFUSED'], 'the refused retry no longer holds the slot');
    const hookRetry = await hook(env, completedEvent());              // PayPal resends the completion event meanwhile
    assert.equal(hookRetry.status, 409);
    assert.equal(order(env).status, 'FULFILLING');
    assert.equal(net.mails.length, 0);

    assert.equal((await hook(env, disputeEvent('RESOLVED', '2026-10-14T13:00:00Z'))).status, 200);
    assert.equal((await recover(env, K(2))).status, 409, 'still under review until a person releases it');
    assert.equal((await review(env, K(3), 'release')).status, 200);
    const done = await recover(env, K(4));
    assert.equal(done.status, 200);
    assert.deepEqual(order(env), { status: 'COMPLETED', s: 'NONE', d: 0 });
    assert.deepEqual(tokens(env).map(t => [t.token, t.used, t.why]), [[TOKEN, 0, null]], 'one token, the stored one, usable again');
    assert.equal(net.mails.length, 1);
    noCapture(net);
  } finally { net.restore(); }
});

test('a "revoke" decision during the review is final: the link stays withdrawn and the order can never be completed', async () => {
  const env = setup({ hooks: [{ match: "UPDATE paypal_orders SET status='COMPLETED'", when: 'before', run: openDispute }] });
  const net = fakes();
  try {
    assert.equal((await recover(env, K(1))).status, 409);
    assert.equal((await hook(env, disputeEvent('RESOLVED', '2026-10-14T13:00:00Z'))).status, 200);
    assert.equal((await review(env, K(2), 'revoke')).status, 200);
    assert.equal((await recover(env, K(3))).status, 409);
    assert.equal((await hook(env, completedEvent())).status, 200, 'a refused/revoked order is acknowledged and ignored by the webhook');
    assert.equal(order(env).status, 'FULFILLING');
    assert.deepEqual(tokens(env).map(t => t.used), [2], 'never revived after a revoke decision');
    assert.equal(net.mails.length, 0);
  } finally { net.restore(); }
});

// ----- known to the database vs not yet reported ----------------------------------------------------------------------------

test('a dispute the database already knows blocks both paths from the start; both arrival orders of recovery and webhook agree', async () => {
  for (const order_ of [['recover', 'webhook'], ['webhook', 'recover']]) {
    const env = setup();
    openDispute(env.sqlite);
    const net = fakes();
    try {
      for (const via of order_) {
        const res = via === 'recover' ? await recover(env, K(1)) : await hook(env, completedEvent());
        assert.equal(res.status, 409, via);
      }
      assert.deepEqual(tokens(env), []);
      assert.equal(order(env).status, 'FULFILLING');
      assert.equal(net.mails.length, 0);
    } finally { net.restore(); }
  }
});

test('recovery, completion webhook and dispute webhook racing in every arrival order never leave a delivered order with a withdrawn link or two links', async () => {
  const names = ['recover', 'complete', 'dispute'];
  const permutations = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const permutation of permutations) {
    const env = setup();
    const net = fakes();
    const starters = {
      recover: () => recover(env, K(1)),
      complete: () => hook(env, completedEvent()),
      dispute: () => hook(env, disputeEvent('CREATED')),
    };
    try {
      const responses = await Promise.all(permutation.map(i => starters[names[i]]()));
      for (const r of responses) assert.ok(r.status < 500, permutation.join('') + ' status ' + r.status);
      const final = order(env);
      const rows = tokens(env);
      assert.ok(rows.length <= 1, 'never two links: ' + permutation.join(''));
      assert.equal(final.d, 1, 'the dispute is recorded');
      if (final.status === 'COMPLETED') {
        // delivered before the event was known: by policy the link stays until a person decides; mail at most once
        assert.deepEqual(rows.map(t => t.used), [0], permutation.join('') + ' delivered link is untouched pending the human decision');
        assert.ok(net.mails.length <= 1);
      } else {
        assert.equal(final.status, 'FULFILLING');
        assert.ok(rows.every(t => t.used === 2), permutation.join('') + ' nothing delivered, so no usable link may exist');
        assert.equal(net.mails.length, 0, permutation.join('') + ' no mail for an order that was not delivered');
      }
      noCapture(net);
    } finally { net.restore(); }
  }
});

test('a dispute event that arrives AFTER delivery does not cancel the delivered link (a person decides); reissue stays blocked. This is the boundary: PayPal has not told us earlier', async () => {
  const env = setup();
  const net = fakes();
  try {
    assert.equal((await recover(env, K(1))).status, 200);
    assert.equal(order(env).status, 'COMPLETED');
    assert.equal((await hook(env, disputeEvent('CREATED'))).status, 200);
    assert.deepEqual(order(env), { status: 'COMPLETED', s: 'REVIEW_REQUIRED', d: 1 });
    assert.deepEqual(tokens(env).map(t => [t.used, t.why]), [[0, null]], 'the delivered link is still usable until the human decision: the system cannot know about a dispute earlier than PayPal reports it');
    assert.equal((await review(env, K(2), 'revoke')).status, 200);
    assert.deepEqual(tokens(env).map(t => t.used), [2], 'the person revokes it explicitly');
  } finally { net.restore(); }
});

// ----- schema tolerance and wiring --------------------------------------------------------------------------------------------

test('before migration 0003 (no review columns) the completion works exactly as before: one token, completed', async () => {
  const env = setup({ migrate: false });
  const net = fakes();
  try {
    const res = await hook(env, completedEvent());
    assert.equal(res.status, 200);
    assert.equal(env.sqlite.prepare('SELECT status FROM paypal_orders').get().status, 'COMPLETED');
    assert.deepEqual(env.sqlite.prepare('SELECT token FROM download_tokens').all().map(t => t.token), [TOKEN]);
  } finally { net.restore(); }
});

test('the buyer capture-retry path (resume from FULFILLING) obeys the same blocking rule', async () => {
  const env = setup();
  openDispute(env.sqlite);
  env.PAYMENTS_ENABLED = 'true'; env.DIGITAL_PAYPAL_ENABLED = 'true';
  const net = fakes();
  try {
    const res = await handlePayPalCaptureOrder(new Request('https://amitphotos.com/api/paypal/capture-order', { method: 'POST', body: JSON.stringify({ paypalOrderId: ORDER }) }), env, { skipRateLimit: true });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'ORDER_UNDER_REVIEW');
    assert.deepEqual(tokens(env), []);
    assert.equal(order(env).status, 'FULFILLING');
    noCapture(net);
  } finally { net.restore(); }
});

test('source: the token insert and the completion update carry the after-sale condition themselves, and the event handler withdraws undelivered links', async () => {
  const source = await readFile(new URL('../paypal-orders.js', import.meta.url), 'utf8');
  const finalize = source.slice(source.indexOf('async function finalizeDigitalPayPalOrder'), source.indexOf('export async function handlePayPalCaptureOrder'));
  assert.match(finalize, /INSERT OR IGNORE INTO download_tokens[^`]*SELECT \?, \?, \?, \?, 0, \?, \?, \? WHERE EXISTS \(SELECT 1 FROM paypal_orders WHERE id = \? AND after_sale_state = 'NONE' AND dispute_open = 0\)/);
  assert.match(finalize, /status='FULFILLING'"\s*\+ \(reviewColumns \? " AND after_sale_state = 'NONE' AND dispute_open = 0"/);
  assert.match(source, /revokeUndeliveredTokens\(env, order, captureId, 'REVIEW_BEFORE_DELIVERY'\)/);
  assert.match(source, /status <> 'COMPLETED'/);
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /PAYMENTS_ENABLED = "false"/);
  assert.match(toml, /DIGITAL_PAYPAL_ENABLED = "false"/);
});
