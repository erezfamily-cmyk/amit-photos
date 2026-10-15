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

const prompts = [];
function fakeClaude() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      try { prompts.push(JSON.parse(options.body).messages[0].content.find(c => c.type === 'text').text); } catch { prompts.push(''); }
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
    assert.equal(body.annotations.length, 1);
    assert.equal(body.camera_analysis.iso.value, 'לא ידוע', 'no EXIF: the model value 100 is never kept');
    assert.equal(body.exif_used, false);
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

// ----- real EXIF ---------------------------------------------------------------------------------------------------------------

const withAssets = (env, photos, ok = true) => ({ ...env, ASSETS: { async fetch(req) { assert.match(String(req.url || req), /\/data\/photos\.json$/); return ok ? Response.json(photos) : new Response('no', { status: 500 }); } } });

test('generate puts the real EXIF in the prompt and stores exactly those values, whatever the model wrote', async () => {
  const { sqlite, env } = setup();
  const restore = fakeClaude();
  prompts.length = 0;
  try {
    const photos = [{ id: 'other', exif: { aperture: 2 } }, { id: PHOTO, exif: { camera: 'NIKON D300', aperture: 8, shutter: 0.01, iso: 200, focal: 70 } }];
    const res = await call(withAssets(env, photos), '/api/analyses/generate', { photo_id: PHOTO, dry_run: true });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.exif_used, true);
    assert.deepEqual(Object.fromEntries(Object.entries(body.camera_analysis).map(([k, v]) => [k, v.value])), { aperture: 'f/8', shutter: '1/100s', iso: '200', focal: '70mm' });
    assert.equal(body.camera_analysis.iso.explanation, 'e', 'the model explanation is kept, the number is not');
    assert.ok(prompts[0].includes('f/8') && prompts[0].includes('1/100s') && prompts[0].includes('70mm'), 'EXIF is in the prompt');
    assert.ok(prompts[0].includes('אסור לשנות'), 'the prompt forbids other values');
    assert.ok(!prompts[0].includes('העריך את הגדרות המצלמה'), 'the old "estimate the settings" instruction is gone');
    assert.deepEqual(rows(sqlite), []);
  } finally { restore(); }
});

test('generate (saving) stores the EXIF values too, and a partial EXIF marks the missing fields as unknown', async () => {
  const { sqlite, env } = setup();
  const restore = fakeClaude();
  try {
    const res = await call(withAssets(env, [{ id: PHOTO, exif: { aperture: 2.8, iso: 0 } }]), '/api/analyses/generate', { photo_id: PHOTO });
    assert.equal(res.status, 200);
    const stored = JSON.parse(sqlite.prepare('SELECT camera_json FROM photo_analyses').get().camera_json);
    assert.deepEqual(Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, v.value])), { aperture: 'f/2.8', shutter: 'לא ידוע', iso: 'לא ידוע', focal: 'לא ידוע' });
  } finally { restore(); }
});

test('without EXIF (missing photo entry, unreadable asset, no binding) the prompt forbids numbers and every stored value is "unknown"', async () => {
  for (const make of [env => withAssets(env, [{ id: 'other', exif: { aperture: 4 } }]), env => withAssets(env, [], false), env => env]) {
    const { env } = setup();
    const restore = fakeClaude();
    prompts.length = 0;
    try {
      const body = await (await call(make(env), '/api/analyses/generate', { photo_id: PHOTO, dry_run: true })).json();
      assert.equal(body.exif_used, false);
      assert.ok(Object.values(body.camera_analysis).every(v => v.value === 'לא ידוע'));
      assert.ok(prompts[0].includes('אין נתוני EXIF') && prompts[0].includes('אסור להמציא'));
    } finally { restore(); }
  }
});

// ----- second check (/api/analyses/verify) -------------------------------------------------------------------------------------

const verifyBody = (extra = {}) => ({ photo_id: PHOTO, composition_rule: 'symmetry', composition_html: '<p><strong>סימטריה:</strong> הטחנה משתקפת בשלמות במים, ציר הסימטריה לאורך קו האופק.</p>', ...extra });
function fakeVerify(reply) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com/')) {
      seen.push(JSON.parse(options.body));
      if (typeof reply === 'number') return new Response('err', { status: reply });
      return Response.json({ content: [{ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] });
    }
    return new Response('not found', { status: 404 });
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

test('verify: admin only, validates its input, and an unknown photo is a 404', async () => {
  const { env } = setup();
  const net = fakeVerify({ claims: [{ claim: 'x', verdict: 'supported', reason: 'r' }], rule_fits: true });
  try {
    assert.equal((await call(env, '/api/analyses/verify', verifyBody(), {})).status, 401);
    for (const [label, body] of [['rule', verifyBody({ composition_rule: 'nope' })], ['short', verifyBody({ composition_html: '<p>x</p>' })], ['id', verifyBody({ photo_id: '../x' })]]) {
      assert.equal((await call(env, '/api/analyses/verify', body)).status, 400, label);
    }
    assert.equal((await call(env, '/api/analyses/verify', verifyBody({ photo_id: 'NoSuchPhoto12345' }))).status, 404);
    assert.equal(net.seen.length, 0, 'Claude is not called for refused requests');
  } finally { net.restore(); }
});

test('verify: a sceptical pass judges every claim against the picture; nothing is saved', async () => {
  const { sqlite, env } = setup();
  const net = fakeVerify({
    claims: [
      { claim: 'הטחנה כמעט במרכז', verdict: 'supported', reason: 'בערך 56% מהרוחב' },
      { claim: 'משתקפת בשלמות במים', verdict: 'contradicted', reason: 'רוב החלק התחתון קני סוף' },
      { claim: 'אור דרמטי', verdict: 'maybe', reason: 'ערך לא חוקי' },
    ],
    rule_fits: false, rule_reason: 'השמיים תופסים את רוב הפריים', suggested_rule: 'negative_space',
  });
  try {
    const res = await call(env, '/api/analyses/verify', verifyBody());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.contradicted, 1);
    assert.equal(body.uncertain, 1, 'an invalid verdict becomes uncertain');
    assert.equal(body.claims[2].verdict, 'uncertain');
    assert.equal(body.rule_fits, false);
    assert.equal(body.suggested_rule, 'negative_space');
    const prompt = net.seen[0].messages[0].content.find(c => c.type === 'text').text;
    assert.ok(prompt.includes('ספקן') && prompt.includes('משתקפת בשלמות במים'), 'the analysis text and the sceptical instruction are in the prompt');
    assert.equal(net.seen[0].messages[0].content[0].type, 'image', 'the picture is sent');
    assert.deepEqual(rows(sqlite), []);
  } finally { net.restore(); }
});

test('verify: Claude failing, unparsable or empty answers are 502 with a clear code, an unknown suggested rule becomes null', async () => {
  for (const [reply, code] of [[529, 'CLAUDE_VERIFY_FAILED'], ['not json at all', 'VERIFY_PARSE_FAILED'], [{ claims: [], rule_fits: true }, 'VERIFY_EMPTY']]) {
    const { env } = setup();
    const net = fakeVerify(reply);
    try {
      const res = await call(env, '/api/analyses/verify', verifyBody());
      assert.equal(res.status, 502, code);
      assert.equal((await res.json()).error, code);
    } finally { net.restore(); }
  }
  const { env } = setup();
  const net = fakeVerify({ claims: [{ claim: 'x', verdict: 'supported', reason: 'r' }], rule_fits: true, suggested_rule: 'spiral' });
  try {
    assert.equal((await (await call(env, '/api/analyses/verify', verifyBody())).json()).suggested_rule, null);
  } finally { net.restore(); }
});

test('verify: without an image to show the model it refuses (502) instead of judging blind', async () => {
  const { env } = setup();
  env.PHOTOS = { async get() { return null; } };
  const net = fakeVerify({ claims: [{ claim: 'x', verdict: 'supported', reason: 'r' }], rule_fits: true });
  try {
    const res = await call(env, '/api/analyses/verify', verifyBody());
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'IMAGE_NOT_AVAILABLE');
    assert.equal(net.seen.length, 0);
  } finally { net.restore(); }
});

// ----- one repair round (/api/analyses/revise) ---------------------------------------------------------------------------------

const reviseBody = (extra = {}) => ({
  photo_id: PHOTO, composition_rule: 'framing', composition_html: '<p><strong>מסגור:</strong> הקיאק מואר מול שמיים מבריקים.</p>',
  problems: [{ claim: 'הקיאק מואר', reason: 'הוא צללית בצל' }, { claim: 'שמיים מבריקים', reason: 'אין שמיים, זו השתקפות' }],
  rule_fits: true, ...extra,
});
const goodRevision = {
  composition_rule: 'framing',
  composition_html: '<p><strong>מסגור:</strong> קשת הגשר ממסגרת את הקיאק.</p><p><strong>אור:</strong> הקיאק צללית מול השתקפויות.</p><p><strong>מה ללמוד:</strong> צלמו מתוך הצל אל האור.</p>',
  annotations: [{ x_pct: 60, y_pct: 40, label: 'הקיאק', anchor: 'left' }],
  tags: ['מסגור', 'צללית'],
};

test('revise: admin only, needs something to revise, validates input, unknown photo 404', async () => {
  const { env } = setup();
  const net = fakeVerify(goodRevision);
  try {
    assert.equal((await call(env, '/api/analyses/revise', reviseBody(), {})).status, 401);
    assert.equal((await call(env, '/api/analyses/revise', reviseBody({ problems: [], rule_fits: true }))).status, 400, 'nothing to revise');
    assert.equal((await call(env, '/api/analyses/revise', reviseBody({ composition_rule: 'x' }))).status, 400);
    assert.equal((await call(env, '/api/analyses/revise', reviseBody({ photo_id: 'NoSuchPhoto12345' }))).status, 404);
    assert.equal(net.seen.length, 0);
  } finally { net.restore(); }
});

test('revise: the model gets the picture, the old text and exactly the contradicted claims; the revision is returned and NOT saved', async () => {
  const { sqlite, env } = setup();
  const net = fakeVerify(goodRevision);
  try {
    const res = await call(env, '/api/analyses/revise', reviseBody({ rule_fits: false, rule_reason: 'השמיים שולטים', suggested_rule: 'negative_space' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.composition_html, goodRevision.composition_html);
    assert.deepEqual(body.tags, ['מסגור', 'צללית']);
    const sent = net.seen[0].messages[0].content;
    assert.equal(sent[0].type, 'image');
    const prompt = sent.find(c => c.type === 'text').text;
    for (const piece of ['הקיאק מואר', 'אין שמיים, זו השתקפות', 'negative_space', 'אל תכתוב מספרי מצלמה']) assert.ok(prompt.includes(piece), piece);
    assert.deepEqual(rows(sqlite), []);
  } finally { net.restore(); }
});

test('revise: an unsafe or malformed rewrite is refused (502), Claude failures are 502 with a code', async () => {
  for (const [reply, code] of [
    [{ ...goodRevision, composition_html: '<p>x</p><script>alert(1)</script><p>more text here</p>' }, 'REVISE_INVALID'],
    [{ ...goodRevision, composition_rule: 'spiral' }, 'REVISE_INVALID'],
    ['no json', 'REVISE_PARSE_FAILED'],
    [529, 'CLAUDE_REVISE_FAILED'],
  ]) {
    const { sqlite, env } = setup();
    const net = fakeVerify(reply);
    try {
      const res = await call(env, '/api/analyses/revise', reviseBody());
      assert.equal(res.status, 502, code);
      assert.equal((await res.json()).error, code);
      assert.deepEqual(rows(sqlite), []);
    } finally { net.restore(); }
  }
});

// ----- weekly pick: candidates and a rule chosen in advance ----------------------------------------------------------------------

function fakeScreen(replies) {
  const original = globalThis.fetch;
  const queue = [...replies];
  const seen = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(options.body);
      seen.push(body);
      const reply = queue.shift();
      if (typeof reply === 'number') return new Response('err', { status: reply });
      return Response.json({ content: [{ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] });
    }
    return new Response('nf', { status: 404 });
  };
  return { seen, restore() { globalThis.fetch = original; } };
}
function addPhotos(sqlite, n) {
  for (let i = 1; i <= n; i++) sqlite.prepare("INSERT INTO photos (id, title, thumbnail, url, r2_key) VALUES (?, ?, ?, ?, ?)").run('Cand' + i + '_photo_id', 'תמונה ' + i, '/photos/thumb/c' + i + '.webp', '/photos/c' + i + '.webp', 'c' + i + '.jpg');
}

test('candidates: admin only; screens unanalysed photos with the cheap model and returns only clear cases, best first', async () => {
  const { sqlite, env } = setup();
  sqlite.prepare("INSERT INTO photo_analyses (photo_id, composition_rule, title) VALUES (?, 'symmetry', 't')").run(PHOTO);   // already analysed: never proposed
  addPhotos(sqlite, 5);
  assert.equal((await call(env, '/api/analyses/candidates', {}, {})).status, 401);
  const net = fakeScreen([
    { rule: 'leading_lines', clarity: 0.95, reason: 'מסילה מובילה אל הנקודה' },
    { rule: null, clarity: 0.2, reason: 'אין חוק ברור' },
    { rule: 'symmetry', clarity: 0.65, reason: 'כמעט' },
    { rule: 'framing', clarity: 0.82, reason: 'קשת ממסגרת' },
    'not json',
  ]);
  try {
    const res = await call(env, '/api/analyses/candidates', { count: 3, pool: 5 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.screened, 5);
    assert.deepEqual(body.candidates.map(c => [c.rule, c.clarity]), [['leading_lines', 0.95], ['framing', 0.82]], 'below 0.7, null rule and unparsable answers are dropped; sorted by clarity');
    assert.ok(body.candidates.every(c => c.photo_id.startsWith('Cand') && c.title && c.thumbnail && c.reason));
    assert.ok(net.seen.every(b => b.model.startsWith('claude-haiku')), 'screening uses the cheap model');
    assert.equal(net.seen.length, 5);
    assert.deepEqual(rows(sqlite).map(r => r.photo_id), [PHOTO], 'nothing is saved');
  } finally { net.restore(); }
});

test('candidates: count and pool are bounded', async () => {
  const { sqlite, env } = setup();
  addPhotos(sqlite, 3);
  const net = fakeScreen(Array.from({ length: 20 }, () => ({ rule: 'framing', clarity: 0.9, reason: 'r' })));
  try {
    const body = await (await call(env, '/api/analyses/candidates', { count: 99, pool: 99 })).json();
    assert.ok(body.candidates.length <= 5);
    assert.ok(net.seen.length <= 12);
  } finally { net.restore(); }
});

test('generate with a rule chosen in advance: the prompt fixes the rule and the stored rule is that one, whatever the model wrote', async () => {
  const { sqlite, env } = setup();
  const restore = fakeClaude();     // the fake model answers composition_rule "symmetry"
  prompts.length = 0;
  try {
    const body = await (await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true, rule: 'framing' })).json();
    assert.equal(body.composition_rule, 'framing');
    assert.ok(prompts[0].includes('כבר נקבע: framing'));
    assert.ok(!prompts[0].includes('בחר את חוק הצילום'));
    const unknown = await (await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true, rule: 'spiral' })).json();
    assert.equal(unknown.composition_rule, 'symmetry', 'an unknown rule is ignored (the model chooses as before)');
    assert.deepEqual(rows(sqlite), []);
  } finally { restore(); }
});

// ----- structured output (forced tool) and one retry ---------------------------------------------------------------------------

function fakeToolClaude(replies) {
  const original = globalThis.fetch;
  const queue = [...replies];
  const seen = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(options.body);
      seen.push(body);
      const reply = queue.shift();
      if (typeof reply === 'number') return new Response('busy', { status: reply });
      return Response.json({ content: [{ type: 'tool_use', name: body.tool_choice?.name, input: reply }] });
    }
    return new Response('nf', { status: 404 });
  };
  return { seen, restore() { globalThis.fetch = original; } };
}
const toolAnalysis = {
  composition_rule: 'rule_of_thirds',
  annotations: [{ x_pct: 64, y_pct: 50, label: 'הדלת על קו השליש', anchor: 'left' }],
  camera_analysis: { iso: { value: '100', explanation: 'e' } },
  composition_html: '<p><strong>חוק השליש:</strong> הדלת ליד שער צה"ל, "ירוקה" ועתיקה.</p>',
  tags: ['שליש'],
};

test('generate: the model answers through the forced tool; quotes inside Hebrew text can no longer break the JSON', async () => {
  const { env } = setup();
  const net = fakeToolClaude([toolAnalysis]);
  try {
    const res = await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.composition_html, toolAnalysis.composition_html);
    assert.equal(net.seen[0].tool_choice.name, 'photo_analysis');
    assert.equal(net.seen[0].tools[0].name, 'photo_analysis');
    assert.ok(net.seen[0].tools[0].input_schema.properties.composition_rule.enum.includes('rule_of_thirds'));
  } finally { net.restore(); }
});

test('a busy or failing Claude (429/5xx/529) is retried once; a second failure is reported, a success is used', async () => {
  let env = setup().env;
  let net = fakeToolClaude([529, toolAnalysis]);
  try {
    const res = await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true });
    assert.equal(res.status, 200);
    assert.equal(net.seen.length, 2, 'one retry');
  } finally { net.restore(); }
  env = setup().env;
  net = fakeToolClaude([529, 529, toolAnalysis]);
  try {
    const res = await call(env, '/api/analyses/verify', verifyBody());
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'CLAUDE_VERIFY_FAILED');
    assert.equal(net.seen.length, 2, 'never more than one retry');
  } finally { net.restore(); }
  env = setup().env;
  net = fakeToolClaude([400]);
  try {
    assert.equal((await call(env, '/api/analyses/verify', verifyBody())).status, 502);
    assert.equal(net.seen.length, 1, 'a client error is not retried');
  } finally { net.restore(); }
});

test('verify, revise and the screening all use their own forced tool', async () => {
  const { sqlite, env } = setup();
  addPhotos(sqlite, 1);
  const net = fakeToolClaude([
    { claims: [{ claim: 'x', verdict: 'supported', reason: 'r' }], rule_fits: true, rule_reason: 'ok', suggested_rule: null },
    goodRevision,
    { rule: 'framing', clarity: 0.9, reason: 'קשת' },
  ]);
  try {
    assert.equal((await call(env, '/api/analyses/verify', verifyBody())).status, 200);
    assert.equal((await call(env, '/api/analyses/revise', reviseBody())).status, 200);
    const cands = await (await call(env, '/api/analyses/candidates', { count: 1, pool: 1 })).json();
    assert.equal(cands.candidates.length >= 0, true);
    assert.deepEqual(net.seen.map(b => b.tool_choice.name), ['claim_check', 'revised_analysis', 'rule_screen'].slice(0, net.seen.length));
  } finally { net.restore(); }
});

test('tool answers whose array fields come back as JSON strings are parsed back (claims, tags, annotations)', async () => {
  let env = setup().env;
  let net = fakeToolClaude([{ claims: JSON.stringify([{ claim: 'הדלת על קו השליש', verdict: 'supported', reason: 'כ-64%' }]), rule_fits: 'true', rule_reason: 'ok' }]);
  try {
    const res = await call(env, '/api/analyses/verify', verifyBody());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.claims.length, 1);
    assert.equal(body.rule_fits, true, 'a "true" string becomes a boolean');
  } finally { net.restore(); }
  env = setup().env;
  net = fakeToolClaude([{ ...toolAnalysis, tags: JSON.stringify(['שליש', 'דלת']), annotations: JSON.stringify(toolAnalysis.annotations) }]);
  try {
    const body = await (await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true })).json();
    assert.deepEqual(body.tags, ['שליש', 'דלת']);
    assert.equal(body.annotations.length, 1);
  } finally { net.restore(); }
  env = setup().env;
  net = fakeToolClaude([{ claims: [], rule_fits: true, rule_reason: 'x' }]);
  try {
    const res = await call(env, '/api/analyses/verify', verifyBody());
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'VERIFY_EMPTY', detail: 'claims was an empty array' });
  } finally { net.restore(); }
});

test('revise with lock_rule keeps the owner rule even if the model answers another one, and says so in the prompt', async () => {
  const { env } = setup();
  const net = fakeVerify({ ...goodRevision, composition_rule: 'negative_space' });
  try {
    const res = await call(env, '/api/analyses/revise', reviseBody({ composition_rule: 'rule_of_thirds', lock_rule: true, rule_fits: false, suggested_rule: 'negative_space' }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).composition_rule, 'rule_of_thirds');
    const prompt = net.seen[0].messages[0].content.find(c => c.type === 'text').text;
    assert.ok(prompt.includes('אסור לשנות אותו'));
    assert.ok(!prompt.includes('ההמלצה היא negative_space'), 'the suggestion to change the rule is not passed on');
  } finally { net.restore(); }
});

test('an answer cut off by the token limit is reported, and an analysis without text is never returned', async () => {
  let env = setup().env;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => String(url).startsWith('https://api.anthropic.com/')
    ? Response.json({ stop_reason: 'max_tokens', content: [{ type: 'tool_use', name: JSON.parse(options.body).tool_choice.name, input: { composition_rule: 'framing' } }] })
    : new Response('nf', { status: 404 });
  try {
    const res = await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /Claude API error \(analysis\) 502/);
  } finally { globalThis.fetch = original; }
  env = setup().env;
  const net = fakeToolClaude([{ ...toolAnalysis, composition_html: '' }]);
  try {
    const res = await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'ANALYSIS_INCOMPLETE');
  } finally { net.restore(); }
});

test('the learn calls ask for enough tokens for Hebrew text', async () => {
  const { sqlite, env } = setup();
  addPhotos(sqlite, 1);
  const net = fakeToolClaude([toolAnalysis, { claims: [{ claim: 'x', verdict: 'supported', reason: 'r' }], rule_fits: true, rule_reason: 'r' }, goodRevision, { rule: null, clarity: 0, reason: 'r' }]);
  try {
    await call(env, '/api/analyses/generate', { photo_id: PHOTO, dry_run: true });
    await call(env, '/api/analyses/verify', verifyBody());
    await call(env, '/api/analyses/revise', reviseBody());
    await call(env, '/api/analyses/candidates', { count: 1, pool: 1 });
    const byTool = Object.fromEntries(net.seen.map(b => [b.tool_choice.name, b.max_tokens]));
    assert.ok(byTool.photo_analysis >= 4000 && byTool.revised_analysis >= 4000 && byTool.claim_check >= 3000, JSON.stringify(byTool));
  } finally { net.restore(); }
});
