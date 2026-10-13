import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// Local rehearsal of migrations/0002_paypal_security_hardening.sql against the
// PRODUCTION-SHAPED schema (pre-0002). It never touches Cloudflare: it builds an
// in-memory SQLite database from the DDL pinned below, which was read from the
// production D1 `amit-photos-db` (sqlite_master) on 2026-10-13, applies the real
// migration file, and checks shape, data safety, re-run behaviour and rollback.
//
// LIMIT: this is a LOCAL SQLite rehearsal only. It proves nothing about Cloudflare
// D1 itself: not that `wrangler d1 execute --file` is atomic, not what a mid-file
// failure leaves behind on D1, not D1's support for DROP COLUMN, and not Time
// Travel recovery. Those still need remote verification on a throwaway D1 (see
// docs/paypal-d1-migration-0002-plan-2026-10-13.md, section 3). The explicit
// BEGIN/ROLLBACK below demonstrates SQLite semantics, not D1 behaviour.

const migration = await readFile(new URL('../migrations/0002_paypal_security_hardening.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../staging/rollback-0002-paypal-security-hardening.sql', import.meta.url), 'utf8');
const sandboxBootstrap = await readFile(new URL('../staging/paypal-sandbox-bootstrap.sql', import.meta.url), 'utf8');

const PRODUCTION_PRE_0002_DDL = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE INDEX idx_paypal_orders_status ON paypal_orders(status);
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
`;

const PAYPAL_OBJECTS = ['paypal_orders', 'paypal_webhook_events', 'paypal_rate_limits'];

function productionShapedDb({ withSyntheticRows = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(PRODUCTION_PRE_0002_DDL);
  if (withSyntheticRows) {
    db.exec(`
      INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount)
        VALUES ('legacy-token-1', '["p1"]', 'small', 0, 9999999999, 1, 'LEGACYTX1', 19.0);
      INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at)
        VALUES ('o1', 'SYNTHORDER0001', 'digital', 'p1', 'small', 1900, 'ILS', 'COMPLETED', '2026-10-01T00:00:00Z');
      INSERT INTO paypal_webhook_events (event_id, event_type, received_at, processed)
        VALUES ('WH-SYNTH-1', 'PAYMENT.CAPTURE.COMPLETED', '2026-10-01T00:00:01Z', 1);
    `);
  }
  return db;
}

function shape(db, tables) {
  const out = {};
  for (const table of tables) {
    const cols = db.prepare('PRAGMA table_info(' + table + ')').all();
    out[table] = cols.map(c => [c.name, c.type, c.notnull, c.dflt_value, c.pk].join('|')).sort();
  }
  return out;
}

function indexNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => row.name);
}

test('0002 applies to the production-shaped schema and adds exactly the expected objects', () => {
  const db = productionShapedDb();
  const before = indexNames(db);
  db.exec(migration);

  const orderCols = shape(db, ['paypal_orders']).paypal_orders;
  // Array.join renders a NULL default as an empty string: name|type|notnull|default|pk.
  assert.ok(orderCols.includes('client_idempotency_key|TEXT|0||0'));
  const eventCols = shape(db, ['paypal_webhook_events']).paypal_webhook_events;
  assert.ok(eventCols.includes('processing_started_at|TEXT|0||0'));
  assert.ok(eventCols.includes('attempts|INTEGER|1|0|0'));
  assert.equal(db.prepare('PRAGMA table_info(paypal_rate_limits)').all().length, 4);

  const added = indexNames(db).filter(name => !before.includes(name));
  assert.deepEqual(added, ['idx_paypal_orders_client_idempotency', 'idx_paypal_rate_limits_window']);
});

test('0002 keeps existing rows and gives the new columns safe defaults', () => {
  const db = productionShapedDb({ withSyntheticRows: true });
  db.exec(migration);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 1);
  assert.equal(db.prepare('SELECT client_idempotency_key AS k FROM paypal_orders').get().k, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM paypal_webhook_events').get().n, 1);
  const event = db.prepare('SELECT processed, processing_started_at AS started, attempts FROM paypal_webhook_events').get();
  assert.equal(event.processed, 1);
  assert.equal(event.started, null);
  assert.equal(event.attempts, 0);
  // Legacy download tokens are untouched.
  assert.equal(db.prepare("SELECT used FROM download_tokens WHERE token = 'legacy-token-1'").get().used, 0);
});

test('the idempotency index allows many NULL keys and rejects a duplicate key', () => {
  const db = productionShapedDb();
  db.exec(migration);
  const insert = db.prepare(
    "INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, amount_expected, currency, created_at, client_idempotency_key) VALUES (?, ?, 'digital', 'p', 100, 'ILS', 't', ?)"
  );
  insert.run('a', 'ORDERAAAAAAA', null);
  insert.run('b', 'ORDERBBBBBBB', null);
  insert.run('c', 'ORDERCCCCCCC', 'key-1');
  assert.throws(() => insert.run('d', 'ORDERDDDDDDD', 'key-1'), /UNIQUE/);
});

test('after 0002 the PayPal tables match the Sandbox bootstrap (the schema E2E ran on)', () => {
  const prod = productionShapedDb();
  prod.exec(migration);
  const sandbox = new DatabaseSync(':memory:');
  sandbox.exec(sandboxBootstrap);
  assert.deepEqual(shape(prod, PAYPAL_OBJECTS), shape(sandbox, PAYPAL_OBJECTS));
});

test('0002 is not re-runnable: a second run fails and a transaction leaves the schema unchanged', () => {
  const db = productionShapedDb();
  db.exec(migration);
  const afterFirst = { shape: shape(db, PAYPAL_OBJECTS), indexes: indexNames(db) };

  assert.throws(() => db.exec(migration), /duplicate column name/);

  // Running the file inside a transaction and rolling back on failure must not leave a partial state.
  let failed = false;
  try {
    db.exec('BEGIN');
    db.exec(migration);
    db.exec('COMMIT');
  } catch {
    failed = true;
    db.exec('ROLLBACK');
  }
  assert.equal(failed, true);
  assert.deepEqual({ shape: shape(db, PAYPAL_OBJECTS), indexes: indexNames(db) }, afterFirst);
});

test('the rollback file restores the pre-0002 shape and keeps the data', () => {
  const db = productionShapedDb({ withSyntheticRows: true });
  const before = { shape: shape(db, PAYPAL_OBJECTS.slice(0, 2)), indexes: indexNames(db) };

  db.exec(migration);
  db.exec(rollback);

  assert.deepEqual({ shape: shape(db, PAYPAL_OBJECTS.slice(0, 2)), indexes: indexNames(db) }, before);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'paypal_rate_limits'").all().length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM paypal_webhook_events').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM download_tokens').get().n, 1);
});

test('the rollback file is outside migrations/ so a migrations apply can never run it', () => {
  assert.match(rollback, /DO NOT RUN without explicit owner approval/);
  assert.match(rollback, /NOT a migration/);
});
