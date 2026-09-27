import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

test('photo manager renders a bounded first page instead of every photo record', () => {
  assert.match(admin, /const PHOTO_PAGE_SIZE = 60/);
  assert.match(admin, /let visibleCount = PHOTO_PAGE_SIZE/);
  assert.match(admin, /const disp = all\.slice\(0, visibleCount\)/);
  assert.doesNotMatch(admin, /grid\.innerHTML = getDisplayData\(\)\.map/);
});

test('photo manager exposes progressive loading and an accessible result count', () => {
  assert.match(admin, /id="photos-results-summary"[^>]*aria-live="polite"/);
  assert.match(admin, /id="photos-load-more"/);
  assert.match(admin, /visibleCount \+= PHOTO_PAGE_SIZE/);
  assert.match(admin, /מוצגות .* מתוך/);
});

test('changing a category, search, or sort resets pagination to the first page', () => {
  assert.match(admin, /function resetPhotoPagination\(\)\s*\{\s*visibleCount = PHOTO_PAGE_SIZE/);
  assert.match(admin, /function filterByChip[\s\S]*?resetPhotoPagination\(\)[\s\S]*?render\(\)/);
  assert.match(admin, /photos-search'[\s\S]*?resetPhotoPagination\(\)[\s\S]*?renderGrid\(\)/);
  assert.match(admin, /photos-sort'[\s\S]*?resetPhotoPagination\(\)[\s\S]*?renderGrid\(\)/);
});

test('photo search and sort controls have explicit accessible labels', () => {
  assert.match(admin, /<label[^>]*for="photos-search"[^>]*>[^<]+<\/label>/);
  assert.match(admin, /<label[^>]*for="photos-sort"[^>]*>[^<]+<\/label>/);
});
