import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker.js';

// /api/analyses/generate with dry_run (returns the analysis, saves nothing) and /api/analyses/save (admin, validated).
// Real SQLite, fake Claude, fake R2. No network.

const ADMIN = 'test-admin-password';
const PHOTO = '1TestPhotoId_abc123';
const ctx = { waitUntil() {}, passThroughOnException() {} };

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, thumbnail TEXT, url TEXT, r2_key TEXT, description TEXT, published INTEGER DEFAULT 1, width INTEGER DEFAULT 1500);
    CREATE TABLE photo_analyses (photo_id TEXT PRIMARY KEY, composition_rule TEXT, annotations_json TEXT, camera_json TEXT, composition_html TEXT, tags_json TEXT, title TEXT, published_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, title_en TEXT, composition_html_en TEXT, camera_json_en TEXT, tags_json_en TEXT DEFAULT '[]');
    CREATE TABLE sessions (token TEXT, expires_at TEXT);
  `);
  sqlite.prepare("INSERT INTO photos (id, title, thumbnail, url, r2_key, description) VALUES (?, 'חלון כחול', '/photos/thumb/x.webp', '/photos/x.webp', 'x.jpg', 'חלון')").run(PHOTO);
  const DB = {
    prepare(sql) {
      const run = args => ({
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      });
      return { bind: (...args) => run(args), ...run([]) };
    },
  };
  const PHOTOS = { async get() { return { size: 10, httpMetadata: { contentType: 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; } };
  return { sqlite, env: { DB, PHOTOS, ADMIN_PASSWORD: ADMIN, ANTHROPIC_API_KEY: 'fake-claude-key' } };
}

const valid = (extra = {}) => ({
  photo_id: PHOTO,
  composition_rule: 'rule_of_thirds',
  composition_html: '<p><strong>חוק השליש:</strong> החלון בשליש הימני.</p><p><strong>צבע:</strong> כחול על בז\'.</p>',
  tags: ['חוק השליש', 'אדריכלות'],
  annotations: [{ x_pct: 67, y_pct: 30, label: 'קו השליש\nהימני', anchor: 'left' }],
  camera_analysis: { aperture: { value: 'f/8.0', explanation: 'חדות' }, iso: { value: '200' } },
  ...extra,
});
const call = (env, path, body, headers = { 'X-Admin-Password': ADMIN }) => worker.fetch(new Request('https://amitphotos.com' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
}), env, ctx);
const rows = sqlite => sqlite.prepare('SELECT photo_id, composition_rule, title FROM photo_analyses').all().map(r => ({ ...r }));

// ----- save ------------------------------------------------------------------------------------------------------------------

test('save: admin only; nothing is written without the admin password', async () => {
  const { sqlite, env } = setup();
  for (const headers of [{}, { 'X-Admin-Password': 'wrong' }]) {
    const res = await call(env, '/api/analyses/save', valid(), headers);
    assert.equal(res.status, 401);
  }
  assert.deepEqual(rows(sqlite), []);
});

test('save: an approved analysis is stored with the photo title and the public URL is returned', async () => {
  const { sqlite, env } = setup();
  const res = await call(env, '/api/analyses/save', valid());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, photo_id: PHOTO, learn_url: 'https://amitphotos.com/learn/' + PHOTO });
  assert.deepEqual(rows(sqlite), [{ photo_id: PHOTO, composition_rule: 'rule_of_thirds', title: 'חלון כחול' }]);
  const stored = sqlite.prepare('SELECT * FROM photo_analyses').get();
  assert.deepEqual(JSON.parse(stored.tags_json), ['חוק השליש', 'אדריכלות']);
  assert.equal(JSON.parse(stored.camera_json).iso.value, '200');
});

test('save: it replaces the earlier analysis of the same photo (the correction case) and clears the stale English columns', async () => {
  const { sqlite, env } = setup();
  sqlite.prepare("INSERT INTO photo_analyses (photo_id, composition_rule, composition_html, composition_html_en, title) VALUES (?, 'symmetry', '<p>old</p>', '<p>old en</p>', 't')").run(PHOTO);
  assert.equal((await call(env, '/api/analyses/save', valid())).status, 200);
  const stored = sqlite.prepare('SELECT composition_rule, composition_html_en FROM photo_analyses').get();
  assert.equal(stored.composition_rule, 'rule_of_thirds');
  assert.equal(stored.composition_html_en, null);
});

test('save: invalid or unsafe payloads are refused and nothing is written', async () => {
  const cases = {
    'unknown rule': valid({ composition_rule: 'golden-spiral' }),
    'script tag': valid({ composition_html: '<p>x</p><script>alert(1)</script>' }),
    'image tag': valid({ composition_html: '<p>text text text text</p><img src=x>' }),
    'attribute on an allowed tag': valid({ composition_html: '<p onclick="x()">text text text text text</p>' }),
    'link': valid({ composition_html: '<p>text <a href="https://evil.example">x</a> text text text</p>' }),
    'too short': valid({ composition_html: '<p>x</p>' }),
    'too many tags': valid({ tags: Array.from({ length: 9 }, (_, i) => 't' + i) }),
    'annotation out of range': valid({ annotations: [{ x_pct: 120, y_pct: 10, label: 'x', anchor: 'left' }] }),
    'annotation bad anchor': valid({ annotations: [{ x_pct: 10, y_pct: 10, label: 'x', anchor: 'middle' }] }),
    'camera unknown key': valid({ camera_analysis: { lens: { value: 'x' } } }),
    'camera value too long': valid({ camera_analysis: { iso: { value: 'x'.repeat(40) } } }),
    'bad photo id': valid({ photo_id: '../etc' }),
    'not an object': 'text',
  };
  for (const [label, body] of Object.entries(cases)) {
    const { sqlite, env } = setup();
    const res = await call(env, '/api/analyses/save', body);
    assert.equal(res.status, 400, label);
    assert.equal((await res.json()).error, 'ANALYSIS_INVALID', label);
    assert.deepEqual(rows(sqlite), [], label);
  }
});

test('save: an unknown photo is a 404 and nothing is written', async () => {
  const { sqlite, env } = setup();
  const res = await call(env, '/api/analyses/save', valid({ photo_id: 'NoSuchPhoto12345' }));
  assert.equal(res.status, 404);
  assert.deepEqual(rows(sqlite), []);
});

// ----- generate: dry run vs normal -------------------------------------------------------------------------------------------

function fakeClaude() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      const analysis = {
        composition_rule: 'symmetry',
        annotations: [{ x_pct: 50, y_pct: 50, label: 'x', anchor: 'top' }],
        camera_analysis: { iso: { value: '100', explanation: 'e' } },
        composition_html: '<p><strong>a:</strong> text.</p>',
        tags: ['a', 'b'],
      };
      return Response.json({ content: [{ text: JSON.stringify(analysis) }] });
    }
    return Response.json({}, { status: 404 });
  };
  return () => { globalThis.fetch = original; };
}

test('generate with dry_run returns the whole analysis and saves NOTHING (the page does not exist until it is approved)', async () => {
  const { sqlite, env } = setup();
  const restore = fakeClaude();
  try {
    const res = await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.dry_run, true);
    assert.equal(body.photo_id, PHOTO);
    assert.equal(body.composition_rule, 'symmetry');
    assert.deepEqual(body.tags, ['a', 'b']);
    assert.ok(body.annotations.length === 1 && body.camera_analysis.iso.value === '100');
    assert.deepEqual(rows(sqlite), []);
  } finally { restore(); }
});

test('generate without dry_run still saves immediately (unchanged behaviour for existing callers)', async () => {
  const { sqlite, env } = setup();
  const restore = fakeClaude();
  try {
    const res = await call(env, '/api/analyses/generate', { photo_id: PHOTO });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).dry_run, undefined);
    assert.deepEqual(rows(sqlite), [{ photo_id: PHOTO, composition_rule: 'symmetry', title: 'חלון כחול' }]);
  } finally { restore(); }
});

test('generate with dry_run is still admin only', async () => {
  const { sqlite, env } = setup();
  const res = await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true }, {});
  assert.equal(res.status, 401);
  assert.deepEqual(rows(sqlite), []);
});
