import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('assets/css/guide-cream.css');
const hash = createHash('md5').update(css.replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);
const pages = ['locations/index.html', 'locations/spot/index.html'];

test('location pages link the shared cream stylesheet with its current cache-bust hash', () => {
  for (const page of pages) {
    assert.ok(read(page).includes(`/assets/css/guide-cream.css?v=${hash}`), `${page} must link guide-cream.css?v=${hash}`);
  }
});

test('location pages load the heading font and carry no dark-theme leftovers', () => {
  for (const page of pages) {
    const html = read(page).replace(/<link rel="icon"[^>]*>/, '');
    assert.ok(html.includes('family=Frank+Ruhl+Libre'), `${page} loads Frank Ruhl Libre`);
    assert.ok(!html.includes("'Syne'"), `${page} still sets Syne on headings`);
    const dark = html.match(/#(0a0a0a|111|141414|1a1a1a|c8a96e|f0ede8)\b/gi) || [];
    assert.deepEqual(dark, [], `${page} still hard-codes dark-theme colours: ${dark.join(' ')}`);
  }
});

test('location pages use inline SVG icons, not emoji', () => {
  for (const page of pages) {
    // © in the map attribution is text, not an icon
    const found = read(page).replace(/©/g, '').match(/\p{Extended_Pictographic}|⃣/gu) || [];
    assert.deepEqual(found, [], `${page} still contains emoji: ${found.join('')}`);
  }
});

test('the map toggle starts closed and the filter that is active reads as filled', () => {
  const html = read('locations/index.html');
  assert.match(html, /mapContainer\.style\.display === 'block'/);
  assert.match(html, /\.filter-btn\.active\{background:var\(--accent\)/);
});
