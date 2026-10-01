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

test('business page sends one contact-start event through funnel logic', () => {
  assert.match(business, /window\.trackUxEvent\('b2b_contact_start'/);
  assert.doesNotMatch(business, /data-analytics-event="b2b_contact_start"/);
});

test('business packages are allowlisted and stored without PII', () => {
  assert.match(business, /new Set\(\['digital_display','wall_art','custom_collection'\]\)/);
  assert.match(business, /sessionStorage\.setItem\('amit_b2b_context'/);
  assert.doesNotMatch(business, /email|phone|name:/i);
});

test('contact form reads short-lived B2B context and selects commercial topic robustly', () => {
  assert.match(gallery, /30 \* 60 \* 1000/);
  assert.match(gallery, /option\[data-i18n="contact\.f\.t2"\]/);
  assert.doesNotMatch(gallery, /selectedIndex\s*=\s*2/);
});

test('successful B2B contact attribution contains only source and safe package label', () => {
  assert.match(gallery, /contact_form_success/);
  assert.match(gallery, /\{ source: 'business', label: businessContext\.package \}/);
  assert.doesNotMatch(gallery, /trackUxEvent\?\.\('contact_form_success'[\s\S]{0,200}(email|message|name)/i);
});
