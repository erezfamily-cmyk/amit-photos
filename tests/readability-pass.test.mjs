import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('assets/css/home-experience-preview.css');

test('Hebrew text on the home page is not letter-spaced', () => {
  assert.match(css, /html\.home-experience-preview\[lang="he"\] \.section-label,[\s\S]*?\.footer-copy \{\s*letter-spacing: normal;/);
});

test('small labels on the home page reach 12px and bronze text meets contrast on cream', () => {
  assert.match(css, /\.section-label \{ font-size: 0\.78rem; color: #7a5c3f; \}/);
  assert.match(css, /html\.home-experience-preview \.filter-count,[\s\S]*?\.lang-btn \{\s*font-size: 0\.75rem;/);
});

test('#7a5c3f on the cream background is at least 4.5:1', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum('#f5f1e9'), lum('#7a5c3f')].sort((a, b) => b - a);
  assert.ok((hi + 0.05) / (lo + 0.05) >= 4.5);
});

test('sale, quiz and puzzle expose a level-1 heading and puzzle tiles are marked decorative', () => {
  assert.match(read('sale/index.html'), /id="s-title" role="heading" aria-level="1"/);
  assert.match(read('quiz/index.html'), /class="question-label" role="heading" aria-level="1"/);
  assert.match(read('puzzle/index.html'), /class="splash-title" role="heading" aria-level="1"/);
  assert.match(read('puzzle/index.html'), /img\.alt = '';/);
});
