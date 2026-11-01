import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

// Regression (1.11.2026): POST /api/admin/locations returned extra_links as the raw DB string "[]",
// so admin.html renderEditor crashed on `.map` and the editor stayed blank; a retry then hit 409.

function fakeEnv() {
  let row = null;
  return {
    ADMIN_PASSWORD: 'pw',
    DB: {
      prepare(sql) {
        const stmt = {
          bind: (...args) => ({
            first: async () => (/SELECT \* FROM locations/.test(sql) ? row : null),
            all: async () => ({ results: [] }),
            run: async () => {
              if (/INSERT INTO locations/.test(sql)) {
                row = { id: args[0], title: args[1], region: args[2], published: 0, created_at: args[3],
                        related_guides: '[]', extra_links: '[]' };
              }
              return { success: true };
            },
          }),
          first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }),
        };
        return stmt;
      },
    },
  };
}

test('create location returns extra_links and related_guides as arrays', async () => {
  const req = new Request('https://amitphotos.com/api/admin/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Password': 'pw' },
    body: JSON.stringify({ title: 'מקום בדיקה', region: 'צפון' }),
  });
  const res = await worker.fetch(req, fakeEnv(), { waitUntil() {} });
  assert.equal(res.status, 201);
  const loc = await res.json();
  assert.ok(Array.isArray(loc.extra_links), 'extra_links must be an array');
  assert.ok(Array.isArray(loc.related_guides), 'related_guides must be an array');
});
