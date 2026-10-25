import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dict = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');

test('the experience-led hero links to the gallery and existing guide', () => {
  assert.match(html, /data-i18n="hero\.title\.main">יש רגעים<\/span>/);
  assert.match(html, /data-i18n="hero\.cta"[^>]*>גלו את הרגע שלכם<\/a>/);
  assert.match(html, /data-i18n="hero\.cta-pdf"/);
  assert.match(dict, /'hero\.title\.main':\s*'Some moments'/);
  assert.match(dict, /'hero\.cta':\s*'Find your moment'/);
});

test('the no-checkout Hero remains truthful in Hebrew and English', () => {
  assert.match(html, /<body[^>]*data-payments-state="disabled"/);
  const off = html.match(/<p class="hero-subtitle payments-disabled-only"[^>]*>([^<]+)<\/p>/);
  assert.ok(off, 'disabled-mode subtitle is present');
  assert.match(off[1], /לפנות אליי ישירות/);
  assert.doesNotMatch(off[1], /PayPal|הורדה מיידית|תשלום מאובטח/);
  assert.match(dict, /'payments\.disabled\.hero':\s*'Explore the gallery and find your moment/);
});

test('the experiential subtitle wraps on narrow mobile devices', () => {
  assert.match(css, /\.hero-subtitle\s*\{[^}]*white-space:\s*normal;/s);
  assert.match(css, /\.hero-subtitle\s*\{[^}]*text-wrap:\s*balance;/s);
});
