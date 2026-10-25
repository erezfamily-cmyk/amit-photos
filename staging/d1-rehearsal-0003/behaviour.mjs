// Runs the REAL handlers from the repo against the throwaway D1 (via the D1 REST API).
// PayPal is stubbed with fake ids; the D1 connection is real, so concurrency is real.
import { DB, query, dbName, DB_ID } from './d1lib.mjs';
import path from 'node:path';
const repo = process.env.REPO;
const { handlePayPalWebhook, handlePayPalReissueDownload, handlePayPalAfterSaleReview } = await import(new URL('file:///' + repo.replace(/\\/g, '/') + '/paypal-orders.js'));

if ((await dbName()) !== 'amit-migration-0003-rehearsal-20261013') throw new Error('wrong database');
const realFetch = globalThis.fetch;
const results = [];
const check = (name, ok, detail = '') => { results.push([ok, name, detail]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); };

const baseEnv = { DB, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id', PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false' };
const stubState = { captureStatus: 'REFUNDED', calls: 0 };
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api-m.sandbox.paypal.com') return realFetch(url, options);
  stubState.calls++;
  if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
  if (u.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
  let m = u.pathname.match(/^\/v2\/payments\/captures\/(RHCAP\d+)$/);
  if (m) return Response.json({ id: m[1], status: stubState.captureStatus, custom_id: 'rh-local-' + m[1].slice(5), amount: { currency_code: 'ILS', value: '100.00' } });
  m = u.pathname.match(/^\/v2\/checkout\/orders\/(RHORDER\d+)$/);
  if (m) {
    const n = m[1].slice(7);
    return Response.json({ id: m[1], status: 'COMPLETED', purchase_units: [{ custom_id: 'rh-local-' + n, payments: { captures: [{ id: 'RHCAP' + n, status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' } }] } }] });
  }
  return Response.json({}, { status: 404 });
};

let seq = 100;
async function mkOrder({ status = 'COMPLETED' } = {}) {
  const n = String(Date.now() % 100000000) + String(++seq).padStart(3, '0');
  await query("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, paypal_capture_id, fulfillment_token, created_at) VALUES (?, ?, 'digital', 'photo-1', 'large', 10000, 'ILS', ?, ?, ?, '2026-10-01T00:00:00Z')",
    ['rh-local-' + n, 'RHORDER' + n, status, 'RHCAP' + n, 'rh-orig-' + n]);
  await query("INSERT INTO download_tokens (token, photo_ids, size, used, expires_at, created_at, tx, amount) VALUES (?, '[\"photo-1\"]', 'large', 0, 9999999999, 1, ?, 100)", ['rh-orig-' + n, 'RHCAP' + n]);
  return { n, orderId: 'RHORDER' + n, local: 'rh-local-' + n, capture: 'RHCAP' + n };
}
const live = async o => (await query("SELECT COUNT(*) AS c FROM download_tokens WHERE used = 0 AND (paypal_order_ref = ? OR tx = ?)", [o.local, o.capture])).results[0].c;
const orderRow = async o => (await query('SELECT after_sale_state AS s, dispute_open AS d, refunded_minor AS r, status FROM paypal_orders WHERE id = ?', [o.local])).results[0];
const actionCount = async (o, where = "status IN ('STARTED','DONE')") => (await query("SELECT COUNT(*) AS c FROM paypal_order_actions WHERE order_ref = ? AND action = 'REISSUE' AND " + where, [o.local])).results[0].c;
const dupTx = async o => (await query("SELECT COUNT(*) AS c FROM (SELECT tx FROM download_tokens WHERE paypal_order_ref = ? GROUP BY tx HAVING COUNT(*) > 1)", [o.local])).results[0].c;

const reissue = (o, key, env = baseEnv) => handlePayPalReissueDownload(new Request('https://amitphotos.com/api/admin/paypal/reissue', {
  method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ paypalOrderId: o.orderId, reason: 'rehearsal' }),
}), env);
let evt = 0;
const event = (o, type, resource) => ({ id: 'WH-RH-' + (++evt) + '-' + Date.now(), event_type: type, create_time: '2026-10-13T10:00:00.000Z', resource });
const sendEvent = async (e, env = baseEnv) => {
  const r = await handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', {
    method: 'POST', body: JSON.stringify(e),
    headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't' + evt, 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': 't' },
  }), env);
  return { status: r.status, body: await r.json() };
};
const refundEvent = (o, amount = '100.00') => event(o, 'PAYMENT.CAPTURE.REFUNDED', {
  id: 'RHREFUND' + (++evt), status: 'COMPLETED', amount: { currency_code: 'ILS', value: amount },
  links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + o.capture }],
  supplementary_data: { related_ids: { order_id: o.orderId } },
});
const disputeEvent = (o, type, status, at) => event(o, type, { dispute_id: 'PP-D-RH', status, update_time: at, disputed_transactions: [{ seller_transaction_id: o.capture }] });

// ---------------- 3. quota claim on real D1 ----------------
{
  const o = await mkOrder();
  const res = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(s => reissue(o, 'rh-par-' + o.n + '-' + s)));
  const codes = res.map(r => r.status);
  const ok = codes.filter(c => c === 200).length;
  check('3a parallel distinct keys: at most 2 re-issues granted', ok >= 1 && ok <= 2, 'statuses=' + codes.join(','));
  check('3a slot rows <= 2 and only one live link, no duplicate tx', (await actionCount(o)) <= 2 && (await live(o)) === 1 && (await dupTx(o)) === 0,
    'rows=' + await actionCount(o) + ' live=' + await live(o));
}
{
  const o = await mkOrder();
  const key = 'rh-same-' + o.n;
  const res = await Promise.all([1, 2, 3, 4, 5].map(() => reissue(o, key)));
  const bodies = await Promise.all(res.map(r => r.json()));
  check('3b same key x5 in parallel: all 200 with one shared link', res.every(r => r.status === 200) && new Set(bodies.map(b => b.url)).size === 1, res.map(r => r.status).join(','));
  check('3b same key consumed exactly one slot and one new token', (await actionCount(o)) === 1 && (await query('SELECT COUNT(*) AS c FROM download_tokens WHERE paypal_order_ref = ?', [o.local])).results[0].c === 1);
  const again = await reissue(o, key);
  check('3b replay later returns the same link and still one slot', again.status === 200 && (await again.json()).url === bodies[0].url && (await actionCount(o)) === 1);
}
{
  const o = await mkOrder();
  const first = await (await reissue(o, 'rh-seq1-' + o.n)).json();
  const second = await reissue(o, 'rh-seq2-' + o.n);
  const third = await reissue(o, 'rh-seq3-' + o.n);
  check('3c sequential: second ok, third refused with the limit', second.status === 200 && third.status === 409 && (await third.json()).error === 'REISSUE_LIMIT_REACHED');
  check('3c first link is revoked by the second; replaying key 1 is refused; one live link', (await reissue(o, 'rh-seq1-' + o.n)).status === 409 && (await live(o)) === 1 && first.url);
}
// ---------------- 3d. interruption recovery ----------------
{
  // crash right after the slot was taken (no token, nothing revoked)
  const o = await mkOrder();
  await query("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, new_token, created_at) VALUES (?, ?, 'REISSUE', ?, 'STARTED', 'admin', 'crash1', ?, ?)", [o.local, o.orderId, 'rh-crash1-' + o.n, 'rh-newtok-1-' + o.n, new Date().toISOString()]);
  const blocked = await reissue(o, 'rh-other-' + o.n);
  check('3d another key while a fresh STARTED row exists is refused (in progress)', blocked.status === 409);
  const resumed = await reissue(o, 'rh-crash1-' + o.n);
  const body = await resumed.json();
  check('3d resume with the same key completes with the pre-allocated link', resumed.status === 200 && body.url === '/api/download/rh-newtok-1-' + o.n);
  check('3d after resume: row DONE, one slot, one live link, orig revoked', (await actionCount(o, "status = 'DONE'")) === 1 && (await live(o)) === 1);
}
{
  // crash after the old link was revoked and the new one inserted, before DONE
  const o = await mkOrder();
  const key = 'rh-crash2-' + o.n;
  await query("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, new_token, created_at) VALUES (?, ?, 'REISSUE', ?, 'STARTED', 'admin', 'crash2', ?, ?)", [o.local, o.orderId, key, 'rh-newtok-2-' + o.n, new Date().toISOString()]);
  await query("UPDATE download_tokens SET used = 2 WHERE token = ?", ['rh-orig-' + o.n]);
  await query("INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount, paypal_order_ref) VALUES (?, '[]', 'large', ?, 0, 9999999999, 1, 100, ?)", ['rh-newtok-2-' + o.n, o.capture + ':R999', o.local]);
  const resumed = await reissue(o, key);
  check('3d resume after token insert: 200, no second token, DONE', resumed.status === 200 && (await query('SELECT COUNT(*) AS c FROM download_tokens WHERE paypal_order_ref = ?', [o.local])).results[0].c === 1 && (await actionCount(o, "status = 'DONE'")) === 1);
}
{
  // stale STARTED row (older than 10 minutes) no longer blocks other keys but still counts toward the limit
  const o = await mkOrder();
  await query("INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, new_token, created_at) VALUES (?, ?, 'REISSUE', ?, 'STARTED', 'admin', 'stale', ?, ?)", [o.local, o.orderId, 'rh-stale-' + o.n, 'rh-newtok-3-' + o.n, new Date(Date.now() - 3600e3).toISOString()]);
  const r1 = await reissue(o, 'rh-fresh1-' + o.n);
  const r2 = await reissue(o, 'rh-fresh2-' + o.n);
  check('3d stale STARTED counts toward the limit: one more allowed, then refused', r1.status === 200 && r2.status === 409, r1.status + ',' + r2.status);
}
// ---------------- 4. refund / reversal during re-issue ----------------
{
  // flip the order to REFUNDED exactly when the new token is written
  const o = await mkOrder();
  const env = { ...baseEnv, DB: { prepare(sql) { if (sql.startsWith('INSERT OR IGNORE INTO download_tokens')) { return { bind: (...a) => ({ first: () => DB.prepare(sql).bind(...a).first(), all: () => DB.prepare(sql).bind(...a).all(),
    async run() { await query("UPDATE paypal_orders SET after_sale_state = 'REFUNDED' WHERE id = ?", [o.local]); return DB.prepare(sql).bind(...a).run(); } }) }; } return DB.prepare(sql); } } };
  const r = await reissue(o, 'rh-race1-' + o.n, env);
  check('4a refund landing during token write: 409, no live link, action REVOKED', r.status === 409 && (await live(o)) === 0 && (await actionCount(o, "status = 'REVOKED'")) === 1);
}
{
  const outcomes = [];
  for (let i = 0; i < 6; i++) {
    const o = await mkOrder();
    stubState.captureStatus = 'REFUNDED';
    const [r, w] = await Promise.all([reissue(o, 'rh-conc-' + o.n), sendEvent(refundEvent(o))]);
    const ok = (await live(o)) === 0 && (await orderRow(o)).s === 'REFUNDED' && w.status === 200;
    outcomes.push(ok + ':' + r.status);
  }
  check('4b refund webhook racing a re-issue x6: always REFUNDED with zero live links', outcomes.every(x => x.startsWith('true')), outcomes.join(' '));
}
{
  const outcomes = [];
  for (let i = 0; i < 4; i++) {
    const o = await mkOrder();
    const [r, w] = await Promise.all([reissue(o, 'rh-rev-' + o.n), sendEvent(event(o, 'PAYMENT.CAPTURE.REVERSED', { id: o.capture, status: 'REVERSED', amount: { currency_code: 'ILS', value: '100.00' }, supplementary_data: { related_ids: { order_id: o.orderId } } }))]);
    outcomes.push(((await live(o)) === 0 && (await orderRow(o)).s === 'REVERSED') + ':' + r.status);
  }
  check('4c reversal racing a re-issue x4: always REVERSED with zero live links', outcomes.every(x => x.startsWith('true')), outcomes.join(' '));
}
// ---------------- 5. final states ----------------
{
  const review = (o, key, decision) => handlePayPalAfterSaleReview(new Request('https://amitphotos.com/x', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ paypalOrderId: o.orderId, decision, reason: 'rehearsal' }) }), baseEnv);
  for (const [label, type, mk] of [['REFUNDED', 'PAYMENT.CAPTURE.REFUNDED', o => refundEvent(o)], ['REVERSED', 'PAYMENT.CAPTURE.REVERSED', o => event(o, 'PAYMENT.CAPTURE.REVERSED', { id: o.capture, status: 'REVERSED', amount: { currency_code: 'ILS', value: '100.00' }, supplementary_data: { related_ids: { order_id: o.orderId } } })]]) {
    const o = await mkOrder();
    stubState.captureStatus = 'REFUNDED';
    await sendEvent(mk(o));
    const release = await review(o, 'rh-rel-' + label + o.n, 'release');
    check(`5a ${label}: after-sale-review cannot release it`, release.status === 409 && (await orderRow(o)).s === label && (await live(o)) === 0);
    const before = (await query('SELECT COUNT(*) AS c FROM download_tokens')).results[0].c;
    const late = await sendEvent(event(o, 'PAYMENT.CAPTURE.COMPLETED', { id: o.capture, status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' }, supplementary_data: { related_ids: { order_id: o.orderId } } }));
    const after = (await query('SELECT COUNT(*) AS c FROM download_tokens')).results[0].c;
    check(`5b ${label}: late COMPLETED event is ignored and mints nothing`, late.status === 200 && late.body.ignored === true && before === after && (await live(o)) === 0);
    check(`5c ${label}: re-issue refused`, (await reissue(o, 'rh-ri-' + label + o.n)).status === 409);
  }
  const o = await mkOrder();
  stubState.captureStatus = 'REFUNDED';
  await sendEvent(refundEvent(o));
  await query("UPDATE paypal_orders SET after_sale_state = 'REVIEW_REQUIRED' WHERE id = ?", [o.local]); // simulate a manual state only to prove release works from review
  check('5d release works only from REVIEW_REQUIRED (control)', (await review(o, 'rh-rel-ctl-' + o.n, 'release')).status === 200);
}
// ---------------- 6. disputes and ordering ----------------
{
  const o = await mkOrder();
  await sendEvent(disputeEvent(o, 'CUSTOMER.DISPUTE.CREATED', 'OPEN', '2026-10-13T10:00:00.000Z'));
  let r = await orderRow(o);
  check('6a dispute opened: REVIEW_REQUIRED, dispute_open=1, link untouched', r.s === 'REVIEW_REQUIRED' && r.d === 1 && (await live(o)) === 1);
  check('6a re-issue refused while the dispute is open', (await reissue(o, 'rh-d1-' + o.n)).status === 409);
  await sendEvent(disputeEvent(o, 'CUSTOMER.DISPUTE.RESOLVED', 'RESOLVED', '2026-10-14T10:00:00.000Z'));
  r = await orderRow(o);
  check('6b dispute closed: dispute_open=0, still REVIEW_REQUIRED (manual)', r.s === 'REVIEW_REQUIRED' && r.d === 0);
  await sendEvent(disputeEvent(o, 'CUSTOMER.DISPUTE.UPDATED', 'UNDER_REVIEW', '2026-10-13T12:00:00.000Z'));
  check('6c older event after RESOLVED does not reopen', (await orderRow(o)).d === 0);
  check('6d re-issue still refused until a manual release', (await reissue(o, 'rh-d2-' + o.n)).status === 409);
  const rel = await handlePayPalAfterSaleReview(new Request('https://amitphotos.com/x', { method: 'POST', headers: { 'Idempotency-Key': 'rh-rel-d-' + o.n }, body: JSON.stringify({ paypalOrderId: o.orderId, decision: 'release', reason: 'rehearsal' }) }), baseEnv);
  check('6e manual release works once the dispute is closed, then re-issue works', rel.status === 200 && (await reissue(o, 'rh-d3-' + o.n)).status === 200);
}
{
  const o = await mkOrder();
  // resolved arrives BEFORE created (created is older)
  await sendEvent(disputeEvent(o, 'CUSTOMER.DISPUTE.RESOLVED', 'RESOLVED', '2026-10-14T10:00:00.000Z'));
  await sendEvent(disputeEvent(o, 'CUSTOMER.DISPUTE.CREATED', 'OPEN', '2026-10-13T10:00:00.000Z'));
  const r = await orderRow(o);
  check('6f RESOLVED before CREATED: final dispute_open=0 (older CREATED ignored), review flag set', r.d === 0 && r.s === 'REVIEW_REQUIRED');
}
{
  const o = await mkOrder();
  stubState.captureStatus = 'PARTIALLY_REFUNDED';
  await sendEvent(refundEvent(o, '40.00'));
  let r = await orderRow(o);
  check('6g partial refund: review only, 4000 recorded, link kept', r.s === 'REVIEW_REQUIRED' && r.r === 4000 && (await live(o)) === 1);
  await sendEvent(disputeEvent(o, 'CUSTOMER.DISPUTE.CREATED', 'OPEN', '2026-10-13T11:00:00.000Z'));
  stubState.captureStatus = 'REFUNDED';
  await sendEvent(refundEvent(o, '60.00'));
  r = await orderRow(o);
  check('6h dispute + second refund covering the price: REFUNDED, links revoked', r.s === 'REFUNDED' && r.r === 10000 && (await live(o)) === 0);
  await sendEvent(disputeEvent(o, 'CUSTOMER.DISPUTE.RESOLVED', 'RESOLVED', '2026-10-15T11:00:00.000Z'));
  check('6i dispute resolution after a full refund does not lower the state', (await orderRow(o)).s === 'REFUNDED');
}
{
  // duplicate delivery of the same event id
  const o = await mkOrder();
  stubState.captureStatus = 'PARTIALLY_REFUNDED';
  const e = refundEvent(o, '40.00');
  const [a, b, c] = await Promise.all([sendEvent(e), sendEvent(e), sendEvent(e)]);
  const rows = (await query("SELECT COUNT(*) AS c FROM paypal_order_actions WHERE order_ref = ? AND action = 'AFTER_SALE_EVENT'", [o.local])).results[0].c;
  check('6j same event id delivered 3x in parallel: counted once', rows === 1 && (await orderRow(o)).r === 4000, [a, b, c].map(x => x.status).join(','));
}
globalThis.fetch = realFetch;
const failed = results.filter(r => !r[0]);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
