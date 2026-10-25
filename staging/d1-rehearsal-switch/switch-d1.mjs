// Runs the REAL handlers from the repo against a throwaway isolated D1 (via the D1 REST API).
// PayPal is a fake with fake ids; no real payment call, no mail, no alerts. Concurrency is real
// (parallel requests to D1). Written for the switch rehearsal of 14.10.2026.
import { DB, query, dbName } from './d1lib.mjs';
const repo = process.env.REPO.replace(/\\/g, '/');
const orders = await import('file:///' + repo + '/paypal-orders.js');
const sw = await import('file:///' + repo + '/paypal-switch.js');
const worker = await import('file:///' + repo + '/worker.js');
const { handlePayPalCreateOrder, handlePayPalCaptureOrder, handleDigitalCheckoutQuote, handlePayPalCheckoutSwitch, handlePayPalWebhook } = orders;
const { readCheckoutSwitch, SWITCH_KEY } = sw;

if ((await dbName()) !== 'amit-switch-test-20261014') throw new Error('wrong database');
const realFetch = globalThis.fetch;
const results = [];
const check = (name, ok, detail = '') => { results.push([ok, name]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : '')); };
const MIN = 60000, HOUR = 3600000;
const iso = ms => new Date(ms).toISOString();

const env = { DB, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'fake-webhook-id', PAYMENTS_ENABLED: 'true', DIGITAL_PAYPAL_ENABLED: 'true' };
const paypal = { creates: 0, captures: 0, ids: [], other: [] };
let seq = 0;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'api-m.sandbox.paypal.com') return realFetch(url, options);
  const method = options.method || 'GET';
  if (u.pathname === '/v1/oauth2/token') return Response.json({ access_token: 'token' });
  if (u.pathname === '/v1/notifications/verify-webhook-signature') return Response.json({ verification_status: 'SUCCESS' });
  if (u.pathname === '/v2/checkout/orders' && method === 'POST') {
    paypal.creates++;
    const id = 'SWTEST' + Date.now().toString(36).toUpperCase() + String(++seq).padStart(4, '0');
    paypal.ids.push(id);
    return Response.json({ id, links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + id }] }, { status: 201 });
  }
  const m = u.pathname.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
  if (m) {
    const row = (await query('SELECT * FROM paypal_orders WHERE paypal_order_id = ?', [m[1]])).results[0];
    const cap = row ? { id: 'CAP' + row.id.replace(/\W/g, '').slice(0, 12).toUpperCase(), status: 'COMPLETED', custom_id: row.id, amount: { currency_code: 'ILS', value: (row.amount_expected / 100).toFixed(2) } } : null;
    if (m[2]) { paypal.captures++; return Response.json(row ? { id: m[1], status: 'COMPLETED', purchase_units: [{ custom_id: row.id, payments: { captures: [cap] } }] } : {}, { status: row ? 201 : 404 }); }
    return Response.json({ id: m[1], links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + m[1] }] });
  }
  paypal.other.push(u.pathname);
  return Response.json({}, { status: 404 });
};

const setRow = value => query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [SWITCH_KEY, typeof value === 'string' ? value : JSON.stringify(value)]);
const delRow = () => query('DELETE FROM settings WHERE key = ?', [SWITCH_KEY]);
const rowNow = async () => (await query('SELECT value FROM settings WHERE key = ?', [SWITCH_KEY])).results[0]?.value ?? null;
const openCfg = (extra = {}) => ({ state: 'open', openedAt: iso(Date.now() - 1000), closesAt: iso(Date.now() + 2 * HOUR), maxOrders: null, photoIds: null, ...extra });
const createReq = (key, photoId = 'photo-1') => new Request('https://amitphotos.com/api/paypal/create-order', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ type: 'digital', photoId, sku: 'large', currency: 'ILS', licenseAccepted: true, expectedAmountMinor: 10000 }),
});
const create = (key, photoId) => handlePayPalCreateOrder(createReq(key, photoId), env, { publicCheckout: true, includeApproveUrl: true, skipRateLimit: true });
const capture = po => handlePayPalCaptureOrder(new Request('https://amitphotos.com/api/paypal/capture-order', { method: 'POST', body: JSON.stringify({ paypalOrderId: po }) }), env, { skipRateLimit: true });
const quote = async photoId => (await (await handleDigitalCheckoutQuote(new Request('https://amitphotos.com/api/paypal/quote?photoId=' + (photoId || 'photo-1') + '&sku=large'), env)).json()).enabled;
const admin = (key, body, method = 'POST') => handlePayPalCheckoutSwitch(new Request('https://amitphotos.com/api/admin/paypal/switch', { method, headers: key ? { 'Idempotency-Key': key } : {}, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }), env);
const count = async sql => (await query(sql)).results[0].n;
const stamp = Date.now().toString(36);
const key = (name, i = 0) => `sw-${name}-${stamp}-${String(i).padStart(3, '0')}`;
async function seedOrder(createdMs, status = 'CREATED') {
  const id = 'sw-' + stamp + '-' + (++seq); const po = 'SWSEED' + stamp.toUpperCase() + String(seq).padStart(3, '0');
  await query("INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at, client_idempotency_key) VALUES (?, ?, 'digital', 'photo-1', 'large', 10000, 'ILS', ?, ?, ?)", [id, po, status, iso(createdMs), 'seed-' + id]);
  return { id, po };
}

// ---- S0/S1: baseline and fail-closed on the real database ---------------------------------------------
check('S0 database is the throwaway one, schema has the switch table and no switch row', (await rowNow()) === null && (await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('paypal_order_actions','settings','paypal_orders')")) === 3);
const seeded = await seedOrder(Date.now() - 10 * MIN);
check('S1 no row: quote disabled, create 503, capture 503, PayPal untouched', (await quote()) === false && (await create(key('absent'))).status === 503 && (await capture(seeded.po)).status === 503 && paypal.creates === 0 && paypal.captures === 0);
await setRow('{"state":');
check('S1 invalid JSON row: blocked the same way', (await quote()) === false && (await create(key('badjson'))).status === 503 && (await readCheckoutSwitch(env)).reason === 'SWITCH_INVALID_JSON');
await setRow({ state: 'open', openedAt: iso(Date.now()) });
check('S1 open row without closing time: blocked', (await create(key('notimes'))).status === 503);
await delRow();
const broken = { ...env, DB: { prepare() { throw new Error('D1 unavailable (simulated at the binding)'); } } };
check('S1 unreadable database (simulated at the binding): fail closed', (await sw.checkNewOrderAllowed(broken)).allowed === false && (await sw.checkCaptureAllowed(broken, { created_at: iso(Date.now() - MIN) })).allowed === false);

// ---- S2: ON CONFLICT upsert, meta.changes, audit and replay on D1 ----------------------------------------
const raw1 = await query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [SWITCH_KEY, JSON.stringify(openCfg())]);
const raw2 = await query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [SWITCH_KEY, JSON.stringify(openCfg({ maxOrders: 5 }))]);
check('S2 ON CONFLICT upsert works on D1 (insert, then update) and reports meta.changes', raw1.meta.changes === 1 && raw2.meta.changes === 1 && (await count("SELECT COUNT(*) AS n FROM settings WHERE key = 'digital_checkout_switch'")) === 1, 'changes=' + raw1.meta.changes + ',' + raw2.meta.changes);
await delRow();
const closesAt = iso(Date.now() + 3 * HOUR);
const opened = await admin(key('open'), { state: 'open', reason: 'rehearsal', closesAt, maxOrders: 2, photoIds: ['photo-1'] });
const afterOpen = JSON.parse(await rowNow());
check('S2 admin open writes the row (upsert path) with caps', opened.status === 200 && afterOpen.state === 'open' && afterOpen.maxOrders === 2 && afterOpen.photoIds[0] === 'photo-1');
const replay = await admin(key('open'), { state: 'frozen', reason: 'must be ignored' });
check('S2 same key = replay: nothing re-applied, one audit row', (await replay.json()).replayed === true && JSON.parse(await rowNow()).state === 'open' && (await count(`SELECT COUNT(*) AS n FROM paypal_order_actions WHERE action='SWITCH' AND request_id LIKE 'sw-open-${stamp}-%'`)) === 1);
check('S2 audit rows hold no address, link or token', (await count("SELECT COUNT(*) AS n FROM paypal_order_actions WHERE action='SWITCH' AND (reason LIKE '%@%' OR reason LIKE '%http%' OR reason LIKE '%token%')")) === 0);

// ---- S4: transitions ------------------------------------------------------------------------------------------
const f1 = await admin(key('freeze'), { state: 'frozen', reason: 'rehearsal freeze' });
const frozenAt = JSON.parse(await rowNow()).closedAt;
check('S4 open -> frozen', f1.status === 200 && JSON.parse(await rowNow()).state === 'frozen');
check('S4 frozen -> open refused (must close first)', (await admin(key('direct'), { state: 'open', reason: 'x', closesAt })).status === 409);
await new Promise(r => setTimeout(r, 30));
await admin(key('close'), { state: 'closed', reason: 'calmer' });
check('S4 frozen -> closed keeps the original stop time', JSON.parse(await rowNow()).closedAt === frozenAt && JSON.parse(await rowNow()).state === 'closed');
const reopened = await admin(key('reopen'), { state: 'open', reason: 'again', closesAt, maxOrders: 2, photoIds: null });
check('S4 closed -> open starts a new period', reopened.status === 200 && JSON.parse(await rowNow()).openedAt > frozenAt);
check('S4 refused requests changed nothing (bad closesAt, bad caps)', (await admin(key('bad1'), { state: 'open', reason: 'x', closesAt: iso(Date.now() - MIN) })).status === 400 && (await admin(key('bad2'), { state: 'open', reason: 'x', closesAt, maxOrders: 0 })).status === 400 && JSON.parse(await rowNow()).state === 'open');

// ---- S5: cap under real parallel requests + retries ---------------------------------------------------------------
await admin(key('cap2'), { state: 'closed', reason: 'reset' });
const periodStart = Date.now();
await new Promise(r => setTimeout(r, 20));
await admin(key('cap2open'), { state: 'open', reason: 'cap test', closesAt, maxOrders: 2 });
const createsBefore = paypal.creates;
const par = await Promise.all(Array.from({ length: 8 }, (_, i) => create(key('par', i))));
const codes = par.map(r => r.status);
const rowsNow = await count(`SELECT COUNT(*) AS n FROM paypal_orders WHERE client_idempotency_key LIKE 'sw-par-${stamp}-%'`);
check('S5 8 parallel requests with a cap of 2: exactly 2 orders persisted (real D1 INSERT...SELECT, meta.changes)', rowsNow === 2 && codes.filter(c => c === 201).length === 2 && codes.filter(c => c === 503).length === 6, 'codes=' + codes.join());
const winner = (await query(`SELECT client_idempotency_key AS k, paypal_order_id AS po FROM paypal_orders WHERE client_idempotency_key LIKE 'sw-par-${stamp}-%' LIMIT 1`)).results[0];
const retry = await create(winner.k);
check('S5 retry with the same key returns the same order and is not counted again', retry.status === 200 && (await retry.json()).paypalOrderId === winner.po && (await count(`SELECT COUNT(*) AS n FROM paypal_orders WHERE client_idempotency_key LIKE 'sw-par-${stamp}-%'`)) === 2);
check('S5 a new key is refused once the cap is used', (await create(key('late'))).status === 503);
const orphansA = paypal.creates - createsBefore - 2;
await admin(key('cap1close'), { state: 'closed', reason: 'reset' });
await new Promise(r => setTimeout(r, 20));
await admin(key('cap1open'), { state: 'open', reason: 'cap 1', closesAt, maxOrders: 1 });
const same = await Promise.all([1, 2, 3, 4, 5].map(() => create(key('same'))));
const sameCodes = same.map(r => r.status);
check('S5 five parallel requests with ONE key and a cap of 1: one order, no refusal for the key owner', (await count(`SELECT COUNT(*) AS n FROM paypal_orders WHERE client_idempotency_key = '${key('same')}'`)) === 1 && sameCodes.every(c => c < 500), 'codes=' + sameCodes.join());
check('S5 a second key is refused (cap 1)', (await create(key('same2'))).status === 503);

// ---- S6: the orphan PayPal order scenario ---------------------------------------------------------------------------
const known = new Set((await query('SELECT paypal_order_id AS po FROM paypal_orders')).results.map(r => r.po));
const orphans = paypal.ids.filter(id => !known.has(id));
check('S6 orphans exist in this rehearsal (PayPal orders created, local row refused by the cap)', orphans.length > 0, 'orphans=' + orphans.length);
const capturesBefore = paypal.captures;
const orphanCapture = await capture(orphans[0]);
check('S6 capturing an orphan through the app is impossible: 404, PayPal capture never called', orphanCapture.status === 404 && paypal.captures === capturesBefore);
const hook = (id, type, resource) => handlePayPalWebhook(new Request('https://amitphotos.com/api/paypal/webhook', { method: 'POST', body: JSON.stringify({ id, event_type: type, create_time: '2026-10-14T10:00:00Z', resource }), headers: { 'PAYPAL-AUTH-ALGO': 'a', 'PAYPAL-CERT-URL': 'https://x/c', 'PAYPAL-TRANSMISSION-ID': 't' + id, 'PAYPAL-TRANSMISSION-SIG': 's', 'PAYPAL-TRANSMISSION-TIME': 't' } }), env);
const tokensBefore = await count('SELECT COUNT(*) AS n FROM download_tokens');
const orphanHook = await hook('WH-ORPHAN-' + stamp, 'PAYMENT.CAPTURE.COMPLETED', { id: 'CAPORPHAN' + stamp.toUpperCase(), status: 'COMPLETED', amount: { currency_code: 'ILS', value: '100.00' }, supplementary_data: { related_ids: { order_id: orphans[0] } } });
const orphanBody = await orphanHook.json();
check('S6 a completion event for an orphan is acknowledged and ignored: no fulfilment, no token', orphanHook.status === 200 && orphanBody.ignored === true && (await count("SELECT COUNT(*) AS n FROM download_tokens")) === tokensBefore && paypal.captures === capturesBefore);

// ---- S7: closesAt with real time, and the 30-minute grace on real rows -------------------------------------------------
await admin(key('s7close'), { state: 'closed', reason: 'reset' });
await setRow(openCfg({ closesAt: iso(Date.now() + 4000), openedAt: iso(Date.now() - 1000) }));
const beforeEnd = await create(key('s7a'));
await new Promise(r => setTimeout(r, 4600));
const afterEnd = await create(key('s7b'));
check('S7 closesAt passes with no job running: the next request is refused', beforeEnd.status === 201 && afterEnd.status === 503 && (await quote()) === false);
const olderThanClose = await seedOrder(Date.now() - 40 * MIN);
await setRow({ state: 'closed', closedAt: iso(Date.now() - 29 * MIN - 30000) });
const cap1 = await capture(olderThanClose.po);
check('S7 closed 29.5 minutes ago: an older order can still be charged (graceful)', cap1.status === 200, 'status=' + cap1.status);
const older2 = await seedOrder(Date.now() - 50 * MIN);
await setRow({ state: 'closed', closedAt: iso(Date.now() - 31 * MIN) });
const capturesAtGrace = paypal.captures;
check('S7 closed 31 minutes ago: refused, PayPal not called', (await capture(older2.po)).status === 503 && paypal.captures === capturesAtGrace);
const youngerThanClose = await seedOrder(Date.now() - 2 * MIN);
await setRow({ state: 'closed', closedAt: iso(Date.now() - 5 * MIN) });
check('S7 order created AFTER the close is refused even inside the grace', (await capture(youngerThanClose.po)).status === 503);

// ---- S8: frozen and the photo list ---------------------------------------------------------------------------------------------
await setRow({ state: 'frozen', closedAt: iso(Date.now() - 5 * MIN) });
const frozenOrder = await seedOrder(Date.now() - 20 * MIN);
const capturesFrozen = paypal.captures;
check('S8 frozen: quote, create and capture refused; PayPal untouched', (await quote()) === false && (await create(key('fz'))).status === 503 && (await capture(frozenOrder.po)).status === 503 && paypal.captures === capturesFrozen);
const paidReplay = await capture(olderThanClose.po);
check('S8 frozen: a purchase that was already paid still returns its stored result', paidReplay.status === 200);
await setRow(openCfg({ photoIds: ['photo-1'] }));
check('S8 photo list on D1: photo-2 refused for quote and order, photo-1 accepted', (await quote('photo-2')) === false && (await create(key('p2'), 'photo-2')).status === 503 && (await create(key('p1'), 'photo-1')).status === 201);

// ---- S9: the documented emergency statements, on D1 ---------------------------------------------------------------------------------
await query("INSERT INTO settings (key, value) VALUES ('digital_checkout_switch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify({ state: 'frozen', closedAt: iso(Date.now()), updatedBy: 'd1' })]);
const e1 = (await readCheckoutSwitch(env)).effective.mode;
await query("DELETE FROM settings WHERE key = 'digital_checkout_switch'");
const e2 = await sw.checkCaptureAllowed(env, { created_at: iso(Date.now() - HOUR) });
check('S9 emergency statements: frozen upsert is read as frozen; deleting the row blocks charges too', e1 === 'frozen' && e2.allowed === false && e2.reason === 'SWITCH_ABSENT');

globalThis.fetch = realFetch;
const failed = results.filter(r => !r[0]);
console.log(`\nPayPal fake calls: creates=${paypal.creates} captures=${paypal.captures} other=${JSON.stringify(paypal.other)} orphans(total)=${orphans.length}`);
console.log(`SUMMARY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
