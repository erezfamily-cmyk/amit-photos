import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  handlePayPalWebhook, handlePayPalReissueDownload, handlePayPalAfterSaleReview,
  handlePayPalOrderSupportView, handlePayPalCaptureOrder,
} from '../paypal-orders.js';
import { handleDownload } from '../worker.js';

// Refunds, reversals, disputes and admin re-issue against a REAL SQLite database
// shaped like production (pre-0002 DDL) + migrations 0002 and 0003. Fake PayPal
// responses and fake ids only: no network, no secrets, no Cloudflare.

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
const PRICE = 10000;

function setup({ status = 'COMPLETED', capture = CAPTURE, tokenUsed = 0 } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(PRE_0002);
  sqlite.exec(migration0002);
  sqlite.exec(migration0003);
  sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, fulfillment_token, created_at) VALUES (?, ?, 'digital', 'photo-1', 'large', ?, 'ILS', ?, ?, ?, '2026-10-01T00:00:00Z')")
    .run(LOCAL, ORDER, PRICE, status, capture, capture ? 'orig-token-1' : null);
  if (capture) {
    sqlite.prepare("INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES ('orig-token-1', '[\"photo-1\"]', 'large', ?, ?, ?, 1, 100)")
      .run(capture, tokenUsed, Math.floor(Date.now() / 1000) + 3600);
  }
  const DB = {
    prepare(sql) {
      const run = args => ({
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => run(args), ...run([]) };
    },
  };
  return { sqlite, DB, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id', PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false' };
}

// PayPal stub. `capture` = what GET /payments/captures returns; `orderStatus` = GET order.
function paypal({ captureStatus = 'COMPLETED', customId = LOCAL, orderStatus = 'COMPLETED', orderLookupOk = true, afterOrderGet, amount = '100.00', captureId = CAPTURE } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  const hosts = new Set();
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(String(url)).pathname;
    hosts.add(new URL(String(url)).host);
    calls.push((options.method || 'GET') + ' ' + path);
    if (path === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
    if (path === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
    const capture = { id: captureId, status: captureStatus, custom_id: customId, amount: { currency_code: 'ILS', value: amount } };
    if (path.startsWith('/v2/payments/captures/')) return Response.json(capture);
    if (path.startsWith('/v2/checkout/orders/')) {
      if (!orderLookupOk) return Response.json({}, { status: 500 });
      const body = { id: ORDER, status: orderStatus, purchase_units: [{ custom_id: customId, payments: { captures: [capture] } }] };
      if (afterOrderGet) afterOrderGet();
      return Response.json(body);
    }
    return Response.json({}, { status: 404 });
  };
  return { calls, hosts, restore() { globalThis.fetch = original; } };
}

let eventCounter = 0;
function webhook(env, type, resource, extra = {}) {
  const event = { id: 'WH-EVT-' + (++eventCounter) + '-' + type.replace(/\W/g, ''), event_type: type, create_time: '2026-10-13T10:00:00.000Z', resource, ...extra };
  return [event, handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', {
    method: 'POST', body: JSON.stringify(event),
    headers: {
      'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't' + eventCounter,
      'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': '2026-10-13T10:00:00Z',
    },
  }), env)];
}
async function send(env, type, resource, extra) {
  const [event, pending] = webhook(env, type, resource, extra);
  const response = await pending;
  return { event, response, body: await response.json() };
}
const refundResource = (amount = '100.00', extra = {}) => ({
  id: 'REFUND-' + (++eventCounter), status: 'COMPLETED', amount: { currency_code: 'ILS', value: amount },
  links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + CAPTURE }],
  supplementary_data: { related_ids: { order_id: ORDER } }, ...extra,
});

const state = env => ({ ...env.sqlite.prepare('SELECT after_sale_state AS s, dispute_open AS d, refunded_minor AS r FROM paypal_orders WHERE id = ?').get(LOCAL) });
const tokens = env => env.sqlite.prepare('SELECT token, used, tx, paypal_order_ref AS ref, expires_at FROM download_tokens ORDER BY created_at, token').all();

function reissueRequest(key, body = {}, extraHeaders = {}) {
  return new Request('https://amitphotos.com/api/admin/paypal/reissue', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...extraHeaders },
    body: JSON.stringify({ paypalOrderId: ORDER, reason: 'customer download failed', ...body }),
  });
}
const reissue = (env, key, body) => handlePayPalReissueDownload(reissueRequest(key, body), env);

// ----- webhook: refunds, reversals ------------------------------------------------

test('full refund revokes unused links, keeps a used link as used, and is idempotent', async () => {
  const env = setup();
  env.sqlite.prepare("INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount, paypal_order_ref) VALUES ('used-token-1', '[]', 'large', 'CAPTURE1234567:R1', 1, 9999999999, 2, 100, ?)").run(LOCAL);
  const stub = paypal({ captureStatus: 'REFUNDED' });
  try {
    const first = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00'));
    assert.equal(first.response.status, 200);
    assert.equal(first.body.afterSale, 'REFUNDED');
    assert.deepEqual(state(env), { s: 'REFUNDED', d: 0, r: PRICE });
    const byToken = Object.fromEntries(tokens(env).map(row => [row.token, row.used]));
    assert.equal(byToken['orig-token-1'], 2);
    assert.equal(byToken['used-token-1'], 1);

    // PayPal redelivers the same event id: acknowledged, nothing counted twice.
    const again = await handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', {
      method: 'POST', body: JSON.stringify(first.event),
      headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 'again', 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': 't' },
    }), env);
    assert.equal((await again.json()).duplicate, true);
    assert.equal(state(env).r, PRICE);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM paypal_order_actions WHERE action = 'AFTER_SALE_EVENT'").get().n, 1);
  } finally { stub.restore(); }
});

test('a partial refund only flags manual review; refunds that add up to the price become a full refund', async () => {
  const env = setup();
  const stub = paypal({ captureStatus: 'PARTIALLY_REFUNDED' });
  try {
    const first = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('40.00'));
    assert.equal(first.body.afterSale, 'REVIEW_REQUIRED');
    assert.deepEqual(state(env), { s: 'REVIEW_REQUIRED', d: 0, r: 4000 });
    assert.equal(tokens(env)[0].used, 0, 'a partial refund must not revoke anything automatically');
    const second = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('60.00'));
    assert.equal(second.body.afterSale, 'REFUNDED');
    assert.deepEqual(state(env), { s: 'REFUNDED', d: 0, r: PRICE });
    assert.equal(tokens(env)[0].used, 2);
  } finally { stub.restore(); }
});

test('a refund in another currency is not counted as a price match and needs review', async () => {
  const env = setup();
  const stub = paypal({ captureStatus: 'COMPLETED' });
  try {
    const result = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', { amount: { currency_code: 'USD', value: '100.00' } }));
    assert.equal(result.body.afterSale, 'REVIEW_REQUIRED');
    assert.equal(state(env).r, 0);
    assert.equal(tokens(env)[0].used, 0);
  } finally { stub.restore(); }
});

test('a reversal revokes unused links and a later refund event never lowers the state', async () => {
  const env = setup();
  const stub = paypal();
  try {
    const reversed = await send(env, 'PAYMENT.CAPTURE.REVERSED', { id: CAPTURE, status: 'REVERSED', amount: { currency_code: 'ILS', value: '100.00' }, supplementary_data: { related_ids: { order_id: ORDER } } });
    assert.equal(reversed.body.afterSale, 'REVERSED');
    assert.equal(tokens(env)[0].used, 2);
    paypal({ captureStatus: 'REFUNDED' });
    await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00'));
    assert.equal(state(env).s, 'REVERSED');
  } finally { stub.restore(); }
});

test('a refund that arrives before the order is fulfilled blocks the late COMPLETED event', async () => {
  const env = setup({ status: 'CREATED', capture: null });
  env.sqlite.prepare('DELETE FROM download_tokens').run();
  const stub = paypal({ captureStatus: 'REFUNDED' });
  try {
    const refund = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00'));
    assert.equal(refund.response.status, 200);
    assert.equal(state(env).s, 'REFUNDED');
    const completed = await send(env, 'PAYMENT.CAPTURE.COMPLETED', {
      id: CAPTURE, status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' },
      supplementary_data: { related_ids: { order_id: ORDER } },
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.ignored, true);
    assert.equal(tokens(env).length, 0, 'no download link may be minted for a refunded order');
    assert.equal(env.sqlite.prepare('SELECT status FROM paypal_orders WHERE id = ?').get(LOCAL).status, 'CREATED');
  } finally { stub.restore(); }
});

test('events for unknown orders are acknowledged; identity mismatches are refused and retried', async () => {
  const env = setup();
  const stub = paypal({ captureStatus: 'REFUNDED' });
  try {
    const unknown = await send(env, 'PAYMENT.CAPTURE.REFUNDED', {
      ...refundResource('100.00'),
      links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/OTHERCAPTURE99' }],
      supplementary_data: { related_ids: { order_id: 'SOMEOTHERORDER1' } },
    });
    assert.equal(unknown.body.ignored, true);
    assert.equal(state(env).s, 'NONE');

    paypal({ captureStatus: 'REFUNDED', customId: 'some-other-local-order' });
    const mismatch = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00'));
    assert.equal(mismatch.response.status, 409);
    assert.equal(state(env).s, 'NONE');
    assert.equal(tokens(env)[0].used, 0);
    // The lease was released, so PayPal's retry is processed again.
    assert.equal(env.sqlite.prepare('SELECT processed FROM paypal_webhook_events WHERE event_id = ?').get(mismatch.event.id)?.processed, 0);

    const wrongCapture = setup({ capture: 'DIFFERENTCAP123' });
    paypal({ captureStatus: 'REFUNDED' });
    const refused = await send(wrongCapture, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', {
      links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + CAPTURE }],
    }));
    assert.equal(refused.response.status, 409, 'order matches but the capture belongs to another payment');
    assert.equal(state(wrongCapture).s, 'NONE');
  } finally { stub.restore(); }
});

test('an unsigned event is rejected before it can change anything', async () => {
  const env = setup();
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'token' });
    return Response.json({ verification_status: 'FAILURE' });
  };
  try {
    const result = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00'));
    assert.equal(result.response.status, 401);
    assert.equal(state(env).s, 'NONE');
  } finally { globalThis.fetch = original; }
});

// ----- webhook: disputes ----------------------------------------------------------------

const dispute = (status, at) => ({ dispute_id: 'PP-D-1', status, update_time: at, disputed_transactions: [{ seller_transaction_id: CAPTURE }] });

test('disputes need manual review, resolution does not auto-release, and a late older event cannot reopen', async () => {
  const env = setup();
  const stub = paypal();
  try {
    await send(env, 'CUSTOMER.DISPUTE.CREATED', dispute('OPEN', '2026-10-13T10:00:00.000Z'));
    assert.deepEqual(state(env), { s: 'REVIEW_REQUIRED', d: 1, r: 0 });
    assert.equal(tokens(env)[0].used, 0, 'a dispute alone does not revoke links');
    await send(env, 'CUSTOMER.DISPUTE.RESOLVED', dispute('RESOLVED', '2026-10-14T10:00:00.000Z'));
    assert.deepEqual(state(env), { s: 'REVIEW_REQUIRED', d: 0, r: 0 });
    await send(env, 'CUSTOMER.DISPUTE.UPDATED', dispute('UNDER_REVIEW', '2026-10-13T12:00:00.000Z'));
    assert.equal(state(env).d, 0, 'older event must not reopen a resolved dispute');
    const unknown = await send(env, 'CUSTOMER.DISPUTE.CREATED', { ...dispute('OPEN', '2026-10-15T10:00:00.000Z'), disputed_transactions: [{ seller_transaction_id: 'NOTOURS123456' }] });
    assert.equal(unknown.body.ignored, true);
  } finally { stub.restore(); }
});

// ----- admin re-issue --------------------------------------------------------------------

test('re-issue gives a new one-time link for the same order, revokes the old unused one, and never creates or captures', async () => {
  const env = setup();
  const stub = paypal();
  const logged = [];
  const originals = ['log', 'info', 'warn', 'error'].map(name => [name, console[name]]);
  for (const [name] of originals) console[name] = (...args) => logged.push(args.join(' '));
  try {
    const response = await reissue(env, 'reissue-key-0001');
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(body.url, /^\/api\/download\/[0-9a-f-]{36}$/);
    assert.equal(body.reissuesRemaining, 1);
    assert.ok(Math.abs(new Date(body.expiresAt).getTime() - (Date.now() + 7 * 86400000)) < 5000, 'a re-issued link is valid for 7 days, like the first one');
    const rows = tokens(env);
    assert.equal(rows.length, 2);
    const fresh = rows.find(row => row.token === body.url.split('/').pop());
    assert.equal(fresh.used, 0);
    assert.equal(fresh.ref, LOCAL);
    assert.notEqual(fresh.tx, CAPTURE, 'production keeps tx unique, so the re-issued link carries its own tx');
    assert.equal(rows.find(row => row.token === 'orig-token-1').used, 2);
    assert.deepEqual(stub.calls.filter(call => !call.startsWith('GET') && !call.includes('oauth2')), []);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 1);
    const audit = env.sqlite.prepare("SELECT * FROM paypal_order_actions WHERE action = 'REISSUE'").all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].status, 'DONE');
    assert.equal(audit[0].actor, 'admin');
    assert.equal(audit[0].reason, 'customer download failed');
    assert.deepEqual(logged.filter(line => line.includes(fresh.token) || line.includes('orig-token-1') || line.includes('fake-secret')), []);
  } finally { stub.restore(); for (const [name, fn] of originals) console[name] = fn; }
});

test('the revoked link answers 410 "revoked" and never serves the file; the new link serves once', async () => {
  const env = setup();
  const stub = paypal();
  try {
    const body = await (await reissue(env, 'reissue-key-0002')).json();
    env.PHOTOS = { async get() { return { body: new Blob(['jpg']).stream(), httpMetadata: { contentType: 'image/jpeg' } }; }, async head() { return { body: null, httpMetadata: {} }; } };
    const get = token => handleDownload(new Request('https://amitphotos.com/api/download/' + token), env, token);
    const old = await get('orig-token-1');
    assert.equal(old.status, 410);
    assert.equal((await old.json()).code, 'LINK_REVOKED');
    const fresh = body.url.split('/').pop();
    assert.equal((await get(fresh)).status, 200);
    assert.equal((await get(fresh)).status, 410);
  } finally { stub.restore(); }
});

test('at most two re-issues per order; a repeated request id replays instead of spending another', async () => {
  const env = setup();
  const stub = paypal();
  try {
    const first = await (await reissue(env, 'reissue-key-0003')).json();
    const replay = await reissue(env, 'reissue-key-0003');
    assert.equal(replay.status, 200);
    const replayBody = await replay.json();
    assert.equal(replayBody.url, first.url);
    assert.equal(replayBody.replayed, true);
    assert.equal(replayBody.reissuesUsed, 1);
    const second = await reissue(env, 'reissue-key-0004');
    assert.equal(second.status, 200);
    const third = await reissue(env, 'reissue-key-0005');
    assert.equal(third.status, 409);
    assert.equal((await third.json()).error, 'REISSUE_LIMIT_REACHED');
    // The first link was revoked by the second re-issue, so replaying it is refused.
    assert.equal((await reissue(env, 'reissue-key-0003')).status, 409);
    assert.equal(tokens(env).filter(row => row.used === 0).length, 1);
  } finally { stub.restore(); }
});

test('parallel requests: one shared key gives one link; different keys never exceed the limit or leave two live links', async () => {
  const sameKey = setup();
  const stub = paypal();
  try {
    const results = await Promise.all([1, 2, 3, 4].map(() => reissue(sameKey, 'reissue-key-same')));
    const bodies = await Promise.all(results.map(response => response.json()));
    assert.ok(results.every(response => response.status === 200), JSON.stringify(bodies));
    assert.equal(new Set(bodies.map(body => body.url)).size, 1);
    assert.equal(sameKey.sqlite.prepare("SELECT COUNT(*) AS n FROM paypal_order_actions WHERE action = 'REISSUE'").get().n, 1);
    assert.equal(tokens(sameKey).length, 2);

    const different = setup();
    const many = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(suffix => reissue(different, 'reissue-key-par-' + suffix)));
    const ok = many.filter(response => response.status === 200).length;
    assert.ok(ok >= 1 && ok <= 2, 'successes: ' + ok);
    assert.ok(env_count(different, "status IN ('STARTED','DONE')") <= 2);
    assert.equal(tokens(different).filter(row => row.used === 0).length, 1, 'only the newest link stays live');
  } finally { stub.restore(); }
});
function env_count(env, where) {
  return env.sqlite.prepare("SELECT COUNT(*) AS n FROM paypal_order_actions WHERE action = 'REISSUE' AND " + where).get().n;
}

test('re-issue is refused after a refund, reversal, open review or dispute, and for unfinished or unknown orders', async () => {
  const stub = paypal();
  try {
    for (const [label, sql] of [
      ['refunded', "UPDATE paypal_orders SET after_sale_state = 'REFUNDED'"],
      ['reversed', "UPDATE paypal_orders SET after_sale_state = 'REVERSED'"],
      ['review', "UPDATE paypal_orders SET after_sale_state = 'REVIEW_REQUIRED'"],
      ['dispute', 'UPDATE paypal_orders SET dispute_open = 1'],
      ['not completed', "UPDATE paypal_orders SET status = 'FULFILLING'"],
    ]) {
      const env = setup();
      env.sqlite.exec(sql);
      const before = stub.calls.length;
      const response = await reissue(env, 'reissue-key-' + label.replace(/\W/g, ''));
      assert.equal(response.status, 409, label);
      assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_order_actions').get().n, 0, label);
      assert.equal(tokens(env).length, 1, label);
      assert.equal(stub.calls.length, before, label + ': refused before any PayPal call');
    }
    assert.equal((await reissue(setup(), 'reissue-key-unknown', { paypalOrderId: 'UNKNOWNORDER123' })).status, 404);
  } finally { stub.restore(); }
});

test('re-issue needs PayPal to confirm the payment; failures spend nothing', async () => {
  for (const [label, options, status] of [
    ['capture refunded at PayPal', { captureStatus: 'REFUNDED' }, 409],
    ['capture pending', { captureStatus: 'PENDING' }, 409],
    ['order not completed', { orderStatus: 'APPROVED' }, 409],
    ['wrong custom id', { customId: 'someone-else' }, 409],
    ['lookup failed', { orderLookupOk: false }, 502],
  ]) {
    const env = setup();
    const stub = paypal(options);
    try {
      const response = await reissue(env, 'reissue-key-verify');
      assert.equal(response.status, status, label);
      assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_order_actions').get().n, 0, label);
      assert.equal(tokens(env).length, 1, label);
      assert.equal(tokens(env)[0].used, 0, label);
    } finally { stub.restore(); }
  }
});

test('re-issue input is validated and works while public checkout is closed, but not on an invalid configuration', async () => {
  const env = setup();
  const stub = paypal();
  try {
    for (const [request, label] of [
      [reissueRequest('short'), 'key too short'],
      [reissueRequest('reissue-key-ok-1', { reason: '   ' }), 'reason missing'],
      [reissueRequest('reissue-key-ok-1', { paypalOrderId: 'bad id!' }), 'order id invalid'],
    ]) assert.equal((await handlePayPalReissueDownload(request, env)).status, 400, label);
    assert.equal((await handlePayPalReissueDownload(new Request('https://amitphotos.com/x'), env)).status, 405);
    assert.equal(env.PAYMENTS_ENABLED, 'false');
    assert.equal((await reissue(env, 'reissue-key-closed')).status, 200);
    const before = stub.calls.length;
    const bad = await reissue({ ...env, PAYPAL_ENVIRONMENT: 'prod' }, 'reissue-key-badcfg');
    assert.equal(bad.status, 503);
    assert.equal(stub.calls.length, before);
  } finally { stub.restore(); }
});

test('an interrupted re-issue resumes with the same key and finishes exactly once', async () => {
  const env = setup();
  const stub = paypal();
  try {
    env.sqlite.prepare("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, new_token, created_at) VALUES (?, ?, 'REISSUE', 'reissue-key-crash', 'STARTED', 'admin', 'crash test', 'resumed-token-1', ?)")
      .run(LOCAL, ORDER, new Date().toISOString());
    const response = await reissue(env, 'reissue-key-crash');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).url, '/api/download/resumed-token-1');
    assert.equal(env.sqlite.prepare("SELECT status FROM paypal_order_actions WHERE request_id = 'reissue-key-crash'").get().status, 'DONE');
    assert.equal(tokens(env).filter(row => row.used === 0).length, 1);
    assert.equal(env_count(env, "status IN ('STARTED','DONE')"), 1);
  } finally { stub.restore(); }
});

test('a refund landing during a re-issue leaves no live link behind', async () => {
  const env = setup();
  const stub = paypal();
  // The refund lands exactly when the new link is being written.
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    if (sql.startsWith('INSERT OR IGNORE INTO download_tokens')) env.sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REFUNDED'");
    return realPrepare(sql);
  };
  try {
    const response = await reissue(env, 'reissue-key-race');
    assert.equal(response.status, 409);
    assert.equal(tokens(env).filter(row => row.used === 0).length, 0);
    assert.equal(env.sqlite.prepare("SELECT status FROM paypal_order_actions WHERE request_id = 'reissue-key-race'").get().status, 'REVOKED');
  } finally { stub.restore(); }
});

// ----- manual review, support view, capture guard ---------------------------------------------

test('manual review: release only from review without an open dispute; revoke is final and idempotent', async () => {
  const env = setup();
  const review = (key, decision) => handlePayPalAfterSaleReview(new Request('https://amitphotos.com/api/admin/paypal/after-sale-review', {
    method: 'POST', headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ paypalOrderId: ORDER, decision, reason: 'checked with the buyer' }),
  }), env);
  assert.equal((await review('review-key-0001', 'release')).status, 409, 'nothing to release on a clean order');
  env.sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REVIEW_REQUIRED', dispute_open = 1");
  assert.equal((await review('review-key-0002', 'release')).status, 409, 'open dispute blocks release');
  env.sqlite.exec('UPDATE paypal_orders SET dispute_open = 0');
  assert.equal((await review('review-key-0003', 'release')).status, 200);
  assert.equal(state(env).s, 'NONE');
  env.sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REVIEW_REQUIRED'");
  const revoked = await (await review('review-key-0004', 'revoke')).json();
  assert.equal(revoked.state, 'REVOKED_MANUAL');
  assert.equal(tokens(env)[0].used, 2);
  const replay = await (await review('review-key-0004', 'revoke')).json();
  assert.equal(replay.replayed, true);
  assert.equal((await review('review-key-0005', 'release')).status, 409, 'a final decision cannot be released');
  assert.equal((await review('review-key-0006', 'maybe')).status, 400);
});

test('support view shows state and audit rows but never a link or secret', async () => {
  const env = setup();
  const stub = paypal();
  try {
    const issued = await (await reissue(env, 'reissue-key-view1')).json();
    const view = await handlePayPalOrderSupportView(new Request('https://amitphotos.com/api/admin/paypal/order?paypalOrderId=' + ORDER), env);
    const text = await view.text();
    assert.equal(view.status, 200);
    assert.ok(JSON.parse(text).actions.some(action => action.action === 'REISSUE' && action.status === 'DONE'));
    assert.ok(!text.includes(issued.url.split('/').pop()) && !text.includes('orig-token-1') && !text.includes('fake-secret'));
  } finally { stub.restore(); }
});

test('capture-order for a refunded order never mints a link', async () => {
  const env = setup({ status: 'FULFILLING' });
  env.sqlite.prepare('DELETE FROM download_tokens').run();
  env.sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REFUNDED'");
  env.PAYMENTS_ENABLED = 'true';
  env.DIGITAL_PAYPAL_ENABLED = 'true';
  const stub = paypal();
  try {
    const response = await handlePayPalCaptureOrder(new Request('https://amitphotos.com/api/paypal/capture-order', {
      method: 'POST', body: JSON.stringify({ paypalOrderId: ORDER }),
    }), env, { skipRateLimit: true });
    assert.equal(response.status, 409);
    assert.equal(tokens(env).length, 0);
  } finally { stub.restore(); }
});

// ----- the "up" link from an event is untrusted -----------------------------------------------

test('an event link naming another host, scheme, port, path or credentials is refused and never receives Authorization', async () => {
  const hostsWithAuth = [];
  const stub = paypal({ captureStatus: 'REFUNDED' });
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (options.headers?.Authorization) hostsWithAuth.push(new URL(String(url)).host + new URL(String(url)).pathname);
    return inner(url, options);
  };
  const ok = 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + CAPTURE;
  try {
    for (const href of [
      'https://evil.example/v2/payments/captures/' + CAPTURE,
      'https://api-m.paypal.com/v2/payments/captures/' + CAPTURE,
      'https://api-m.sandbox.paypal.com.evil.example/v2/payments/captures/' + CAPTURE,
      'https://api-m.sandbox.paypal.com@evil.example/v2/payments/captures/' + CAPTURE,
      'https://user:pw@api-m.sandbox.paypal.com/v2/payments/captures/' + CAPTURE,
      'http://api-m.sandbox.paypal.com/v2/payments/captures/' + CAPTURE,
      'https://api-m.sandbox.paypal.com:8443/v2/payments/captures/' + CAPTURE,
      ok + '?x=1', ok + '#frag', ok + '/refunds', ok + '/../x', 'https://api-m.sandbox.paypal.com/v1/payments/captures/' + CAPTURE,
      'https://api-m.sandbox.paypal.com/v2/payments/captures/short', 'not a url', '',
    ]) {
      const env = setup();
      const result = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', { links: [{ rel: 'up', href }] }));
      assert.equal(result.response.status, 400, href);
      assert.equal(state(env).s, 'NONE', href);
      assert.equal(tokens(env)[0].used, 0, href);
    }
    // two "up" links are ambiguous; a missing link on a refund is invalid; only reversals may fall back to the resource id
    const env = setup();
    assert.equal((await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', { links: [{ rel: 'up', href: ok }, { rel: 'up', href: ok }] }))).response.status, 400);
    assert.equal((await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', { links: [] }))).response.status, 400);
    assert.equal((await send(env, 'PAYMENT.CAPTURE.REVERSED', { id: 'bad id', status: 'REVERSED' })).response.status, 400);
    // Signature verification talks to the approved host by design; what must never happen is
    // an authenticated call to any other host, or a capture lookup for a refused event.
    assert.ok(hostsWithAuth.every(entry => entry.startsWith('api-m.sandbox.paypal.com/')), hostsWithAuth.join());
    assert.deepEqual(hostsWithAuth.filter(entry => entry.includes('/v2/payments/captures/')), [], 'refused events trigger no capture lookup');

    // the accepted shape still works and only talks to the approved API host
    const good = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00'));
    assert.equal(good.body.afterSale, 'REFUNDED');
    assert.deepEqual(hostsWithAuth.filter(entry => entry.includes('/v2/payments/captures/')), ['api-m.sandbox.paypal.com/v2/payments/captures/' + CAPTURE]);
  } finally { stub.restore(); }
});

test('in Live the link must name the Live API host, and a Sandbox link is refused', async () => {
  const live = { PAYPAL_ENVIRONMENT: 'live', PAYPAL_CREDENTIALS_ENVIRONMENT: 'live' };
  const stub = paypal({ captureStatus: 'REFUNDED' });
  try {
    const env = { ...setup(), ...live };
    const sandboxLink = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00'));
    assert.equal(sandboxLink.response.status, 400);
    const liveLink = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', {
      links: [{ rel: 'up', href: 'https://api-m.paypal.com/v2/payments/captures/' + CAPTURE }],
    }));
    assert.equal(liveLink.body.afterSale, 'REFUNDED');
  } finally { stub.restore(); }
});

test('a full refund or reversal can never be released through after-sale-review, and a late COMPLETED event cannot restore entitlement', async () => {
  for (const state of ['REFUNDED', 'REVERSED', 'REVOKED_MANUAL']) {
    const env = setup();
    env.sqlite.prepare("UPDATE paypal_orders SET after_sale_state = ? WHERE id = ?").run(state, LOCAL);
    const stub = paypal({ captureStatus: 'REFUNDED' });
    try {
      const release = await handlePayPalAfterSaleReview(new Request('https://amitphotos.com/x', {
        method: 'POST', headers: { 'Idempotency-Key': 'release-final-' + state },
        body: JSON.stringify({ paypalOrderId: ORDER, decision: 'release', reason: 'attempt' }),
      }), env);
      assert.equal(release.status, 409, state);
      assert.equal(env.sqlite.prepare('SELECT after_sale_state AS s FROM paypal_orders WHERE id = ?').get(LOCAL).s, state);
      assert.equal((await reissue(env, 'reissue-final-' + state)).status, 409, state);
      const before = tokens(env).length;
      const late = await send(env, 'PAYMENT.CAPTURE.COMPLETED', {
        id: CAPTURE, status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' },
        supplementary_data: { related_ids: { order_id: ORDER } },
      });
      assert.equal(late.body.ignored, true, state);
      assert.equal(tokens(env).length, before, state);
    } finally { stub.restore(); }
  }
});

// ----- regression: REAL Sandbox refund event of 14.10.2026 (filtered to the fields that matter) -----

test('the real Sandbox refund payload (links on api.sandbox.paypal.com) is processed: REFUNDED, 300 recorded, unused link revoked', async () => {
  const REAL_CAPTURE = '0MS84441LR651773E';
  const env = setup({ capture: REAL_CAPTURE });
  env.sqlite.exec('UPDATE paypal_orders SET amount_expected = 300');
  const stub = paypal({ captureStatus: 'REFUNDED', amount: '3.00', captureId: REAL_CAPTURE });
  try {
    const result = await send(env, 'PAYMENT.CAPTURE.REFUNDED', {
      id: '72459513T30123329', status: 'COMPLETED', amount: { currency_code: 'ILS', value: '3.00' },
      seller_payable_breakdown: { total_refunded_amount: { currency_code: 'ILS', value: '3.00' } },
      links: [
        { rel: 'self', href: 'https://api.sandbox.paypal.com/v2/payments/refunds/72459513T30123329', method: 'GET' },
        { rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/' + REAL_CAPTURE, method: 'GET' },
      ],
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.afterSale, 'REFUNDED');
    assert.deepEqual(state(env), { s: 'REFUNDED', d: 0, r: 300 });
    assert.equal(tokens(env)[0].used, 2, 'the unused link is revoked');
    assert.equal((await reissue(env, 'reissue-after-real-refund')).status, 409);
    // The link host was only parsed: every PayPal call went to the trusted API base of the configuration.
    assert.deepEqual([...stub.hosts], ['api-m.sandbox.paypal.com']);
    assert.ok(stub.calls.includes('GET /v2/payments/captures/' + REAL_CAPTURE));
  } finally { stub.restore(); }
});

test('event link hosts are exact per environment: both Sandbox aliases work in Sandbox, both Live aliases only in Live', async () => {
  const link = host => [{ rel: 'up', href: 'https://' + host + '/v2/payments/captures/' + CAPTURE }];
  const stub = paypal({ captureStatus: 'REFUNDED' });
  try {
    for (const host of ['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com']) {
      const env = setup();
      assert.equal((await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', { links: link(host) }))).body.afterSale, 'REFUNDED', host);
    }
    for (const host of ['api-m.paypal.com', 'api.paypal.com', 'sandbox.paypal.com', 'www.sandbox.paypal.com', 'api.sandbox.paypal.com.evil.example',
      'evil-api.sandbox.paypal.com', 'x.api.sandbox.paypal.com', 'paypal.com', 'localhost', '127.0.0.1']) {
      const env = setup();
      const result = await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', { links: link(host) }));
      assert.equal(result.response.status, 400, 'Sandbox must refuse ' + host);
      assert.equal(state(env).s, 'NONE', host);
    }
    for (const host of ['api-m.paypal.com', 'api.paypal.com']) {
      const env = { ...setup(), PAYPAL_ENVIRONMENT: 'live', PAYPAL_CREDENTIALS_ENVIRONMENT: 'live' };
      assert.equal((await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', { links: link(host) }))).body.afterSale, 'REFUNDED', 'Live accepts ' + host);
    }
    for (const host of ['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com', 'www.paypal.com', 'api.paypal.com.evil.example']) {
      const env = { ...setup(), PAYPAL_ENVIRONMENT: 'live', PAYPAL_CREDENTIALS_ENVIRONMENT: 'live' };
      assert.equal((await send(env, 'PAYMENT.CAPTURE.REFUNDED', refundResource('100.00', { links: link(host) }))).response.status, 400, 'Live must refuse ' + host);
    }
    // whatever the event named, PayPal was only ever called on the configured API bases
    assert.ok([...stub.hosts].every(host => ['api-m.sandbox.paypal.com', 'api-m.paypal.com'].includes(host)), [...stub.hosts].join());
  } finally { stub.restore(); }
});
