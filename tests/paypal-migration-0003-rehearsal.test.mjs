import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// LOCAL SQLite rehearsal of migrations/0003_after_sale_and_reissue.sql on top of a
// production-shaped schema (pre-0002 DDL read from production on 2026-10-13, then
// the real 0002). It never touches Cloudflare. It does NOT prove D1 behaviour
// (atomicity of `d1 execute --file`, mid-file failure, DROP COLUMN, Time Travel):
// those need the throwaway-D1 rehearsal in docs/paypal-d1-migration-0003-plan-2026-10-13.md.

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const migration0002 = await read('../migrations/0002_paypal_security_hardening.sql');
const migration0003 = await read('../migrations/0003_after_sale_and_reissue.sql');
const rollback0003 = await read('../staging/rollback-0003-after-sale-and-reissue.sql');

const PRE_0002 = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE INDEX idx_paypal_orders_status ON paypal_orders(status);
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
`;

function db({ rows = false, apply0003 = false } = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(PRE_0002);
  database.exec(migration0002);
  if (rows) {
    database.exec(`
      INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES ('legacy-token-1', '["p1"]', 'small', 0, 9999999999, 1, 'LEGACYTX1', 19.0);
      INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, created_at) VALUES ('o1', 'SYNTHORDER0001', 'digital', 'p1', 'small', 1900, 'ILS', 'COMPLETED', 'LEGACYTX1', '2026-10-01T00:00:00Z');
    `);
  }
  if (apply0003) database.exec(migration0003);
  return database;
}
const columns = (database, table) => database.prepare('PRAGMA table_info(' + table + ')').all().map(col => col.name).sort();
const indexes = database => database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);

test('0003 adds exactly the expected columns, index and table', () => {
  const before = db();
  const orderCols = columns(before, 'paypal_orders');
  const tokenCols = columns(before, 'download_tokens');
  const idxBefore = indexes(before);
  const after = db({ apply0003: true });
  assert.deepEqual(columns(after, 'paypal_orders').filter(name => !orderCols.includes(name)),
    ['after_sale_state', 'after_sale_updated_at', 'dispute_open', 'dispute_updated_at', 'refunded_minor']);
  assert.deepEqual(columns(after, 'download_tokens').filter(name => !tokenCols.includes(name)),
    ['paypal_order_ref', 'revoke_reason', 'revoked_at']);
  assert.deepEqual(indexes(after).filter(name => !idxBefore.includes(name)),
    ['idx_download_tokens_order_ref', 'idx_paypal_order_actions_order']);
  assert.ok(columns(after, 'paypal_order_actions').includes('new_token'));
  assert.ok(indexes(after).includes('idx_download_tokens_tx'), 'the unique tx index must survive');
});

test('0003 keeps existing rows and defaults them to a clean after-sale state', () => {
  const database = db({ rows: true, apply0003: true });
  const order = database.prepare("SELECT after_sale_state, dispute_open, refunded_minor, status FROM paypal_orders WHERE id = 'o1'").get();
  assert.deepEqual({ ...order }, { after_sale_state: 'NONE', dispute_open: 0, refunded_minor: 0, status: 'COMPLETED' });
  const token = database.prepare("SELECT used, paypal_order_ref, revoked_at FROM download_tokens WHERE token = 'legacy-token-1'").get();
  assert.deepEqual({ ...token }, { used: 0, paypal_order_ref: null, revoked_at: null });
});

test('the audit table rejects a repeated (order, action, request id) and keeps tx unique for re-issued links', () => {
  const database = db({ apply0003: true });
  const insert = database.prepare("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, created_at) VALUES ('o1', 'P1', 'REISSUE', 'req-1', 'STARTED', 'admin', 'now')");
  insert.run();
  assert.throws(() => insert.run(), /UNIQUE/);
  const token = tx => database.prepare("INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at) VALUES (?, '[]', 'large', ?, 0, 1, 1)").run('t-' + tx, tx);
  token('CAP1:R1');
  assert.throws(() => token('CAP1:R1'), /UNIQUE/);
  token('CAP1:R2');
});

test('0003 is not re-runnable, and a failed run inside a transaction leaves nothing behind', () => {
  const database = db({ apply0003: true });
  assert.throws(() => database.exec(migration0003), /duplicate column name/);
  const fresh = db();
  const before = columns(fresh, 'paypal_orders').join();
  fresh.exec('BEGIN');
  try { fresh.exec(migration0003 + '\nSELECT * FROM table_that_does_not_exist;'); } catch {}
  fresh.exec('ROLLBACK');
  assert.equal(columns(fresh, 'paypal_orders').join(), before);
});

test('the rollback restores the pre-0003 shape and keeps orders and tokens (revoked ones stay unusable)', () => {
  const reference = db({ rows: true });
  const database = db({ rows: true, apply0003: true });
  database.exec("UPDATE download_tokens SET used = 2, revoked_at = 5, revoke_reason = 'REFUNDED' WHERE token = 'legacy-token-1'");
  database.exec(rollback0003);
  for (const table of ['paypal_orders', 'download_tokens']) assert.deepEqual(columns(database, table), columns(reference, table));
  assert.deepEqual(indexes(database), indexes(reference));
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'paypal_order_actions'").get().n, 0);
  assert.equal(database.prepare("SELECT used FROM download_tokens WHERE token = 'legacy-token-1'").get().used, 2);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM paypal_orders').get().n, 1);
});

test('the rollback file lives outside migrations/ so a migrations apply can never run it', () => {
  assert.ok(!/migrations\//.test('staging/rollback-0003-after-sale-and-reissue.sql'));
  assert.match(rollback0003, /DESTRUCTIVE/);
});
