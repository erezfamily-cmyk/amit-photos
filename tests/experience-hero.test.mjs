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

test('the main emotional story remains visible while online payments are disabled', () => {
  assert.match(html, /<body[^>]*data-payments-state="disabled"/);
  assert.match(html, /<p class="hero-subtitle" data-i18n="hero\.subtitle">אור שמופיע לרגע/);
  assert.doesNotMatch(html, /class="hero-subtitle payments-enabled-only"/);
  assert.match(dict, /'hero\.subtitle':\s*'A fleeting light/);
});

test('disabled-payment notice is honest in Hebrew and English', () => {
  const off = html.match(/<p class="hero-payment-note payments-disabled-only"[^>]*>([^<]+)<\/p>/);
  assert.ok(off, 'disabled-mode notice is present');
  assert.match(off[1], /בירור רכישה או רישוי ב־WhatsApp/);
  assert.doesNotMatch(off[1], /PayPal|הורדה מיידית|תשלום מאובטח/);
  assert.match(dict, /'payments\.disabled\.hero':\s*'Found a photograph that fits\?/);
});

test('hero text and disabled notice wrap on narrow mobile screens', () => {
  assert.match(css, /\.hero-subtitle\s*\{[^}]*white-space:\s*normal;/s);
  assert.match(css, /\.hero-subtitle\s*\{[^}]*text-wrap:\s*balance;/s);
  assert.match(css, /\.hero-payment-note\s*\{[^}]*text-wrap:\s*balance;/s);
});
