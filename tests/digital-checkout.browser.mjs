// Isolated browser QA: localhost fixtures and intercepted responses only.
// No credentials, cloud resources, real PayPal requests or payment activation.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.CHECKOUT_QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = process.env.CHECKOUT_QA_OUTPUT || '/tmp/amit-checkout-browser';
await mkdir(output, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const contents = await readFile(filename);
    const type = filename.endsWith('.mjs') || filename.endsWith('.js') ? 'text/javascript'
      : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(contents);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
const orderId = 'MOCKORDER123456';
const photo = { id: 'qa-photo', title: 'תמונת בדיקה — אור על הים', title_en: 'Test photo — light on the sea',
  published: 1, category: 'Sandbox', thumbnail: '/qa-image.svg', url: '/qa-image.svg' };
let passed = 0;

async function scenario(name, options, action) {
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: options.height || 844 }, serviceWorkers: 'block' });
  const calls = { quotes: 0, creates: 0, captures: 0, approvals: 0, keys: [] };
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.sandbox.paypal.com') {
      calls.approvals++;
      await route.fulfill({ contentType: 'text/html', body: '<title>Mock PayPal approval</title><h1>Mock approval only</h1>' });
      return;
    }
    if (url.origin !== origin) { await route.abort(); return; }
    if (url.pathname === '/api/paypal/quote') {
      calls.quotes++;
      await json(route, { photoId: photo.id, sku: 'large', title: options.title || photo.title, currency: 'ILS', license: 'personal',
        enabled: options.enabled === true, amountMinor: options.priceChange && calls.quotes > 1 ? 15000 : 12900, environment: 'sandbox' });
    } else if (url.pathname === '/api/paypal/create-order') {
      calls.creates++;
      calls.keys.push(route.request().headers()['idempotency-key']);
      const body = route.request().postDataJSON();
      assert.equal(body.licenseAccepted, true);
      assert.equal(body.expectedAmountMinor, 12900);
      await json(route, { paypalOrderId: orderId, approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=' + orderId });
    } else if (url.pathname === '/api/paypal/capture-order') {
      calls.captures++;
      assert.equal(route.request().postDataJSON().paypalOrderId, orderId);
      if (options.decline) { await json(route, { error: 'PAYMENT_DECLINED', restartCheckout: true }, 422); return; }
      if (options.retry && calls.captures === 1) { await json(route, { error: 'TEST_NETWORK_FAILURE' }, 502); return; }
      await json(route, { title: photo.title, url: '/api/download/qa-bearer-token' });
    } else if (url.pathname === '/api/photos' || url.pathname === '/data/photos.json') await json(route, [photo]);
    else if (url.pathname === '/api/admin/featured') await json(route, [photo.id]);
    else if (url.pathname === '/api/admin/prices') await json(route, { small: 19, medium: 59, large: 129 });
    else if (url.pathname === '/api/payments-status') await json(route, { enabled: false, digitalEnabled: false });
    else if (url.pathname.startsWith('/api/')) await json(route, {});
    else if (url.pathname === '/qa-image.svg') await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#315b80"/></svg>' });
    else await route.continue();
  });
  try {
    await action({ page, calls, context });
    assert.deepEqual(errors, [], 'Unexpected browser JavaScript errors');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    passed++;
    console.log('PASS ' + name);
  } catch (error) {
    await page.screenshot({ path: path.join(output, name + '-FAILED.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function loaded(page, lang = 'he') {
  await page.goto(origin + '/checkout/?photoId=' + photo.id + '&lang=' + lang);
  await page.locator('#checkout-title').getByText(photo.title, { exact: true }).waitFor();
}
async function approve(page) {
  await loaded(page);
  await page.locator('#checkout-consent').check();
  await page.locator('#checkout-pay').click();
  await page.waitForURL('https://www.sandbox.paypal.com/**');
  await page.goto(origin + '/checkout/?approved=1&token=' + orderId);
}

try {
  for (const width of [390, 768, 1280]) for (const lang of ['he', 'en']) {
    await scenario('disabled-' + lang + '-' + width, { width }, async ({ page, calls }) => {
      await loaded(page, lang);
      await page.locator('#checkout-status').getByText(lang === 'he' ? /התשלום המקוון אינו זמין/ : /Online payment is temporarily unavailable/).waitFor();
      assert.equal(await page.locator('#checkout-pay').isDisabled(), true);
      assert.equal(await page.locator('#checkout-consent').isDisabled(), true);
      assert.equal(await page.locator('html').getAttribute('dir'), lang === 'he' ? 'rtl' : 'ltr');
      const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(size.scroll <= size.width, JSON.stringify(size));
      assert.equal(calls.creates + calls.captures + calls.approvals, 0);
    });
  }
  await scenario('long-title-390', { title: 'Photograph'.repeat(24) }, async ({ page }) => {
    await page.goto(origin + '/checkout/?photoId=' + photo.id);
    await page.locator('#checkout-title').getByText('Photograph'.repeat(24), { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  await scenario('approval-success-390', { enabled: true }, async ({ page, calls }) => {
    await approve(page);
    await page.locator('#checkout-download').waitFor({ state: 'visible' });
    assert.equal(calls.creates, 1);
    assert.equal(calls.captures, 1);
    assert.equal(await page.locator('#checkout-download').getAttribute('href'), '/api/download/qa-bearer-token');
    assert.equal(await page.evaluate(() => JSON.stringify(sessionStorage).includes('qa-bearer-token')), false);
    assert.equal(new URL(page.url()).search, '');
  });
  // PayPal returns the buyer to /checkout/?approved=1 or ?cancelled=1 without ?lang when the
  // return URL was created before the language was known; the tab's pending attempt must decide.
  await scenario('english-survives-approval-return-390', { enabled: true }, async ({ page }) => {
    await loaded(page, 'en');
    await page.locator('#checkout-consent').check();
    await page.locator('#checkout-pay').click();
    await page.waitForURL('https://www.sandbox.paypal.com/**');
    await page.goto(origin + '/checkout/?approved=1&token=' + orderId);
    await page.locator('#checkout-download').waitFor({ state: 'visible' });
    await page.locator('#checkout-status').getByText(/Payment verified/).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
    assert.equal(new URL(page.url()).search, '?lang=en');
  });
  await scenario('english-survives-cancel-return-390', { enabled: true }, async ({ page }) => {
    await loaded(page, 'en');
    await page.locator('#checkout-consent').check();
    await page.locator('#checkout-pay').click();
    await page.waitForURL('https://www.sandbox.paypal.com/**');
    await page.goto(origin + '/checkout/?cancelled=1');
    await page.locator('#checkout-status').getByText(/You returned without completing checkout/).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  });
  await scenario('english-return-url-param-works-without-session-390', { enabled: true }, async ({ page }) => {
    // The server now adds &lang=en to the PayPal return/cancel URLs of English attempts.
    await page.goto(origin + '/checkout/?cancelled=1&lang=en');
    await page.locator('#checkout-status').getByText(/Choose an image in the gallery first/).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  });
  await scenario('capture-retry-390', { enabled: true, retry: true }, async ({ page, calls }) => {
    await approve(page);
    await page.locator('#checkout-retry').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#checkout-download').isVisible(), false);
    await page.locator('#checkout-retry').click();
    await page.locator('#checkout-download').waitFor({ state: 'visible' });
    assert.equal(calls.creates, 1);
    assert.equal(calls.captures, 2);
  });
  await scenario('price-change-390', { enabled: true, priceChange: true }, async ({ page, calls }) => {
    await loaded(page);
    await page.locator('#checkout-consent').check();
    await page.locator('#checkout-pay').click();
    await page.locator('#checkout-status').getByText(/המחיר השתנה/).waitFor();
    assert.equal(await page.locator('#checkout-consent').isChecked(), false);
    assert.equal(await page.locator('#checkout-pay').isDisabled(), true);
    assert.equal(calls.creates, 0);
  });
  await scenario('cancelled-390', { enabled: true }, async ({ page, calls }) => {
    await loaded(page);
    await page.locator('#checkout-consent').check();
    await page.locator('#checkout-pay').click();
    await page.waitForURL('https://www.sandbox.paypal.com/**');
    await page.goto(origin + '/checkout/?cancelled=1');
    await page.locator('#checkout-status').getByText(/חזרתם ללא השלמת הרכישה/).waitFor();
    assert.equal(calls.captures, 0);
    assert.equal(await page.locator('#checkout-download').isVisible(), false);
  });
  await scenario('forged-return-390', {}, async ({ page, calls }) => {
    await page.goto(origin + '/checkout/?approved=1&token=FORGEDORDER12345');
    await page.locator('#checkout-retry').waitFor({ state: 'visible' });
    assert.equal(calls.captures, 0);
    assert.equal(await page.locator('#checkout-download').isVisible(), false);
  });
  await scenario('decline-restart-390', { enabled: true, decline: true }, async ({ page, calls }) => {
    await approve(page);
    await page.locator('#checkout-restart').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#checkout-retry').isVisible(), false);
    assert.equal(await page.locator('#checkout-download').isVisible(), false);
    await page.locator('#checkout-restart').click();
    await page.waitForURL(origin + '/checkout/?photoId=**');
    await page.locator('#checkout-title').getByText(photo.title, { exact: true }).waitFor();
    assert.equal(await page.locator('#checkout-consent').isChecked(), false);
    assert.equal(await page.locator('#checkout-pay').isDisabled(), true);
    assert.equal(calls.creates, 1);
    assert.equal(calls.captures, 1);
    await page.locator('#checkout-consent').check();
    await page.locator('#checkout-pay').click();
    await page.waitForURL('https://www.sandbox.paypal.com/**');
    assert.equal(calls.creates, 2);
    assert.notEqual(calls.keys[0], calls.keys[1]);
  });
  for (const size of [{ width: 1280, height: 800 }, { width: 360, height: 640 }]) {
    await scenario('cookie-dialog-' + size.width + '-' + size.height, size, async ({ page, calls }) => {
      await page.goto(origin);
      await page.locator('#cookie-notice').waitFor({ state: 'visible' });
      await page.locator('.filter-btn[data-cat="all"]').click();
      await page.locator('.gallery-item').click();
      await page.locator('#lightbox').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#cookie-notice').isVisible(), false);
      assert.equal(await page.evaluate(() => localStorage.getItem('cookie_notice_dismissed')), null);
      await page.locator('#lb-close').click();
      await page.locator('#cookie-notice').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => localStorage.getItem('cookie_notice_dismissed')), null);
      await page.locator('.gallery-item').click();
      await page.locator('#lb-buy').click();
      await page.waitForURL(origin + '/checkout/**');
      assert.equal(calls.creates + calls.captures, 0);
    });
  }
  for (const width of [390, 1280]) {
    await scenario('gallery-pointer-' + width, { width }, async ({ page, calls }) => {
      await page.goto(origin);
      await page.evaluate(() => localStorage.setItem('cookieNoticeSeen', '1'));
      const cookie = page.locator('#cookie-notice-ok');
      if (await cookie.isVisible()) await cookie.click();
      await page.locator('.filter-btn[data-cat="all"]').click();
      await page.locator('.gallery-buy-btn').click();
      await page.waitForURL(origin + '/checkout/**');
      await page.locator('#checkout-title').getByText(photo.title, { exact: true }).waitFor();
      assert.equal(await page.locator('#checkout-pay').isDisabled(), true);
      assert.equal(calls.creates + calls.captures, 0);
    });
  }
  console.log('Browser QA: ' + passed + ' scenarios passed; all payment responses mocked.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
