import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker, { handlePing } from '../worker.js';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');

function d1(sqlite) {
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      let args = [];
      const api = {
        bind(...values) { args = values; return api; },
        async first() { return stmt.get(...args) ?? null; },
        async run() { stmt.run(...args); return { meta: { changes: 1 } }; },
        async all() { return { results: stmt.all(...args) }; },
      };
      return api;
    },
  };
}
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ping = (env, method = 'GET') => worker.fetch(new Request('https://amitphotos.com/api/ping', { method }), env, ctx);

// ----- GET /api/ping ---------------------------------------------------------------------------------------------------------

test('ping: healthy database answers 200 {"ok":true} and nothing else, through the real router, uncached', async () => {
  const env = { DB: d1(new DatabaseSync(':memory:')), ADMIN_PASSWORD: 'x-secret-admin', RESEND_API_KEY: 'x-secret-mail' };
  const res = await ping(env);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, '{"ok":true}');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.match(res.headers.get('Content-Type'), /application\/json/);
  for (const secret of ['x-secret-admin', 'x-secret-mail']) assert.ok(!text.includes(secret));
});

test('ping: any database failure is a bare 503 {"ok":false}: no error text, no stack, no binding or table names', async () => {
  const leaks = 'SQLITE_ERROR: no such table: paypal_orders at D1_ERROR internal-binding-DB';
  const failing = { DB: { prepare() { return { first() { return Promise.reject(new Error(leaks)); } }; } } };
  const throwing = { DB: { prepare() { throw new Error(leaks); } } };
  for (const env of [failing, throwing, {}, { DB: null }]) {
    const res = await ping(env);
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.equal(text, '{"ok":false}');
    for (const word of ['SQLITE', 'paypal_orders', 'D1_ERROR', 'binding', 'Error', 'stack']) assert.ok(!text.includes(word), word);
  }
});

test('ping: a database that never answers is a 503 after the timeout, not a hang', async () => {
  const hanging = { DB: { prepare() { return { first() { return new Promise(() => {}); } }; } } };
  const started = Date.now();
  const res = await ping(hanging);
  assert.equal(res.status, 503);
  assert.equal(await res.text(), '{"ok":false}');
  assert.ok(Date.now() - started < 6000, 'bounded by the 3 s timeout');
});

test('ping: read-only by construction: only GET/HEAD, exactly one SELECT 1, no other statement ever prepared', async () => {
  const seen = [];
  const sqlite = new DatabaseSync(':memory:');
  const inner = d1(sqlite);
  const env = { DB: { prepare(sql) { seen.push(sql); return inner.prepare(sql); } } };
  assert.equal((await ping(env)).status, 200);
  const head = await ping(env, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '', 'HEAD has no body');
  assert.deepEqual(seen, ['SELECT 1 AS ok', 'SELECT 1 AS ok']);
  seen.length = 0;
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await ping(env, method);
    assert.equal(res.status, 405, method);
  }
  assert.deepEqual(seen, [], 'a write method never reaches the database');
  const source = await read('../worker.js');
  const body = source.slice(source.indexOf('async function handlePing'), source.indexOf('export {', source.indexOf('async function handlePing')));
  assert.ok(!/INSERT|UPDATE|DELETE|DROP|fetch\(|env\.[A-Z_]+_(KEY|SECRET|PASSWORD)/i.test(body), 'the probe body has no write, no outbound call, no secret');
});

test('ping: needs no password, no cookie and no query; extra input is ignored; the payment flags and the D1 switch are not read', async () => {
  const seen = [];
  const inner = d1(new DatabaseSync(':memory:'));
  const env = { DB: { prepare(sql) { seen.push(sql); return inner.prepare(sql); } }, PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false' };
  const res = await worker.fetch(new Request('https://amitphotos.com/api/ping?x=<script>&photoId=1', { headers: { Cookie: 'a=b' } }), env, ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['SELECT 1 AS ok']);
});

test('handlePing is exported and both payment flags stay false (the cron list is asserted per branch in scheduled-routing.test.mjs)', async () => {
  assert.equal(typeof handlePing, 'function');
  const toml = await read('../wrangler.toml');
  assert.match(toml, /PAYMENTS_ENABLED = "false"/);
  assert.match(toml, /DIGITAL_PAYPAL_ENABLED = "false"/);
});

// ----- helper tool: the switch command -----------------------------------------------------------------------------------------

test('window-tools switch command: goes only through the existing admin route, never touches the database, stays Preview-only', async () => {
  const tool = await read('../staging/sandbox-window/window-tools.ps1');
  const start = tool.indexOf("'switch' {");
  const end = tool.indexOf("'testalert' {");
  assert.ok(start > 0 && end > start);
  const branch = tool.slice(start, end);
  assert.deepEqual([...new Set(branch.match(/\/api\/[A-Za-z0-9\/_-]+/g))], ['/api/admin/paypal/switch']);
  assert.ok(!/wrangler|d1 |INSERT|UPDATE|DELETE|sqlite|settings/i.test(branch), 'no direct database access');
  assert.ok(/Send 'GET'/.test(branch) && /Send 'POST'/.test(branch));
  assert.ok(/\$admin|\$true \$p\[2\]|\$true \$null/.test(branch) || branch.includes('$true'), 'sent as admin');
  assert.ok(/Idempotency|\$p\[2\]/.test(branch), 'the idempotency key is passed');
  assert.match(tool, /\$Base = 'https:\/\/feature-digital-checkout-preparation-amit-photos-paypal-sandbox\.erez-family\.workers\.dev'/);
  assert.ok(!/amitphotos\.com/.test(tool.replace(/#.*$/gm, '')), 'no production host in the tool');
  assert.ok(tool.includes('switch open|closed|frozen KEY'), 'documented in the command list');
});

test('window-tools switch command: validates state, key and open arguments locally before any request', async () => {
  const tool = await read('../staging/sandbox-window/window-tools.ps1');
  const branch = tool.slice(tool.indexOf("'switch' {"), tool.indexOf("'testalert' {"));
  const order = ['State must be open, closed or frozen', 'idempotency KEY', 'open needs:', "Send 'POST'"].map(marker => branch.indexOf(marker));
  assert.ok(order.every(position => position > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'all local checks come before the POST');
});
