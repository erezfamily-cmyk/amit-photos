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

test('generate-en response carries every English field for the editor', async () => {
  const payload = { title_en: 'T', description_en: 'D', best_time_en: 'B', equipment_en: 'E', my_tip_en: 'M',
    when_to_visit_en: { summer: { rating: 'ok', note: 'n' } }, recommended_gear_en: [{ name: 'Tripod', primary: true }] };
  const env = { ADMIN_PASSWORD: 'pw', ANTHROPIC_API_KEY: 'k',
    DB: { prepare: () => ({ bind: () => ({ first: async () => ({ id: 'x', title: 'א', region: '' }), run: async () => ({}) }) }) } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ text: JSON.stringify(payload) }] }), { status: 200 });
  try {
    const res = await worker.fetch(new Request('https://amitphotos.com/api/admin/locations/x/generate-en', {
      method: 'POST', headers: { 'X-Admin-Password': 'pw' } }), env, { waitUntil() {} });
    assert.equal(res.status, 200);
    const d = await res.json();
    for (const k of ['title_en', 'description_en', 'best_time_en', 'equipment_en', 'my_tip_en']) assert.ok(d[k], k);
    assert.ok(JSON.parse(d.when_to_visit_en).summer);
    assert.equal(JSON.parse(d.recommended_gear_en)[0].name, 'Tripod');
  } finally { globalThis.fetch = realFetch; }
});
