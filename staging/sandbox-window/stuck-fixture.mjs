// Creates (and undoes) ONE controlled "paid but stuck in FULFILLING" order in the SANDBOX D1, for the
// recover-fulfillment rehearsal on the Preview. Test fixture only: not used by the app, never run in CI against the cloud.
//
//   node stuck-fixture.mjs plan    <paypalOrderId>   read-only: eligibility + the exact statements
//   node stuck-fixture.mjs create  <paypalOrderId>   applies the two statements (needs --yes-sandbox)
//   node stuck-fixture.mjs check   <paypalOrderId>   read-only: current status and token count
//   node stuck-fixture.mjs restore <paypalOrderId>   puts the order back exactly as snapshotted (needs --yes-sandbox)
//
// What it does to the chosen order, and nothing else: status COMPLETED -> FULFILLING (fulfillment_json and completed_at cleared)
// and deletes its single download token. That is exactly the state a crash between the capture and the completion leaves
// (capture id + stored token recorded, no link). The real recover-fulfillment route then has to verify the payment with PayPal
// and finish the delivery. The deleted token row (a bearer value) is kept only in a local snapshot file, never printed.
// Safety: the target database id AND name must be the Sandbox's; the production id/name are refused; the order must be a
// clean COMPLETED digital Sandbox order (no refund, no dispute, no re-issue, no audit rows, exactly one token).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ACCOUNT = '439cc74123631d21ff905817aca9785d';
export const SANDBOX = { id: '7b027b93-c548-4ceb-bbe9-42c45264fc23', name: 'amit-photos-paypal-sandbox-db' };
export const PRODUCTION = { id: '802379c7-97cf-4262-93b8-da81c5c3c07d', name: 'amit-photos-db' };

export function assertSandboxTarget(id, name) {
  if (id === PRODUCTION.id || name === PRODUCTION.name) throw new Error('refusing: this is the production database');
  if (id !== SANDBOX.id || name !== SANDBOX.name) throw new Error('refusing: not the Sandbox database');
}

// order: row of paypal_orders; tokens: rows of download_tokens that belong to it (by tx or paypal_order_ref); actions: audit rows for it.
export function eligibilityProblems({ order, tokens, actions }) {
  const problems = [];
  if (!order) return ['ORDER_NOT_FOUND'];
  if (order.order_type !== 'digital') problems.push('NOT_DIGITAL');
  if (order.status !== 'COMPLETED') problems.push('NOT_COMPLETED:' + order.status);
  if (order.after_sale_state !== 'NONE') problems.push('AFTER_SALE_STATE:' + order.after_sale_state);
  if (Number(order.dispute_open) !== 0) problems.push('DISPUTE_OPEN');
  if (Number(order.refunded_minor) !== 0) problems.push('REFUNDED');
  if (!order.paypal_capture_id || !order.fulfillment_token) problems.push('NO_CAPTURE_OR_TOKEN');
  if (tokens.length !== 1) problems.push('TOKEN_COUNT:' + tokens.length);
  else if (tokens[0].token !== order.fulfillment_token || tokens[0].tx !== order.paypal_capture_id || tokens[0].paypal_order_ref !== null) problems.push('TOKEN_NOT_THE_ORIGINAL');
  if (actions.length) problems.push('HAS_AUDIT_ROWS:' + actions.length);
  return problems;
}

export function createStatements(order) {
  return [
    { sql: "UPDATE paypal_orders SET status = 'FULFILLING', fulfillment_json = NULL, completed_at = NULL WHERE paypal_order_id = ? AND status = 'COMPLETED' AND order_type = 'digital' AND after_sale_state = 'NONE' AND dispute_open = 0 AND refunded_minor = 0", params: [order.paypal_order_id] },
    { sql: 'DELETE FROM download_tokens WHERE token = ? AND tx = ? AND paypal_order_ref IS NULL', params: [order.fulfillment_token, order.paypal_capture_id] },
  ];
}

export function restoreStatements(snapshot) {
  const t = snapshot.token; const o = snapshot.order;
  return [
    { sql: 'INSERT OR IGNORE INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params: [t.token, t.photo_ids, t.size, t.used, t.expires_at, t.created_at, t.tx, t.amount] },
    { sql: "UPDATE paypal_orders SET status = 'COMPLETED', fulfillment_json = ?, completed_at = ? WHERE paypal_order_id = ? AND status = 'FULFILLING'", params: [o.fulfillment_json, o.completed_at, o.paypal_order_id] },
  ];
}

// ---- cloud part (only when run directly) ------------------------------------------------------------------------------------
async function main() {
  const [mode, orderId] = process.argv.slice(2);
  const confirmed = process.argv.includes('--yes-sandbox');
  if (!['plan', 'create', 'check', 'restore'].includes(mode) || !/^[A-Za-z0-9_-]{8,64}$/.test(orderId || '')) {
    console.log('usage: node stuck-fixture.mjs plan|create|check|restore <paypalOrderId> [--yes-sandbox]'); process.exit(2);
  }
  const token = execFileSync('npx', ['-y', 'wrangler@4.149.0', 'auth', 'token'], { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split(/\r?\n/).map(l => l.trim()).filter(l => /^[A-Za-z0-9_.-]{20,}$/.test(l)).pop();
  const api = async (p, init = {}) => (await fetch('https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + p, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } })).json();
  const info = (await api('/d1/database/' + SANDBOX.id)).result;
  assertSandboxTarget(info?.uuid, info?.name);
  const q = async (sql, params = []) => {
    const r = await api('/d1/database/' + SANDBOX.id + '/query', { method: 'POST', body: JSON.stringify({ sql, params }) });
    if (!r.success || !r.result?.[0]?.success) throw new Error('D1: ' + (r.errors?.[0]?.message || 'query failed'));
    return r.result[0];
  };
  const load = async () => {
    const order = (await q('SELECT * FROM paypal_orders WHERE paypal_order_id = ?', [orderId])).results[0];
    const tokens = order ? (await q('SELECT * FROM download_tokens WHERE tx = ? OR paypal_order_ref = ?', [order.paypal_capture_id || '-', order.id])).results : [];
    const actions = order ? (await q('SELECT id FROM paypal_order_actions WHERE paypal_order_id = ?', [orderId])).results : [];
    return { order, tokens, actions };
  };
  const snapFile = path.join(os.tmpdir(), 'stuck-fixture-' + orderId + '.json');
  const state = await load();
  if (mode === 'check') {
    console.log(JSON.stringify({ status: state.order?.status, tokens: state.tokens.length, afterSale: state.order?.after_sale_state, snapshotFile: fs.existsSync(snapFile) }));
    return;
  }
  if (mode === 'plan' || mode === 'create') {
    const problems = eligibilityProblems(state);
    console.log('database:', info.name, '(Sandbox) | eligibility:', problems.length ? 'REFUSED ' + problems.join(', ') : 'OK');
    if (problems.length) process.exit(1);
    const statements = createStatements(state.order);
    console.log('statements (token value not shown):');
    for (const s of statements) console.log('  ', s.sql, '| params:', s.params.map((p, i) => (typeof p === 'string' && p.length > 20 ? '<' + p.slice(0, 4) + '…>' : p)).join(', '));
    if (mode === 'plan') return;
    if (!confirmed) { console.log('add --yes-sandbox to apply'); process.exit(2); }
    fs.writeFileSync(snapFile, JSON.stringify({ takenAt: new Date().toISOString(), order: state.order, token: state.tokens[0] }));
    for (const s of statements) console.log('changes:', (await q(s.sql, s.params)).meta?.changes);
    const after = await load();
    console.log('now:', after.order.status, '| tokens:', after.tokens.length, '| snapshot saved locally:', snapFile);
    return;
  }
  // restore
  if (!fs.existsSync(snapFile)) throw new Error('no snapshot file for this order');
  if (!confirmed) { console.log('add --yes-sandbox to apply'); process.exit(2); }
  const snapshot = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  if (state.order?.status !== 'FULFILLING') { console.log('order is', state.order?.status, '- nothing to restore (the recovery already completed it)'); return; }
  for (const s of restoreStatements(snapshot)) console.log('changes:', (await q(s.sql, s.params)).meta?.changes);
  const after = await load();
  console.log('now:', after.order.status, '| tokens:', after.tokens.length);
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]).replace(/\\/g, '/'))) await main();
