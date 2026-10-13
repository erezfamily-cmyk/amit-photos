import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCheckoutClient } from '../assets/js/digital-checkout.mjs';
import { digitalPaymentsEnabled, handleDigitalCheckoutQuote, handlePayPalCreateOrder, handlePayPalCaptureOrder } from '../paypal-orders.js';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
function env() {
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
  const DB = {
    prepare(sql) {
      return { bind(...args) {
        return {
          async first() { return sqlite.prepare(sql).get(...args) || null; },
          async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: result.changes } }; },
        };
      }, async first() { return sqlite.prepare(sql).get() || null; } };
    },
  };
  return { DB, sqlite, PAYMENTS_ENABLED: 'true', DIGITAL_PAYPAL_ENABLED: 'true', PAYPAL_CLIENT_ID: 'test', PAYPAL_CLIENT_SECRET: 'test' };
}
const quoteRequest = new Request('https://amitphotos.com/api/paypal/quote?photoId=photo-1&sku=large');
const quote = { photoId: 'photo-1', amountMinor: 10000, currency: 'ILS', license: 'personal', enabled: true };
const orderId = 'PAYPALORDER12345';
function createRequest(overrides = {}) {
  return new Request('https://amitphotos.com/api/paypal/create-order', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'checkout-attempt-12345' },
    body: JSON.stringify({ type: 'digital', photoId: 'photo-1', sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: 10000, ...overrides }),
  });
}

test('both flags require exact true; public create and capture fail before DB access', async () => {
  for (const value of [undefined, null, false, 'false', 'TRUE', '1']) {
    for (const flags of [{ PAYMENTS_ENABLED: 'true', DIGITAL_PAYPAL_ENABLED: value }, { PAYMENTS_ENABLED: value, DIGITAL_PAYPAL_ENABLED: 'true' }]) {
      assert.equal(digitalPaymentsEnabled(flags), false);
      assert.equal((await handlePayPalCreateOrder(createRequest(), flags)).status, 503);
      assert.equal((await handlePayPalCaptureOrder(createRequest(), flags)).status, 503);
    }
  }
  assert.equal(digitalPaymentsEnabled({ PAYMENTS_ENABLED: 'true', DIGITAL_PAYPAL_ENABLED: 'true' }), true);
});

test('quote uses published photo and server overrides while payments are disabled', async () => {
  const config = env();
  config.DIGITAL_PAYPAL_ENABLED = 'false';
  const response = await handleDigitalCheckoutQuote(quoteRequest, config);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...quote, sku: 'large', title: 'Photo One', enabled: false, environment: 'sandbox' });
  config.sqlite.prepare('UPDATE photos SET published=0').run();
  assert.equal((await handleDigitalCheckoutQuote(quoteRequest, config)).status, 404);
});

test('public create rejects stale prices, missing acceptance and unsupported currency before PayPal', async () => {
  for (const [body, expected] of [[{ expectedAmountMinor: 1 }, 409], [{ licenseAccepted: false }, 400], [{ currency: 'USD' }, 400]]) {
    const config = env();
    const response = await handlePayPalCreateOrder(createRequest(body), config, { publicCheckout: true, skipRateLimit: true });
    assert.equal(response.status, expected);
    assert.equal(config.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 0);
  }
});

test('public create uses server amount, checkout return URLs and one canonical order on retry', async () => {
  const config = env();
  const original = globalThis.fetch;
  let payload;
  let creates = 0;
  const approval = 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'token' });
    if (options?.method === 'POST') { creates++; payload = JSON.parse(options.body); }
    return Response.json({ id: orderId, links: [{ rel: 'payer-action', href: approval }] }, { status: 201 });
  };
  try {
    const options = { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true };
    const first = await handlePayPalCreateOrder(createRequest(), config, options);
    assert.equal(first.status, 201);
    assert.equal((await first.json()).approveUrl, approval);
    assert.equal(payload.purchase_units[0].amount.value, '100.00');
    assert.equal(payload.payment_source.paypal.experience_context.return_url, 'https://amitphotos.com/checkout/?approved=1');
    assert.equal(payload.payment_source.paypal.experience_context.cancel_url, 'https://amitphotos.com/checkout/?cancelled=1');
    const second = await handlePayPalCreateOrder(createRequest(), config, options);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).paypalOrderId, orderId);
    assert.equal(creates, 1);
    assert.equal(config.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 1);
    const mismatch = await handlePayPalCreateOrder(createRequest({ sku: 'small', expectedAmountMinor: 1900 }), config, options);
    assert.equal(mismatch.status, 409);
  } finally { globalThis.fetch = original; }
});

test('client keeps its key after a lost create response and never sends a client price as authority', async () => {
  const keys = [];
  let requests = 0;
  const client = createCheckoutClient({ storage: storage(), uuid: () => 'stable-checkout-key', fetcher: async (url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    const body = JSON.parse(options.body);
    assert.equal(body.expectedAmountMinor, 10000);
    assert.equal('amount' in body, false);
    if (++requests === 1) throw new Error('network');
    return Response.json({ paypalOrderId: orderId, approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId });
  } });
  await assert.rejects(client.start(quote, true), /network/);
  await client.start(quote, true);
  assert.deepEqual(keys, ['stable-checkout-key', 'stable-checkout-key']);
});

test('client blocks disabled payment, unaccepted license and concurrent create clicks', async () => {
  let release;
  const client = createCheckoutClient({ storage: storage(), fetcher: () => new Promise(resolve => { release = resolve; }) });
  await assert.rejects(client.start({ ...quote, enabled: false }, true), /DISABLED/);
  await assert.rejects(client.start(quote, false), /DISABLED/);
  const pending = client.start(quote, true);
  await assert.rejects(client.start(quote, true), /BUSY/);
  release(Response.json({ paypalOrderId: orderId, approveUrl: 'https://www.sandbox.paypal.com/checkoutnow' }));
  await pending;
});

test('client rejects unsafe approval hosts and forged or expired checkout returns', async () => {
  const saved = storage();
  const client = createCheckoutClient({ storage: saved, fetcher: async () => Response.json({ paypalOrderId: orderId, approveUrl: 'https://evil.example/checkout' }) });
  await assert.rejects(client.start(quote, true), /INVALID_APPROVAL/);
  await assert.rejects(client.capture(orderId), /RETURN_MISMATCH/);
  const good = createCheckoutClient({ storage: saved, now: () => 100, fetcher: async () => Response.json({ paypalOrderId: orderId, approveUrl: 'https://www.sandbox.paypal.com/checkoutnow' }) });
  await good.start(quote, true);
  await assert.rejects(good.capture('FORGEDORDER12345'), /RETURN_MISMATCH/);
  const expired = createCheckoutClient({ storage: saved, now: () => 86400101 });
  await assert.rejects(expired.capture(orderId), /RETURN_MISMATCH/);
});

test('capture retries the same order and keeps bearer download tokens out of storage', async () => {
  const saved = storage();
  const bodies = [];
  let captureCount = 0;
  const client = createCheckoutClient({ storage: saved, fetcher: async (url, options) => {
    if (url.endsWith('create-order')) return Response.json({ paypalOrderId: orderId, approveUrl: 'https://www.sandbox.paypal.com/checkoutnow' });
    bodies.push(JSON.parse(options.body));
    if (++captureCount === 1) throw new Error('lost response');
    return Response.json({ url: '/api/download/bearer-token', title: 'Photo One' });
  } });
  await client.start(quote, true);
  await assert.rejects(client.capture(orderId), /lost response/);
  assert.equal((await client.capture(orderId)).url, '/api/download/bearer-token');
  assert.deepEqual(bodies, [{ paypalOrderId: orderId }, { paypalOrderId: orderId }]);
  assert.doesNotMatch(saved.getItem('amit-digital-checkout-v1'), /bearer-token/);
});
