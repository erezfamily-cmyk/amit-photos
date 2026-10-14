import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { scheduledJobs, LEGACY_CRONS, LEGACY_JOBS, PAYMENT_MONITOR_CRON } from '../scheduled-routing.js';
import worker from '../worker.js';

// Which background jobs each cron trigger may start. No trigger is added anywhere by these tests.

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
// the quoted cron expressions of "crons = [...]" (an expression may itself contain commas)
const configuredCrons = toml => [...((toml.match(/^crons\s*=\s*\[([^\]]*)\]/m) || [])[1] || '').matchAll(/"([^"]*)"/g)].map(m => m[1]);
const COSTLY = ['pinterest', 'newsletter', 'welcome'];
const migration0002 = await read('../migrations/0002_paypal_security_hardening.sql');
const migration0003 = await read('../migrations/0003_after_sale_and_reissue.sql');
const DDL = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
`;

// ----- the routing table itself ----------------------------------------------------------------------------

test('the two existing triggers keep exactly the job set they always had', () => {
  assert.deepEqual(LEGACY_CRONS, ['0 */2 * * *', '0 9 1,15 * *']);
  assert.deepEqual(LEGACY_JOBS, ['pinterest', 'newsletter', 'welcome', 'linkEmailRetry', 'paymentHealth']);
  for (const cron of LEGACY_CRONS) assert.deepEqual(scheduledJobs(cron), { kind: 'legacy', jobs: LEGACY_JOBS });
  assert.notEqual(scheduledJobs(LEGACY_CRONS[0]).jobs, LEGACY_JOBS, 'callers cannot mutate the shared list');
});

test('the 15-minute trigger starts the payment health check and nothing else', () => {
  assert.equal(PAYMENT_MONITOR_CRON, '*/15 * * * *');
  assert.deepEqual(scheduledJobs(PAYMENT_MONITOR_CRON), { kind: 'payment-monitor', jobs: ['paymentHealth'] });
});

test('an unknown, edited, empty or missing trigger runs only the health check, never a costly job', () => {
  const unknown = ['*/5 * * * *', '*/10 * * * *', '* * * * *', '', ' ', undefined, null, 42, {}, [], '*/15 * * * * ', ' */15 * * * *', '*/15 * * * *\n', '0 */2 * * * ', '0 */3 * * *',
    '0 9 1,16 * *', '0 */2 * * *x', '*/15 * * * *; rm -rf /', 'pinterest', 'newsletter', '0 0 * * *', '*/15  * * * *', '*/015 * * * *'];
  for (const cron of unknown) {
    const plan = scheduledJobs(cron);
    assert.equal(plan.kind, 'unknown', JSON.stringify(cron));
    assert.deepEqual(plan.jobs, ['paymentHealth'], JSON.stringify(cron));
  }
});

test('only the two classified existing triggers can start Pinterest, the newsletter or the welcome sequence', () => {
  const samples = [...LEGACY_CRONS, PAYMENT_MONITOR_CRON, '*/1 * * * *', '0 * * * *', '30 8 * * 1', '', undefined];
  for (const cron of samples) {
    const { kind, jobs } = scheduledJobs(cron);
    const startsCostly = COSTLY.some(job => jobs.includes(job));
    assert.equal(startsCostly, kind === 'legacy', JSON.stringify(cron));
  }
});

// ----- what the Worker really starts -------------------------------------------------------------------------

function environment({ alerts = false, problem = false, secrets = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL); sqlite.exec(migration0002); sqlite.exec(migration0003);
  if (problem) {
    sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, created_at) VALUES ('o1', 'PAYPALSTUCK0001', 'digital', 'photo-1', 'large', 10000, 'ILS', 'FULFILLING', 'CAP0001', ?)")
      .run(new Date(Date.now() - 3 * 3600e3).toISOString());
  }
  const sql = [];
  const DB = {
    prepare(text) {
      sql.push(text);
      const run = args => ({
        async first() { return sqlite.prepare(text).get(...args) || null; },
        async run() { const r = sqlite.prepare(text).run(...args); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: sqlite.prepare(text).all(...args) }; },
      });
      return { bind: (...args) => run(args), ...run([]) };
    },
  };
  const env = { DB, sqlite, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret' };
  if (secrets) Object.assign(env, { PINTEREST_ACCESS_TOKEN: 'fake-pinterest', PINTEREST_APP_ID: 'x', PINTEREST_APP_SECRET: 'y', ANTHROPIC_API_KEY: 'fake-anthropic', RESEND_API_KEY: 'fake-mail', CALLMEBOT_TELEGRAM_USER: 'fake-user', ADMIN_EMAIL: 'owner@example.com' });
  if (alerts) env.PAYMENT_ALERTS_ENABLED = 'true';
  return { env, sql };
}

async function fire(cron, setup) {
  const { env, sql } = environment(setup);
  const original = globalThis.fetch;
  const hosts = [];
  globalThis.fetch = async url => { hosts.push(new URL(String(url)).host); return new Response('{}', { status: 200 }); };
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const pending = [];
  try {
    await worker.scheduled(cron === undefined ? undefined : { cron }, env, { waitUntil: promise => pending.push(promise) });
    await Promise.allSettled(pending);
  } finally { globalThis.fetch = original; console.error = originalError; }
  return { started: pending.length, hosts, sql, errors };
}
const tablesOf = sql => new Set(sql.flatMap(text => [...text.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/gi)].map(m => m[1].toLowerCase())));

test('the 15-minute trigger starts exactly one job; with alerts off it touches neither the database nor the network', async () => {
  const run = await fire(PAYMENT_MONITOR_CRON, { alerts: false });
  assert.equal(run.started, 1);
  assert.deepEqual(run.hosts, [], 'no network call at all (no Pinterest, no AI, no mail)');
  assert.deepEqual(run.sql, [], 'no database read while alerts are off');
});

test('the 15-minute trigger with alerts on reads only payment tables and calls only the alert channels, even with every other secret present', async () => {
  const run = await fire(PAYMENT_MONITOR_CRON, { alerts: true, problem: true });
  assert.equal(run.started, 1);
  const tables = tablesOf(run.sql);
  assert.ok(tables.size > 0);
  for (const table of tables) assert.match(table, /^(paypal_|download_tokens$)/, 'unexpected table ' + table);
  assert.ok(run.hosts.length > 0, 'the stuck order produced an alert');
  assert.ok(run.hosts.every(host => ['api.callmebot.com', 'api.resend.com'].includes(host)), run.hosts.join());
  for (const forbidden of ['api.pinterest.com', 'api.anthropic.com', 'api.openai.com']) assert.ok(!run.hosts.includes(forbidden), forbidden);
  const again = await fire(PAYMENT_MONITOR_CRON, { alerts: true, problem: false });
  assert.deepEqual(again.hosts, [], 'a healthy system sends nothing');
});

test('an existing trigger still starts all five jobs; both of them', async () => {
  for (const cron of LEGACY_CRONS) {
    const run = await fire(cron, { alerts: false, secrets: false });
    assert.equal(run.started, 5, cron);
    assert.deepEqual(run.errors.filter(line => line.includes('unrecognised')), [], cron);
  }
});

test('an unknown trigger starts one job, reports itself once, and never reaches Pinterest, the newsletter generator or the AI', async () => {
  for (const cron of ['*/5 * * * *', '', undefined, '0 */2 * * * ']) {
    const run = await fire(cron, { alerts: true, problem: true });
    assert.equal(run.started, 1, JSON.stringify(cron));
    assert.equal(run.errors.filter(line => line.includes('[scheduled] unrecognised cron trigger')).length, 1, JSON.stringify(cron));
    assert.ok(run.hosts.every(host => ['api.callmebot.com', 'api.resend.com'].includes(host)), JSON.stringify(cron) + ' ' + run.hosts.join());
    for (const table of tablesOf(run.sql)) assert.match(table, /^(paypal_|download_tokens$)/);
  }
});

// ----- nothing was added to the configuration -------------------------------------------------------------------

test('wrangler.toml still lists exactly the two existing triggers: no 15-minute trigger was added anywhere', async () => {
  const toml = await read('../wrangler.toml');
  assert.deepEqual(configuredCrons(toml), LEGACY_CRONS);
  assert.ok(!toml.includes(PAYMENT_MONITOR_CRON));
  const sandbox = await read('../wrangler.paypal-sandbox.example.toml');
  assert.ok(!/\[triggers\]\s*\n\s*crons/.test(sandbox) && !sandbox.includes(PAYMENT_MONITOR_CRON), 'the Sandbox Worker has no triggers');
  const builder = await read('../src/build_paypal_sandbox_config.py');
  assert.ok(!builder.includes('crons') && !builder.includes(PAYMENT_MONITOR_CRON));
  assert.match(toml, /PAYMENTS_ENABLED = "false"/);
  assert.match(toml, /DIGITAL_PAYPAL_ENABLED = "false"/);
});

test('every trigger configured in wrangler.toml is classified (so editing one cannot silently stop its jobs), and the Worker routes through the table', async () => {
  const toml = await read('../wrangler.toml');
  const configured = configuredCrons(toml);
  assert.ok(configured.length >= 2);
  for (const cron of configured) assert.notEqual(scheduledJobs(cron).kind, 'unknown', cron);
  const source = await read('../worker.js');
  const handler = source.slice(source.indexOf('async scheduled('));
  assert.match(handler, /scheduledJobs\(event\?\.cron\)/);
  assert.match(handler, /for \(const job of plan\.jobs\) ctx\.waitUntil\(runners\[job\]\(\)\)/);
  for (const job of LEGACY_JOBS) assert.match(handler.slice(0, 1400), new RegExp('\\b' + job + ':'), job + ' has a runner');
  assert.ok(!/ctx\.waitUntil\(runPinterestCronSync/.test(handler.slice(0, 1400)), 'no unconditional job start is left');
});
