import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('worker.js', 'utf8');
const start = worker.indexOf('const FLOWER_CURATION_DECISIONS_KEY =');
const end = worker.indexOf('\nexport { handleAdminCurationDecisions', start);
assert.ok(start >= 0 && end > start);
const source = worker.slice(start, end);

function makeHandler(initial) {
  let state = structuredClone(initial);
  const d1 = {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() { return { value: JSON.stringify(state) }; },
            async run() {
              if (/json_patch/i.test(sql)) {
                const patch = JSON.parse(params[1]);
                for (const [id, record] of Object.entries(patch)) {
                  if (record === null) delete state[id];
                  else state[id] = { ...(state[id] || {}), ...record };
                }
              } else {
                // Models the legacy read/replace write, which loses one of
                // two decisions if both requests read the same old value.
                state = JSON.parse(params[1]);
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  const handler = new Function('checkAuth', 'unauth', 'jsonRes', 'invalidatePublicPhotosCache',
    source + '\nreturn handleAdminCurationDecisions;')(
    async () => true,
    () => new Response('{}', { status: 401 }),
    (body, status) => new Response(JSON.stringify(body), { status }),
    async () => {},
  );
  return {
    post(photo_id, decision) {
      return handler(new Request('https://example.com/api/admin/curation-decisions', {
        method: 'POST',
        body: JSON.stringify({ photo_id, decision }),
      }), { DB: d1 });
    },
    async get() {
      const response = await handler(new Request('https://example.com/api/admin/curation-decisions'), { DB: d1 });
      return (await response.json()).decisions;
    },
  };
}

test('overlapping owner decisions do not overwrite each other after reload', async () => {
  const api = makeHandler({ older: { decision: 'HIDE' } });
  const responses = await Promise.all([
    api.post('delete-photo', 'DELETE'),
    api.post('secondary-photo', 'KEEP_SECONDARY'),
  ]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const reloaded = await api.get();
  assert.equal(reloaded.older.decision, 'HIDE');
  assert.equal(reloaded['delete-photo'].decision, 'DELETE');
  assert.equal(reloaded['secondary-photo'].decision, 'KEEP_SECONDARY');

  assert.equal((await api.post('delete-photo', '')).status, 200);
  const afterReset = await api.get();
  assert.equal(Object.hasOwn(afterReset, 'delete-photo'), false);
  assert.equal(afterReset['secondary-photo'].decision, 'KEEP_SECONDARY');
  assert.equal(afterReset.older.decision, 'HIDE');
});
