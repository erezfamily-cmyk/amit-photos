import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Every public standalone page had no <link rel="icon"> at all — only index.html did. Browsers
// fell back to requesting /favicon.ico, which doesn't exist (confirmed 404 live), so every
// subpage showed a generic/blank tab icon. Locks in that every public page now declares one,
// using the same inline SVG as the homepage (no extra HTTP request) plus an absolute
// apple-touch-icon path (these pages live at different directory depths, so a relative path
// would resolve incorrectly for anything nested more than one level deep).
const PUBLIC_PAGES = [
  'index.html',
  'camera/index.html', 'camera/black-and-white/index.html', 'camera/color-channels/index.html',
  'camera/color-theory/index.html', 'camera/composition/index.html', 'camera/controls/index.html',
  'camera/depth-of-field/index.html', 'camera/dynamic-range/index.html', 'camera/editing/index.html',
  'camera/exposure/index.html', 'camera/filters/index.html', 'camera/focus/index.html',
  'camera/histogram/index.html', 'camera/landscape/index.html', 'camera/lenses/index.html',
  'camera/light/index.html', 'camera/macro/index.html', 'camera/mobile/index.html',
  'camera/night/index.html', 'camera/portrait/index.html', 'camera/software/index.html',
  'camera/sports/index.html', 'camera/types/index.html', 'camera/visual-language/index.html',
  'camera/white-balance/index.html',
  'locations/index.html', 'locations/spot/index.html',
  'videos/index.html', 'sale/index.html', 'games/index.html', 'gear/index.html',
  'learn/index.html', 'quiz/index.html', 'puzzle/index.html',
  'privacy/index.html', 'accessibility/index.html',
];

for (const page of PUBLIC_PAGES) {
  test(`${page} declares a favicon`, () => {
    const html = readFileSync(fileURLToPath(new URL(`../${page}`, import.meta.url)), 'utf8');
    assert.match(html, /<link rel="icon"/, `${page} is missing <link rel="icon">`);
  });
}

test('apple-touch-icon uses an absolute path on every nested page (index.html is at the root, where a relative path also works)', () => {
  for (const page of PUBLIC_PAGES) {
    if (page === 'index.html') continue;
    const html = readFileSync(fileURLToPath(new URL(`../${page}`, import.meta.url)), 'utf8');
    const match = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/);
    if (match) {
      assert.ok(match[1].startsWith('/'), `${page}: apple-touch-icon href "${match[1]}" must be an absolute path`);
    }
  }
});
