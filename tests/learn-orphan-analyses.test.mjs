import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLearnIndex, handleLearnAnalysis } from '../worker.js';

// An analysis whose photo was removed or unpublished (e.g. in the copyright review) used to stay in the
// /learn/ list, in "more analyses" and in the sitemap, but its own page answered 404 and its thumbnail was empty.
function fakeEnv() {
  const sql = [];
  const stmt = (q) => {
    sql.push(q);
    const api = { bind: () => api, all: async () => ({ results: [{ total: 0 }] }), first: async () => null, run: async () => ({}) };
    return api;
  };
  return { sql, env: { DB: { prepare: stmt } } };
}

test('/learn/ lists and counts only analyses whose photo is still published', async () => {
  const { sql, env } = fakeEnv();
  await handleLearnIndex(env, new Request('https://amitphotos.com/learn/'));
  const analysisQueries = sql.filter((q) => /FROM photo_analyses a/.test(q));
  assert.ok(analysisQueries.length >= 2, 'count and list queries ran');
  for (const q of analysisQueries) assert.match(q, /JOIN photos p ON p\.id = a\.photo_id AND p\.published = 1/, q.slice(0, 80));
  assert.ok(!analysisQueries.some((q) => /LEFT JOIN photos/.test(q)), 'no LEFT JOIN that keeps orphans');
});

test('/learn/{id} only loads a published photo, and prev/next/more never point at dead pages', async () => {
  const { sql, env } = fakeEnv();
  await handleLearnAnalysis(env, 'x');
  assert.ok(sql.some((q) => /FROM photos WHERE id = \? AND published = 1/.test(q)), 'photo lookup requires published = 1');
  // prev/next/more only run once the analysis row exists, so check the template source as well
  const src = (await import('node:fs')).readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  const learn = src.slice(src.indexOf('async function handleLearnAnalysis'), src.indexOf('// ===== LOCATIONS API ====='));
  const siblings = learn.match(/FROM photo_analyses a [^`]*?(?=`)/g) || [];
  assert.ok(siblings.length >= 3, 'prev, next and more queries found');
  for (const q of siblings) assert.match(q, /JOIN photos p ON p\.id = a\.photo_id AND p\.published = 1/, q.slice(0, 90));
});

test('the sitemap does not list analysis URLs whose photo is gone', () => {
  const src = readSrc();
  assert.match(src, /FROM photo_analyses a JOIN photos p ON p\.id = a\.photo_id AND p\.published = 1 ORDER BY a\.published_at DESC/);
  assert.ok(!src.includes("'SELECT photo_id, published_at FROM photo_analyses ORDER BY published_at DESC'"));
});

function readSrc() {
  return globalThis.process.getBuiltinModule('node:fs').readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
}
