import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Locks in the root cause behind a real bug found in the audit: ~20 strings across the site
// (GuruShots section, testimonial dates, beta banner, contact address, wall/buy-modal bits) had
// no English translation at all — they were simply never given a data-i18n attribute or a
// TRANSLATIONS entry. This test can't check every element in the DOM, but it can guarantee the
// dictionary itself never regresses into that state again: every key that exists in one language
// must exist in the other, with a non-empty value.
const src = readFileSync(fileURLToPath(new URL('../assets/js/i18n.js', import.meta.url)), 'utf8');
const start = src.indexOf('const TRANSLATIONS = {');
const end = src.indexOf('\n};', start) + 3;
if (start === -1 || end === -1) throw new Error('TRANSLATIONS object not found in i18n.js — has it moved or been renamed?');
const translationsSrc = src.slice(start, end);

const context = {};
vm.createContext(context);
vm.runInContext(`${translationsSrc}\nthis.__RESULT__ = TRANSLATIONS;`, context);
const TRANSLATIONS = context.__RESULT__;

test('TRANSLATIONS has both an he and an en dictionary', () => {
  assert.ok(TRANSLATIONS.he && typeof TRANSLATIONS.he === 'object');
  assert.ok(TRANSLATIONS.en && typeof TRANSLATIONS.en === 'object');
});

test('every key in he has a matching key in en, and vice versa', () => {
  const heKeys = new Set(Object.keys(TRANSLATIONS.he));
  const enKeys = new Set(Object.keys(TRANSLATIONS.en));
  const missingFromEn = [...heKeys].filter(k => !enKeys.has(k));
  const missingFromHe = [...enKeys].filter(k => !heKeys.has(k));
  assert.deepEqual(missingFromEn, [], `keys present in he but missing from en: ${missingFromEn.join(', ')}`);
  assert.deepEqual(missingFromHe, [], `keys present in en but missing from he: ${missingFromHe.join(', ')}`);
});

test('no translation value is an empty string', () => {
  for (const lang of ['he', 'en']) {
    for (const [key, value] of Object.entries(TRANSLATIONS[lang])) {
      assert.notEqual(String(value).trim(), '', `${lang}.${key} is empty`);
    }
  }
});

test('regression: the ~20 strings found leaking Hebrew into English mode are now translated', () => {
  const mustExist = [
    'beta.banner.html', 'gurushots.label', 'gurushots.title', 'gurushots.sub',
    'gurushots.points.suffix', 'gurushots.stat.pick', 'gurushots.stat.top10',
    'gurushots.stat.top100', 'gurushots.stat.exhibition', 'gurushots.stat.magazine',
    'gurushots.stat.photos.label', 'gurushots.stat.submitted', 'gurushots.link',
    'testimonial.date.1', 'testimonial.date.2', 'testimonial.date.3',
    'contact.address', 'wall.color.picker', 'buy.alt.brand',
  ];
  for (const key of mustExist) {
    assert.ok(key in TRANSLATIONS.he, `missing he.${key}`);
    assert.ok(key in TRANSLATIONS.en, `missing en.${key}`);
    assert.notEqual(TRANSLATIONS.he[key], TRANSLATIONS.en[key], `he.${key} and en.${key} are identical — likely never actually translated`);
  }
});

test('regression: every data-i18n* key actually used in HTML exists in the dictionary (he) — catches keys missing from BOTH languages, which the he/en parity check above cannot', () => {
  // this is exactly the skip.link bug: data-i18n="skip.link" was on the page but the key was
  // never added to TRANSLATIONS at all (not just missing from one language), so applyTranslations()
  // fell through to t()'s final fallback and displayed the literal key name "skip.link" as
  // visible text — found live in production.
  const consumers = ['404.html', 'download.html', 'index.html', 'print-complete.html'];
  const attrPattern = /data-i18n(?:-html|-aria|-placeholder|-title)?="([^"]+)"/g;
  const missing = [];
  for (const file of consumers) {
    const pageSrc = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
    for (const m of pageSrc.matchAll(attrPattern)) {
      const key = m[1];
      if (!(key in TRANSLATIONS.he)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `these data-i18n keys are used in HTML but missing from TRANSLATIONS entirely:\n${missing.join('\n')}`);
});

test('regression: cookie-notice.js and accessibility-widget.js read localStorage, not the (stale-at-load-time) documentElement.lang', () => {
  for (const file of ['../assets/js/cookie-notice.js', '../assets/js/accessibility-widget.js']) {
    const scriptSrc = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.match(scriptSrc, /var isEn = localStorage\.getItem\(['"]lang['"]\) === ['"]en['"]/, `${file} should compute isEn from localStorage directly`);
    // documentElement.lang may still be mentioned in an explanatory comment; only the old buggy
    // *assignment* pattern must be gone.
    assert.doesNotMatch(scriptSrc, /var isEn = .*document\.documentElement\.lang/, `${file} must not compute isEn from documentElement.lang, which i18n.js only sets on DOMContentLoaded — after these synchronous scripts already ran`);
  }
});
