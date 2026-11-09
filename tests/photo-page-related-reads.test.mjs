import test from 'node:test';
import assert from 'node:assert/strict';
import { servePhotoPage } from '../worker.js';

// 9.11.2026: "related photos" ran ORDER BY RANDOM() over the whole category on every
// /photo/{id} request and burned 4.3M of the 5M daily D1 rows_read. The category pool
// is now one plain query (edge-cached), randomised in JS.
function fakeEnv(log) {
  const pool = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, title: `t${i}`, thumbnail: `/th${i}.webp` }));
  return {
    DB: {
      prepare(sql) {
        log.push(sql);
        return {
          bind() { return this; },
          async first() { return { id: 'p0', title: 't0', description: 'd', thumbnail: '/th0.webp', url: '/p0.webp', category: 'england' }; },
          async all() { return { results: pool }; },
        };
      },
    },
    ASSETS: { fetch: async () => new Response('[]') },
  };
}

test('photo page does not use ORDER BY RANDOM() for related photos', async () => {
  const log = [];
  const res = await servePhotoPage('p0', fakeEnv(log));
  assert.equal(res.status, 200);
  assert.ok(log.length >= 2, 'expected the photo + category pool queries');
  assert.ok(!log.some(sql => /ORDER BY RANDOM\(\)/i.test(sql)), 'no RANDOM() scan in photo page queries');
});

test('related photos exclude the current photo and number at most 6', async () => {
  const html = await (await servePhotoPage('p0', fakeEnv([]))).text();
  const ids = [...html.matchAll(/\/photo\/(p\d+)/g)].map(m => m[1]).filter(id => id !== 'p0');
  assert.ok(ids.length > 0 && new Set(ids).size <= 6, `related ids: ${ids}`);
});
