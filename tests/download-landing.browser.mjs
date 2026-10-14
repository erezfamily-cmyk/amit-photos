// Browser QA for /checkout/download/ (the page a mailed link opens). Localhost fixtures and
// intercepted responses only: no credentials, no cloud resources, no real PayPal or mail.
// What it proves: loading the page, running its JavaScript, the HEAD pre-check, and a scripted
// (untrusted) click never touch the one-time link; only a real user click requests it, once.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.CHECKOUT_QA_PLAYWRIGHT_MODULE || 'playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = '0b9a7c1e-4d52-4f3a-9a6e-5d1c2b3a4f60';
const server = http.createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    res.writeHead(200, { 'Content-Type': filename.endsWith('.html') ? 'text/html' : 'text/plain', 'Cache-Control': 'no-store' }).end(await readFile(filename));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();
let passed = 0;

// state: 'ok' (HEAD 200) | 'used' | 'revoked' | 'expired' | 'missing' | 'down'
async function scenario(name, { state = 'ok', hash = '#t=' + TOKEN, width = 390 } = {}, action) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: 'block', locale: 'he-IL' });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { requests.push({ external: request.url() }); await route.abort(); return; }
    if (url.pathname.startsWith('/api/download/')) {
      requests.push({ method: request.method(), path: url.pathname, search: url.search });
      if (request.method() === 'GET') { await route.fulfill({ status: 200, headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': 'attachment; filename="photo.jpg"' }, body: 'jpg' }); return; }
      if (state === 'down') { await route.abort(); return; }
      const gone = { used: 'used', revoked: 'revoked', expired: 'expired' }[state];
      if (gone) { await route.fulfill({ status: 410, headers: { 'X-Link-State': gone }, contentType: 'application/json', body: '{}' }); return; }
      if (state === 'missing') { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); return; }
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'image/jpeg' }, body: '' });
      return;
    }
    await route.continue();
  });
  await page.goto(origin + '/checkout/download/' + hash, { waitUntil: 'networkidle' });
  try {
    await action({ page, requests });
    assert.deepEqual(errors, [], name + ': page errors');
    assert.ok(requests.every(r => !r.external), name + ': no external request');
    assert.ok(requests.every(r => !String(r.search).includes(TOKEN)), name + ': token never in a query string');
    passed++;
    console.log('ok  ' + name);
  } finally { await context.close(); }
}
const gets = requests => requests.filter(r => r.method === 'GET');

await scenario('loading the page and its HEAD pre-check never consume the link; the download URL is not in the DOM', {}, async ({ page, requests }) => {
  await page.waitForTimeout(400);
  assert.deepEqual(requests.map(r => r.method), ['HEAD'], 'exactly one HEAD, no GET');
  const exposed = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap(el => [...el.attributes].map(a => a.value)).filter(v => v.includes('/api/download')));
  assert.deepEqual(exposed, [], 'no element carries the download URL (the script text itself is not a link)');
  assert.equal(await page.locator('#go').isDisabled(), false);
  assert.match(await page.locator('#body').innerText(), /חד-פעמי/);
});

await scenario('a scanner that runs the JavaScript, scripts clicks, scrolls and screenshots still does not consume the link', {}, async ({ page, requests }) => {
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const button = document.querySelector('#go');
    button.click();                                              // scripted click: isTrusted is false
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelectorAll('a[href], button, [onclick]').forEach(el => { if (el !== button && el.tagName === 'A') el.click(); });
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.screenshot();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  assert.equal(gets(requests).length, 0, 'no GET from scripted activity');
  assert.equal(page.url().includes('/api/download/'), false);
});

await scenario('one real click requests the link exactly once, a second click does nothing', {}, async ({ page, requests }) => {
  const download = page.waitForEvent('download');
  await page.locator('#go').click();
  await download;
  await page.locator('#go').click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  assert.equal(gets(requests).length, 1);
  assert.equal(gets(requests)[0].path, '/api/download/' + TOKEN);
});

for (const [state, pattern] of [['used', /כבר נוצל/], ['revoked', /בוטל/], ['expired', /בוטל|פג תוקף/]]) {
  await scenario('a ' + state + ' link is explained and cannot be clicked', { state }, async ({ page, requests }) => {
    await page.waitForTimeout(300);
    assert.match(await page.locator('#body').innerText(), pattern);
    assert.equal(await page.locator('#go').isDisabled(), true);
    assert.equal(gets(requests).length, 0);
  });
}

await scenario('an unknown link (404) shows the invalid-link text and stays disabled', { state: 'missing' }, async ({ page }) => {
  await page.waitForTimeout(300);
  assert.match(await page.locator('#body').innerText(), /קישור לא תקין/);
  assert.equal(await page.locator('#go').isDisabled(), true);
});

await scenario('when the pre-check cannot reach the server the button stays usable', { state: 'down' }, async ({ page }) => {
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#go').isDisabled(), false);
  assert.match(await page.locator('#body').innerText(), /לא הצלחנו לבדוק/);
});

for (const hash of ['', '#t=', '#t=not-a-token', '#t=' + TOKEN + 'x', '#t=../../etc/passwd', '#lang=en']) {
  await scenario('invalid fragment "' + hash + '" makes no API request and keeps the button disabled', { hash }, async ({ page, requests }) => {
    await page.waitForTimeout(250);
    assert.deepEqual(requests, []);
    assert.equal(await page.locator('#go').isDisabled(), true);
  });
}

await scenario('English via the fragment, language toggle, RTL/LTR and a narrow screen', { hash: '#t=' + TOKEN + '&lang=en', width: 320 }, async ({ page }) => {
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');
  assert.equal(await page.locator('#go').innerText(), 'Download the file');
  await page.locator('[data-lang="he"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at 320px');
});

await browser.close();
server.close();
console.log(`download landing browser QA: ${passed} scenarios passed`);
