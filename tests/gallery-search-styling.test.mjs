import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Found live (screenshot from the user): the gallery search input rendered as a plain unstyled
// native <input>, with none of the site's dark theme applied. Root cause: assets/css/style.css
// has a fully-designed `.gallery-search` / `.gallery-search-wrap` pair (dark bg, search icon,
// centered, max-width, RTL, focus/placeholder states) that was never wired up — the JS injection
// in renderFilterBar() created the element with class "gallery-search-input" (no such CSS rule
// exists at all) and inserted it bare, not inside the centering wrapper.
const gallerySrc = readFileSync(fileURLToPath(new URL('../assets/js/gallery.js', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../assets/css/style.css', import.meta.url)), 'utf8');

function searchInjectionBlock() {
  const start = gallerySrc.indexOf('הזרקת שדה חיפוש');
  const end = gallerySrc.indexOf('לחיצה על כפתור רגיל', start);
  return gallerySrc.slice(start, end);
}

test('the injected search input uses the class the CSS actually styles, not an orphaned one', () => {
  const block = searchInjectionBlock();
  assert.match(block, /inp\.className = 'gallery-search'/);
  assert.doesNotMatch(block, /gallery-search-input/, 'this class has no matching CSS rule — it was the root cause of the unstyled input');
});

test('the search input is wrapped in .gallery-search-wrap before insertion, so it gets centered/max-width layout', () => {
  const block = searchInjectionBlock();
  assert.match(block, /wrap\.className = 'gallery-search-wrap'/);
  assert.match(block, /wrap\.appendChild\(inp\)/);
  assert.match(block, /insertBefore\(wrap, bar\)/);
});

test('.gallery-search and .gallery-search-wrap CSS rules actually exist (the fix has something real to attach to)', () => {
  assert.match(css, /\.gallery-search-wrap\s*\{/);
  assert.match(css, /\.gallery-search\s*\{/);
  assert.match(css, /\.gallery-search:focus/);
});
