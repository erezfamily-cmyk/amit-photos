// Browser regression against the current PR checkout, not a previously deployed Preview.
// All HTTP APIs and image assets are local fixtures. No checkout, tracking or production writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = resolve(fileURLToPath(new URL('../', import.meta.url))); // normalize trailing slash before containment checks
const engine = process.env.EXPERIENCE_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const photos = [
  { id: 'json-fallback-photo', title: 'חלון עתיק בגג סלובקי', description: 'תיאור בעברית',
    alt: 'חלון ישן', category: 'סלובקיה', url: '/photos/test-1.webp',
    thumbnail: '/photos/test-1.webp', published: 1, sort_order: 1 },
  { id: 'missing-georgia-photo', title: 'שביל בגאורגיה', description: 'תיאור ללא תרגום',
    alt: 'שביל', category: 'גאורגיה', url: '/photos/test-2.webp',
    thumbnail: '/photos/test-2.webp', published: 1, sort_order: 2 },
  { id: 'missing-night-photo', title: 'אור בשמים', description: 'צילום לילה',
    category: 'צילומי לילה', url: '/photos/test-3.webp',
    thumbnail: '/photos/test-3.webp', published: 1, sort_order: 3 },
  { id: 'translated-photo', title: 'נוף בסלובקיה', title_en: 'Slovakia Landscape',
    description: 'נוף דרמטי', description_en: 'A mountain landscape.',
    category: 'סלובקיה', url: '/photos/test-4.webp',
    thumbnail: '/photos/test-4.webp', published: 1, sort_order: 4 },
];
const curated = photos.map(p => p.id === 'json-fallback-photo'
  ? { ...p, title_en: 'Old Attic Window in Slovakia',
      description_en: 'An old wooden window.', alt_en: 'Old attic window.' } : p);
const apiRows = photos.map(p => ({ ...p, title_en: p.title_en || '', description_en: p.description_en || '' }));
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
  'base64');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/png' };
function json(res, val, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(val));
}
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { blocked: true }, 405);
    if (path === '/api/photos') return json(res, apiRows);
    if (path === '/data/photos.json') return json(res, curated);
    if (path === '/api/admin/featured') return json(res, { ids: photos.map(p => p.id) });
    if (path === '/api/payments-status') return json(res, { enabled: false });
    if (path === '/api/new-badge-settings') return json(res, { days: 7 });
    if (path.startsWith('/api/')) return json(res, {}, 404);
    if (path.startsWith('/photos/')) {
      res.writeHead(200, { 'content-type': 'image/png' }); return res.end(pixel);
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!(file === root || file.startsWith(root + sep))) {
      res.writeHead(403); return res.end('forbidden');
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
const results = [];
try {
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  page.setDefaultTimeout(18000);
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('cookie_notice_dismissed', '1');
    sessionStorage.setItem('week_popup_dismissed', '1');
  });
  // Only the local checkout is allowed. No external analytics, font or media traffic.
  await page.route('**/*', route =>
    route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  try {
    await page.locator('.filter-btn[data-cat="all"]').waitFor();
  } catch (error) {
    console.error('LOCAL_FIXTURE_DIAGNOSTICS ' + JSON.stringify({
      status: await page.locator('body').count(),
      htmlLength: (await page.content()).length,
      filterHtml: await page.locator('#filter-bar').innerHTML().catch(() => null),
      errors,
    }));
    throw error;
  }
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('body').getAttribute('data-payments-state'), 'disabled');
  // Room mockup stays on the wall, clear of the sofa back, on narrow phones.
  await page.locator('#home-value:not([hidden])').waitFor();
  const roomLayout = await page.evaluate(() => {
    const room = document.querySelector('.home-value-room').getBoundingClientRect();
    const art = document.querySelector('.home-value-art').getBoundingClientRect();
    return {
      roomWidth: room.width, roomHeight: room.height,
      centerDelta: Math.abs((art.left + art.width / 2) - (room.left + room.width / 2)),
      frameBottomRatio: (art.bottom - room.top) / room.height,
      artWidthRatio: art.width / room.width,
      whatsappDisplay: getComputedStyle(document.querySelector('.whatsapp-float')).display,
      backToTopDisplay: getComputedStyle(document.querySelector('.back-to-top')).display,
    };
  });
  assert.ok(roomLayout.roomHeight > 0 && roomLayout.roomWidth > 0);
  assert.ok(roomLayout.centerDelta < 3, 'Frame must be centered above the sofa');
  assert.ok(roomLayout.frameBottomRatio < 0.54, 'Frame should not touch the sofa top');
  assert.ok(roomLayout.artWidthRatio < 0.42, 'Frame too wide for a phone');
  assert.equal(roomLayout.whatsappDisplay, 'none');
  assert.equal(roomLayout.backToTopDisplay, 'none');
  assert.doesNotMatch(await page.locator('meta[name="viewport"]').getAttribute('content'), /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[,.\s]|$)/,
    'Keep pinch zoom available for accessibility');
  assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'), /minimum-scale\s*=\s*1(?:[,.\s]|$)/,
    'Keep native minimum mobile scale, but allow zooming in');
  results.push('Mobile living-room art alignment + unobstructed photo + accessible viewport');

  await page.locator('.filter-btn[data-cat="all"]').click();
  await page.locator('#gallery-grid .gallery-item').first().waitFor();
  assert.equal(await page.locator('#gallery-grid .gallery-item').count(), 4);

  const card = page.locator('#gallery-grid .gallery-item').first();
  assert.match(await card.getAttribute('aria-label'), /Old Attic Window in Slovakia/);
  assert.equal(await card.locator('img').getAttribute('alt'), 'Old attic window.');
  await card.click();
  await page.locator('#lightbox.open').waitFor();
  const navLayout = await page.evaluate(() => {
    const photoRegion = document.querySelector('.lightbox-inner').getBoundingClientRect();
    const nav = document.querySelector('.lightbox-navigation').getBoundingClientRect();
    const previous = document.querySelector('#lb-prev').getBoundingClientRect();
    const next = document.querySelector('#lb-next').getBoundingClientRect();
    return { regionBottom: photoRegion.bottom, navTop: nav.top,
      previousTop: previous.top, nextTop: next.top,
      buttonHeight: Math.min(previous.height, next.height),
      previousPosition: getComputedStyle(document.querySelector('#lb-prev')).position };
  });
  assert.ok(navLayout.navTop >= navLayout.regionBottom - 2, 'Navigation should follow the image region');
  assert.ok(navLayout.previousTop >= navLayout.regionBottom - 2 && navLayout.nextTop >= navLayout.regionBottom - 2,
    'Arrow buttons must not overlay the photograph');
  assert.ok(navLayout.buttonHeight >= 44, 'Arrow tap targets must be at least 44px');
  assert.equal(navLayout.previousPosition, 'static');
  results.push('Mobile previous/next controls appear below photograph');

  assert.equal((await page.locator('#lb-title').innerText()).trim(), 'Old Attic Window in Slovakia');
  assert.equal((await page.locator('#lb-desc').innerText()).trim(), 'An old wooden window.');
  assert.equal((await page.locator('#lb-cat').innerText()).trim(), 'Slovakia');
  const textColor = await page.locator('#lightbox').evaluate(el => ({
    modal: getComputedStyle(el).color,
    scheme: getComputedStyle(el).colorScheme,
    font: getComputedStyle(document.querySelector('.hero-title')).fontFamily,
  }));
  assert.equal(textColor.scheme, 'dark');
  assert.equal(textColor.modal, 'rgb(245, 241, 234)');
  assert.match(textColor.font, /DM Sans/);
  const contactText = new URL(await page.locator('#lb-contact').getAttribute('href')).searchParams.get('text');
  assert.ok(contactText.includes('Old Attic Window in Slovakia'));
  assert.doesNotMatch(contactText, /[א-ת]/);
  await page.locator('#lb-wall').click();
  await page.locator('#wall-modal.open').waitFor();
  assert.equal((await page.locator('#wall-label').innerText()).trim(), 'Old Attic Window in Slovakia');
  assert.equal(await page.locator('#wall-img').getAttribute('alt'), 'Old attic window.');
  await page.locator('#wall-modal-close').click();
  results.push('English translations from curated JSON + contrast + wall preview + contact');

  await page.locator('#lb-close').click();
  const missing = page.locator('#gallery-grid .gallery-item').nth(1);
  assert.match(await missing.getAttribute('aria-label'), /Georgia photograph/);
  await missing.click();
  await page.locator('#lightbox.open').waitFor();
  assert.equal((await page.locator('#lb-title').innerText()).trim(), 'Georgia photograph');
  assert.equal((await page.locator('#lb-cat').innerText()).trim(), 'Georgia');
  assert.equal(await page.locator('#lb-desc').isVisible(), false);
  assert.doesNotMatch(await page.locator('#lb-img').getAttribute('alt'), /[א-ת]/);
  results.push('No Hebrew leak when English translation is absent');

  await page.evaluate(() => window.setLang('he'));
  assert.equal((await page.locator('#lb-title').innerText()).trim(), 'שביל בגאורגיה');
  assert.equal((await page.locator('#lb-cat').innerText()).trim(), 'גאורגיה');
  assert.equal((await page.locator('#lb-desc').innerText()).trim(), 'תיאור ללא תרגום');
  await page.evaluate(() => window.setLang('en'));
  assert.equal((await page.locator('#lb-title').innerText()).trim(), 'Georgia photograph');
  results.push('Switch HE to EN with lightbox open');

  const dest = 'artifacts/experience-smoke/branch-' + engine;
  mkdirSync(dest, { recursive: true });
  await page.locator('#lightbox').screenshot({ path: dest + '/lightbox-english.png', timeout: 12000 });
  assert.deepEqual(errors, [], 'No JavaScript page errors');
  console.log('BRANCH_LIGHTBOX_SUCCESS ' + JSON.stringify({ engine, results, pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
