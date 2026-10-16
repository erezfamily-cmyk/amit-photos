// Launch model (owner-approved planning basis, 16.10.2026): one product, enforced on the server.
//   large only, ILS only, personal non-commercial license, one-time link valid 7 days, two re-issues, same 7 days.
// These tests touch no production system and need no flag: everything runs against an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  DIGITAL_LINK_VALIDITY_DAYS, DIGITAL_PUBLIC_SKU, buildLinkEmail, handleDigitalCheckoutQuote, handlePayPalCreateOrder,
} from '../paypal-orders.js';
import { LINK_VALIDITY_DAYS } from '../assets/js/digital-checkout.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const OPEN_SWITCH = JSON.stringify({ state: 'open', openedAt: '2026-01-01T00:00:00.000Z', closesAt: '2099-01-01T00:00:00.000Z', maxOrders: null, photoIds: null });

function env({ prices = '{"small":19,"medium":59,"large":8900}' } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO settings VALUES ('digital_checkout_switch', '${OPEN_SWITCH}');
    CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, published INTEGER, price_overrides TEXT);
    INSERT INTO photos VALUES ('photo-1','Photo One',1,NULL);
    CREATE TABLE paypal_orders (id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE, order_type TEXT,
      photo_id TEXT, sku TEXT, amount_expected INTEGER, currency TEXT, status TEXT, created_at TEXT,
      client_idempotency_key TEXT UNIQUE);
  `);
  if (prices) sqlite.prepare("INSERT INTO settings VALUES ('prices', ?)").run(prices);
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
const quoteRequest = (sku) => new Request('https://amitphotos.com/api/paypal/quote?photoId=photo-1' + (sku === undefined ? '' : '&sku=' + sku));
const createRequest = (overrides = {}, key = 'launch-model-attempt-1') => new Request('https://amitphotos.com/api/paypal/create-order', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ type: 'digital', photoId: 'photo-1', sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: 8900, ...overrides }),
});
const PUBLIC = { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true };

async function withPayPal(run) {
  const original = globalThis.fetch;
  const calls = { oauth: 0, orders: 0, payload: null };
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/v1/oauth2/token')) { calls.oauth++; return Response.json({ access_token: 'token' }); }
    if (options?.method === 'POST') { calls.orders++; calls.payload = JSON.parse(options.body); }
    return Response.json({ id: 'PAYPALORDER12345', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALORDER12345' }] }, { status: 201 });
  };
  try { return await run(calls); } finally { globalThis.fetch = original; }
}

// ---------- constants: one source of truth on the server, the browser only mirrors it ----------

test('launch model constants: large only, 7 days; the browser display default equals the server value', () => {
  assert.equal(DIGITAL_PUBLIC_SKU, 'large');
  assert.equal(DIGITAL_LINK_VALIDITY_DAYS, 7);
  assert.equal(LINK_VALIDITY_DAYS, DIGITAL_LINK_VALIDITY_DAYS);
});

test('the server code carries no 24-hour download validity any more', () => {
  const source = read('paypal-orders.js');
  assert.doesNotMatch(source, /\b86400\b/);
  assert.doesNotMatch(source, /24 שעות|24 hours/);
  assert.match(read('assets/js/digital-checkout.mjs'), /LINK_VALIDITY_DAYS/);
  assert.doesNotMatch(read('assets/js/digital-checkout.mjs').split('\n').filter(line => /success:/.test(line)).join('\n'), /24/);
});

// ---------- quote: the page shows what the server says ----------

test('quote sells large only; any other size is refused with a stable error', async () => {
  for (const sku of ['small', 'medium', 'xlarge', 'LARGE']) {
    const response = await handleDigitalCheckoutQuote(quoteRequest(sku), env());
    assert.equal(response.status, 400, sku);
    assert.equal((await response.json()).error, 'SKU_NOT_AVAILABLE');
  }
  const omitted = await handleDigitalCheckoutQuote(quoteRequest(), env());
  assert.equal(omitted.status, 200);
  assert.equal((await omitted.json()).sku, 'large');
});

test('quote reports ILS, the personal license and the server-side link validity; the amount comes from D1', async () => {
  const body = await (await handleDigitalCheckoutQuote(quoteRequest('large'), env({ prices: '{"small":19,"medium":59,"large":89}' }))).json();
  assert.equal(body.currency, 'ILS');
  assert.equal(body.license, 'personal');
  assert.equal(body.linkValidityDays, 7);
  assert.equal(body.amountMinor, 8900);
  const changed = await (await handleDigitalCheckoutQuote(quoteRequest('large'), env({ prices: '{"large":129}' }))).json();
  assert.equal(changed.amountMinor, 12900, 'the price is whatever D1 says; nothing in the browser can set it');
});

test('without a prices row the code falls back to 89 ILS for large (the live value is an admin setting)', async () => {
  const body = await (await handleDigitalCheckoutQuote(quoteRequest('large'), env({ prices: null }))).json();
  assert.equal(body.amountMinor, 8900);
});

// ---------- create-order: restrictions are server-side ----------

test('public create refuses small and medium before any PayPal call or database row', async () => {
  await withPayPal(async calls => {
    for (const sku of ['small', 'medium']) {
      const config = env();
      const response = await handlePayPalCreateOrder(createRequest({ sku, expectedAmountMinor: sku === 'small' ? 1900 : 5900 }, 'key-' + sku + '-aaaaaa'), config, PUBLIC);
      assert.equal(response.status, 400, sku);
      assert.equal((await response.json()).error, 'SKU_NOT_AVAILABLE');
      assert.equal(config.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 0);
    }
    assert.equal(calls.oauth + calls.orders, 0, 'PayPal must not be contacted');
  });
});

test('public create ignores any client amount: PayPal receives the D1 price in ILS', async () => {
  await withPayPal(async calls => {
    const config = env({ prices: '{"large":89}' });
    const response = await handlePayPalCreateOrder(createRequest({ amount: '1.00', price: 1, amountMinor: 100 }), config, PUBLIC);
    assert.equal(response.status, 201);
    assert.equal(calls.payload.purchase_units[0].amount.value, '89.00');
    assert.equal(calls.payload.purchase_units[0].amount.currency_code, 'ILS');
    const row = config.sqlite.prepare('SELECT sku, currency, amount_expected FROM paypal_orders').get();
    assert.deepEqual({ ...row }, { sku: 'large', currency: 'ILS', amount_expected: 8900 });
  });
});

test('public create refuses a stale price, a non-ILS currency and a missing or non-boolean license acceptance', async () => {
  await withPayPal(async calls => {
    const cases = [
      [{ expectedAmountMinor: 12900 }, 409, 'PRICE_CHANGED'],
      [{ currency: 'USD' }, 400, 'PERSONAL_LICENSE_ACCEPTANCE_REQUIRED'],
      [{ licenseAccepted: false }, 400, 'PERSONAL_LICENSE_ACCEPTANCE_REQUIRED'],
      [{ licenseAccepted: 'true' }, 400, 'PERSONAL_LICENSE_ACCEPTANCE_REQUIRED'],
      [{ licenseAccepted: undefined }, 400, 'PERSONAL_LICENSE_ACCEPTANCE_REQUIRED'],
    ];
    for (const [overrides, status, code] of cases) {
      const config = env({ prices: '{"large":89}' });
      const response = await handlePayPalCreateOrder(createRequest(overrides), config, PUBLIC);
      assert.equal(response.status, status, JSON.stringify(overrides));
      assert.equal((await response.json()).error, code);
      assert.equal(config.sqlite.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 0);
    }
    assert.equal(calls.orders, 0);
  });
});

// ---------- e-mail ----------

test('the download e-mail states 7 days in Hebrew, English and plain text, and never 24 hours', () => {
  const mail = buildLinkEmail({ link: 'https://amitphotos.com/checkout/download/#t', title: 'Photo One', test: false });
  assert.match(mail.html, /ותקף ל-7 ימים מרגע ההנפקה/);
  assert.match(mail.html, /valid for 7 days from issue/);
  assert.match(mail.text, /7 ימים/);
  assert.match(mail.text, /7 days/);
  for (const part of [mail.html, mail.text]) assert.doesNotMatch(part, /24 שעות|24 hours|24-hour/);
});

// ---------- checkout page: license, validity, links, mandatory consent, both languages ----------

const pairs = html => [...html.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-he="([^"]*)"[^>]*\bdata-en="([^"]*)"[^>]*>/g)];

test('checkout shows price, license type and link validity, links to both policies, and a mandatory consent box', () => {
  const html = read('checkout/index.html');
  assert.match(html, /id="checkout-price"/);
  assert.match(html, /רישיון אישי/);
  assert.match(html, /Personal license/);
  // validity line: server value is substituted for {days}; the default text already says 7
  const validity = html.match(/<p id="checkout-validity"[^>]*data-he="([^"]*)"[^>]*data-en="([^"]*)"[^>]*>([^<]*)<\/p>/);
  assert.ok(validity, 'validity line present');
  assert.match(validity[1], /\{days\} ימים/);
  assert.match(validity[2], /\{days\} days/);
  assert.match(validity[3], /7 ימים/);
  // links to both policies open in a new tab so the checkout state is kept
  for (const href of ['/license-terms/', '/refund-policy/']) {
    const link = html.match(new RegExp('<a href="' + href + '"[^>]*>'));
    assert.ok(link, href + ' linked');
    assert.match(link[0], /target="_blank"/);
    assert.match(link[0], /rel="noopener"/);
    assert.match(link[0], /data-lang-link/);
  }
  assert.match(html, /href="\/licensing\/"/, 'commercial use stays a manual inquiry');
  // consent: a checkbox that starts disabled, and a pay button that starts disabled
  assert.match(html, /<input id="checkout-consent" type="checkbox" disabled>/);
  assert.match(html, /<button id="checkout-pay" type="button" disabled/);
  const consent = html.match(/<label><input id="checkout-consent"[^>]*><span data-he="([^"]*)" data-en="([^"]*)">/);
  assert.ok(consent);
  assert.match(consent[1], /תנאי הרישיון/);
  assert.match(consent[1], /מדיניות ההחזרים/);
  assert.match(consent[1], /אישי ולא מסחרי/);
  assert.match(consent[2], /license terms/);
  assert.match(consent[2], /refund policy/);
  assert.match(consent[2], /personal and non-commercial/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
});

test('every translatable element on the checkout page has both languages', () => {
  const html = read('checkout/index.html');
  const withHe = (html.match(/\bdata-he="/g) || []).length;
  const withEn = (html.match(/\bdata-en="/g) || []).length;
  assert.equal(withHe, withEn);
  assert.equal(pairs(html).length, withHe, 'every data-he has its data-en on the same element');
  for (const [, , he, en] of pairs(html)) { assert.ok(he.trim().length > 0); assert.ok(en.trim().length > 0); }
});

// ---------- policy pages ----------

function section(html, id) {
  const match = html.match(new RegExp('<section id="' + id + '"[^>]*>([\\s\\S]*?)</section>'));
  assert.ok(match, id + ' section present');
  return match[1];
}

for (const [path, name] of [['license-terms/index.html', 'license terms'], ['refund-policy/index.html', 'refund policy']]) {
  test(name + ' page: both languages, marked as a draft, not indexed, equal structure', () => {
    const html = read(path);
    assert.match(html, /name="robots" content="noindex,nofollow"/);
    assert.match(html, /<section id="he" lang="he" dir="rtl">/);
    assert.match(html, /<section id="en" lang="en" dir="ltr">/);
    const he = section(html, 'he');
    const en = section(html, 'en');
    assert.match(he, /class="draft"[^>]*>[\s\S]*טיוטה[\s\S]*יועץ משפטי ורואה חשבון/);
    assert.match(en, /class="draft"[^>]*>[\s\S]*Draft[\s\S]*lawyer and an accountant/);
    assert.equal((he.match(/<li>/g) || []).length, (en.match(/<li>/g) || []).length, 'same number of clauses in both languages');
    assert.match(html, /contact@amitphotos\.com/);
  });
}

test('the license terms state the approved launch model in both languages', () => {
  const html = read('license-terms/index.html');
  const he = section(html, 'he');
  const en = section(html, 'en');
  assert.match(he, /אישי, לא בלעדי/);
  assert.match(he, /פרטי ולא מסחרי בלבד/);
  assert.match(he, /חד-פעמי ותקף ל-7 ימים/);
  assert.match(he, /עד שתי הנפקות חוזרות/);
  assert.match(he, /כל אחת תקפה ל-7 ימים/);
  assert.match(he, /רישיון מסחרי[\s\S]*אינו מוצר אוטומטי/);
  assert.match(en, /personal, non-exclusive, non-transferable/);
  assert.match(en, /private, non-commercial purposes only/);
  assert.match(en, /works once and is valid for 7 days/);
  assert.match(en, /up to two re-issues per order, each valid for 7 days/);
  assert.match(en, /Commercial license[\s\S]*Not an automated product/);
  assert.match(he, /href="\/refund-policy\/"/);
  assert.match(en, /href="\/refund-policy\/"/);
});

test('the refund policy states the approved rule in both languages', () => {
  const html = read('refund-policy/index.html');
  const he = section(html, 'he');
  const en = section(html, 'en');
  assert.match(he, /החזר כספי מלא לפני שהורדת את הקובץ/);
  assert.match(he, /לא יינתן החזר, למעט[\s\S]*תקלה טכנית[\s\S]*חיוב כפול/);
  assert.match(he, /אין בו כדי לפגוע בזכויות/);
  assert.match(en, /full refund before you download the file/);
  assert.match(en, /do not give a refund, except[\s\S]*technical fault[\s\S]*duplicate charge/);
  assert.match(en, /does not affect rights that the law gives you/);
  assert.match(he, /href="\/license-terms\/"/);
  assert.match(en, /href="\/license-terms\/"/);
});

// ---------- scope guard: this change does not switch anything on ----------

test('both payment flags stay false in wrangler.toml', () => {
  const toml = read('wrangler.toml');
  assert.match(toml, /PAYMENTS_ENABLED\s*=\s*"false"/);
  assert.match(toml, /DIGITAL_PAYPAL_ENABLED\s*=\s*"false"/);
  assert.doesNotMatch(toml, /(PAYMENTS_ENABLED|DIGITAL_PAYPAL_ENABLED)\s*=\s*"true"/);
});
