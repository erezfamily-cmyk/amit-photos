import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const analytics = readFileSync(new URL('../assets/js/analytics.js', import.meta.url), 'utf8');

test('a photo keeps a direct purchase-contact action while online payments are disabled', () => {
  assert.match(html, /id="lb-contact"[^>]*payments-disabled-only/);
  assert.match(html, /data-analytics-event="photo_contact_click"/);
  assert.match(html, /data-analytics-method="whatsapp"/);
});

test('the lightbox contact action is personalized to the open photo without exposing form data', () => {
  assert.match(gallery, /contactBtn\.href = `https:\/\/wa\.me\/972503333227\?text=/);
  assert.match(gallery, /contactBtn\.dataset\.analyticsPhotoId = String\(photo\.id/);
  assert.match(analytics, /photo_id: target\.dataset\.analyticsPhotoId/);
  assert.match(analytics, /destination: target\.dataset\.analyticsMethod \? ''/);
});

test('the mobile contact action is a full-width primary touch target', () => {
  assert.match(css, /\.lb-contact-btn\s*\{[^}]*background:\s*#25d366/s);
  assert.match(css, /@media \(hover: none\)[\s\S]*\.lb-contact-btn\s*\{[^}]*width:\s*100%[^}]*min-height:\s*48px/s);
  assert.match(css, /\.lightbox\s*\{[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/s);
});
