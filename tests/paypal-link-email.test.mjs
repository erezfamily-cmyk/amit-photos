import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  handlePayPalCaptureOrder, handlePayPalWebhook, handlePayPalReissueDownload, handlePayPalResendLinkEmail,
  sendDownloadLinkEmail, retryDownloadLinkEmails, downloadEmailEnabled,
} from '../paypal-orders.js';
import { handleDownload } from '../worker.js';

// Download-link e-mail on a REAL SQLite database shaped like production (pre-0002 DDL + 0002 + 0003).
// PayPal and the mail provider are fakes; addresses are reserved example domains; no network.

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const migration0002 = await read('../migrations/0002_paypal_security_hardening.sql');
const migration0003 = await read('../migrations/0003_after_sale_and_reissue.sql');
const landing = await read('../checkout/download/index.html');
const headersFile = await read('../_headers');
const PRE_0002 = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, r2_key TEXT);
INSERT INTO photos VALUES ('photo-1', 'Photo <One> & "Co"', 'photo-1.jpg');
`;
const ORDER = 'PAYPALORDER12345';
const CAPTURE = 'CAPTURE1234567';
const LOCAL = 'local-order-1';
const PAYER = 'buyer.real@example.com';
const TEST_INBOX = 'qa-inbox@example.com';

// status 'CREATED' = before capture; 'COMPLETED' = paid with an unused link already issued.
function setup({ status = 'CREATED', env: extra = {} } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(PRE_0002); sqlite.exec(migration0002); sqlite.exec(migration0003);
  const paid = status === 'COMPLETED';
  sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, fulfillment_token, fulfillment_json, completed_at, created_at) VALUES (?, ?, 'digital', 'photo-1', 'large', 10000, 'ILS', ?, ?, ?, ?, ?, '2026-10-01T00:00:00Z')")
    .run(LOCAL, ORDER, status, paid ? CAPTURE : null, paid ? 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' : null, paid ? '{"url":"/api/download/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa","title":"x"}' : null, paid ? new Date().toISOString() : null);
  if (paid) {
    sqlite.prepare("INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '[\"photo-1\"]', 'large', ?, 0, ?, 1, 100)").run(CAPTURE, Math.floor(Date.now() / 1000) + 3600);
  }
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
  return {
    sqlite, DB, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id',
    PAYMENTS_ENABLED: 'true', DIGITAL_PAYPAL_ENABLED: 'true', RESEND_API_KEY: 'fake-resend-key', DOWNLOAD_EMAIL_ENABLED: 'true',
    DOWNLOAD_EMAIL_OVERRIDE_TO: TEST_INBOX, PUBLIC_BASE_URL: 'https://amitphotos.com', ...extra,
  };
}
const LIVE = { PAYPAL_ENVIRONMENT: 'live', PAYPAL_CREDENTIALS_ENVIRONMENT: 'live' };

// Fake PayPal + fake mail provider in one fetch.
function fakes({ resend = 'ok', payer = PAYER, onResend } = {}) {
  const original = globalThis.fetch;
  const mails = [];
  const state = { resend };
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.resend.com') {
      const body = JSON.parse(options.body);
      const mail = { to: body.to, subject: body.subject, html: body.html, text: body.text, key: options.headers['Idempotency-Key'] };
      mails.push(mail);
      if (onResend) await onResend(mail);
      if (state.resend === 'network') throw new Error('network down');
      if (state.resend === 'fail') return Response.json({ message: 'boom ' + body.to }, { status: 500 });
      return Response.json({ id: 'mail-' + mails.length });
    }
    if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
    if (u.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
    const capture = { id: CAPTURE, status: 'COMPLETED', custom_id: LOCAL, amount: { currency_code: 'ILS', value: '100.00' } };
    const order = { id: ORDER, status: 'COMPLETED', payer: payer === null ? undefined : { email_address: payer }, purchase_units: [{ custom_id: LOCAL, payments: { captures: [capture] } }] };
    if (u.pathname.endsWith('/capture')) return Response.json(order, { status: 201 });
    if (u.pathname.startsWith('/v2/checkout/orders/')) return Response.json(order);
    if (u.pathname.startsWith('/v2/payments/captures/')) return Response.json(capture);
    return Response.json({}, { status: 404 });
  };
  return { mails, state, restore() { globalThis.fetch = original; } };
}
const capture = (env, extra = {}) => handlePayPalCaptureOrder(new Request('https://amitphotos.com/api/paypal/capture-order', { method: 'POST', body: JSON.stringify({ paypalOrderId: ORDER }) }), env, { skipRateLimit: true, ...extra });
const rows = env => env.sqlite.prepare("SELECT request_id, status, actor, reason FROM paypal_order_actions WHERE action = 'LINK_EMAIL' ORDER BY id").all().map(r => ({ ...r }));
const tokens = env => env.sqlite.prepare('SELECT token, used, tx FROM download_tokens ORDER BY created_at, token').all().map(r => ({ ...r }));
const orderRow = env => env.sqlite.prepare('SELECT * FROM paypal_orders WHERE id = ?').get(LOCAL);
const tokenIn = html => (html.match(/#t=([0-9a-f-]{36})/) || [])[1];

function spyConsole() {
  const logged = [];
  const originals = ['log', 'info', 'warn', 'error', 'debug'].map(name => [name, console[name]]);
  for (const [name] of originals) console[name] = (...args) => logged.push(args.map(String).join(' '));
  return { logged, restore() { for (const [name, fn] of originals) console[name] = fn; } };
}

// ----- sending after a verified payment ----------------------------------------------------

test('after capture the SAME link is mailed to the test recipient: no new token, no charge, nothing logged', async () => {
  const env = setup();
  const net = fakes();
  const spy = spyConsole();
  try {
    const response = await capture(env);
    const body = await response.json();
    assert.equal(response.status, 200);
    const token = body.url.split('/').pop();
    assert.equal(net.mails.length, 1);
    assert.equal(net.mails[0].to, TEST_INBOX, 'Sandbox mail goes only to the explicit test recipient');
    assert.match(net.mails[0].subject, /^\[TEST\] /);
    assert.equal(tokenIn(net.mails[0].html), token, 'the mailed link is the link shown to the buyer');
    assert.ok(net.mails[0].html.includes('https://amitphotos.com/checkout/download/#t=' + token));
    assert.ok(!net.mails[0].html.includes('/api/download/'), 'the mail never links straight to the one-time endpoint');
    assert.equal(net.mails[0].key, 'dl-auto-' + LOCAL);
    assert.equal(tokens(env).length, 1, 'no extra token');
    assert.deepEqual(rows(env), [{ request_id: 'auto-1', status: 'SENT', actor: 'system', reason: 'test_recipient' }]);
    assert.equal(orderRow(env).status, 'COMPLETED');
    const secrets = [token, 'fake-resend-key', 'fake-secret', TEST_INBOX, PAYER];
    assert.deepEqual(spy.logged.filter(line => secrets.some(s => line.includes(s))), [], 'no link, address or secret in logs');
  } finally { spy.restore(); net.restore(); }
});

test('Sandbox without a test recipient never mails (fake payer addresses), and the payment is unaffected', async () => {
  const env = setup({ env: { DOWNLOAD_EMAIL_OVERRIDE_TO: undefined } });
  const net = fakes({ payer: 'sb-buyer@personal.example.com' });
  try {
    assert.equal((await capture(env)).status, 200);
    assert.equal(net.mails.length, 0);
    assert.deepEqual(rows(env), []);
  } finally { net.restore(); }
});

test('Live mails the payer address PayPal reported for the verified transaction, never an address from the browser', async () => {
  const env = setup({ env: { ...LIVE, DOWNLOAD_EMAIL_OVERRIDE_TO: undefined } });
  const net = fakes();
  try {
    const request = new Request('https://amitphotos.com/api/paypal/capture-order', {
      method: 'POST', body: JSON.stringify({ paypalOrderId: ORDER, email: 'attacker@evil.example', to: 'attacker@evil.example' }),
    });
    assert.equal((await handlePayPalCaptureOrder(request, env, { skipRateLimit: true })).status, 200);
    assert.equal(net.mails.length, 1);
    assert.equal(net.mails[0].to, PAYER);
    assert.doesNotMatch(net.mails[0].subject, /TEST/);
    assert.ok(!JSON.stringify(net.mails).includes('evil.example'));
    assert.equal(rows(env)[0].reason, 'payer');
  } finally { net.restore(); }
});

test('Live without a usable payer address sends nothing; unsafe addresses are refused', async () => {
  for (const payer of [null, 'not-an-email', 'a@b', 'x@y.example\nBcc: attacker@evil.example', 'two@example.com,three@example.com', '<script>@example.com', 'a b@example.com']) {
    const env = setup({ env: { ...LIVE, DOWNLOAD_EMAIL_OVERRIDE_TO: undefined } });
    const net = fakes({ payer });
    try {
      assert.equal((await capture(env)).status, 200, String(payer));
      assert.equal(net.mails.length, 0, JSON.stringify(payer));
    } finally { net.restore(); }
  }
});

test('an invalid test recipient blocks every mail instead of falling back to the payer', async () => {
  const env = setup({ env: { ...LIVE, DOWNLOAD_EMAIL_OVERRIDE_TO: 'not valid' } });
  const net = fakes();
  try {
    assert.equal((await capture(env)).status, 200);
    assert.equal(net.mails.length, 0);
  } finally { net.restore(); }
});

test('mail is off unless explicitly enabled with a provider key, and an invalid PayPal configuration also blocks it', async () => {
  assert.equal(downloadEmailEnabled({ RESEND_API_KEY: 'k' }), false);
  assert.equal(downloadEmailEnabled({ DOWNLOAD_EMAIL_ENABLED: 'true' }), false);
  assert.equal(downloadEmailEnabled({ DOWNLOAD_EMAIL_ENABLED: 'TRUE', RESEND_API_KEY: 'k' }), false);
  assert.equal(downloadEmailEnabled({ DOWNLOAD_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'k' }), true);
  for (const extra of [{ DOWNLOAD_EMAIL_ENABLED: undefined }, { RESEND_API_KEY: undefined }]) {
    const env = setup({ env: extra });
    const net = fakes();
    try { await capture(env); assert.equal(net.mails.length, 0); } finally { net.restore(); }
  }
  const env = setup({ env: { PAYPAL_ENVIRONMENT: 'prod' } });
  const net = fakes();
  try {
    const result = await sendDownloadLinkEmail(env, null, { id: LOCAL });
    assert.equal(result.reason, 'CONFIG_INVALID');
    assert.equal(net.mails.length, 0);
  } finally { net.restore(); }
});

// ----- failures, retries and duplicates -------------------------------------------------------

test('a failed or timed-out send never fails the payment; the sweep retries and a later success stops further mail', async () => {
  for (const failure of ['fail', 'network']) {
    const env = setup();
    const net = fakes({ resend: failure });
    const spy = spyConsole();
    try {
      const response = await capture(env);
      assert.equal(response.status, 200, failure);
      assert.match((await response.json()).url, /^\/api\/download\//);
      assert.equal(orderRow(env).status, 'COMPLETED');
      assert.equal(tokens(env)[0].used, 0, 'the link still works');
      assert.deepEqual(rows(env).map(r => [r.request_id, r.status]), [['auto-1', 'FAILED']]);
      assert.ok(['provider_500', 'network'].includes(rows(env)[0].reason));
      assert.deepEqual(spy.logged.filter(line => line.includes(TEST_INBOX)), [], 'provider error text (which can echo the address) is not logged');

      net.state.resend = 'ok';
      assert.deepEqual(await retryDownloadLinkEmails(env), { checked: 1 });
      assert.deepEqual(rows(env).map(r => [r.request_id, r.status]), [['auto-1', 'FAILED'], ['auto-2', 'SENT']]);
      assert.equal(net.mails.length, 2);
      assert.equal(net.mails[0].key, net.mails[1].key, 'the provider de-duplicates retries with one idempotency key');
      assert.deepEqual(await retryDownloadLinkEmails(env), { checked: 0 }, 'delivered orders are left alone');
      assert.equal(net.mails.length, 2);
    } finally { spy.restore(); net.restore(); }
  }
});

test('retries stop after four attempts and a stale in-progress claim does not block recovery forever', async () => {
  const env = setup({ status: 'COMPLETED' });
  const net = fakes({ resend: 'fail' });
  try {
    for (let i = 0; i < 6; i++) await sendDownloadLinkEmail(env, null, { id: LOCAL });
    assert.equal(net.mails.length, 4);
    assert.equal(rows(env).length, 4);
    assert.equal((await sendDownloadLinkEmail(env, null, { id: LOCAL })).reason, 'ATTEMPTS_EXHAUSTED');
  } finally { net.restore(); }
  const crashed = setup({ status: 'COMPLETED' });
  crashed.sqlite.prepare("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, created_at) VALUES (?, ?, 'LINK_EMAIL', 'auto-1', 'SENDING', 'system', 'auto', ?)")
    .run(LOCAL, ORDER, new Date(Date.now() - 3600e3).toISOString());
  const net2 = fakes();
  try {
    assert.equal((await sendDownloadLinkEmail(crashed, null, { id: LOCAL })).status, 'SENT');
    const fresh = setup({ status: 'COMPLETED' });
    fresh.sqlite.prepare("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, created_at) VALUES (?, ?, 'LINK_EMAIL', 'auto-1', 'SENDING', 'system', 'auto', ?)")
      .run(LOCAL, ORDER, new Date().toISOString());
    assert.equal((await sendDownloadLinkEmail(fresh, null, { id: LOCAL })).reason, 'ALREADY_SENT_OR_IN_PROGRESS');
  } finally { net2.restore(); }
});

test('payment completion from the buyer request AND the webhook at the same time sends exactly one mail', async () => {
  const env = setup();
  const net = fakes();
  try {
    const event = { id: 'WH-EVENT-LINKMAIL-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', create_time: '2026-10-14T10:00:00Z',
      resource: { id: CAPTURE, status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' }, supplementary_data: { related_ids: { order_id: ORDER } } } };
    const webhook = handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', {
      method: 'POST', body: JSON.stringify(event),
      headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't1', 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': 't' },
    }), env);
    const [buyer, hook] = await Promise.all([capture(env), webhook]);
    assert.equal(buyer.status, 200);
    assert.ok([200, 409].includes(hook.status));
    await retryDownloadLinkEmails(env);
    assert.equal(net.mails.length, 1, 'one mail');
    assert.equal(tokens(env).length, 1, 'one token');
    assert.equal(rows(env).filter(r => r.status === 'SENT').length, 1);
  } finally { net.restore(); }
});

test('five parallel send attempts produce one mail', async () => {
  const env = setup({ status: 'COMPLETED' });
  const net = fakes({ onResend: () => new Promise(resolve => setTimeout(resolve, 20)) });
  try {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => sendDownloadLinkEmail(env, null, { id: LOCAL })));
    assert.equal(net.mails.length, 1);
    assert.equal(results.filter(r => r.status === 'SENT').length, 1);
  } finally { net.restore(); }
});

// ----- never mail a link that is not valid ------------------------------------------------------

test('no mail for a used, expired or revoked link, a refunded or reviewed order, a dispute, or an unfinished order', async () => {
  const cases = {
    used: env => env.sqlite.exec("UPDATE download_tokens SET used = 1"),
    revoked: env => env.sqlite.exec("UPDATE download_tokens SET used = 2, revoked_at = 1"),
    expired: env => env.sqlite.exec('UPDATE download_tokens SET expires_at = 1'),
    refunded: env => env.sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REFUNDED'"),
    reversed: env => env.sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REVERSED'"),
    review: env => env.sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REVIEW_REQUIRED'"),
    dispute: env => env.sqlite.exec('UPDATE paypal_orders SET dispute_open = 1'),
    unfinished: env => env.sqlite.exec("UPDATE paypal_orders SET status = 'FULFILLING'"),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const env = setup({ status: 'COMPLETED' });
    mutate(env);
    const net = fakes();
    try {
      const result = await sendDownloadLinkEmail(env, null, { id: LOCAL });
      assert.equal(result.status, 'SKIPPED', name);
      assert.equal(net.mails.length, 0, name);
      assert.deepEqual(rows(env), [], name);
      assert.deepEqual(await retryDownloadLinkEmails(env), { checked: 0 }, name + ' sweep');
    } finally { net.restore(); }
  }
});

test('a refund that lands between the check and the send stops the mail', async () => {
  const env = setup({ status: 'COMPLETED' });
  const realPrepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    if (sql.includes("INSERT INTO paypal_order_actions") && sql.includes("'LINK_EMAIL'")) env.sqlite.exec("UPDATE paypal_orders SET after_sale_state = 'REFUNDED'");
    return realPrepare(sql);
  };
  const net = fakes();
  try {
    const result = await sendDownloadLinkEmail(env, null, { id: LOCAL });
    assert.equal(result.status, 'SKIPPED');
    assert.equal(net.mails.length, 0);
    assert.equal(rows(env)[0].status, 'SKIPPED');
  } finally { net.restore(); }
});

// ----- support: re-send the current link ---------------------------------------------------------

const resend = (env, key, body = {}) => handlePayPalResendLinkEmail(new Request('https://amitphotos.com/api/admin/paypal/resend-link-email', {
  method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ paypalOrderId: ORDER, reason: 'customer lost the mail', ...body }),
}), env);

test('support re-send mails the current link only; a re-issued order mails the NEW link; same key never mails twice; three at most', async () => {
  const env = setup({ status: 'COMPLETED' });
  const net = fakes();
  try {
    assert.equal((await resend(env, 'resend-key-0001')).status, 200);
    assert.equal(tokenIn(net.mails[0].html), 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    const replay = await resend(env, 'resend-key-0001');
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);
    assert.equal(net.mails.length, 1);

    const reissued = await handlePayPalReissueDownload(new Request('https://amitphotos.com/x', {
      method: 'POST', headers: { 'Idempotency-Key': 'reissue-key-0001' }, body: JSON.stringify({ paypalOrderId: ORDER, reason: 'download failed' }),
    }), env);
    assert.equal(reissued.status, 200);
    const newToken = (await reissued.json()).url.split('/').pop();
    assert.equal((await resend(env, 'resend-key-0002')).status, 200);
    assert.equal(tokenIn(net.mails[1].html), newToken, 'the previous (revoked) link is never mailed');
    assert.equal(tokens(env).length, 2, 'mailing created no token');
    assert.equal((await resend(env, 'resend-key-0003')).status, 200);
    const fourth = await resend(env, 'resend-key-0004');
    assert.equal(fourth.status, 409);
    assert.equal(net.mails.length, 3);
    for (const [bad, expected] of [[{ reason: ' ' }, 400], [{ paypalOrderId: 'bad id' }, 400]]) assert.equal((await resend(env, 'resend-key-0009', bad)).status, expected);
    assert.equal((await handlePayPalResendLinkEmail(new Request('https://amitphotos.com/x'), env)).status, 405);
  } finally { net.restore(); }
});

test('support re-send refuses when nothing valid exists, when mail is off, or on an invalid configuration', async () => {
  const net = fakes();
  try {
    const used = setup({ status: 'COMPLETED' });
    used.sqlite.exec('UPDATE download_tokens SET used = 1');
    const result = await resend(used, 'resend-key-0001');
    assert.equal(result.status, 409);
    assert.equal((await result.json()).reason, 'NO_ACTIVE_LINK');
    assert.equal((await resend(setup({ status: 'COMPLETED', env: { DOWNLOAD_EMAIL_ENABLED: undefined } }), 'resend-key-0001')).status, 409);
    assert.equal((await resend(setup({ status: 'COMPLETED', env: { PAYPAL_ENVIRONMENT: 'prod' } }), 'resend-key-0001')).status, 503);
    assert.equal(net.mails.length, 0);
  } finally { net.restore(); }
});

// ----- the landing page and the link state hint -----------------------------------------------------

test('landing page: token only from the URL fragment, no third-party loads, HEAD pre-check, noindex and no referrer', () => {
  assert.match(landing, /location\.hash/);
  assert.doesNotMatch(landing, /location\.search|document\.cookie|localStorage|sessionStorage/);
  assert.match(landing, /method: 'HEAD'/);
  assert.match(landing, /name="robots" content="noindex, nofollow"/);
  assert.match(landing, /name="referrer" content="no-referrer"/);
  assert.deepEqual(landing.match(/https?:\/\/[^\s"'<>)]+/g) || [], [], 'no external URL at all: no fonts, analytics or scripts');
  assert.doesNotMatch(landing, /<script[^>]+src=/);
  assert.match(headersFile, /\/checkout\/download\/\*\s+Cache-Control: no-store\s+Referrer-Policy: no-referrer\s+X-Robots-Tag: noindex, nofollow/);
  assert.match(landing, /aria-live="polite"/);
});

test('a link that cannot be used answers 410 with a non-secret state hint, for HEAD and GET', async () => {
  for (const [sql, state] of [["UPDATE download_tokens SET used = 1", 'used'], ["UPDATE download_tokens SET used = 2, revoked_at = 1", 'revoked'], ['UPDATE download_tokens SET expires_at = 1', 'expired']]) {
    const env = setup({ status: 'COMPLETED' });
    env.sqlite.exec(sql);
    env.PHOTOS = { async get() { return null; }, async head() { return null; } };
    for (const method of ['HEAD', 'GET']) {
      const response = await handleDownload(new Request('https://amitphotos.com/api/download/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', { method }), env, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
      assert.equal(response.status, 410, state + method);
      assert.equal(response.headers.get('X-Link-State'), state, state + method);
    }
  }
});
