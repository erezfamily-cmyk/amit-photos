import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCheckoutClient } from '../assets/js/digital-checkout.mjs';
import {
  resolvePayPalConfig, digitalPaymentsEnabled, handleDigitalCheckoutQuote, handlePayPalCreateOrder,
  handlePayPalCaptureOrder, handlePayPalSandboxStatus, handlePayPalSandboxCleanup, handlePayPalWebhook,
} from '../paypal-orders.js';

// Fake, non-secret values only. No real credential or webhook id appears in this file.
const SANDBOX_HOST = 'api-m.sandbox.paypal.com';
const LIVE_HOST = 'api-m.paypal.com';
const orderId = 'PAYPALORDER12345';

function env(extra = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO settings VALUES ('prices', '{"small":19,"medium":59,"large":129}');
    CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, published INTEGER, price_overrides TEXT);
    INSERT INTO photos VALUES ('photo-1','Photo One',1,'{"large":100}');
    CREATE TABLE paypal_orders (id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE, order_type TEXT,
      photo_id TEXT, sku TEXT, amount_expected INTEGER, currency TEXT, status TEXT, created_at TEXT,
      client_idempotency_key TEXT UNIQUE);
  `);
  const stats = { dbCalls: 0 };
  const DB = {
    prepare(sql) {
      stats.dbCalls++;
      return { bind(...args) {
        return {
          async first() { return sqlite.prepare(sql).get(...args) || null; },
          async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: result.changes } }; },
          async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        };
      }, async first() { return sqlite.prepare(sql).get() || null; } };
    },
  };
  return { DB, sqlite, stats, PAYMENTS_ENABLED: 'true', DIGITAL_PAYPAL_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', ...extra };
}
const SANDBOX = {};
const LIVE = { PAYPAL_ENVIRONMENT: 'live', PAYPAL_CREDENTIALS_ENVIRONMENT: 'live', PAYPAL_WEBHOOK_ID: 'fake-webhook-id' };

function post(path, body = {}, origin = 'https://amitphotos.com', headers = {}) {
  return new Request(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
function createRequest(origin) {
  return post('/api/paypal/create-order', { type: 'digital', photoId: 'photo-1', sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: 10000 },
    origin, { 'Idempotency-Key': 'checkout-attempt-12345' });
}
function recordFetch(approvalHost) {
  const original = globalThis.fetch;
  const hosts = [];
  globalThis.fetch = async url => {
    hosts.push(new URL(String(url)).host);
    if (String(url).endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'token' });
    return Response.json({ id: orderId, links: [{ rel: 'payer-action', href: 'https://' + approvalHost + '/checkoutnow?token=' + orderId }] }, { status: 201 });
  };
  return { hosts, restore() { globalThis.fetch = original; } };
}
const publicOptions = { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true };

test('config: unset means Sandbox; explicit sandbox and live resolve to matching API base and approval host', () => {
  assert.deepEqual(resolvePayPalConfig(env(SANDBOX)), { ok: true, environment: 'sandbox', apiBase: 'https://' + SANDBOX_HOST, approvalHost: 'www.sandbox.paypal.com', eventLinkHosts: ['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'] });
  assert.equal(resolvePayPalConfig(env({ PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_CREDENTIALS_ENVIRONMENT: 'sandbox' })).environment, 'sandbox');
  assert.deepEqual(resolvePayPalConfig(env(LIVE), createRequest('https://www.amitphotos.com')),
    { ok: true, environment: 'live', apiBase: 'https://' + LIVE_HOST, approvalHost: 'www.paypal.com', eventLinkHosts: ['api-m.paypal.com', 'api.paypal.com'] });
});

test('config: unknown selector values are blocked, never treated as Sandbox or Live', () => {
  for (const value of ['Live', 'LIVE', 'production', 'prod', 'sandbox ', ' live', 'true', '1', 'both', 'sandbox,live']) {
    const config = resolvePayPalConfig(env({ ...LIVE, PAYPAL_ENVIRONMENT: value }));
    assert.deepEqual(config, { ok: false, reason: 'PAYPAL_ENVIRONMENT_UNKNOWN' }, JSON.stringify(value));
  }
});

test('config: credentials declared for the other environment are blocked in both directions', () => {
  assert.equal(resolvePayPalConfig(env({ PAYPAL_CREDENTIALS_ENVIRONMENT: 'live' })).reason, 'PAYPAL_CREDENTIALS_ENVIRONMENT_MISMATCH');
  assert.equal(resolvePayPalConfig(env({ ...LIVE, PAYPAL_CREDENTIALS_ENVIRONMENT: 'sandbox' })).reason, 'PAYPAL_CREDENTIALS_ENVIRONMENT_MISMATCH');
  assert.equal(resolvePayPalConfig(env({ ...LIVE, PAYPAL_CREDENTIALS_ENVIRONMENT: undefined })).reason, 'PAYPAL_CREDENTIALS_ENVIRONMENT_MISMATCH');
  assert.equal(resolvePayPalConfig(env({ ...LIVE, PAYPAL_CREDENTIALS_ENVIRONMENT: 'LIVE' })).reason, 'PAYPAL_CREDENTIALS_ENVIRONMENT_MISMATCH');
  assert.equal(resolvePayPalConfig(env({ PAYPAL_CREDENTIALS_ENVIRONMENT: 'production' })).reason, 'PAYPAL_CREDENTIALS_ENVIRONMENT_MISMATCH');
});

test('config: an explicit API base must equal the selected environment base', () => {
  assert.equal(resolvePayPalConfig(env({ PAYPAL_API_BASE: 'https://' + LIVE_HOST })).reason, 'PAYPAL_API_BASE_MISMATCH');
  assert.equal(resolvePayPalConfig(env({ ...LIVE, PAYPAL_API_BASE: 'https://' + SANDBOX_HOST })).reason, 'PAYPAL_API_BASE_MISMATCH');
  assert.equal(resolvePayPalConfig(env({ PAYPAL_API_BASE: 'https://' + SANDBOX_HOST + '/' })).reason, 'PAYPAL_API_BASE_MISMATCH');
  assert.equal(resolvePayPalConfig(env({ PAYPAL_API_BASE: 'https://' + SANDBOX_HOST })).ok, true);
  assert.equal(resolvePayPalConfig(env({ ...LIVE, PAYPAL_API_BASE: 'https://' + LIVE_HOST }), createRequest('https://amitphotos.com')).ok, true);
});

test('config: Live needs credentials, a webhook id and the production origin', () => {
  const request = createRequest('https://amitphotos.com');
  assert.equal(resolvePayPalConfig(env({ ...LIVE, PAYPAL_CLIENT_ID: '' }), request).reason, 'PAYPAL_CREDENTIALS_MISSING');
  assert.equal(resolvePayPalConfig(env({ ...LIVE, PAYPAL_CLIENT_SECRET: undefined }), request).reason, 'PAYPAL_CREDENTIALS_MISSING');
  assert.equal(resolvePayPalConfig(env({ ...LIVE, PAYPAL_WEBHOOK_ID: '' }), request).reason, 'PAYPAL_WEBHOOK_ID_MISSING');
  for (const origin of ['https://feature-x.erez-family.workers.dev', 'http://amitphotos.com', 'https://amitphotos.com.evil.example', 'https://evil.example']) {
    assert.equal(resolvePayPalConfig(env(LIVE), createRequest(origin)).reason, 'PAYPAL_LIVE_ORIGIN_NOT_ALLOWED', origin);
  }
});

test('Sandbox calls only Sandbox hosts; Live calls only Live hosts', async () => {
  for (const [label, extra, origin, apiHost, approvalHost] of [
    ['sandbox', SANDBOX, 'https://feature-x.erez-family.workers.dev', SANDBOX_HOST, 'www.sandbox.paypal.com'],
    ['live', LIVE, 'https://amitphotos.com', LIVE_HOST, 'www.paypal.com'],
  ]) {
    const config = env(extra);
    const spy = recordFetch(approvalHost);
    try {
      const response = await handlePayPalCreateOrder(createRequest(origin), config, publicOptions);
      assert.equal(response.status, 201, label);
      assert.deepEqual([...new Set(spy.hosts)], [apiHost], label);
      assert.equal(new URL((await response.json()).approveUrl).host, approvalHost, label);
    } finally { spy.restore(); }
  }
});

test('any invalid configuration blocks public create, capture and quote even with both flags true', async () => {
  const bad = [
    { PAYPAL_ENVIRONMENT: 'production' },
    { PAYPAL_CREDENTIALS_ENVIRONMENT: 'live' },
    { ...LIVE, PAYPAL_WEBHOOK_ID: '' },
    { ...LIVE, PAYPAL_CREDENTIALS_ENVIRONMENT: 'sandbox' },
    { ...LIVE, PAYPAL_API_BASE: 'https://' + SANDBOX_HOST },
    { PAYPAL_API_BASE: 'https://' + LIVE_HOST },
  ];
  for (const extra of bad) {
    const config = env(extra);
    const spy = recordFetch('www.paypal.com');
    try {
      assert.equal(digitalPaymentsEnabled(config, createRequest('https://amitphotos.com')), false, JSON.stringify(extra));
      assert.equal((await handlePayPalCreateOrder(createRequest('https://amitphotos.com'), config, publicOptions)).status, 503);
      assert.equal((await handlePayPalCaptureOrder(post('/api/paypal/capture-order', { paypalOrderId: orderId }), config)).status, 503);
      const quote = await handleDigitalCheckoutQuote(new Request('https://amitphotos.com/api/paypal/quote?photoId=photo-1&sku=large'), config);
      assert.equal((await quote.json()).enabled, false);
      assert.deepEqual(spy.hosts, [], 'no PayPal call for ' + JSON.stringify(extra));
      assert.equal(config.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 0);
    } finally { spy.restore(); }
  }
});

test('Live is closed in every flag combination that is not both true', async () => {
  for (const flags of [
    { PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false' },
    { PAYMENTS_ENABLED: 'true', DIGITAL_PAYPAL_ENABLED: 'false' },
    { PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'true' },
    { PAYMENTS_ENABLED: undefined, DIGITAL_PAYPAL_ENABLED: undefined },
  ]) {
    const config = env({ ...LIVE, ...flags });
    const spy = recordFetch('www.paypal.com');
    try {
      assert.equal((await handlePayPalCreateOrder(createRequest('https://amitphotos.com'), config, publicOptions)).status, 503);
      assert.equal((await handlePayPalCaptureOrder(post('/api/paypal/capture-order', { paypalOrderId: orderId }), config)).status, 503);
      assert.deepEqual(spy.hosts, []);
    } finally { spy.restore(); }
  }
});

test('admin test tools and cleanup refuse Live and invalid configuration, before any PayPal or DB access', async () => {
  const live = env({ ...LIVE, PAYPAL_SANDBOX_CLEANUP_ENABLED: 'true', PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false' });
  const spy = recordFetch('www.paypal.com');
  try {
    const admin = { allowWhenPaymentsDisabled: true, includeApproveUrl: true };
    const results = [
      await handlePayPalCreateOrder(createRequest('https://amitphotos.com'), live, admin),
      await handlePayPalCaptureOrder(post('/api/admin/paypal/capture-order', { paypalOrderId: orderId }), live, admin),
      await handlePayPalSandboxStatus(new Request('https://amitphotos.com/api/admin/paypal/sandbox-status'), live),
      await handlePayPalSandboxCleanup(post('/api/admin/paypal/cleanup', { apply: true }), live),
    ];
    for (const response of results) {
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'SANDBOX_TOOLS_DISABLED_IN_LIVE');
    }
    const invalid = env({ PAYPAL_ENVIRONMENT: 'prod', PAYPAL_SANDBOX_CLEANUP_ENABLED: 'true' });
    const invalidCleanup = await handlePayPalSandboxCleanup(post('/api/admin/paypal/cleanup', { apply: true }), invalid);
    assert.equal(invalidCleanup.status, 503);
    assert.equal((await invalidCleanup.json()).error, 'PAYPAL_CONFIGURATION_INVALID');
    assert.deepEqual(spy.hosts, []);
    assert.equal(live.stats.dbCalls, 0);
    assert.equal(invalid.stats.dbCalls, 0);
  } finally { spy.restore(); }
});

test('Sandbox admin tools and cleanup keep working, and cleanup still needs its own switch', async () => {
  const spy = recordFetch('www.sandbox.paypal.com');
  try {
    const status = await handlePayPalSandboxStatus(new Request('https://x.example/api/admin/paypal/sandbox-status'), env(SANDBOX));
    assert.equal(status.status, 200);
    assert.equal((await status.json()).environment, 'sandbox');
    const off = await handlePayPalSandboxCleanup(post('/api/admin/paypal/cleanup', {}), env(SANDBOX));
    assert.equal(off.status, 403);
    assert.equal((await off.json()).error, 'PAYPAL_SANDBOX_CLEANUP_DISABLED');
    const admin = await handlePayPalCreateOrder(createRequest('https://x.example'), env({ PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false' }), { allowWhenPaymentsDisabled: true, includeApproveUrl: true, skipRateLimit: true });
    assert.equal(admin.status, 201);
    assert.deepEqual([...new Set(spy.hosts)], [SANDBOX_HOST]);
  } finally { spy.restore(); }
});

test('webhook: invalid configuration is refused before reading the body or calling PayPal', async () => {
  const spy = recordFetch('www.paypal.com');
  try {
    const unknown = await handlePayPalWebhook(post('/api/paypal/webhook', {}), env({ PAYPAL_ENVIRONMENT: 'prod' }));
    assert.equal(unknown.status, 503);
    const mismatch = await handlePayPalWebhook(post('/api/paypal/webhook', {}), env({ ...LIVE, PAYPAL_CREDENTIALS_ENVIRONMENT: 'sandbox' }));
    assert.equal(mismatch.status, 503);
    const noWebhookId = await handlePayPalWebhook(post('/api/paypal/webhook', {}), env({ ...LIVE, PAYPAL_WEBHOOK_ID: '' }));
    assert.equal(noWebhookId.status, 400);
    assert.equal((await noWebhookId.json()).error, 'PAYPAL_WEBHOOK_ID_MISSING');
    const wrongOrigin = await handlePayPalWebhook(post('/api/paypal/webhook', {}, 'https://feature-x.erez-family.workers.dev'), env(LIVE));
    assert.equal(wrongOrigin.status, 503);
    assert.deepEqual(spy.hosts, []);
  } finally { spy.restore(); }
});

test('quote reports the environment so the client can pin the matching approval host', async () => {
  const request = new Request('https://amitphotos.com/api/paypal/quote?photoId=photo-1&sku=large');
  assert.equal((await (await handleDigitalCheckoutQuote(request, env(SANDBOX))).json()).environment, 'sandbox');
  assert.equal((await (await handleDigitalCheckoutQuote(request, env(LIVE))).json()).environment, 'live');
  assert.equal((await (await handleDigitalCheckoutQuote(request, env({ PAYPAL_ENVIRONMENT: 'prod' }))).json()).environment, null);
});

test('client accepts only the approval host of the environment the server reported', async () => {
  const storage = () => { const m = new Map(); return { getItem: k => m.get(k) || null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; };
  const base = { photoId: 'photo-1', amountMinor: 10000, currency: 'ILS', license: 'personal', enabled: true };
  const attempt = async (environment, host) => {
    const client = createCheckoutClient({ storage: storage(), uuid: () => 'key-123456', fetcher: async () =>
      Response.json({ paypalOrderId: orderId, approveUrl: 'https://' + host + '/checkoutnow?token=' + orderId }) });
    return client.start({ ...base, ...(environment === undefined ? {} : { environment }) }, true);
  };
  assert.match(await attempt('sandbox', 'www.sandbox.paypal.com'), /^https:\/\/www\.sandbox\.paypal\.com\//);
  assert.match(await attempt('live', 'www.paypal.com'), /^https:\/\/www\.paypal\.com\//);
  await assert.rejects(attempt('sandbox', 'www.paypal.com'), /INVALID_APPROVAL/);
  await assert.rejects(attempt('live', 'www.sandbox.paypal.com'), /INVALID_APPROVAL/);
  await assert.rejects(attempt(undefined, 'www.sandbox.paypal.com'), /INVALID_APPROVAL/);
  await assert.rejects(attempt('constructor', 'www.paypal.com'), /INVALID_APPROVAL/);
  await assert.rejects(attempt('live', 'www.paypal.com.evil.example'), /INVALID_APPROVAL/);
});
