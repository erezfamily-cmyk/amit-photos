import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { assertSandboxTarget, eligibilityProblems, createStatements, restoreStatements, finishStatements, clearSwitchStatements, SWITCH_KEY, SANDBOX, PRODUCTION } from '../staging/sandbox-window/stuck-fixture.mjs';

// The Sandbox "stuck order" fixture and the helper commands for the Preview rehearsal. SQLite only: nothing here touches the cloud.

const m2 = await readFile(new URL('../migrations/0002_paypal_security_hardening.sql', import.meta.url), 'utf8');
const m3 = await readFile(new URL('../migrations/0003_after_sale_and_reissue.sql', import.meta.url), 'utf8');
const PRE = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
`;
function db() {
  const s = new DatabaseSync(':memory:');
  s.exec(PRE); s.exec(m2); s.exec(m3);
  s.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, fulfillment_token, fulfillment_json, completed_at, created_at) VALUES ('o1','ORDERFIXTURE01','digital','p','large',300,'ILS','COMPLETED','CAPFIXTURE001','tok-fixture-1','{\"url\":\"/api/download/tok-fixture-1\"}','2026-10-13T17:31:57Z','2026-10-13T17:31:37Z')").run();
  s.prepare("INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES ('tok-fixture-1','[\"p\"]','large',1,1791999117,1791912717,'CAPFIXTURE001',3)").run();
  return s;
}
const load = (s, id = 'ORDERFIXTURE01') => {
  const order = s.prepare('SELECT * FROM paypal_orders WHERE paypal_order_id = ?').get(id);
  return {
    order: order && { ...order },
    tokens: order ? s.prepare('SELECT * FROM download_tokens WHERE tx = ? OR paypal_order_ref = ?').all(order.paypal_capture_id, order.id).map(r => ({ ...r })) : [],
    actions: order ? s.prepare('SELECT id FROM paypal_order_actions WHERE paypal_order_id = ?').all(id).map(r => ({ ...r })) : [],
  };
};
const run = (s, statements) => statements.map(st => Number(s.prepare(st.sql).run(...st.params).changes));

test('a clean COMPLETED Sandbox order is eligible; create turns it into the crash state and removes only its token', () => {
  const s = db();
  const state = load(s);
  assert.deepEqual(eligibilityProblems(state), []);
  assert.deepEqual(run(s, createStatements(state.order)), [1, 1]);
  const after = load(s);
  assert.equal(after.order.status, 'FULFILLING');
  assert.equal(after.order.fulfillment_json, null);
  assert.equal(after.order.completed_at, null);
  assert.equal(after.order.paypal_capture_id, 'CAPFIXTURE001', 'capture id and token stay recorded: the exact state of an interrupted completion');
  assert.equal(after.order.fulfillment_token, 'tok-fixture-1');
  assert.deepEqual(after.tokens, []);
});

test('restore puts the order and its token back exactly as they were', () => {
  const s = db();
  const before = load(s);
  run(s, createStatements(before.order));
  assert.deepEqual(run(s, restoreStatements({ order: before.order, token: before.tokens[0] })), [1, 1]);
  assert.deepEqual(load(s), before);
  assert.deepEqual(run(s, restoreStatements({ order: before.order, token: before.tokens[0] })), [0, 0], 'a second restore is a no-op');
});

test('finish: after a recovery rewrote the token and the fulfilment fields, the originals come back; the audit rows of the test stay', () => {
  const s = db();
  const before = load(s);
  run(s, createStatements(before.order));
  // what recover-fulfillment does: re-insert the stored token (fresh timestamps, unused), flip the order, write an audit row
  s.prepare("INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES ('tok-fixture-1','[\"p\"]','large',0,9999999999,1800000000,'CAPFIXTURE001',3)").run();
  s.exec("UPDATE paypal_orders SET status = 'COMPLETED', fulfillment_json = '{\"url\":\"/api/download/tok-fixture-1\",\"x\":1}', completed_at = '2026-10-14T20:00:00Z'");
  s.exec("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, created_at) VALUES ('o1','ORDERFIXTURE01','RECOVER_FULFILLMENT','k1','DONE','admin','2026-10-14T20:00:00Z')");
  assert.deepEqual(run(s, finishStatements({ order: before.order, token: before.tokens[0] })), [1, 1]);
  const after = load(s);
  assert.deepEqual({ ...after, actions: undefined }, { ...before, actions: undefined }, 'order and token rows equal the originals');
  assert.equal(after.actions.length, 1, 'the audit row of the rehearsal is kept');
  assert.deepEqual(run(s, finishStatements({ order: before.order, token: before.tokens[0] })), [1, 1], 'idempotent');
});

test('finish does nothing to an order that is not COMPLETED', () => {
  const s = db();
  const before = load(s);
  run(s, createStatements(before.order));
  assert.equal(run(s, finishStatements({ order: before.order, token: before.tokens[0] }))[0], 0);
  assert.equal(load(s).order.status, 'FULFILLING');
});

test('clear-switch deletes only the switch row and refuses while the switch is open', () => {
  assert.throws(() => clearSwitchStatements(JSON.stringify({ state: 'open' })), /open/);
  for (const value of [JSON.stringify({ state: 'frozen' }), JSON.stringify({ state: 'closed' }), 'not json', null]) {
    const [statement] = clearSwitchStatements(value);
    assert.equal(statement.sql, 'DELETE FROM settings WHERE key = ?');
    assert.deepEqual(statement.params, [SWITCH_KEY]);
  }
  const s = new DatabaseSync(':memory:');
  s.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); INSERT INTO settings VALUES ('digital_checkout_switch','{\"state\":\"frozen\"}'), ('other_key','keep');");
  const [statement] = clearSwitchStatements('{"state":"frozen"}');
  assert.equal(Number(s.prepare(statement.sql).run(...statement.params).changes), 1);
  assert.deepEqual(s.prepare('SELECT key FROM settings').all().map(r => r.key), ['other_key']);
});

test('orders that are not clean are refused: refunded, disputed, reviewed, re-issued, audited, not completed, not digital, extra tokens', () => {
  const cases = {
    refunded: s => s.exec("UPDATE paypal_orders SET refunded_minor = 100, after_sale_state = 'REVIEW_REQUIRED'"),
    disputed: s => s.exec('UPDATE paypal_orders SET dispute_open = 1'),
    'after-sale state': s => s.exec("UPDATE paypal_orders SET after_sale_state = 'REFUNDED'"),
    'not completed': s => s.exec("UPDATE paypal_orders SET status = 'CREATED'"),
    'already stuck': s => s.exec("UPDATE paypal_orders SET status = 'FULFILLING'"),
    'not digital': s => s.exec("UPDATE paypal_orders SET order_type = 'print'"),
    'audit row': s => s.exec("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, created_at) VALUES ('o1','ORDERFIXTURE01','REISSUE','k1','DONE','admin','2026-10-13T00:00:00Z')"),
    're-issued token': s => s.exec("INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount, paypal_order_ref) VALUES ('tok-r','[]','large',0,1,1,'CAPFIXTURE001:R1',0,'o1')"),
    'no capture': s => s.exec('UPDATE paypal_orders SET paypal_capture_id = NULL'),
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const s = db(); mutate(s);
    assert.notDeepEqual(eligibilityProblems(load(s)), [], label);
  }
  assert.deepEqual(eligibilityProblems({ order: undefined, tokens: [], actions: [] }), ['ORDER_NOT_FOUND']);
});

test('the create statements carry their own guards: they change nothing on an order that is no longer clean', () => {
  const s = db();
  const state = load(s);
  s.exec("UPDATE paypal_orders SET dispute_open = 1");
  assert.deepEqual(run(s, createStatements(state.order)), [0, 1], 'the order update is refused by its WHERE; only the (already checked) token delete would run');
  const s2 = db();
  s2.exec("UPDATE paypal_orders SET status = 'FULFILLING'");
  assert.equal(run(s2, createStatements(load(s2).order))[0], 0);
});

test('the target guard accepts only the Sandbox database and refuses production by id or by name', () => {
  assert.doesNotThrow(() => assertSandboxTarget(SANDBOX.id, SANDBOX.name));
  assert.throws(() => assertSandboxTarget(PRODUCTION.id, SANDBOX.name), /production/);
  assert.throws(() => assertSandboxTarget(SANDBOX.id, PRODUCTION.name), /production/);
  assert.throws(() => assertSandboxTarget('00000000-0000-0000-0000-000000000000', 'anything'), /not the Sandbox/);
  assert.throws(() => assertSandboxTarget(undefined, undefined), /not the Sandbox/);
});

test('window-tools recover command: one admin POST to the recovery route with exactly paypalOrderId and reason, no capture id, no database access', async () => {
  const tool = await readFile(new URL('../staging/sandbox-window/window-tools.ps1', import.meta.url), 'utf8');
  const start = tool.indexOf("'recover' {");
  const end = tool.indexOf("'testalert' {");
  assert.ok(start > 0 && end > start);
  const branch = tool.slice(start, end).split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
  assert.deepEqual([...new Set(branch.match(/\/api\/[A-Za-z0-9\/_-]+/g))], ['/api/admin/paypal/recover-fulfillment']);
  assert.ok(/@\{ paypalOrderId = \$p\[1\]; reason = [^}]*\}/.test(branch) && !/capture/i.test(branch.replace(/recover-fulfillment/g, '')), 'body is only the order id and a reason');
  assert.ok(branch.includes("Send 'POST'") && branch.includes('$true $p[2]'));
  assert.ok(!/wrangler|d1 |INSERT|UPDATE|DELETE|sqlite|settings/i.test(branch));
  assert.ok(tool.includes('recover ORDERID KEY | switch'), 'documented in the command list');
  assert.match(tool, /\$Base = 'https:\/\/feature-digital-checkout-preparation-amit-photos-paypal-sandbox\.erez-family\.workers\.dev'/);
});

test('the fixture script is Sandbox-only by construction and prints no token values', async () => {
  const source = await readFile(new URL('../staging/sandbox-window/stuck-fixture.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('assertSandboxTarget(info?.uuid, info?.name)'), 'the target is verified from the API before any query');
  assert.ok(!/console\.log\([^)]*(tokens\[0\]|\.token\b|fulfillment_token|snapshot\.)/.test(source), 'no console output of token fields');
  assert.ok(source.includes("p.length > 20 ? '<'"), 'long parameter values (real tokens are 36 characters) are masked in the statement preview');
  assert.ok(source.includes('--yes-sandbox'));
});
