import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// The Sandbox D1 is created from staging/paypal-sandbox-bootstrap.sql. Its
// photos table once lacked columns the public gallery query reads, so the
// Sandbox Worker threw "no such column" (Cloudflare error 1101) on every
// home-page load. These tests run the real queries from worker.js against a
// database built from the bootstrap file.

const bootstrap = await readFile(new URL('../staging/paypal-sandbox-bootstrap.sql', import.meta.url), 'utf8');
const worker = await readFile(new URL('../worker.js', import.meta.url), 'utf8');

// Pull the exact SQL strings out of worker.js so this test cannot drift from it.
function extractSql(pattern, label) {
  const match = worker.match(pattern);
  assert.ok(match, 'could not find the ' + label + ' query in worker.js');
  return match[1];
}

const FULL_GALLERY_SQL = extractSql(
  /'(SELECT [*] FROM photos WHERE published=1 ORDER BY [^']+)'/,
  'public gallery (SELECT *)'
);
const SLIM_GALLERY_SQL = extractSql(
  /'(SELECT id, title, category, thumbnail, redbubble_url, redbubble_products, zazzle_products FROM photos WHERE published=1 ORDER BY [^']+)'/,
  'slim gallery'
);

const GALLERY_COLUMNS = ['sort_order', 'redbubble_url', 'redbubble_products', 'zazzle_products'];

function bootstrappedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(bootstrap);
  return db;
}

test('a database built from the Sandbox bootstrap serves the public gallery queries', () => {
  const db = bootstrappedDb();
  const full = db.prepare(FULL_GALLERY_SQL).all();
  const slim = db.prepare(SLIM_GALLERY_SQL).all();

  assert.equal(full.length, 1);
  assert.equal(full[0].id, 'paypal-sandbox-test-photo');
  assert.equal(slim.length, 1);
  assert.equal(slim[0].id, 'paypal-sandbox-test-photo');
});

test('gallery columns are nullable with no default, matching production', () => {
  const db = bootstrappedDb();
  const columns = new Map(db.prepare('PRAGMA table_info(photos)').all().map(col => [col.name, col]));

  for (const name of GALLERY_COLUMNS) {
    const col = columns.get(name);
    assert.ok(col, 'photos is missing column ' + name);
    assert.equal(col.notnull, 0, name + ' must be nullable');
    assert.equal(col.dflt_value, null, name + ' must have no default');
  }
  assert.equal(columns.get('sort_order').type, 'INTEGER');
  for (const name of ['redbubble_url', 'redbubble_products', 'zazzle_products']) {
    assert.equal(columns.get(name).type, 'TEXT');
  }
});

test('the old minimal photos table fails the public query (regression guard)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT \'\', category TEXT NOT NULL DEFAULT \'\', ' +
    'description TEXT NOT NULL DEFAULT \'\', filename TEXT NOT NULL DEFAULT \'\', r2_key TEXT NOT NULL DEFAULT \'\', ' +
    'url TEXT NOT NULL DEFAULT \'\', thumbnail TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL, ' +
    'published INTEGER NOT NULL DEFAULT 1, price_overrides TEXT DEFAULT NULL)'
  );
  assert.throws(() => db.prepare(FULL_GALLERY_SQL).all(), /no such column: sort_order/);
  assert.throws(() => db.prepare(SLIM_GALLERY_SQL).all(), /no such column/);
});

test('the bootstrap stays Sandbox-only and keeps its production guard', () => {
  assert.match(bootstrap, /NEVER RUN AGAINST amit-photos-db/);
  assert.equal(bootstrap.includes('802379c7-97cf-4262-93b8-da81c5c3c07d'), false);
});
