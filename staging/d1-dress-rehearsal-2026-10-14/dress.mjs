// Dress rehearsal of production migrations 0002 + 0003 on an ISOLATED TEMPORARY D1 (owner-approved 14.10.2026).
// Synthetic rows only. Evidence tool: not used by the app or by CI.
//   node dress.mjs <stage>      stages: create | baseline | m0002 | m0003 | behaviour | rollback | restore | delete | status
// Safety: the database id is read from a local state file and compared with the production and Sandbox ids before
// EVERY call; wrangler is always run from a temporary directory holding a config that lists only this database
// (never from the repository, whose wrangler.toml binds production). Credentials: `wrangler auth token`, in memory only.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ACCOUNT = '439cc74123631d21ff905817aca9785d';
const FORBIDDEN = ['802379c7-97cf-4262-93b8-da81c5c3c07d', '7b027b93-c548-4ceb-bbe9-42c45264fc23'];
const FORBIDDEN_NAMES = ['amit-photos-db', 'amit-photos-paypal-sandbox-db'];
const NAME = 'amit-migration-dress-20261014';
const WRANGLER = 'wrangler@4.149.0';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = process.env.REPO || path.resolve(here, '..', '..');
const work = path.join(os.tmpdir(), 'dress-rehearsal-20261014');
const stateFile = path.join(work, 'state.json');
fs.mkdirSync(work, { recursive: true });
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
const realFetch = globalThis.fetch;
let token;
const getToken = () => token ||= execFileSync('npx', ['-y', WRANGLER, 'auth', 'token'], { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split(/\r?\n/).map(l => l.trim()).filter(l => /^[A-Za-z0-9_.-]{20,}$/.test(l)).pop();
const guard = () => {
  if (!state.id || !/^[0-9a-f-]{36}$/.test(state.id) || FORBIDDEN.includes(state.id)) throw new Error('refusing: no valid throwaway database id');
  if (state.name !== NAME || FORBIDDEN_NAMES.includes(state.name)) throw new Error('refusing: wrong database name');
};
export async function query(sql, params = []) {
  guard();
  const r = await realFetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${state.id}/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }),
  });
  const body = await r.json();
  if (!body.success || !body.result?.[0]?.success) throw new Error('D1: ' + (body.errors?.[0]?.message || 'query failed'));
  return body.result[0];
}
async function snapshot() {
  const schema = (await query("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")).results;
  const counts = {}; const hash = crypto.createHash('sha256');
  for (const row of schema.filter(r => /^CREATE TABLE/i.test(r.sql || ''))) {
    const rows = (await query('SELECT * FROM ' + row.name + ' ORDER BY 1')).results;
    counts[row.name] = rows.length; hash.update(row.name + JSON.stringify(rows));
  }
  return { schema: schema.map(r => r.name + ':' + crypto.createHash('sha256').update(r.sql || '').digest('hex').slice(0, 8)), counts, dataHash: hash.digest('hex').slice(0, 16) };
}
async function oldHash() {
  const h = crypto.createHash('sha256');
  for (const [table, cols] of Object.entries(state.baseCols)) h.update(table + JSON.stringify((await query('SELECT ' + cols.join(', ') + ' FROM ' + table + ' ORDER BY 1')).results));
  return h.digest('hex').slice(0, 16);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); return ok; };

function writeConfig() {
  guard();
  fs.writeFileSync(path.join(work, 'wrangler.toml'), `name = "dress-rehearsal"\ncompatibility_date = "2026-01-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${NAME}"\ndatabase_id = "${state.id}"\n`);
}
function wr(args, { allowFail = false } = {}) {
  const t0 = Date.now();
  try {
    const out = execFileSync('npx', ['-y', WRANGLER, ...args], { cwd: work, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 });
    return { ok: true, out, ms: Date.now() - t0 };
  } catch (e) {
    if (!allowFail) throw e;
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || ''), ms: Date.now() - t0 };
  }
}
const execFile = (file, opts) => { writeConfig(); guard(); return wr(['d1', 'execute', NAME, '--remote', '--yes', '--config', path.join(work, 'wrangler.toml'), '--file', file], opts); };
const sqlOf = rel => path.join(REPO, rel);
const read = rel => fs.readFileSync(sqlOf(rel), 'utf8');

async function cols(table) { return (await query(`SELECT name, type, "notnull" AS nn, dflt_value AS d, pk FROM pragma_table_info('${table}')`)).results; }
const has = (list, name, type, nn, d) => list.some(c => c.name === name && c.type === type && c.nn === nn && (d === undefined || String(c.d) === d));
async function objects() { return Object.fromEntries((await query("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")).results.map(r => [r.name, r.sql])); }

async function v2() {
  const o = await cols('paypal_orders'); const w = await cols('paypal_webhook_events'); const r = await cols('paypal_rate_limits'); const obj = await objects();
  check('V2 paypal_orders.client_idempotency_key TEXT nullable', has(o, 'client_idempotency_key', 'TEXT', 0));
  check('V2 paypal_webhook_events.processing_started_at TEXT', has(w, 'processing_started_at', 'TEXT', 0));
  check('V2 paypal_webhook_events.attempts INTEGER NOT NULL DEFAULT 0', has(w, 'attempts', 'INTEGER', 1, '0'));
  check('V2 paypal_rate_limits has 4 columns and the 3-column primary key', r.length === 4 && r.filter(c => c.pk > 0).length === 3);
  check('V2 partial unique idempotency index and rate-limit index exist', /UNIQUE/i.test(obj.idx_paypal_orders_client_idempotency || '') && /WHERE/i.test(obj.idx_paypal_orders_client_idempotency || '') && !!obj.idx_paypal_rate_limits_window);
  check('V2 earlier indexes untouched (tx unique partial, status)', /UNIQUE/i.test(obj.idx_download_tokens_tx || '') && !!obj.idx_paypal_orders_status);
}
async function v3() {
  const o = await cols('paypal_orders'); const t = await cols('download_tokens'); const a = await cols('paypal_order_actions'); const obj = await objects();
  check('V3 paypal_orders review columns with defaults', has(o, 'after_sale_state', 'TEXT', 1, "'NONE'") && has(o, 'dispute_open', 'INTEGER', 1, '0') && has(o, 'dispute_updated_at', 'TEXT', 0) && has(o, 'refunded_minor', 'INTEGER', 1, '0') && has(o, 'after_sale_updated_at', 'TEXT', 0));
  check('V3 download_tokens new columns', has(t, 'paypal_order_ref', 'TEXT', 0) && has(t, 'revoked_at', 'INTEGER', 0) && has(t, 'revoke_reason', 'TEXT', 0));
  check('V3 paypal_order_actions has 12 columns and the unique triple', a.length === 12 && /UNIQUE\s*\(order_ref, action, request_id\)/i.test(obj.paypal_order_actions || ''));
  check('V3 indexes exist and tx stays UNIQUE partial', !!obj.idx_download_tokens_order_ref && !!obj.idx_paypal_order_actions_order && /UNIQUE/i.test(obj.idx_download_tokens_tx || ''));
  const old = (await query("SELECT COUNT(*) AS n FROM download_tokens WHERE paypal_order_ref IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL")).results[0].n;
  const all = (await query('SELECT COUNT(*) AS n FROM download_tokens')).results[0].n;
  check('V3 existing tokens untouched, new columns NULL', old === all && all === state.seedTokens, `${old}/${all}`);
  const dflt = (await query("SELECT COUNT(*) AS n FROM paypal_orders WHERE after_sale_state = 'NONE' AND dispute_open = 0 AND refunded_minor = 0")).results[0].n;
  check('V3 existing orders default to NONE/0/0', dflt === (await query('SELECT COUNT(*) AS n FROM paypal_orders')).results[0].n);
}

const stage = process.argv[2];
if (stage === 'create') {
  if (state.id) throw new Error('state already holds a database: ' + state.id);
  const before = JSON.parse(wr(['d1', 'list', '--json']).out.slice(wr(['d1', 'list', '--json']).out.indexOf('[')));
  const out = wr(['d1', 'create', NAME]).out;
  const id = (out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
  if (!id || FORBIDDEN.includes(id)) throw new Error('unexpected id');
  state.id = id; state.name = NAME; state.createdAt = new Date().toISOString(); state.listBefore = before.map(d => d.name); save();
  console.log('created', NAME, id, 'databases before:', state.listBefore.join(', '));
} else if (stage === 'baseline') {
  guard();
  const pre = read('staging/d1-rehearsal-0003/pre0002.sql');
  const seedTokens = 8;
  // Production-like counts: 8 legacy tokens, PayPal tables empty; plus three synthetic orders (COMPLETED/CREATED/FULFILLING) to prove old rows survive.
  let seed = read('staging/d1-rehearsal-0003/seed.sql');
  for (let i = 4; i <= seedTokens; i++) seed += `INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES ('tok-synth-x${i}','["photo-1"]','small',0,9999999999,${i},NULL,19);\n`;
  fs.writeFileSync(path.join(work, 'pre.sql'), pre); fs.writeFileSync(path.join(work, 'seed.sql'), seed);
  check('pre-0002 DDL applied', execFile(path.join(work, 'pre.sql')).ok);
  check('seed applied', execFile(path.join(work, 'seed.sql')).ok);
  const snap = await snapshot(); state.seedTokens = snap.counts.download_tokens; state.baseline = snap;
  state.baseCols = {}; for (const t of ['download_tokens', 'paypal_orders', 'paypal_webhook_events', 'photos']) state.baseCols[t] = (await cols(t)).map(c => c.name);
  state.baseOldHash = await oldHash(); save();
  console.log(JSON.stringify(snap));
  check('baseline is pre-0002 (no 0002/0003 objects)', !snap.schema.some(s => /paypal_rate_limits|paypal_order_actions/.test(s)));
} else if (stage === 'm0002') {
  guard();
  const real = sqlOf('migrations/0002_paypal_security_hardening.sql');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex');
  check('0002 checksum matches the plan', sha === 'f0d99d379be565cc659bec0b8dc75406b81343df69a7f5007a5afa8436c32054', sha.slice(0, 12));
  // failure drill: runtime error after statements 1-4
  const lines = fs.readFileSync(real, 'utf8').split(/\r?\n/);
  const cut = lines.findIndex(l => l.startsWith('CREATE INDEX IF NOT EXISTS idx_paypal_rate_limits_window')) + 1;
  fs.writeFileSync(path.join(work, 'broken0002.sql'), [...lines.slice(0, cut + 1), 'INSERT INTO no_such_table_here VALUES (1);', ...lines.slice(cut + 1)].join('\n'));
  const base = state.baseline;
  const failed = execFile(path.join(work, 'broken0002.sql'), { allowFail: true });
  check('0002 failure drill: command fails', !failed.ok, 'no such table in output: ' + /no such table/i.test(failed.out));
  check('0002 failure drill: nothing left behind (schema, counts, checksum identical)', same(await snapshot(), base));
  const run = execFile(real);
  check('0002 clean run', run.ok, run.ms + ' ms wall');
  await v2();
  const after = await snapshot(); state.after0002 = after; save();
  check('0002 left every pre-existing row and column value unchanged (hash over the original columns)', (await oldHash()) === state.baseOldHash);
  const again = execFile(real, { allowFail: true });
  check('0002 re-run is refused with duplicate column name', !again.ok && /duplicate column name/i.test(again.out));
  check('0002 re-run changed nothing', same(await snapshot(), after));
} else if (stage === 'm0003') {
  guard();
  const real = sqlOf('migrations/0003_after_sale_and_reissue.sql');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex');
  check('0003 checksum matches the plan', sha === 'a3e317e528711fb2cedeb73c95feeeaf65ce5e042b17ecb576525f9c816e3a68', sha.slice(0, 12));
  const lines = fs.readFileSync(real, 'utf8').split(/\r?\n/);
  const idx = lines.findIndex(l => l.startsWith('ALTER TABLE download_tokens ADD COLUMN paypal_order_ref'));
  fs.writeFileSync(path.join(work, 'broken0003.sql'), [...lines.slice(0, idx + 1), 'INSERT INTO no_such_table_here VALUES (1);', ...lines.slice(idx + 1)].join('\n'));
  const base = state.after0002;
  const failed = execFile(path.join(work, 'broken0003.sql'), { allowFail: true });
  check('0003 failure drill: command fails', !failed.ok);
  check('0003 failure drill: nothing left behind (schema, counts, checksum identical)', same(await snapshot(), base));
  const run = execFile(real);
  check('0003 clean run', run.ok, run.ms + ' ms wall');
  await v3();
  const after = await snapshot(); state.after0003 = after; save();
  check('0003 left every pre-existing row and column value unchanged (hash over the original columns), audit table empty', (await oldHash()) === state.baseOldHash && after.counts.paypal_order_actions === 0);
  const again = execFile(real, { allowFail: true });
  check('0003 re-run is refused with duplicate column name', !again.ok && /duplicate column name/i.test(again.out));
  check('0003 re-run changed nothing', same(await snapshot(), after));
  // bookmark for the restore drill
  const info = JSON.parse((() => { const o = wr(['d1', 'time-travel', 'info', NAME, '--config', path.join(work, 'wrangler.toml'), '--json']).out; return o.slice(o.indexOf('{')); })());
  state.bookmarkAfter0003 = info.bookmark; save();
  check('time travel bookmark recorded after 0003', !!info.bookmark);
} else if (stage === 'behaviour') {
  guard();
  // Real handlers (recover-fulfillment, finalize guards, dispute event handler, reissue) against the real temporary D1; PayPal and mail stubbed.
  const mod = await import('file:///' + REPO.replace(/\\/g, '/') + '/paypal-orders.js');
  const DB = { prepare(sql) { const make = args => ({ async first() { return (await query(sql, args)).results[0] || null; }, async run() { const r = await query(sql, args); return { meta: { changes: r.meta?.changes ?? 0 } }; }, async all() { return { results: (await query(sql, args)).results }; } }); return { bind: (...a) => make(a), ...make([]) }; } };
  const env = { DB, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id', PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false' };
  const net = { calls: [], mails: 0, lookup: {} };
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.resend.com') { net.mails++; return Response.json({ id: 'x' }); }
    if (u.hostname !== 'api-m.sandbox.paypal.com') return realFetch(url, options);
    net.calls.push((options.method || 'GET') + ' ' + u.pathname);
    if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
    if (u.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
    const m = u.pathname.match(/^\/v2\/checkout\/orders\/(DRORDER\d+)$/);
    if (m) { const n = m[1].slice(7); const cap = { id: 'DRCAP' + n, status: 'COMPLETED', custom_id: 'dr-local-' + n, amount: { currency_code: 'ILS', value: '100.00' }, ...(net.lookup.capture || {}) };
      return Response.json({ id: m[1], status: 'COMPLETED', payer: { email_address: 'payer@example.com' }, purchase_units: [{ custom_id: 'dr-local-' + n, payments: { captures: [cap] } }] }); }
    return Response.json({}, { status: 404 });
  };
  let seq = 0;
  const mk = async (status = 'FULFILLING') => { const n = String(Date.now() % 1e8) + String(++seq).padStart(3, '0');
    await query("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, fulfillment_token, created_at) VALUES (?, ?, 'digital', 'photo-1', 'large', 10000, 'ILS', ?, ?, ?, '2026-10-01T00:00:00Z')", ['dr-local-' + n, 'DRORDER' + n, status, 'DRCAP' + n, 'dr-tok-' + n]);
    return { n, orderId: 'DRORDER' + n, local: 'dr-local-' + n, capture: 'DRCAP' + n, token: 'dr-tok-' + n }; };
  const row = async o => (await query('SELECT status, after_sale_state AS s, dispute_open AS d FROM paypal_orders WHERE id = ?', [o.local])).results[0];
  const toks = async o => (await query('SELECT used, revoke_reason AS why FROM download_tokens WHERE tx = ?', [o.capture])).results;
  const recover = (o, key) => mod.handlePayPalRecoverFulfillment(new Request('https://amitphotos.com/api/admin/paypal/recover-fulfillment', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ paypalOrderId: o.orderId, reason: 'dress rehearsal' }) }), env);
  const hook = async (e) => (await mod.handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', { method: 'POST', body: JSON.stringify(e), headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't' + Math.random(), 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': 't' } }), env)).status;
  const dispute = (o, kind = 'CREATED', at = '2026-10-14T12:00:00Z') => ({ id: 'WH-DR-' + Math.random().toString(36).slice(2), event_type: 'CUSTOMER.DISPUTE.' + kind, create_time: at, resource: { dispute_id: 'PP-D-1', status: kind === 'RESOLVED' ? 'RESOLVED' : 'OPEN', update_time: at, disputed_transactions: [{ seller_transaction_id: o.capture }] } });
  const completed = o => ({ id: 'WH-DC-' + Math.random().toString(36).slice(2), event_type: 'PAYMENT.CAPTURE.COMPLETED', create_time: '2026-10-14T10:00:00.000Z', resource: { id: o.capture, status: 'COMPLETED', custom_id: o.local, amount: { currency_code: 'ILS', value: '100.00' }, links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + o.capture }], supplementary_data: { related_ids: { order_id: o.orderId } } } });
  const review = (o, key, decision) => mod.handlePayPalAfterSaleReview(new Request('https://amitphotos.com/api/admin/paypal/after-sale-review', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ paypalOrderId: o.orderId, decision, reason: 'dress rehearsal' }) }), env);
  const tag = Date.now().toString(36);

  // 1 happy path
  let o = await mk(); let r = await recover(o, 'dr-' + tag + '-a001');
  check('recover: stuck FULFILLING order completes on real D1', r.status === 200 && (await row(o)).status === 'COMPLETED', 'http ' + r.status);
  check('recover: exactly the stored token, unused', JSON.stringify(await toks(o)) === JSON.stringify([{ used: 0, why: null }]));
  check('recover: only read-only PayPal calls (oauth + GET order), no capture', net.calls.every(c => c === 'POST /v1/oauth2/token' || c.startsWith('GET /v2/checkout/orders/')) && !net.calls.some(c => /capture$/.test(c)), net.calls.slice(-2).join(' | '));
  const replay = await recover(o, 'dr-' + tag + '-a001'); check('recover: same key replays', (await replay.json()).replayed === true);
  // 2 PayPal says not verified
  net.lookup.capture = { amount: { currency_code: 'ILS', value: '99.00' } }; o = await mk(); r = await recover(o, 'dr-' + tag + '-b001'); net.lookup = {};
  check('recover: amount mismatch refused, nothing minted', r.status === 409 && (await row(o)).status === 'FULFILLING' && (await toks(o)).length === 0);
  // 3 known dispute blocks both paths
  o = await mk(); await query("UPDATE paypal_orders SET dispute_open = 1, after_sale_state = 'REVIEW_REQUIRED' WHERE id = ?", [o.local]);
  r = await recover(o, 'dr-' + tag + '-c001'); const ws = await hook(completed(o));
  check('known dispute blocks recovery (409) and the completion webhook (409); nothing minted', r.status === 409 && ws === 409 && (await toks(o)).length === 0 && (await row(o)).status === 'FULFILLING', `${r.status}/${ws}`);
  // 4 guarded insert on real D1: dispute recorded, then the guarded INSERT must write nothing
  o = await mk(); await query("UPDATE paypal_orders SET dispute_open = 1, after_sale_state = 'REVIEW_REQUIRED' WHERE id = ?", [o.local]);
  const ins = await query("INSERT OR IGNORE INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) SELECT ?, '[]', 'large', ?, 0, 9999999999, 1, 100 WHERE EXISTS (SELECT 1 FROM paypal_orders WHERE id = ? AND after_sale_state = 'NONE' AND dispute_open = 0)", [o.token, o.capture, o.local]);
  check('D1 accepts the guarded INSERT … SELECT … WHERE EXISTS and writes 0 rows when a dispute is recorded', (ins.meta?.changes ?? 0) === 0 && (await toks(o)).length === 0);
  const upd = await query("UPDATE paypal_orders SET status='COMPLETED' WHERE paypal_order_id = ? AND status='FULFILLING' AND after_sale_state = 'NONE' AND dispute_open = 0", [o.orderId]);
  check('D1: guarded completion UPDATE changes 0 rows under a dispute', (upd.meta?.changes ?? 0) === 0);
  // 5 crash-like: token minted, dispute event arrives -> undelivered token withdrawn; release -> same token back -> completes once
  o = await mk(); await query("INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES (?, '[\"photo-1\"]', 'large', 0, 9999999999, 1, ?, 100)", [o.token, o.capture]);
  const ds = await hook(dispute(o)); const afterEvent = await toks(o);
  check('dispute event withdraws the undelivered token on real D1', ds === 200 && afterEvent.length === 1 && afterEvent[0].used === 2 && afterEvent[0].why === 'REVIEW_BEFORE_DELIVERY', JSON.stringify(afterEvent));
  r = await recover(o, 'dr-' + tag + '-e001'); check('recover refused while under review', r.status === 409);
  await hook(dispute(o, 'RESOLVED', '2026-10-14T13:00:00Z')); const rel = await review(o, 'dr-' + tag + '-e002', 'release');
  r = await recover(o, 'dr-' + tag + '-e003'); const fin = await toks(o);
  check('after release the SAME link is restored and the order completes once', rel.status === 200 && r.status === 200 && (await row(o)).status === 'COMPLETED' && fin.length === 1 && fin[0].used === 0, `release ${rel.status}, recover ${r.status}`);
  // 6 delivered, then dispute: link untouched (policy)
  o = await mk(); await recover(o, 'dr-' + tag + '-f001'); await hook(dispute(o));
  const post = await toks(o); check('dispute after delivery leaves the delivered link to a person (policy)', post.length === 1 && post[0].used === 0 && (await row(o)).s === 'REVIEW_REQUIRED');
  // 7 concurrency: 6 parallel keys, webhook + recovery together -> one token
  o = await mk(); const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(i => recover(o, 'dr-' + tag + '-g00' + i)));
  const ok200 = (await Promise.all(rs.map(x => x.clone().json()))).filter(b => b.ok && b.replayed === false).length;
  check('6 parallel recoveries on real D1: one completes, one token', ok200 === 1 && (await toks(o)).length === 1 && (await row(o)).status === 'COMPLETED', `completed=${ok200}`);
  o = await mk(); const [a, b] = await Promise.all([recover(o, 'dr-' + tag + '-h001'), hook(completed(o))]);
  check('recovery and completion webhook racing on real D1: one token, completed', (await toks(o)).length === 1 && (await row(o)).status === 'COMPLETED', `${a.status}/${b}`);
  // 8 undelivered-revoke statement with the status subquery
  o = await mk('COMPLETED'); await query("INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES (?, '[]', 'large', 0, 9999999999, 1, ?, 100)", [o.token, o.capture]);
  const rv = await query("UPDATE download_tokens SET used = 2, revoked_at = 1, revoke_reason = 'X' WHERE used = 0 AND (paypal_order_ref = ? OR tx = ?) AND EXISTS (SELECT 1 FROM paypal_orders WHERE id = ? AND status <> 'COMPLETED')", [o.local, o.capture, o.local]);
  check('D1: revoke-undelivered statement skips a COMPLETED order', (rv.meta?.changes ?? 0) === 0);
  check('mails sent during the whole behaviour run: none (mail is not configured)', net.mails === 0);
  globalThis.fetch = realFetch;
} else if (stage === 'rollback') {
  guard();
  state.bookmarkBeforeRollback = JSON.parse((() => { const o = wr(['d1', 'time-travel', 'info', NAME, '--config', path.join(work, 'wrangler.toml'), '--json']).out; return o.slice(o.indexOf('{')); })()).bookmark; save();
  state.snapBeforeRollback = await snapshot(); save();
  const r3 = execFile(sqlOf('staging/rollback-0003-after-sale-and-reissue.sql'));
  check('rollback 0003 accepted by D1 (DROP COLUMN)', r3.ok, r3.ms + ' ms');
  const obj = await objects(); const oc = await cols('paypal_orders'); const tc = await cols('download_tokens');
  check('rollback 0003 removed the 8 columns, the table and the indexes; tx index kept', !obj.paypal_order_actions && !oc.some(c => c.name === 'after_sale_state') && !tc.some(c => c.name === 'revoke_reason') && !!obj.idx_download_tokens_tx);
  const r2 = execFile(sqlOf('staging/rollback-0002-paypal-security-hardening.sql'));
  check('rollback 0002 accepted by D1', r2.ok, r2.ms + ' ms');
  const obj2 = await objects();
  check('rollback 0002 restored the pre-0002 shape', !obj2.paypal_rate_limits && !(await cols('paypal_orders')).some(c => c.name === 'client_idempotency_key'));
  check('orders and tokens remain after both rollbacks (rows kept)', (await query('SELECT COUNT(*) AS n FROM paypal_orders')).results[0].n >= 3 && (await query('SELECT COUNT(*) AS n FROM download_tokens')).results[0].n >= state.seedTokens);
} else if (stage === 'restore') {
  guard();
  const cfg = path.join(work, 'wrangler.toml');
  await query("INSERT INTO photos (id, title, r2_key) VALUES ('marker-after-rollback', 'marker', 'm.jpg')");
  const preRestore = await snapshot();
  const rs = wr(['d1', 'time-travel', 'restore', NAME, '--config', cfg, '--bookmark', state.bookmarkBeforeRollback], { allowFail: true });
  check('time travel restore to the pre-rollback bookmark', rs.ok, rs.ms + ' ms wall');
  const now = await snapshot();
  check('restore returned schema and data identical to the pre-rollback snapshot (marker discarded)', same(now.schema, state.snapBeforeRollback.schema) && now.dataHash === state.snapBeforeRollback.dataHash);
  console.log('restore output (no data):', rs.out.replace(/\s+/g, ' ').slice(0, 400));
  const marks = [...new Set(rs.out.match(/[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}/g) || [])].filter(m => m !== state.bookmarkBeforeRollback);
  state.previousBookmark = marks[0] || null; save();
  check('previous_bookmark available for undo', !!state.previousBookmark, state.previousBookmark ? 'present' : 'missing');
  if (state.previousBookmark) {
    const un = wr(['d1', 'time-travel', 'restore', NAME, '--config', cfg, '--bookmark', state.previousBookmark], { allowFail: true });
    const back = await snapshot();
    check('undo of the restore brings back the rolled-back state including the marker', un.ok && same(back.schema, preRestore.schema) && back.dataHash === preRestore.dataHash, un.ms + ' ms wall');
  }
} else if (stage === 'delete') {
  guard();
  const del = wr(['d1', 'delete', NAME, '--skip-confirmation', '--config', path.join(work, 'wrangler.toml')], { allowFail: true });
  const list = JSON.parse(wr(['d1', 'list', '--json']).out.replace(/^[^[]*/, '')).map(d => d.name).sort();
  check('temporary database deleted', del.ok && !list.includes(NAME), del.out.replace(/\s+/g, ' ').slice(0, 120));
  check('account lists only production and Sandbox databases', same(list, ['amit-photos-db', 'amit-photos-paypal-sandbox-db']), list.join(', '));
  state.deletedAt = new Date().toISOString(); save();
} else if (stage === 'status') {
  console.log(JSON.stringify({ ...state, baseline: undefined, after0002: undefined, after0003: undefined, snapBeforeRollback: undefined }));
} else {
  console.log('usage: node dress.mjs create|baseline|m0002|m0003|behaviour|rollback|restore|delete|status');
}
if (results.length) { const fails = results.filter(r => !r.ok).length; console.log(`\n${stage}: ${results.length - fails}/${results.length} passed`); process.exitCode = fails ? 1 : 0; }
