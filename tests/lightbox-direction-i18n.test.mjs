import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const enStart = i18n.search(/^ {2}en: \{/m);
const heBlock = i18n.slice(0, enStart);
const enBlock = i18n.slice(enStart);

const get = (block, key) => {
  const at = block.indexOf("'" + key + "':");
  if (at === -1) return undefined;
  return (block.slice(at).match(/:\s*'([^']*)'/) || [])[1];
};

test('lightbox arrows flip between RTL (HE) and LTR (EN)', () => {
  assert.equal(get(heBlock, 'lightbox.prev.glyph'), '›');
  assert.equal(get(heBlock, 'lightbox.next.glyph'), '‹');
  assert.equal(get(enBlock, 'lightbox.prev.glyph'), '‹');
  assert.equal(get(enBlock, 'lightbox.next.glyph'), '›');
  assert.match(html, /id="lb-prev"[^>]*data-i18n="lightbox\.prev\.glyph"/);
  assert.match(html, /id="lb-next"[^>]*data-i18n="lightbox\.next\.glyph"/);
});

test('page title and footer logo have English translations', () => {
  assert.match(html, /<title data-i18n="meta\.title\.home">/);
  assert.match(html, /data-i18n="footer\.logo\.name"/);
  assert.match(html, /data-i18n="footer\.logo\.tag"/);
  for (const key of ['meta.title.home', 'footer.logo.name', 'footer.logo.tag']) {
    assert.ok(get(heBlock, key), 'HE ' + key);
    assert.ok(get(enBlock, key), 'EN ' + key);
    assert.ok(!/[֐-׿]/.test(get(enBlock, key)), 'EN ' + key + ' has no Hebrew');
  }
});
