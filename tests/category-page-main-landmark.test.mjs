import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCategoryPage } from '../worker.js';

function fakeEnv(photos) {
  return {
    DB: {
      prepare() {
        return { bind: () => ({ all: async () => ({ results: photos }) }) };
      },
    },
  };
}

test('category page HTML has exactly one <main> landmark wrapping the heading and photo grid', async () => {
  const env = fakeEnv([
    { id: 'p1', title: 'Photo 1', thumbnail: '/photos/thumb/p1.webp' },
    { id: 'p2', title: 'Photo 2', thumbnail: '/photos/thumb/p2.webp' },
  ]);
  const res = await handleCategoryPage('nature', env);
  const html = await res.text();

  const openCount = (html.match(/<main[\s>]/g) || []).length;
  const closeCount = (html.match(/<\/main>/g) || []).length;
  assert.equal(openCount, 1, 'exactly one <main> open tag');
  assert.equal(closeCount, 1, 'exactly one </main> close tag');

  const mainContent = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  assert.match(mainContent, /<h1>/, 'h1 heading is inside <main>');
  assert.match(mainContent, /class="grid"/, 'photo grid is inside <main>');
});

test('redirects (no <main> needed) when category has no photos', async () => {
  const env = fakeEnv([]);
  const res = await handleCategoryPage('empty-category', env);
  assert.equal(res.status, 302);
});
