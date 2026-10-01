import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../licensing/index.html', import.meta.url), 'utf8');

test('licensing page includes GA bootstrap before analytics helper', () => {
  const gtag = html.indexOf('googletagmanager.com/gtag/js?id=G-XM6T3E8QWN');
  const analytics = html.indexOf('/assets/js/analytics.js');
  assert.ok(gtag >= 0, 'GA bootstrap missing');
  assert.ok(analytics > gtag, 'analytics.js should load after gtag bootstrap');
});

test('licensing page tracks personal and commercial business events', () => {
  assert.match(html, /data-analytics-event="licensing_personal_interest"/);
  assert.match(html, /data-analytics-event="licensing_commercial_contact"/);
});

test('licensing page loads prices from the existing server endpoint', () => {
  assert.match(html, /fetch\('\/api\/admin\/prices'/);
  assert.match(html, /data-price-size="small"/);
  assert.match(html, /data-price-size="medium"/);
  assert.match(html, /data-price-size="large"/);
});

test('licensing page keeps production checkout disabled in its public copy', () => {
  assert.match(html, /הרכישה באתר עדיין כבויה זמנית/);
  assert.doesNotMatch(html, /paypal\.Buttons|create-order|capture-order/);
});

test('licensing page is bilingual and has canonical social metadata', () => {
  assert.match(html, /hreflang="en"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /data-he=/);
  assert.match(html, /data-en=/);
});


test('licensing page inline script remains syntactically intact', () => {
  assert.match(html, /return currentLang === 'en'[\s\S]*\? '\$' \+ Math\.round\(value \/ ILS_TO_USD\)[\s\S]*: '₪' \+ value;/);
  assert.equal((html.match(/const T = \{/g) || []).length, 1);
  assert.equal((html.match(/<\/body>/g) || []).length, 1);
  assert.equal((html.match(/<\/html>/g) || []).length, 1);
});
