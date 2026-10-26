import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const business = fs.readFileSync(new URL('../business/index.html', import.meta.url), 'utf8');
const gallery = fs.readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');

test('business page has one canonical and bilingual social metadata', () => {
  assert.equal((business.match(/rel="canonical"/g) || []).length, 1);
  assert.match(business, /hreflang="en"/);
  assert.match(business, /property="og:title"/);
  assert.match(business, /name="twitter:card"/);
  assert.match(business, /data-he=/);
  assert.match(business, /data-en=/);
});

test('business page pauses commercial offers and routes visitors to personal-use information', () => {
  assert.match(business, /id="business-unavailable"/);
  assert.match(business, /Commercial use is currently unavailable/);
  assert.match(business, /שימוש מסחרי אינו זמין כרגע/);
  assert.match(business, /href="\/#gallery"/);
  assert.match(business, /href="\/licensing\/"/);
  assert.doesNotMatch(business, /data-package=|b2b_contact_start|b2b_package_select|b2b_intent|business_quote|tailored quote|Request a business quote/);
});

test('paused business page cannot create a business lead context and honors language links', () => {
  assert.doesNotMatch(business, /sessionStorage\.setItem|amit_b2b_context/);
  assert.match(business, /URLSearchParams\(location.search\)\.get\('lang'\)/);
  assert.match(business, /url.searchParams.set\('lang',lang\)/);
});

test('contact form reads short-lived B2B context and selects general inquiry topic robustly', () => {
  assert.match(gallery, /30 \* 60 \* 1000/);
  assert.match(gallery, /option\[data-i18n="contact\.f\.t4"\]/);
  assert.doesNotMatch(gallery, /selectedIndex\s*=\s*2/);
});

test('successful B2B contact attribution contains only source and safe package label', () => {
  assert.match(gallery, /contact_form_success/);
  assert.match(gallery, /\{ source: 'business', label: businessContext\.package \}/);
  assert.doesNotMatch(gallery, /trackUxEvent\?\.\('contact_form_success'[\s\S]{0,200}(email|message|name)/i);
});
