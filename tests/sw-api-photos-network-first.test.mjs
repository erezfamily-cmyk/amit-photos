import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Found live on 2026-09-26 while verifying a deploy: /api/photos (the D1-primary photo feed) was
// falling into sw.js's cache-first branch, same as JS/CSS. Once a returning visitor's browser had
// cached one response, they kept seeing it forever — no photo-count fix, no corrupted-title fix,
// no newly added photo ever reached them, exactly like the photos.json cache-forever bug fixed on
// 2026-07-25 (see docs from that audit). This runs the real sw.js fetch handler in a sandbox to
// prove the strategy per URL, instead of re-implementing the logic.
const swSrc = readFileSync(fileURLToPath(new URL('../sw.js', import.meta.url)), 'utf8');

function buildSandbox({ networkOk = true } = {}) {
  const listeners = {};
  const cacheStore = new Map();
  const fetchCalls = [];
  const cachePutCalls = [];

  const fakeCache = {
    match: async (req) => cacheStore.get(req.url) ?? null,
    put: async (req, res) => { cachePutCalls.push(req.url); cacheStore.set(req.url, res); },
    addAll: async () => {},
  };

  const sandbox = {
    self: {
      location: { origin: 'https://amitphotos.com' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: {
      open: async () => fakeCache,
      keys: async () => [],
      delete: async () => true,
      match: fakeCache.match,
    },
    fetch: async (req) => {
      fetchCalls.push(req.url);
      if (!networkOk) throw new Error('network down');
      return { ok: true, url: req.url, _tag: 'network-response', clone: () => ({ url: req.url, _tag: 'network-response' }) };
    },
    URL,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(swSrc, sandbox);
  return { listeners, cacheStore, fetchCalls, cachePutCalls };
}

function fireFetch(listeners, { url, method = 'GET', mode = 'cors' }) {
  let respondWithPromise = null;
  const event = {
    request: { url, method, mode },
    respondWith: (p) => { respondWithPromise = p; },
  };
  listeners.fetch(event);
  return respondWithPromise;
}

test('/api/photos uses network-first (fetched fresh, not served from a stale cache hit)', async () => {
  const { listeners, cacheStore, fetchCalls } = buildSandbox();
  // pre-seed a stale cached response, simulating a returning visitor
  cacheStore.set('https://amitphotos.com/api/photos', { url: 'https://amitphotos.com/api/photos', _tag: 'STALE' });

  const result = await fireFetch(listeners, { url: 'https://amitphotos.com/api/photos' });

  assert.ok(fetchCalls.includes('https://amitphotos.com/api/photos'), 'must hit the network, not just return the cached copy');
  assert.equal(result._tag, 'network-response', 'must resolve with the fresh network response, not the stale cache');
});

test('/api/photos falls back to cache only when the network request fails', async () => {
  const { listeners, cacheStore } = buildSandbox({ networkOk: false });
  cacheStore.set('https://amitphotos.com/api/photos', { url: 'https://amitphotos.com/api/photos', _tag: 'STALE-FALLBACK' });

  const result = await fireFetch(listeners, { url: 'https://amitphotos.com/api/photos' });

  assert.equal(result._tag, 'STALE-FALLBACK');
});

test('data/photos.json still uses network-first (regression guard)', async () => {
  const { listeners, fetchCalls } = buildSandbox();
  await fireFetch(listeners, { url: 'https://amitphotos.com/data/photos.json' });
  assert.ok(fetchCalls.includes('https://amitphotos.com/data/photos.json'));
});

test('versioned static assets (?v=hash) remain cache-first (regression guard — must not become network-first too)', async () => {
  const { listeners, cacheStore, fetchCalls } = buildSandbox();
  const u = 'https://amitphotos.com/assets/js/gallery.js?v=fa67e0bd';
  cacheStore.set(u, { url: u, _tag: 'CACHED-JS' });

  const result = await fireFetch(listeners, { url: u });

  assert.equal(result._tag, 'CACHED-JS', 'a cache hit for a versioned asset must be returned without touching the network');
  assert.equal(fetchCalls.length, 0);
});

test('unversioned /assets/ JS and CSS are network-first, so pages that reference them without ?v= are not stuck on a stale copy', async () => {
  const { listeners, cacheStore, fetchCalls } = buildSandbox();
  const u = 'https://amitphotos.com/assets/js/nav.js';
  cacheStore.set(u, { url: u, _tag: 'STALE-NAV' });

  const result = await fireFetch(listeners, { url: u });

  assert.ok(fetchCalls.includes(u), 'must hit the network');
  assert.equal(result._tag, 'network-response', 'must resolve with the fresh response, not the stale copy');
});

test('unversioned /assets/ code falls back to the cached copy when the network fails', async () => {
  const { listeners, cacheStore } = buildSandbox({ networkOk: false });
  const u = 'https://amitphotos.com/assets/js/share.js';
  cacheStore.set(u, { url: u, _tag: 'OFFLINE-COPY' });

  const result = await fireFetch(listeners, { url: u });

  assert.equal(result._tag, 'OFFLINE-COPY');
});

test('HTML navigations remain network-first (regression guard)', async () => {
  const { listeners, fetchCalls } = buildSandbox();
  await fireFetch(listeners, { url: 'https://amitphotos.com/', mode: 'navigate' });
  assert.ok(fetchCalls.includes('https://amitphotos.com/'));
});

test('cache version was bumped so existing visitors get a clean cache on next activation', () => {
  assert.match(swSrc, /const CACHE = 'amit-photos-v6'/);
});
