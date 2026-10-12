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
