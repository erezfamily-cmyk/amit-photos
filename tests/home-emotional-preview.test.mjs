import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const translations = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const previewScript = readFileSync(new URL('../assets/js/home-experience-preview.js', import.meta.url), 'utf8');
const previewCss = readFileSync(new URL('../assets/css/home-experience-preview.css', import.meta.url), 'utf8');

test('the emotional-value section is hidden unless the explicit preview query is selected', () => {
  assert.match(html, /<section class="home-value-section" id="home-value" hidden/);
  assert.match(previewScript, /get\('experience'\) !== 'warm'/);
  assert.match(previewScript, /classList\.add\('home-experience-preview'\)/);
  assert.match(previewScript, /previewSection\.hidden = false/);
});

test('the preview uses the existing gallery and does not activate payment or analytics flows', () => {
  const section = html.slice(html.indexOf('id="home-value"'), html.indexOf('</section>', html.indexOf('id="home-value"')));
  assert.match(section, /href="#gallery"/);
  assert.ok(section.includes('https://amitphotos.com/photos/14vthzIuM_Gi0Bl5IsQbogDajHKad6B1r.webp'));
  assert.doesNotMatch(section, /data-analytics-event|paypal|payment|checkout/i);
  assert.match(html, /data-payments-state="disabled"/);
  assert.ok(previewCss.includes('https://amitphotos.com/photos/1m6IFLTq0pfpdgENTItciXddOOGIOUzt2.webp'));
  assert.ok(previewCss.includes("../images/home-value-living-room.png"));
  assert.match(section, /class="home-value-room-wrap"/);
  assert.match(previewCss, /html\.home-experience-preview \.home-value-room-note\s*\{\s*margin:/);
});

test('Hebrew and English copy explains the personal digital product and the illustration', () => {
  for (const key of [
    'home.value.label', 'home.value.title', 'home.value.intro', 'home.value.image.alt',
    'home.value.image.note', 'home.value.home.title', 'home.value.home.copy',
    'home.value.space.title', 'home.value.space.copy', 'home.value.gift.title',
    'home.value.gift.copy', 'home.value.product.note', 'home.value.cta'
  ]) {
    assert.equal((translations.match(new RegExp("'" + key.replaceAll('.', '\\.') + "':", 'g')) || []).length, 2, key + ' must be translated in both locales');
  }
  assert.match(translations, /'home\.value\.product\.note': 'המוצר המוצע כעת הוא קובץ דיגיטלי לשימוש אישי/);
  assert.match(translations, /'home\.value\.product\.note': 'The current offer is a digital file for personal use/);
  assert.match(translations, /'home\.value\.image\.alt': 'שני כיסאות לבנים על חוף שקט/);
  assert.match(translations, /'home\.value\.image\.alt': 'Two white loungers on a quiet beach/);
  assert.match(translations, /'home\.value\.image\.note': 'A quiet moment by the sea/);
  assert.match(translations, /querySelectorAll\('\[data-i18n-alt\]'\)/);
});

test('every preview CSS selector is scoped to the opt-in root class', () => {
  const rules = previewCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g);
  for (const [, rawSelector] of rules) {
    const selector = rawSelector.trim();
    if (selector.startsWith('@')) continue;
    for (const part of selector.split(',')) {
      assert.ok(part.trim().startsWith('html.home-experience-preview'), part.trim());
    }
  }
});
