import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Confirmed live: /locations/ in English mode correctly set dir=ltr and translated all visible
// content (place names, region labels, sort options), but document.title stayed the Hebrew
// "מקומות לצילום — Amit Photos" — applyLang() updates many individual elements but never touched
// the tab title. A full vm-execution test of applyLang() isn't practical here (it cascades into
// renderGrid()/map code with many more dependencies than the other pages' simpler applyLang()),
// so this is a static-source regression check instead, same fallback used for other
// heavily-coupled inline scripts in this repo (e.g. free-guide-routing-source-of-truth.test.mjs).
const html = readFileSync(fileURLToPath(new URL('../locations/index.html', import.meta.url)), 'utf8');

test('regression: applyLang() sets document.title for both languages, not just dir/lang/body direction', () => {
  const applyLangStart = html.indexOf('function applyLang()');
  const applyLangEnd = html.indexOf('\n}', applyLangStart);
  assert.ok(applyLangStart !== -1, 'applyLang() not found in locations/index.html');
  const body = html.slice(applyLangStart, applyLangEnd);
  assert.match(body, /document\.title\s*=\s*isEn\s*\?\s*'Photography Locations — Amit Photos'\s*:\s*'מקומות לצילום — Amit Photos'/);
});
