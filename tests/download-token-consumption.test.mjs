import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDownload } from '../worker.js';

// A paid one-time download token must only be consumed when the file is
// actually served. A missing object or an R2 read failure leaves it intact,
// and the claim is atomic so parallel requests cannot both succeed.

const TOKEN = 'tok-e2e-1';

function makeEnv({ objects = {}, getImpl, usedInitially = 0, r2Key = 'photo.jpg' } = {}) {
  const state = {
    used: usedInitially,
    claimAttempts: 0,
    claimWins: 0,
    r2Gets: 0,
  };
  const env = {
    state,
    DB: {
      prepare(sql) {
        return {
          bind: (...args) => ({
            async first() {
              if (sql.includes('FROM download_tokens')) {
                return {
                  token: TOKEN,
                  photo_ids: JSON.stringify(['photo-1']),
                  size: 'small',
                  used: state.used,
                  expires_at: Math.floor(Date.now() / 1000) + 3600,
                };
              }
              if (sql.includes('FROM photos')) return { r2_key: r2Key, title: 'Test Photo' };
              return null;
            },
            async run() {
              if (sql.includes('UPDATE download_tokens SET used = 1')) {
                state.claimAttempts += 1;
                // Emulates the atomic "WHERE used = 0" compare-and-set in D1.
                if (sql.includes('AND used = 0') && state.used === 0 && args[0] === TOKEN) {
                  state.used = 1;
                  state.claimWins += 1;
                  return { success: true, meta: { changes: 1 } };
                }
                return { success: true, meta: { changes: 0 } };
              }
              return { success: true, meta: { changes: 0 } };
            },
          }),
        };
      },
    },
    PHOTOS: {
      async get(key) {
        state.r2Gets += 1;
        if (getImpl) return getImpl(key, state);
        return objects[key] || null;
      },
    },
  };
  return env;
}

const request = () => new Request('https://example.test/api/download/' + TOKEN);
const fileObject = () => ({ body: 'jpeg-bytes', httpMetadata: { contentType: 'image/jpeg' } });

test('missing R2 object returns 404 and does not consume the token', async () => {
  const env = makeEnv({ objects: {} });
  const res = await handleDownload(request(), env, TOKEN);
  assert.equal(res.status, 404);
  assert.equal(env.state.used, 0);
  assert.equal(env.state.claimAttempts, 0);
});

test('R2 read failure returns 503 and does not consume the token', async () => {
  const env = makeEnv({ getImpl: async () => { throw new Error('R2 unavailable'); } });
  const res = await handleDownload(request(), env, TOKEN);
  assert.equal(res.status, 503);
  assert.equal(env.state.used, 0);
  assert.equal(env.state.claimAttempts, 0);
});

test('retry after the file is restored succeeds once, then the token is spent', async () => {
  const objects = {};
  const env = makeEnv({ objects });

  const missing = await handleDownload(request(), env, TOKEN);
  assert.equal(missing.status, 404);
  assert.equal(env.state.used, 0);

  objects['photo.jpg'] = fileObject();
  const served = await handleDownload(request(), env, TOKEN);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(served.headers.get('Cache-Control'), 'no-store');
  assert.equal(env.state.used, 1);

  const again = await handleDownload(request(), env, TOKEN);
  assert.equal(again.status, 410);
});

test('a transient R2 failure followed by a working read lets the buyer retry', async () => {
  let calls = 0;
  const env = makeEnv({
    getImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return fileObject();
    },
  });
  assert.equal((await handleDownload(request(), env, TOKEN)).status, 503);
  assert.equal(env.state.used, 0);
  assert.equal((await handleDownload(request(), env, TOKEN)).status, 200);
  assert.equal(env.state.used, 1);
  assert.equal((await handleDownload(request(), env, TOKEN)).status, 410);
});

test('parallel downloads of one token: exactly one succeeds, the rest get 410', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const cancelled = [];
  const env = makeEnv({
    getImpl: async () => {
      // Hold every request inside the R2 read so they all pass the initial
      // "used = 0" check before any of them can claim the token.
      await gate;
      return { body: { cancel: async () => { cancelled.push(true); } }, httpMetadata: { contentType: 'image/jpeg' } };
    },
  });

  const pending = Array.from({ length: 5 }, () => handleDownload(request(), env, TOKEN));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.state.r2Gets, 5);
  release();
  const responses = await Promise.all(pending);

  const statuses = responses.map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 410, 410, 410, 410]);
  assert.equal(env.state.claimWins, 1);
  assert.equal(env.state.used, 1);
  // Losing requests release the unread R2 stream.
  assert.equal(cancelled.length, 4);
});

test('an already-used token is rejected before touching R2', async () => {
  const env = makeEnv({ objects: { 'photo.jpg': fileObject() }, usedInitially: 1 });
  const res = await handleDownload(request(), env, TOKEN);
  assert.equal(res.status, 410);
  assert.equal(env.state.r2Gets, 0);
});

test('Drive fallback (no r2_key) still claims the token atomically before redirecting', async () => {
  const env = makeEnv({ r2Key: null });
  const first = await handleDownload(request(), env, TOKEN);
  assert.equal(first.status, 302);
  assert.equal(env.state.used, 1);
  const second = await handleDownload(request(), env, TOKEN);
  assert.equal(second.status, 410);
});

// ===== HEAD must never consume the one-time token (link previews, prefetchers) =====

const headRequest = () => new Request('https://example.test/api/download/' + TOKEN, { method: 'HEAD' });
const methodRequest = method => new Request('https://example.test/api/download/' + TOKEN, { method });

test('HEAD does not consume the token: HEAD, then one GET succeeds, then another GET is blocked', async () => {
  const env = makeEnv({ objects: { 'photo.jpg': fileObject() } });

  const head = await handleDownload(headRequest(), env, TOKEN);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(head.headers.get('Cache-Control'), 'no-store');
  assert.equal(await head.text(), '');
  assert.equal(env.state.used, 0);
  assert.equal(env.state.claimAttempts, 0);

  // A second HEAD (browser preload, scanner) still leaves it intact.
  assert.equal((await handleDownload(headRequest(), env, TOKEN)).status, 200);
  assert.equal(env.state.used, 0);

  const first = await handleDownload(request(), env, TOKEN);
  assert.equal(first.status, 200);
  assert.equal(await first.text(), 'jpeg-bytes');
  assert.equal(env.state.used, 1);

  assert.equal((await handleDownload(request(), env, TOKEN)).status, 410);
  assert.equal(env.state.claimWins, 1);
  // Once spent, HEAD reports it too.
  assert.equal((await handleDownload(headRequest(), env, TOKEN)).status, 410);
});

test('HEAD uses R2 head() when available and never reads or streams the body', async () => {
  const env = makeEnv({ objects: { 'photo.jpg': fileObject() } });
  let heads = 0;
  let cancelled = 0;
  env.PHOTOS.head = async () => { heads += 1; return { body: { cancel: async () => { cancelled += 1; } }, httpMetadata: { contentType: 'image/jpeg' } }; };

  const head = await handleDownload(headRequest(), env, TOKEN);
  assert.equal(head.status, 200);
  assert.equal(heads, 1);
  assert.equal(env.state.r2Gets, 0);
  assert.equal(env.state.used, 0);
  assert.equal(cancelled, 1);

  assert.equal((await handleDownload(request(), env, TOKEN)).status, 200);
  assert.equal(env.state.used, 1);
});

test('HEAD on a missing file or an R2 error reports it and leaves the token intact', async () => {
  const missing = makeEnv({ objects: {} });
  assert.equal((await handleDownload(headRequest(), missing, TOKEN)).status, 404);
  assert.equal(missing.state.used, 0);
  const broken = makeEnv({ getImpl: async () => { throw new Error('R2 unavailable'); } });
  assert.equal((await handleDownload(headRequest(), broken, TOKEN)).status, 503);
  assert.equal(broken.state.used, 0);
  assert.equal(broken.state.claimAttempts, 0);
});

test('HEAD on the Drive fallback does not redirect or claim; GET then redirects once', async () => {
  const env = makeEnv({ r2Key: null });
  const head = await handleDownload(headRequest(), env, TOKEN);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Location'), null);
  assert.equal(env.state.used, 0);
  assert.equal((await handleDownload(request(), env, TOKEN)).status, 302);
  assert.equal(env.state.used, 1);
  assert.equal((await handleDownload(request(), env, TOKEN)).status, 410);
});

test('only GET and HEAD are accepted; other methods answer 405 and never consume the token', async () => {
  const env = makeEnv({ objects: { 'photo.jpg': fileObject() } });
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const response = await handleDownload(methodRequest(method), env, TOKEN);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  }
  assert.equal(env.state.used, 0);
  assert.equal(env.state.claimAttempts, 0);
  assert.equal(env.state.r2Gets, 0);
});

test('mixed parallel HEAD and GET requests: only one GET delivers the file, HEAD never claims', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const env = makeEnv({ getImpl: async () => { await gate; return fileObject(); } });
  env.PHOTOS.head = async () => { await gate; return fileObject(); };

  const pending = [
    handleDownload(headRequest(), env, TOKEN),
    handleDownload(request(), env, TOKEN),
    handleDownload(headRequest(), env, TOKEN),
    handleDownload(request(), env, TOKEN),
  ];
  await new Promise(resolve => setImmediate(resolve));
  release();
  const responses = await Promise.all(pending);

  // Both HEADs validate the link (200) and never claim it.
  assert.equal(responses[0].status, 200);
  assert.equal(responses[2].status, 200);
  const getStatuses = [responses[1].status, responses[3].status].sort();
  assert.deepEqual(getStatuses, [200, 410]);
  assert.equal(env.state.claimAttempts, 2);
  assert.equal(env.state.claimWins, 1);
  assert.equal(env.state.used, 1);
});
