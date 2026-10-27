import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('assets/css/guide-cream.css');
const hash = createHash('md5').update(css.replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);
const migrated = ['exposure', 'night', 'black-and-white', 'color-channels', 'color-theory', 'composition', 'dynamic-range', 'filters', 'depth-of-field', 'histogram', 'white-balance', 'controls', 'focus', 'lenses', 'light', 'editing', 'landscape', 'macro', 'mobile', 'portrait', 'software', 'sports', 'types', 'visual-language'].map((g) => `camera/${g}/index.html`).concat('camera/index.html');

// guides without an interactive simulator: the whole page stays in the cream theme
const contentOnly = ['camera/light/index.html', 'camera/software/index.html', 'camera/visual-language/index.html', 'camera/index.html'];

test('migrated guides link the shared cream stylesheet with its current cache-bust hash', () => {
  for (const page of migrated) {
    assert.ok(read(page).includes(`/assets/css/guide-cream.css?v=${hash}`), `${page} must link guide-cream.css?v=${hash}`);
  }
});

test('the shared stylesheet beats the variables nav.js injects and keeps simulators dark', () => {
  assert.match(css, /html:root \{[^}]*--bg: #f5f1e9;/);
  assert.match(css, /\.lab, \.guide-dark \{[^}]*background: #141413;/);
});

test('migrated guides use inline SVG badges instead of emoji and load the heading font', () => {
  for (const page of migrated) {
    const html = read(page);
    assert.match(html, /<div class="(hero-badge|ls-hero-badge|badge)"><svg /);
    if (html.includes('class="lab-title')) assert.match(html, /<div class="lab-title"><svg /);
    else if (!contentOnly.includes(page)) assert.ok(html.includes('guide-dark'), `${page} keeps its simulator dark via guide-dark`);
    assert.ok(html.includes('family=Frank+Ruhl+Libre'), `${page} loads Frank Ruhl Libre`);
  }
});

test('cream palette text tokens meet 4.5:1 on cream and on the surface colours', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  for (const bg of ['#f5f1e9', '#fffdf9', '#f0ebe0']) {
    assert.ok(ratio('#645f57', bg) >= 4.5, `muted on ${bg}`);
    assert.ok(ratio('#7a5c3f', bg) >= 4.5, `accent on ${bg}`);
  }
});

test('migrated guides use inline SVG icons, not emoji, anywhere in the markup', () => {
  for (const page of migrated) {
    const found = read(page).match(/\p{Extended_Pictographic}/gu) || [];
    assert.deepEqual(found, [], `${page} still contains emoji: ${found.join('')}`);
  }
});
