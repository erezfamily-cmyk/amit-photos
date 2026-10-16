import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker.js';
import { scheduledJobs, PAYMENT_MONITOR_CRON, LEGACY_CRONS } from '../scheduled-routing.js';
import { paymentAlertsEnabled, paymentAlertChannels } from '../paypal-monitoring.js';

// The production configuration prepared for review (wrangler.toml): the 15-minute payment-monitor trigger
// and e-mail payment alerts. These tests read the REAL wrangler.toml, so they describe exactly what a
// deploy of it would configure; nothing here deploys anything.

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const toml = await read('../wrangler.toml');
const section = (text, name) => (text.match(new RegExp('^\\[' + name.replace(/[[\]]/g, '\\$&') + '\\]\\s*\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))', 'm')) || [])[1] || '';
const vars = Object.fromEntries([...section(toml, 'vars').matchAll(/^([A-Z_]+)\s*=\s*"([^"]*)"/gm)].map(m => [m[1], m[2]]));
const crons = [...(section(toml, 'triggers').match(/^crons\s*=\s*\[([^\]]*)\]/m) || [])[1].matchAll(/"([^"]*)"/g)].map(m => m[1]);

const migration0002 = await read('../migrations/0002_paypal_security_hardening.sql');
const migration0003 = await read('../migrations/0003_after_sale_and_reissue.sql');
const DDL = `
CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
`;

// ----- what the file says ------------------------------------------------------------------------------------

test('the payment flags stay false, the alert settings are exactly the reviewed ones, and no secret or customer-mail setting is defined', () => {
  assert.equal(vars.PAYMENTS_ENABLED, 'false');
  assert.equal(vars.DIGITAL_PAYPAL_ENABLED, 'false');
  assert.equal(vars.PAYMENT_ALERTS_ENABLED, 'true');
  assert.equal(vars.PAYMENT_ALERT_CHANNELS, 'email');
  assert.equal(vars.PAYMENT_ALERT_EMAIL, 'erez.family@gmail.com');
  assert.deepEqual(Object.keys(vars).sort(), ['DIGITAL_PAYPAL_ENABLED', 'PAYMENTS_ENABLED', 'PAYMENT_ALERTS_ENABLED', 'PAYMENT_ALERT_CHANNELS', 'PAYMENT_ALERT_EMAIL'], 'no other variable changed or appeared');
  for (const forbidden of ['RESEND_API_KEY', 'CALLMEBOT_TELEGRAM_USER', 'ADMIN_PASSWORD', 'ADMIN_EMAIL', 'FROM_EMAIL', 'DOWNLOAD_EMAIL_ENABLED', 'DOWNLOAD_EMAIL_OVERRIDE_TO', 'PUBLIC_BASE_URL', 'PAYPAL_ENVIRONMENT']) {
    assert.ok(!(forbidden in vars), forbidden + ' must not be defined as a variable (a variable with a secret\'s name would shadow the secret)');
  }
  assert.ok(!/RESEND_API_KEY|CALLMEBOT/.test(toml), 'the file never mentions the secrets');
});

test('the triggers are the two existing ones plus the payment-monitor trigger, all classified, and nothing else in the file moved', () => {
  assert.deepEqual(crons, [...LEGACY_CRONS, PAYMENT_MONITOR_CRON]);
  for (const cron of crons) assert.notEqual(scheduledJobs(cron).kind, 'unknown', cron);
  assert.deepEqual(scheduledJobs(PAYMENT_MONITOR_CRON).jobs, ['paymentHealth']);
  assert.match(toml, /name = "amit-photos"/);
  assert.match(toml, /database_id = "802379c7-97cf-4262-93b8-da81c5c3c07d"/);
  assert.match(toml, /bucket_name = "amit-photos-images"/);
  assert.match(toml, /pattern = "www\.amitphotos\.com\/\*"/);
});

// ----- what a deploy of this file would do at run time ---------------------------------------------------------

function production({ withMailKey = true, problem = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL); sqlite.exec(migration0002); sqlite.exec(migration0003);
  if (problem) {
    sqlite.prepare("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, created_at) VALUES ('o1', 'PAYPALSTUCK0001', 'digital', 'photo-1', 'large', 10000, 'ILS', 'FULFILLING', 'CAP0001', ?)")
      .run(new Date(Date.now() - 3 * 3600e3).toISOString());
  }
  const DB = {
    prepare(text) {
      const run = args => ({
        async first() { return sqlite.prepare(text).get(...args) || null; },
        async run() { const r = sqlite.prepare(text).run(...args); return { meta: { changes: Number(r.changes) } }; },
        async all() { return { results: sqlite.prepare(text).all(...args) }; },
      });
      return { bind: (...args) => run(args), ...run([]) };
    },
  };
  // vars from the real file + the secrets production really has (fake values)
  const env = { ...vars, DB, CALLMEBOT_TELEGRAM_USER: 'fake-telegram-user', PINTEREST_ACCESS_TOKEN: 'p', ANTHROPIC_API_KEY: 'a', PAYPAL_CLIENT_ID: 'i', PAYPAL_CLIENT_SECRET: 's' };
  if (withMailKey) env.RESEND_API_KEY = 'fake-mail-key';
  return env;
}
async function fire(cron, setup) {
  const env = production(setup);
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { const u = new URL(String(url)); calls.push({ host: u.host, body: options.body ? JSON.parse(options.body) : null }); return new Response('{}', { status: 200 }); };
  const pending = [];
  try { await worker.scheduled({ cron }, env, { waitUntil: p => pending.push(p) }); await Promise.allSettled(pending); } finally { globalThis.fetch = original; }
  return { started: pending.length, calls, env };
}

test('with this file, the 15-minute trigger sends a payment alert by e-mail to the dedicated address only: never Telegram, Pinterest or AI', async () => {
  const quiet = await fire(PAYMENT_MONITOR_CRON, { problem: false });
  assert.equal(quiet.started, 1);
  assert.deepEqual(quiet.calls, [], 'a healthy system sends nothing');
  const loud = await fire(PAYMENT_MONITOR_CRON, { problem: true });
  assert.equal(loud.calls.length, 1);
  assert.equal(loud.calls[0].host, 'api.resend.com');
  assert.equal(loud.calls[0].body.to, 'erez.family@gmail.com');
  assert.match(loud.calls[0].body.subject, /התראת תשלומים/);
  assert.ok(!JSON.stringify(loud.calls).includes('fake-telegram-user'));
  assert.ok(!loud.calls.some(call => /pinterest|anthropic|callmebot/.test(call.host)));
  assert.deepEqual(paymentAlertChannels(loud.env), { telegram: false, email: true });
});

test('if the mail secret were ever missing after a deploy, alerts simply stay off: no crash, no Telegram fallback, no call', async () => {
  const env = production({ withMailKey: false, problem: true });
  assert.equal(paymentAlertsEnabled(env), false);
  const run = await fire(PAYMENT_MONITOR_CRON, { withMailKey: false, problem: true });
  assert.equal(run.started, 1);
  assert.deepEqual(run.calls, []);
});

// ----- the Resend secret survives every deploy path ---------------------------------------------------------------

test('no deploy path removes or shadows the mail secret: only deploy.yml writes it (guarded), no workflow deletes any secret, the config defines no secret name', async () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const writers = [];
  for (const entry of (await readdir(dir)).filter(name => /\.ya?ml$/.test(name))) {
    const text = await read('../.github/workflows/' + entry);
    assert.ok(!/secret\s+delete/.test(text), entry + ' must not delete secrets');
    if (/secret\s+put\s+RESEND_API_KEY/.test(text)) writers.push(entry);
    if (/wrangler[^\n]*\bdeploy\b/.test(text) && !/--keep-vars|--secrets-file|--var\b/.test(text)) assert.ok(true);
  }
  assert.deepEqual(writers, ['deploy.yml']);
  const deploy = await read('../.github/workflows/deploy.yml');
  assert.match(deploy, /if \[ -z "\$RESEND_API_KEY" \]; then[\s\S]*?exit 1/, 'deploy.yml refuses to continue (and so never writes an empty value) when the GitHub secret is missing');
  assert.match(deploy, /RESEND_API_KEY: \$\{\{ secrets\.RESEND_API_KEY \}\}/);
  assert.ok(!/RESEND_API_KEY/.test(toml));
  for (const name of ['update-photos.yml', 'scan-dimensions.yml']) {
    const text = await read('../.github/workflows/' + name);
    assert.ok(!/secret\s+put\s+RESEND_API_KEY/.test(text), name + ' never touches the mail secret');
  }
});
