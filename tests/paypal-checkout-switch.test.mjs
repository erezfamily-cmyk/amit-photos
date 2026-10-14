import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  parseSwitch, effectiveSwitch, checkNewOrderAllowed, checkCaptureAllowed, readCheckoutSwitch, SWITCH_KEY, CLOSE_GRACE_MS,
} from '../paypal-switch.js';
import {
  handleDigitalCheckoutQuote, handlePayPalCreateOrder, handlePayPalCaptureOrder, handlePayPalWebhook,
  handlePayPalReissueDownload, handlePayPalCheckoutSwitch, handlePayPalLiveReadiness,
} from '../paypal-orders.js';
import { handleDownload, handlePaymentsStatus } from '../worker.js';

// The D1 checkout switch on a REAL SQLite database shaped like production (pre-0002 + 0002 + 0003).
// PayPal is a fake with fake ids; no network. Time is real: stored times are set relative to "now".

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const migration0002 = await read('../migrations/0002_paypal_security_hardening.sql');
const migration0003 = await read('../migrations/0003_after_sale_and_reissue.sql');
const DDL = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, r2_key TEXT, published INTEGER, price_overrides TEXT);
INSERT INTO photos VALUES ('photo-1', 'Photo One', 'photo-1.jpg', 1, '{"large":100}');
INSERT INTO photos VALUES ('photo-2', 'Photo Two', 'photo-2.jpg', 1, '{"large":100}');
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO settings VALUES ('prices', '{"small":19,"medium":59,"large":129}');
`;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const iso = ms => new Date(ms).toISOString();
const ago = ms => iso(Date.now() - ms);
const ahead = ms => iso(Date.now() + ms);

const openSwitch = (extra = {}) => ({ state: 'open', openedAt: ago(10 * MIN), closesAt: ahead(24 * HOUR), maxOrders: null, photoIds: null, ...extra });
const closedSwitch = (closedAgoMs, extra = {}) => ({ state: 'closed', closedAt: ago(closedAgoMs), ...extra });
const frozenSwitch = (closedAgoMs = 0) => ({ state: 'frozen', closedAt: ago(closedAgoMs) });

function setup({ switchValue = openSwitch(), flags = true, extra = {} } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL); sqlite.exec(migration0002); sqlite.exec(migration0003);
  if (switchValue !== null) sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(SWITCH_KEY, typeof switchValue === 'string' ? switchValue : JSON.stringify(switchValue));
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
  return { sqlite, DB, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id',
    PAYMENTS_ENABLED: flags ? 'true' : 'false', DIGITAL_PAYPAL_ENABLED: flags ? 'true' : 'false', ...extra };
}
const setSwitch = (env, value) => env.sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(SWITCH_KEY, typeof value === 'string' ? value : JSON.stringify(value));

let orderSeq = 0;
function fakePayPal(env) {
  const original = globalThis.fetch;
  const calls = { creates: 0, captures: 0, other: [] };
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    const method = options.method || 'GET';
    if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
    if (u.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
    if (u.pathname === '/v2/checkout/orders' && method === 'POST') {
      calls.creates++;
      const id = 'PAYPALORD' + String(++orderSeq).padStart(6, '0');
      return Response.json({ id, links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + id }] }, { status: 201 });
    }
    const capturePath = u.pathname.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)$/);
    if (capturePath) {
      const row = env.sqlite.prepare('SELECT * FROM paypal_orders WHERE paypal_capture_id = ?').get(capturePath[1]);
      return row ? Response.json({ id: capturePath[1], status: 'REFUNDED', custom_id: row.id, amount: { currency_code: 'ILS', value: (row.amount_expected / 100).toFixed(2) } }) : Response.json({}, { status: 404 });
    }
    const orderPath = u.pathname.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
    if (orderPath) {
      const row = env.sqlite.prepare('SELECT * FROM paypal_orders WHERE paypal_order_id = ?').get(orderPath[1]);
      const capture = row ? { id: row.paypal_capture_id || ('CAP' + row.id.replace(/\W/g, '').slice(0, 10).toUpperCase()), status: 'COMPLETED', custom_id: row.id, amount: { currency_code: 'ILS', value: (row.amount_expected / 100).toFixed(2) } } : null;
      if (orderPath[2]) {
        calls.captures++;
        return Response.json(row ? { id: row.paypal_order_id, status: 'COMPLETED', payer: { email_address: 'x@example.com' }, purchase_units: [{ custom_id: row.id, payments: { captures: [capture] } }] } : {}, { status: row ? 201 : 404 });
      }
      return Response.json({ id: orderPath[1], status: 'COMPLETED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderPath[1] }], purchase_units: [{ custom_id: row?.id, payments: { captures: capture ? [capture] : [] } }] });
    }
    calls.other.push(u.pathname);
    return Response.json({}, { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

const createRequest = (key, photoId = 'photo-1') => new Request('https://amitphotos.com/api/paypal/create-order', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ type: 'digital', photoId, sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: 10000 }),
});
const create = (env, key, photoId) => handlePayPalCreateOrder(createRequest(key, photoId), env, { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true });
const captureReq = po => new Request('https://amitphotos.com/api/paypal/capture-order', { method: 'POST', body: JSON.stringify({ paypalOrderId: po }) });
const capture = (env, po) => handlePayPalCaptureOrder(captureReq(po), env, { skipRateLimit: true });
const quote = (env, photoId = 'photo-1') => handleDigitalCheckoutQuote(new Request('https://amitphotos.com/api/paypal/quote?photoId=' + photoId + '&sku=large'), env).then(r => r.json());
const orderCount = env => env.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n;
let rowSeq = 0;
function addOrder(env, { createdMs = Date.now() - 5 * MIN, status = 'CREATED', photo = 'photo-1' } = {}) {
  const n = ++rowSeq; const id = 'local-' + n; const po = 'PAYPALOLD' + String(n).padStart(5, '0');
  env.sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at, client_idempotency_key) VALUES (?, ?, 'digital', ?, 'large', 10000, 'ILS', ?, ?, ?)")
    .run(id, po, photo, status, iso(createdMs), 'seed-key-' + String(n).padStart(6, '0'));
  return { id, po };
}

// ---------------------------------------------------------------------------------------------------------

test('parseSwitch accepts only well-formed rows; everything else is invalid (and therefore closed)', () => {
  assert.equal(parseSwitch(JSON.stringify(openSwitch())).ok, true);
  assert.equal(parseSwitch(JSON.stringify(openSwitch({ maxOrders: 5, photoIds: ['photo-1', 'abc_DEF-1.2'] }))).ok, true);
  assert.equal(parseSwitch(JSON.stringify(closedSwitch(MIN))).ok, true);
  assert.equal(parseSwitch(JSON.stringify(frozenSwitch())).ok, true);
  const bad = [
    'not json', '', 'null', '[]', '"open"', '{}', '{"state":"OPEN"}', '{"state":"paused"}', JSON.stringify({ state: 'open' }),
    JSON.stringify({ state: 'open', openedAt: 'yesterday', closesAt: ahead(HOUR) }),
    JSON.stringify(openSwitch({ closesAt: '2026-13-45T99:00:00Z' })),
    JSON.stringify(openSwitch({ maxOrders: 0 })), JSON.stringify(openSwitch({ maxOrders: -3 })), JSON.stringify(openSwitch({ maxOrders: 1.5 })),
    JSON.stringify(openSwitch({ maxOrders: '3' })), JSON.stringify(openSwitch({ maxOrders: 1e9 })),
    JSON.stringify(openSwitch({ photoIds: [] })), JSON.stringify(openSwitch({ photoIds: 'photo-1' })), JSON.stringify(openSwitch({ photoIds: [1] })),
    JSON.stringify(openSwitch({ photoIds: ['bad id'] })), JSON.stringify(openSwitch({ photoIds: ['../x'] })), JSON.stringify(openSwitch({ photoIds: Array(201).fill('a') })),
    JSON.stringify({ state: 'closed' }), JSON.stringify({ state: 'frozen', closedAt: 'soon' }),
  ];
  for (const raw of bad) assert.equal(parseSwitch(raw).ok, false, raw);
});

test('closesAt is enforced by the effective state itself (no cron): at and after the moment the mode is closed', () => {
  const config = parseSwitch(JSON.stringify(openSwitch({ closesAt: iso(1_000_000) }))).config;
  assert.equal(effectiveSwitch(config, 999_999).mode, 'open');
  assert.equal(effectiveSwitch(config, 1_000_000).mode, 'closed');
  assert.equal(effectiveSwitch(config, 1_000_001).mode, 'closed');
  assert.equal(effectiveSwitch(config, 1_000_001).closedAt, iso(1_000_000), 'the grace period counts from closesAt');
  assert.equal(effectiveSwitch(config, 1_000_001).autoClosed, true);
});

// ----- fail closed -------------------------------------------------------------------------------------------

test('no switch, an invalid switch or an unreadable database block quote, create and charge, with both flags true and without any PayPal call', async () => {
  const cases = {
    absent: env => env.sqlite.prepare('DELETE FROM settings WHERE key = ?').run(SWITCH_KEY),
    'invalid JSON': env => setSwitch(env, '{"state":'),
    'unknown state': env => setSwitch(env, { state: 'maybe' }),
    'open without closing time': env => setSwitch(env, { state: 'open', openedAt: ago(MIN) }),
    'database error': env => { env.DB = { prepare() { throw new Error('D1 down'); } }; },
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const env = setup();
    const pending = addOrder(env);
    mutate(env);
    const net = fakePayPal(env);
    try {
      if (label !== 'database error') {
        assert.equal((await quote(env)).enabled, false, label + ' quote');
        assert.equal((await create(env, 'attempt-key-0001')).status, 503, label + ' create');
        assert.equal((await capture(env, pending.po)).status, 503, label + ' capture');
        assert.equal(orderCount(env), 1, label);
        assert.deepEqual([net.calls.creates, net.calls.captures], [0, 0], label + ': PayPal not called');
      }
      const gate = await checkNewOrderAllowed(env);
      assert.equal(gate.allowed, false, label);
      assert.equal((await checkCaptureAllowed(env, { created_at: ago(MIN) })).allowed, false, label + ' charge gate');
      assert.equal((await (await handlePaymentsStatus(new Request('https://amitphotos.com/api/payments-status'), env)).json()).digitalEnabled, false, label + ' status');
    } finally { net.restore(); }
  }
});

test('an open switch never overrides the flags or the PayPal configuration', async () => {
  for (const extra of [{ flags: false }, { extra: { PAYPAL_ENVIRONMENT: 'prod' } }, { extra: { DIGITAL_PAYPAL_ENABLED: 'false' } }]) {
    const env = setup(extra);
    const net = fakePayPal(env);
    try {
      assert.equal((await create(env, 'attempt-key-0001')).status, 503);
      assert.equal((await quote(env)).enabled, false);
      assert.equal(net.calls.creates, 0);
    } finally { net.restore(); }
  }
});

// ----- open / closed / frozen ---------------------------------------------------------------------------------

test('open: quote, create and charge work; once closesAt has passed it behaves as closed, on the very next request', async () => {
  const env = setup();
  const net = fakePayPal(env);
  try {
    assert.equal((await quote(env)).enabled, true);
    const made = await create(env, 'attempt-key-0001');
    assert.equal(made.status, 201);
    const { paypalOrderId } = await made.json();
    setSwitch(env, openSwitch({ openedAt: ago(2 * HOUR), closesAt: ago(MIN) }));       // closing time passes, nobody ran any job
    assert.equal((await quote(env)).enabled, false);
    assert.equal((await create(env, 'attempt-key-0002')).status, 503);
    assert.equal(orderCount(env), 1);
    // the order was created before the closing time, which was one minute ago: still inside the 30-minute grace
    env.sqlite.prepare('UPDATE paypal_orders SET created_at = ?').run(ago(2 * HOUR - 5 * MIN));
    assert.equal((await capture(env, paypalOrderId)).status, 200);
  } finally { net.restore(); }
});

test('closed (graceful): no quote and no new order; a charge only for an order created before the close, until 30 minutes after it', async () => {
  const env = setup({ switchValue: closedSwitch(10 * MIN) });
  const net = fakePayPal(env);
  try {
    assert.equal((await quote(env)).enabled, false);
    assert.equal((await create(env, 'attempt-key-0001')).status, 503);
    assert.equal(orderCount(env), 0);
    const before = addOrder(env, { createdMs: Date.now() - 20 * MIN });                 // created before the close
    const after = addOrder(env, { createdMs: Date.now() - 5 * MIN });                   // created after the close
    assert.equal((await capture(env, after.po)).status, 503, 'created after the close');
    assert.equal(net.calls.captures, 0);
    assert.equal((await capture(env, before.po)).status, 200, 'created before the close, inside the grace');
    assert.equal(net.calls.captures, 1);
  } finally { net.restore(); }
  const boundaries = [[29 * MIN + 30 * 1000, true], [31 * MIN, false], [10 * HOUR, false]];
  for (const [closedAgo, allowed] of boundaries) {
    const e = setup({ switchValue: closedSwitch(closedAgo) });
    const order = { created_at: ago(closedAgo + 5 * MIN) };
    assert.equal((await checkCaptureAllowed(e, order)).allowed, allowed, 'closed ' + closedAgo / MIN + ' min ago');
  }
  assert.equal(CLOSE_GRACE_MS, 30 * MIN);
  const exact = setup({ switchValue: closedSwitch(MIN) });
  assert.equal((await checkCaptureAllowed(exact, { created_at: 'garbage' })).allowed, false, 'unknown order time never passes');
});

test('frozen: no quote, no new order, no charge at all; paid purchases, webhooks, downloads, re-issue and refunds keep working', async () => {
  const env = setup({ switchValue: frozenSwitch() });
  const net = fakePayPal(env);
  try {
    assert.equal((await quote(env)).enabled, false);
    assert.equal((await create(env, 'attempt-key-0001')).status, 503);
    const pending = addOrder(env, { createdMs: Date.now() - HOUR });
    assert.equal((await capture(env, pending.po)).status, 503);
    assert.equal(net.calls.captures, 0);

    // 1) an order paid before the freeze: the stored result is still handed out, and a half-finished one is completed
    const paid = addOrder(env, { createdMs: Date.now() - 2 * HOUR });
    env.sqlite.prepare("UPDATE paypal_orders SET status = 'COMPLETED', paypal_capture_id = 'CAPPAID0001', fulfillment_token = 'aaaaaaaa-0000-4000-8000-000000000001', fulfillment_json = ?, completed_at = ? WHERE id = ?")
      .run('{"url":"/api/download/aaaaaaaa-0000-4000-8000-000000000001","title":"Photo One"}', ago(HOUR), paid.id);
    env.sqlite.prepare("INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '[\"photo-1\"]', 'large', 'CAPPAID0001', 0, ?, 1, 100)").run(Math.floor(Date.now() / 1000) + 3600);
    assert.equal((await capture(env, paid.po)).status, 200, 'replay of a completed order');
    const half = addOrder(env, { createdMs: Date.now() - 2 * HOUR });
    env.sqlite.prepare("UPDATE paypal_orders SET status = 'FULFILLING', paypal_capture_id = 'CAPHALF0001', fulfillment_token = 'bbbbbbbb-0000-4000-8000-000000000002' WHERE id = ?").run(half.id);
    const resumed = await capture(env, half.po);
    assert.equal(resumed.status, 200, 'an already captured order is completed locally, no charge');
    assert.equal(net.calls.captures, 0, 'still no PayPal capture');

    // 2) downloads and re-issue
    env.PHOTOS = { async get() { return { body: new Blob(['jpg']).stream(), httpMetadata: {} }; }, async head() { return {}; } };
    const download = await handleDownload(new Request('https://amitphotos.com/api/download/aaaaaaaa-0000-4000-8000-000000000001'), env, 'aaaaaaaa-0000-4000-8000-000000000001');
    assert.equal(download.status, 200);
    const reissue = await handlePayPalReissueDownload(new Request('https://amitphotos.com/x', {
      method: 'POST', headers: { 'Idempotency-Key': 'reissue-key-0001' }, body: JSON.stringify({ paypalOrderId: paid.po, reason: 'customer asked' }),
    }), env);
    assert.equal(reissue.status, 200, 'support re-issue is not blocked by the switch');

    // 3) webhooks: a completion and a refund are processed
    const hook = (id, type, resource) => handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', {
      method: 'POST', body: JSON.stringify({ id, event_type: type, create_time: '2026-10-14T10:00:00Z', resource }),
      headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't' + id, 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': 't' },
    }), env);
    const refunded = await hook('WH-FROZEN-REFUND-1', 'PAYMENT.CAPTURE.REFUNDED', {
      id: 'REFUND0001', status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' },
      links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/CAPPAID0001' }],
    });
    assert.equal(refunded.status, 200, 'a full refund is processed while frozen');
    assert.equal(env.sqlite.prepare('SELECT after_sale_state AS s FROM paypal_orders WHERE id = ?').get(paid.id).s, 'REFUNDED');
    const completed = addOrder(env, { createdMs: Date.now() - 3 * HOUR });
    const done = await hook('WH-FROZEN-DONE-1', 'PAYMENT.CAPTURE.COMPLETED', {
      id: 'CAP' + completed.id.replace(/\W/g, '').slice(0, 10).toUpperCase(), status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' },
      supplementary_data: { related_ids: { order_id: completed.po } },
    });
    assert.equal(done.status, 200, 'a completion webhook finishes delivery while frozen');
    assert.equal(env.sqlite.prepare('SELECT status FROM paypal_orders WHERE id = ?').get(completed.id).status, 'COMPLETED');
  } finally { net.restore(); }
});

// ----- transitions through the admin handler ---------------------------------------------------------------------

const adminSwitch = (env, key, body, method = 'POST') => handlePayPalCheckoutSwitch(new Request('https://amitphotos.com/api/admin/paypal/switch', {
  method, headers: key ? { 'Idempotency-Key': key } : {}, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
}), env);
const stored = env => JSON.parse(env.sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(SWITCH_KEY)?.value ?? 'null');
const audits = env => env.sqlite.prepare("SELECT request_id, status, actor, reason FROM paypal_order_actions WHERE action = 'SWITCH' ORDER BY id").all().map(r => ({ ...r }));

test('admin: validation, who can open, and the rules for moving between states', async () => {
  const env = setup({ switchValue: null });
  assert.equal((await adminSwitch(env, '', { state: 'closed', reason: 'x' })).status, 400, 'key required');
  assert.equal((await adminSwitch(env, 'switch-key-0001', { state: 'closed', reason: '   ' })).status, 400, 'reason required');
  assert.equal((await adminSwitch(env, 'switch-key-0001', { state: 'paused', reason: 'x' })).status, 400, 'state invalid');
  assert.equal((await adminSwitch(env, 'switch-key-0001', { state: 'open', reason: 'x' })).status, 400, 'open needs closesAt');
  for (const closesAt of [iso(Date.now() - MIN), ahead(91 * 24 * HOUR), 'tomorrow', ahead(HOUR).replace('Z', '+02:00')]) {
    assert.equal((await adminSwitch(env, 'switch-key-0001', { state: 'open', reason: 'x', closesAt })).status, 400, 'closesAt ' + closesAt);
  }
  for (const caps of [{ maxOrders: 0 }, { maxOrders: 'ten' }, { photoIds: [] }, { photoIds: ['bad id'] }]) {
    assert.equal((await adminSwitch(env, 'switch-key-0001', { state: 'open', reason: 'x', closesAt: ahead(HOUR), ...caps })).status, 400, JSON.stringify(caps));
  }
  assert.equal((await adminSwitch(env, 'switch-key-0001', { state: 'open', reason: 'x', closesAt: ahead(HOUR) }, 'PUT')).status, 405);
  assert.equal(stored(env), null, 'nothing was written by any refused request');
  assert.deepEqual(audits(env), []);

  const opened = await adminSwitch(env, 'switch-key-0002', { state: 'open', reason: 'canary of 3', closesAt: ahead(6 * HOUR), maxOrders: 3, photoIds: ['photo-1'] });
  assert.equal(opened.status, 200);
  assert.deepEqual({ state: stored(env).state, max: stored(env).maxOrders, photos: stored(env).photoIds }, { state: 'open', max: 3, photos: ['photo-1'] });
  assert.equal((await adminSwitch(env, 'switch-key-0002', { state: 'open', reason: 'canary of 3', closesAt: ahead(6 * HOUR) })).status, 200);
  assert.equal((await (await adminSwitch(env, 'switch-key-0002', { state: 'frozen', reason: 'replay with another body' })).json()).replayed, true, 'same key = replay, nothing re-applied');
  assert.equal(stored(env).state, 'open');
  assert.equal(audits(env).length, 1);

  const frozen = await adminSwitch(env, 'switch-key-0003', { state: 'frozen', reason: 'price bug' });
  assert.equal(frozen.status, 200);
  const frozenAt = stored(env).closedAt;
  assert.equal((await adminSwitch(env, 'switch-key-0004', { state: 'open', reason: 'oops', closesAt: ahead(HOUR) })).status, 409, 'frozen cannot go straight to open');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal((await adminSwitch(env, 'switch-key-0005', { state: 'closed', reason: 'calmer' })).status, 200);
  assert.equal(stored(env).closedAt, frozenAt, 'moving frozen -> closed keeps the ORIGINAL stop time (no new 30-minute window)');
  assert.equal(stored(env).state, 'closed');
  const reopened = await adminSwitch(env, 'switch-key-0006', { state: 'open', reason: 'fixed', closesAt: ahead(HOUR) });
  assert.equal(reopened.status, 200);
  assert.ok(Date.parse(stored(env).openedAt) > Date.parse(frozenAt), 'a new opening starts a new cap period');

  const rows = audits(env);
  assert.deepEqual(rows.map(r => [r.request_id, r.status]), [['switch-key-0002', 'open'], ['switch-key-0003', 'frozen'], ['switch-key-0005', 'closed'], ['switch-key-0006', 'open']]);
  assert.ok(rows.every(r => r.actor === 'admin' && /from=/.test(r.reason) && !/@|http|token/i.test(r.reason)));
  const view = await (await adminSwitch(env, null, null, 'GET')).json();
  assert.deepEqual([view.valid, view.state, view.effectiveMode], [true, 'open', 'open']);
});

test('admin: closing and freezing work even when the PayPal configuration is broken or the stored row is garbage; opening needs a valid configuration', async () => {
  const env = setup({ switchValue: '{"state":"???', extra: { PAYPAL_ENVIRONMENT: 'prod' } });
  assert.equal((await adminSwitch(env, 'switch-key-0001', { state: 'open', reason: 'x', closesAt: ahead(HOUR) })).status, 503);
  assert.equal((await adminSwitch(env, 'switch-key-0002', { state: 'frozen', reason: 'emergency' })).status, 200);
  assert.equal(stored(env).state, 'frozen');
  const view = await (await adminSwitch(env, null, null, 'GET')).json();
  assert.equal(view.effectiveMode, 'frozen');
  const broken = setup({ switchValue: 'garbage' });
  const read = await (await adminSwitch(broken, null, null, 'GET')).json();
  assert.deepEqual([read.valid, read.reason], [false, 'SWITCH_INVALID_JSON']);
});

// ----- caps ------------------------------------------------------------------------------------------------------

test('order cap is atomic under parallel requests; a retry with the same key is never counted again', async () => {
  const env = setup({ switchValue: openSwitch({ maxOrders: 2 }) });
  const net = fakePayPal(env);
  try {
    addOrder(env, { createdMs: Date.now() - 3 * HOUR });                                   // before openedAt: not counted
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => create(env, 'parallel-key-' + String(i).padStart(4, '0'))));
    const statuses = results.map(r => r.status);
    assert.equal(statuses.filter(s => s === 201).length, 2, 'exactly the cap: ' + statuses.join());
    assert.equal(statuses.filter(s => s === 503).length, 6);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM paypal_orders WHERE client_idempotency_key LIKE 'parallel-key-%'").get().n, 2);

    const winner = env.sqlite.prepare("SELECT client_idempotency_key AS key, paypal_order_id AS po FROM paypal_orders WHERE client_idempotency_key LIKE 'parallel-key-%' LIMIT 1").get();
    const retry = await create(env, winner.key);
    assert.equal(retry.status, 200, 'retry with the same key returns the same order');
    assert.equal((await retry.json()).paypalOrderId, winner.po);
    assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM paypal_orders WHERE client_idempotency_key LIKE 'parallel-key-%'").get().n, 2, 'not counted twice, not duplicated');
    assert.equal((await create(env, 'parallel-key-9999')).status, 503, 'a new key is refused once the cap is used');
    assert.equal(net.calls.creates <= 8, true);
  } finally { net.restore(); }
});

test('five parallel requests with ONE key make one order under a cap of one; a new opening starts a fresh cap period', async () => {
  const env = setup({ switchValue: openSwitch({ maxOrders: 1 }) });
  const net = fakePayPal(env);
  try {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => create(env, 'same-key-0000001')));
    assert.deepEqual(results.map(r => r.status).filter(s => s >= 500), [], 'no refusal for the owner of the key');
    assert.equal(orderCount(env), 1);
    assert.equal(new Set((await Promise.all(results.map(r => r.json()))).map(b => b.paypalOrderId)).size, 1);
    assert.equal((await create(env, 'second-key-000001')).status, 503);
    await adminSwitch(env, 'switch-key-0001', { state: 'closed', reason: 'end of canary' });
    assert.equal((await adminSwitch(env, 'switch-key-0002', { state: 'open', reason: 'second canary', closesAt: ahead(HOUR), maxOrders: 1 })).status, 200);
    assert.equal((await create(env, 'second-key-000001')).status, 201, 'the new period has its own capacity');
  } finally { net.restore(); }
});

test('a key owner whose order was created by a parallel request an instant earlier gets that order, not a refusal (cap already full)', async () => {
  const env = setup({ switchValue: openSwitch({ maxOrders: 1 }) });
  const net = fakePayPal(env);
  // The sibling request wins the race between this request's key lookup and its cap look.
  const realPrepare = env.DB.prepare.bind(env.DB);
  let planted = false;
  env.DB.prepare = sql => {
    if (!planted && sql.startsWith("SELECT COUNT(*) AS n FROM paypal_orders WHERE order_type = 'digital' AND created_at >= ?")) {
      planted = true;
      env.sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at, client_idempotency_key) VALUES ('winner-1', 'PAYPALWINNER1', 'digital', 'photo-1', 'large', 10000, 'ILS', 'CREATED', ?, 'raced-key-00000001')").run(iso(Date.now()));
    }
    return realPrepare(sql);
  };
  try {
    const response = await create(env, 'raced-key-00000001');
    assert.equal(response.status, 200, 'the owner of the key gets its own order back');
    assert.equal((await response.json()).paypalOrderId, 'PAYPALWINNER1');
    assert.equal(orderCount(env), 1);
    assert.equal(net.calls.creates, 0, 'no PayPal order was created for it');
    const mismatch = await create(env, 'other-key-00000002');
    assert.equal(mismatch.status, 503, 'a different key is still refused');
  } finally { net.restore(); }
});

test('the orphan PayPal order (cap race) can never be charged: the app has no row for it, so capture is impossible, and its events are ignored', async () => {
  const env = setup({ switchValue: openSwitch({ maxOrders: 1 }) });
  const net = fakePayPal(env);
  try {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(env, 'orphan-key-' + String(i).padStart(6, '0'))));
    assert.equal(orderCount(env), 1);
    const known = new Set(env.sqlite.prepare('SELECT paypal_order_id AS po FROM paypal_orders').all().map(r => r.po));
    assert.ok(results.some(r => r.status === 503));
    // PayPal orders that exist only at PayPal (their approval link was never returned to any browser)
    const orphanId = 'PAYPALORDORPHAN1';
    assert.ok(!known.has(orphanId));
    const before = net.calls.captures;
    assert.equal((await capture(env, orphanId)).status, 404);
    assert.equal(net.calls.captures, before, 'PayPal capture is never called for an order without a local row');
    const hook = await handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', {
      method: 'POST', body: JSON.stringify({ id: 'WH-ORPHAN-00001', event_type: 'PAYMENT.CAPTURE.COMPLETED', create_time: '2026-10-14T10:00:00Z', resource: { id: 'CAPORPHAN0001', status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' }, supplementary_data: { related_ids: { order_id: orphanId } } } }),
      headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't1', 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': 't' },
    }), env);
    assert.equal(hook.status, 200);
    assert.equal((await hook.json()).ignored, true);
    assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM download_tokens').get().n, 0, 'no fulfilment for an order the app never recorded');
  } finally { net.restore(); }
});

test('the photo list is enforced on the server, for the quote and for the order', async () => {
  const env = setup({ switchValue: openSwitch({ photoIds: ['photo-1'] }) });
  const net = fakePayPal(env);
  try {
    assert.equal((await quote(env, 'photo-1')).enabled, true);
    assert.equal((await quote(env, 'photo-2')).enabled, false);
    assert.equal((await create(env, 'attempt-key-0001', 'photo-2')).status, 503);
    assert.equal(net.calls.creates, 0);
    assert.equal((await create(env, 'attempt-key-0002', 'photo-1')).status, 201);
    for (const forged of ['', 'PHOTO-1', 'photo-1 ', 'photo-1/../photo-2']) {
      const response = await handlePayPalCreateOrder(new Request('https://amitphotos.com/x', {
        method: 'POST', headers: { 'Idempotency-Key': 'forged-key-000001', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'digital', photoId: forged, sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: 10000 }),
      }), env, { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true });
      assert.equal(response.status, 503, JSON.stringify(forged));
    }
    const other = addOrder(env, { photo: 'photo-2' });
    assert.equal((await capture(env, other.po)).status, 200, 'an order that already exists is not affected by the list');
  } finally { net.restore(); }
});

// ----- the deployment never touches the switch ---------------------------------------------------------------------

test('no code, config, migration, bootstrap or workflow creates, changes or resets the switch; only the admin handler writes it', async () => {
  const root = new URL('../', import.meta.url);
  const sources = {};
  for (const name of ['worker.js', 'paypal-orders.js', 'paypal-switch.js', 'paypal-monitoring.js', 'wrangler.toml', 'wrangler.paypal-sandbox.example.toml', 'src/build_paypal_sandbox_config.py', 'staging/paypal-sandbox-bootstrap.sql']) sources[name] = await read('../' + name);
  for (const dir of ['migrations', 'staging', '.github/workflows']) {
    for (const entry of await readdir(new URL(dir + '/', root))) {
      if (/\.(sql|ya?ml|ps1|mjs|js|py|toml)$/.test(entry)) sources[dir + '/' + entry] = await read('../' + dir + '/' + entry);
    }
  }
  const mentions = Object.entries(sources).filter(([, text]) => text.includes('digital_checkout_switch') || text.includes('SWITCH_KEY'));
  assert.deepEqual(mentions.map(([name]) => name).sort(), ['paypal-orders.js', 'paypal-switch.js'], 'only the handler module and the reader know the key');
  const writes = (sources['paypal-orders.js'].match(/INSERT INTO settings/g) || []).length;
  assert.equal(writes, 1, 'exactly one writer in the application code');
  assert.ok(!/SWITCH_KEY/.test(sources['worker.js']), 'the Worker entry point (including the scheduled handler) never references the switch key');
  const scheduled = sources['worker.js'].slice(sources['worker.js'].indexOf('async scheduled('));
  assert.ok(!/switch/i.test(scheduled.slice(0, 600)), 'the scheduled handler does not touch the switch');
  assert.ok(!/digital_checkout_switch/.test(sources['staging/paypal-sandbox-bootstrap.sql']));
  assert.match(sources['wrangler.toml'], /PAYMENTS_ENABLED = "false"/);
  assert.match(sources['wrangler.toml'], /DIGITAL_PAYPAL_ENABLED = "false"/, 'the flags in wrangler.toml stay false');
  // A "deployment" in the tests' sense: a fresh database built from migrations plus the Sandbox bootstrap has no switch row (= closed)
  const fresh = setup({ switchValue: null });
  assert.equal((await readCheckoutSwitch(fresh)).reason, 'SWITCH_ABSENT');
});

test('the documented emergency D1 statements work exactly as described', async () => {
  const net = [];
  const env = setup();
  const freeze = "INSERT INTO settings (key, value) VALUES ('digital_checkout_switch', '{\"state\":\"frozen\",\"closedAt\":\"" + iso(Date.now()) + "\",\"updatedBy\":\"d1\"}') ON CONFLICT(key) DO UPDATE SET value = excluded.value";
  env.sqlite.exec(freeze);
  assert.equal((await readCheckoutSwitch(env)).effective.mode, 'frozen');
  assert.equal((await checkCaptureAllowed(env, { created_at: ago(HOUR) })).allowed, false);
  env.sqlite.exec("DELETE FROM settings WHERE key = 'digital_checkout_switch'");
  assert.equal((await checkNewOrderAllowed(env)).reason, 'SWITCH_ABSENT');
  assert.equal((await checkCaptureAllowed(env, { created_at: ago(HOUR) })).allowed, false, 'deleting the row blocks charges too');
  const graceful = "INSERT INTO settings (key, value) VALUES ('digital_checkout_switch', '{\"state\":\"closed\",\"closedAt\":\"" + ago(5 * MIN) + "\"}') ON CONFLICT(key) DO UPDATE SET value = excluded.value";
  env.sqlite.exec(graceful);
  assert.equal((await checkCaptureAllowed(env, { created_at: ago(HOUR) })).allowed, true);
  assert.equal(net.length, 0);
});

test('readiness shows the switch and refuses an invalid row, while an absent row is just "closed"', async () => {
  const net = globalThis.fetch;
  globalThis.fetch = async url => {
    const u = new URL(String(url));
    if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
    return Response.json({ url: 'https://amitphotos.com/api/paypal/webhook', event_types: [{ name: '*' }] });
  };
  try {
    const check = async env => (await handlePayPalLiveReadiness(new Request('https://amitphotos.com/api/admin/paypal/live-readiness'), env)).json();
    const absent = await check(setup({ switchValue: null }));
    assert.deepEqual(absent.checks.checkoutSwitch, { state: 'none', effectiveMode: 'blocked', reason: 'SWITCH_ABSENT' });
    assert.ok(!absent.reasons.includes('CHECKOUT_SWITCH_INVALID'));
    const invalid = await check(setup({ switchValue: '{"state":' }));
    assert.ok(invalid.reasons.includes('CHECKOUT_SWITCH_INVALID'));
    const open = await check(setup());
    assert.deepEqual(open.checks.checkoutSwitch, { state: 'open', effectiveMode: 'open' });
  } finally { globalThis.fetch = net; }
});
