import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

// Regression (1.11.2026): a location created from the admin had no English fields until someone
// clicked "Generate English", so the English site showed Hebrew text for it.

test('create location also writes the English fields', async () => {
  const updates = [];
  const env = {
    ADMIN_PASSWORD: 'pw',
    ANTHROPIC_API_KEY: 'k',
    DB: {
      prepare(sql) {
        return {
          bind: (...args) => ({
            first: async () => (/SELECT \* FROM locations/.test(sql) ? { id: args[0], title: 'מקום בדיקה', region: '', related_guides: '[]', extra_links: '[]' } : null),
            all: async () => ({ results: [] }),
            run: async () => { updates.push({ sql, args }); return { success: true }; },
          }),
          first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }),
        };
      },
    },
  };
  const payload = {
    description: 'תיאור', best_time: 'בוקר', equipment: 'חצובה', my_tip: 'טיפ', coordinates: '31.0,34.0', related_guides: [],
    title_en: 'Test Place', description_en: 'A test place', best_time_en: 'Morning', equipment_en: 'Tripod', my_tip_en: 'Tip',
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ text: JSON.stringify(payload) }] }), { status: 200 });
  try {
    const res = await worker.fetch(new Request('https://amitphotos.com/api/admin/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Password': 'pw' },
      body: JSON.stringify({ title: 'מקום בדיקה', region: 'צפון' }),
    }), env, { waitUntil() {} });
    assert.equal(res.status, 201);
  } finally {
    globalThis.fetch = realFetch;
  }
  const en = updates.find(u => /title_en = \?/.test(u.sql));
  assert.ok(en, 'expected an UPDATE of the English fields');
  assert.equal(en.args[0], 'Test Place');
});
