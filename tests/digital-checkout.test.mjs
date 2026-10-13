import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createCheckoutClient, resolveCheckoutLang } from '../assets/js/digital-checkout.mjs';
import { digitalPaymentsEnabled, handleDigitalCheckoutQuote, handlePayPalCreateOrder, handlePayPalCaptureOrder } from '../paypal-orders.js';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
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

test('gallery personal-license entry opens Orders v2 preview even while payments are closed', () => {
  const source = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
  const start = source.indexOf('function openBuyModal(photo) {');
  const end = source.indexOf('function transitionBuyStep(', start);
  for (const lang of ['he', 'en']) {
    let target;
    const events = [];
    const context = { URLSearchParams, PURCHASES_ENABLED: false, getLang: () => lang,
      trackEvent: type => events.push(type), window: { location: { assign: url => { target = url; } } } };
    vm.runInNewContext(source.slice(start, end) + "\nopenBuyModal({ id: 'photo & 1' });", context);
    const url = new URL(target, 'https://amitphotos.com');
    assert.equal(url.pathname, '/checkout/');
    assert.equal(url.searchParams.get('photoId'), 'photo & 1');
    assert.equal(url.searchParams.get('lang'), lang);
    assert.deepEqual(events, ['licensing_personal_interest']);
  }
  assert.doesNotMatch(source.slice(start, end), /cgi-bin|pending_item_number|amount:/);
});

test('legacy cart and print cannot charge when the global payment flag is true', () => {
  const source = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
  const gate = source.slice(source.indexOf('const LEGACY_CHECKOUT_ENABLED'), source.indexOf('let allPhotos'));
  const cart = source.match(/function cartCheckout\(\) \{[\s\S]*?\n\}/)[0];
  let alerts = 0;
  const context = { PURCHASES_ENABLED: true, alert: () => { alerts++; }, t: value => value };
  vm.runInNewContext(gate + cart + "\nif (canBuy({})) throw Error('legacy visible'); cartCheckout();", context);
  assert.equal(alerts, 1);
  assert.match(source, /async function open\(photo\) \{\s*if \(!PURCHASES_ENABLED \|\| !LEGACY_CHECKOUT_ENABLED\)/);
  assert.match(source, /async function pay\(\) \{\s*if \(!PURCHASES_ENABLED \|\| !LEGACY_CHECKOUT_ENABLED\)/);
});

test('homepage inline JavaScript parses, including the guide popup lead handler', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=|application\/ld\+json|application\/json/i.test(match[1])) continue;
    assert.doesNotThrow(() => new vm.Script(match[2]));
  }
});

test('full-size product copy agrees with the personal license and retained copyright', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const translations = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
  assert.match(html, /data-i18n="pricing.full.f3">רישיון אישי ולא מסחרי/);
  assert.match(html, /data-i18n="pricing.full.f4">זכויות היוצרים נשארות אצל הצלם/);
  assert.match(translations, /'pricing.full.f3':\s*'Personal, non-commercial license'/);
  assert.match(translations, /'pricing.full.f4':\s*'Copyright remains with the photographer'/);
});

test('only a definitive decline allows an explicit fresh checkout attempt', async () => {
  for (const code of ['PAYMENT_DECLINED', 'TEST_NETWORK_FAILURE']) {
    const saved = storage();
    const client = createCheckoutClient({ storage: saved, fetcher: async url => {
      if (url.endsWith('create-order')) return Response.json({ paypalOrderId: orderId, approveUrl: 'https://www.sandbox.paypal.com/checkoutnow' });
      return Response.json({ error: code }, { status: code === 'PAYMENT_DECLINED' ? 422 : 502 });
    } });
    await client.start(quote, true);
    await assert.rejects(client.capture(orderId), new RegExp(code));
    if (code === 'PAYMENT_DECLINED') {
      assert.equal(client.restartAfterDecline(), quote.photoId);
      assert.equal(client.pending(), null);
    } else {
      assert.throws(() => client.restartAfterDecline(), /RESTART_NOT_ALLOWED/);
      assert.equal(client.pending().paypalOrderId, orderId);
    }
  }
});

// ===== Language must survive the PayPal round trip (found in the Sandbox live test) =====

test('checkout language: explicit param wins, then the pending attempt, then the site preference', () => {
  assert.equal(resolveCheckoutLang({ param: 'en' }), 'en');
  assert.equal(resolveCheckoutLang({ param: 'he', pending: { lang: 'en' }, stored: 'en' }), 'he');
  // Return from PayPal carries no ?lang: the pending attempt decides.
  assert.equal(resolveCheckoutLang({ param: null, pending: { lang: 'en' } }), 'en');
  assert.equal(resolveCheckoutLang({ param: null, pending: { lang: 'he' }, stored: 'en' }), 'he');
  assert.equal(resolveCheckoutLang({ param: null, pending: null, stored: 'en' }), 'en');
  assert.equal(resolveCheckoutLang({ param: 'xx', pending: { lang: 'zz' }, stored: 'fr' }), 'he');
  assert.equal(resolveCheckoutLang(), 'he');
});

test('client saves the language with the attempt and sends it to create-order', async () => {
  const store = storage();
  const bodies = [];
  const client = createCheckoutClient({ storage: store, uuid: () => 'lang-checkout-key', fetcher: async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ paypalOrderId: orderId, approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId });
  } });
  await client.start(quote, true, 'en');
  assert.equal(bodies[0].lang, 'en');
  assert.equal(client.pending().lang, 'en');
  assert.equal(resolveCheckoutLang({ param: null, pending: client.pending(), stored: null }), 'en');
  // Anything but "en" is stored and sent as Hebrew.
  await client.start(quote, true, 'fr');
  assert.equal(bodies[1].lang, 'he');
  assert.equal(client.pending().lang, 'he');
});

test('create-order puts lang=en on the return and cancel URLs only for English', async () => {
  const original = globalThis.fetch;
  const urls = [];
  const approval = 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'token' });
    if (options?.method === 'POST') { const ctx = JSON.parse(options.body).payment_source.paypal.experience_context; urls.push([ctx.return_url, ctx.cancel_url]); }
    return Response.json({ id: orderId, links: [{ rel: 'payer-action', href: approval }] }, { status: 201 });
  };
  try {
    const options = { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true };
    const attempt = (overrides, key) => handlePayPalCreateOrder(new Request('https://amitphotos.com/api/paypal/create-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ type: 'digital', photoId: 'photo-1', sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: 10000, ...overrides }),
    }), env(), options);
    assert.equal((await attempt({ lang: 'en' }, 'lang-attempt-en-0001')).status, 201);
    assert.equal((await attempt({}, 'lang-attempt-he-0001')).status, 201);
    assert.equal((await attempt({ lang: 'he' }, 'lang-attempt-he-0002')).status, 201);
    assert.equal((await attempt({ lang: 'en&evil=1' }, 'lang-attempt-bad-0001')).status, 201);
    assert.deepEqual(urls[0], ['https://amitphotos.com/checkout/?approved=1&lang=en', 'https://amitphotos.com/checkout/?cancelled=1&lang=en']);
    for (const pair of urls.slice(1)) assert.deepEqual(pair, ['https://amitphotos.com/checkout/?approved=1', 'https://amitphotos.com/checkout/?cancelled=1']);
  } finally { globalThis.fetch = original; }
});

// ===== INSERT collision on create-order must return the canonical order WITH an approval URL =====

// Simulates two concurrent requests with one Idempotency-Key: both pass the pre-checks (no row yet),
// the other request commits its row, then this request's INSERT hits the unique key.
function racingEnv(racingRow) {
  const config = env();
  const realPrepare = config.DB.prepare.bind(config.DB);
  let raced = false;
  config.DB.prepare = sql => {
    const statement = realPrepare(sql);
    if (!raced && /FROM paypal_orders WHERE client_idempotency_key/.test(sql)) {
      // Before the race: neither the attempt check nor the retry lookup sees a row.
      return { bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) };
    }
    if (/^INSERT INTO paypal_orders/.test(sql)) {
      return { bind: (...args) => ({
        first: async () => null,
        run: async () => {
          if (!raced) {
            raced = true;
            config.sqlite.prepare(
              'INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at, client_idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run('race-local-id', racingRow.paypal_order_id, 'digital', racingRow.photo_id, racingRow.sku,
              racingRow.amount_expected, racingRow.currency, 'CREATED', '2026-10-13T00:00:00Z', 'checkout-attempt-12345');
          }
          return statement.bind(...args).run();
        },
      }) };
    }
    return statement;
  };
  return config;
}

function paypalStub(approval) {
  return async (url, options) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'token' });
    if (options?.method === 'POST') return Response.json({ id: orderId, links: [{ rel: 'payer-action', href: approval }] }, { status: 201 });
    // GET of the canonical order, used to read its approval URL.
    if (target.includes('/v2/checkout/orders/')) return Response.json({ id: target.split('/').pop(), links: [{ rel: 'payer-action', href: approval }] });
    return Response.json({}, { status: 404 });
  };
}

test('INSERT collision returns the canonical order with its approval URL after the attempt matches', async () => {
  const original = globalThis.fetch;
  const approval = 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId;
  globalThis.fetch = paypalStub(approval);
  try {
    const config = racingEnv({ paypal_order_id: orderId, photo_id: 'photo-1', sku: 'large', amount_expected: 10000, currency: 'ILS' });
    const response = await handlePayPalCreateOrder(createRequest(), config, { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.paypalOrderId, orderId);
    assert.equal(body.reused, true);
    // The browser client does new URL(data.approveUrl): it must be present and valid.
    assert.equal(body.approveUrl, approval);
    assert.equal(new URL(body.approveUrl).hostname, 'www.sandbox.paypal.com');
    assert.equal(config.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 1);
    assert.equal(config.sqlite.prepare("SELECT client_idempotency_key AS k FROM paypal_orders").get().k, 'checkout-attempt-12345');
  } finally { globalThis.fetch = original; }
});

test('INSERT collision never returns another attempt\'s order or approval URL', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = paypalStub('https://www.sandbox.paypal.com/checkoutnow?token=' + orderId);
  try {
    const cases = [
      { photo_id: 'photo-1', sku: 'large', amount_expected: 1900, currency: 'ILS' },   // different price
      { photo_id: 'photo-2', sku: 'large', amount_expected: 10000, currency: 'ILS' },  // different photo
      { photo_id: 'photo-1', sku: 'small', amount_expected: 10000, currency: 'ILS' },  // different size
      { photo_id: 'photo-1', sku: 'large', amount_expected: 10000, currency: 'USD' },  // different currency
    ];
    for (const racingRow of cases) {
      const config = racingEnv({ paypal_order_id: 'OTHERORDER123456', ...racingRow });
      const response = await handlePayPalCreateOrder(createRequest(), config, { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true });
      assert.equal(response.status, 409, JSON.stringify(racingRow));
      const body = await response.json();
      assert.equal(body.error, 'CHECKOUT_ATTEMPT_MISMATCH');
      assert.equal('approveUrl' in body, false);
      assert.equal('paypalOrderId' in body, false);
    }
  } finally { globalThis.fetch = original; }
});

test('collision path and normal retry path return the same response shape', async () => {
  const original = globalThis.fetch;
  const approval = 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId;
  globalThis.fetch = paypalStub(approval);
  try {
    const options = { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true };
    const racing = await handlePayPalCreateOrder(createRequest(), racingEnv({ paypal_order_id: orderId, photo_id: 'photo-1', sku: 'large', amount_expected: 10000, currency: 'ILS' }), options);
    const normalConfig = env();
    await handlePayPalCreateOrder(createRequest(), normalConfig, options);
    const retry = await handlePayPalCreateOrder(createRequest(), normalConfig, options);
    assert.deepEqual(await racing.json(), await retry.json());
  } finally { globalThis.fetch = original; }
});
