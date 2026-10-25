// Real-browser, read-only smoke test of PR #181 on its Cloudflare Sandbox Preview.
// Intentionally never clicks checkout/WhatsApp or sends GA4 events.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';

const preview = process.env.EXPERIENCE_PREVIEW_URL ||
  'https://feature-experience-analytics-story-p-amit-photos-paypal-sandbox.erez-family.workers.dev/';
const base = new URL(preview);
assert.ok(base.protocol === 'https:' &&
  base.hostname.endsWith('-amit-photos-paypal-sandbox.erez-family.workers.dev'),
  'Live smoke test must only target the isolated Sandbox Preview');
const engine = process.env.EXPERIENCE_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine), 'Browser engine must be Chromium or Safari WebKit');
const artifactDir = 'artifacts/experience-smoke/' + engine;
const routes = ['quiet', 'wonder', 'details', 'places'];
const results = [];
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
mkdirSync(artifactDir, { recursive: true });

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'he-IL',
  reducedMotion: 'reduce',
});
await context.addInitScript(() => {
  localStorage.setItem('cookie_notice_dismissed', '1');
  localStorage.setItem('week_popup_dismissed', '1');
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => {
  if (request.url().includes('/api/experience-preview-photos'))
    errors.push('API request failed: ' + (request.failure()?.errorText || 'unknown'));
});
// A smoke test should not produce tracking events or phantom leads.
await page.route(/google-analytics\.com|googletagmanager\.com|facebook\.net\/tr|\/api\/track(?:\?|$)/, route => route.abort());

try {
  const publicApi = page.waitForResponse(r =>
    r.url().includes('/api/experience-preview-photos'), { timeout: 35000 });
  await page.goto(new URL('/#experience', base).toString(),
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  const apiResponse = await publicApi;
  assert.equal(apiResponse.status(), 200, 'Sandbox published-photo API must return 200');
  const photos = await apiResponse.json();
  assert.ok(Array.isArray(photos) && photos.length >= 16, 'Sandbox must return a populated public photo array');
  results.push({ step: 'public-api', status: 200, count: photos.length });

  await page.locator('#experience').waitFor({ state: 'visible', timeout: 30000 });
  const cards = page.locator('#experience .experience-card:not([hidden]):not([disabled])');
  assert.equal(await cards.count(), 4, 'Exactly four visible experience routes');
  const layout = await page.locator('.experience-card[data-experience="details"]').evaluate(el => ({
    cardPosition: getComputedStyle(el).position,
    mediaPosition: getComputedStyle(el.querySelector('.experience-card-media')).position,
    width: Math.round(el.getBoundingClientRect().width),
    height: Math.round(el.getBoundingClientRect().height),
  }));
  assert.equal(layout.cardPosition, 'relative', 'P2 photo-first design must be deployed (not old P1)');
  assert.equal(layout.mediaPosition, 'absolute', 'P2 image must fill the experience card');
  results.push({ step: 'design-revision', engine, layout });
  await page.locator('#experience').screenshot({ path: artifactDir + '/mobile-routes.png' });
  for (const route of routes) {
    const card = page.locator('.experience-card[data-experience="' + route + '"]');
    assert.ok(await card.isVisible() && await card.isEnabled(), route + ' is visible/enabled');
    await card.scrollIntoViewIfNeeded();
    const img = card.locator('.experience-card-media img');
    await img.waitFor({ state: 'visible' });
    await page.waitForFunction(el => el.complete && el.naturalWidth > 0,
      await img.elementHandle(), { timeout: 20000 });
    await card.click();
    await page.locator('#gallery-grid-wrap').waitFor({ state: 'visible' });
    const n = await page.locator('#gallery-grid .gallery-item:visible').count();
    assert.ok(n >= 2, route + ' renders at least two public photos; saw ' + n);
    results.push({ step: 'route-' + route, visiblePhotos: n });
  }

  // Every selected details photograph has an approved bilingual story.
  await page.locator('.experience-card[data-experience="details"]').click();
  const firstPhoto = page.locator('#gallery-grid .gallery-item:visible').first();
  await firstPhoto.click();
  await page.locator('#lightbox.open').waitFor({ state: 'visible' });
  await page.locator('#lb-experience-story').waitFor({ state: 'visible' });
  const hebrew = (await page.locator('#lb-experience-story-text').innerText()).trim();
  assert.ok(hebrew.length >= 50, 'Hebrew editorial story must be present');
  assert.equal(await page.locator('#lb-desc').isVisible(), false, 'No duplicate catalog paragraph');
  await page.locator('#lightbox').screenshot({ path: artifactDir + '/mobile-lightbox-he.png' });
  results.push({ step: 'editorial-he', characters: hebrew.length });

  // Language change while lightbox is still open is supported by the site.
  await page.evaluate(() => window.setLang('en'));
  const english = (await page.locator('#lb-experience-story-text').innerText()).trim();
  assert.ok(english.length >= 50 && english !== hebrew, 'English story updates in open lightbox');
  results.push({ step: 'editorial-en', characters: english.length });

  const wallButton = page.locator('#lb-experience-wall');
  await wallButton.scrollIntoViewIfNeeded();
  await wallButton.click();
  await page.locator('#wall-modal.open').waitFor({ state: 'visible' });
  const wallPhoto = page.locator('#wall-img');
  await page.waitForFunction(el => el.complete && el.naturalWidth > 0,
    await wallPhoto.elementHandle(), { timeout: 20000 });
  await page.screenshot({ path: artifactDir + '/mobile-wall.png' });
  results.push({ step: 'wall-preview', visible: true });

  console.log('EXPERIENCE_SMOKE_SUCCESS ' + JSON.stringify({ engine, results, pageErrors: errors }));
} catch (error) {
  console.error('EXPERIENCE_SMOKE_FAILED ' + JSON.stringify({ engine, message: error.message, pageErrors: errors }));
  try {
    await page.screenshot({ path: artifactDir + '/mobile-failure.png', fullPage: true, timeout: 7000 });
  } catch { /* best effort screenshot */ }
  writeFileSync(artifactDir + '/result.json', JSON.stringify({ error: error.message, results }, null, 2));
  process.exitCode = 1;
} finally {
  if (!process.exitCode) writeFileSync(artifactDir + '/result.json', JSON.stringify({ results }, null, 2));
  await browser.close();
}
