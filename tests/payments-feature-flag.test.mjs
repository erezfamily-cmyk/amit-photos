import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentsEnabled,
  paymentsDisabledResponse,
  handlePaymentsStatus,
  handleVerifyPayment,
  handlePrintOrderComplete,
  handleDownload,
} from '../worker.js';

// ===== paymentsEnabled(env) — fail-closed feature flag =====

test('paymentsEnabled defaults to false when PAYMENTS_ENABLED is missing from env', () => {
  assert.equal(paymentsEnabled({}), false);
});

test('paymentsEnabled returns false for any value other than the exact string "true"', () => {
  for (const v of ['false', '', '1', 'yes', 'TRUE', undefined, null, 0]) {
    assert.equal(paymentsEnabled({ PAYMENTS_ENABLED: v }), false, `expected false for ${JSON.stringify(v)}`);
  }
});

test('paymentsEnabled returns true when PAYMENTS_ENABLED is exactly "true"', () => {
  assert.equal(paymentsEnabled({ PAYMENTS_ENABLED: 'true' }), true);
});

// ===== paymentsDisabledResponse(request) — stable shape =====

test('paymentsDisabledResponse returns 503 with stable error code and bilingual message, no internal details', async () => {
  const req = new Request('https://amitphotos.com/api/verify-payment');
  const res = paymentsDisabledResponse(req);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'PAYMENTS_TEMPORARILY_DISABLED');
  assert.equal(typeof body.message.he, 'string');
  assert.equal(typeof body.message.en, 'string');
  assert.ok(body.message.he.length > 0);
  assert.ok(body.message.en.length > 0);
  // no stack traces, DB errors, or other internals leaked
  assert.equal(JSON.stringify(body).toLowerCase().includes('error:'), false);
});

// ===== /api/payments-status — public read of the flag =====

test('handlePaymentsStatus reports enabled:false when the flag is unset', async () => {
  const req = new Request('https://amitphotos.com/api/payments-status');
  const res = await handlePaymentsStatus(req, {});
  const body = await res.json();
  assert.equal(body.enabled, false);
});

test('handlePaymentsStatus reports enabled:true when PAYMENTS_ENABLED=true', async () => {
  const req = new Request('https://amitphotos.com/api/payments-status');
  const res = await handlePaymentsStatus(req, { PAYMENTS_ENABLED: 'true' });
  const body = await res.json();
  assert.equal(body.enabled, true);
});

// ===== handleVerifyPayment — digital purchase completion + download-token creation =====

test('handleVerifyPayment blocks with 503 and touches no DB when payments are disabled, even with fully valid PayPal params', async () => {
  const env = {}; // no env.DB — if the code reached DB access, this would throw instead of returning cleanly
  const params = new URLSearchParams({
    txn_id: 'TXN123', tx: 'TXN123', item_number: 'photoid123_small',
    payment_status: 'Completed', receiver_id: 'RCV1', mc_currency: 'ILS', mc_gross: '19',
  });
  const req = new Request(`https://amitphotos.com/api/verify-payment?${params.toString()}`);
  const res = await handleVerifyPayment(req, env, { waitUntil: () => {} });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'PAYMENTS_TEMPORARILY_DISABLED');
});

test('handleVerifyPayment does not short-circuit on the payments gate when enabled (reaches normal validation)', async () => {
  const env = { PAYMENTS_ENABLED: 'true' }; // no env.DB — normal validation must fail before any DB access
  const req = new Request('https://amitphotos.com/api/verify-payment'); // missing txn_id
  const res = await handleVerifyPayment(req, env, { waitUntil: () => {} });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.notEqual(body.error, 'PAYMENTS_TEMPORARILY_DISABLED');
});

// ===== handlePrintOrderComplete — print order completion + Gelato order creation =====

test('handlePrintOrderComplete blocks with 503 and calls neither Gelato nor the DB when payments are disabled', async () => {
  const env = {}; // no env.DB / no GELATO_API_KEY — a reach past the gate would throw
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { fetchCalled = true; return originalFetch(...args); };
  try {
    const req = new Request('https://amitphotos.com/api/print/order-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx: 'TXN999', itemNumber: 'PRINT_photoid_sku123',
        allParams: 'payment_status=Completed&receiver_id=RCV1&mc_currency=USD&mc_gross=49',
      }),
    });
    const res = await handlePrintOrderComplete(req, env);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'PAYMENTS_TEMPORARILY_DISABLED');
    assert.equal(fetchCalled, false, 'must not call Gelato when payments are disabled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('handlePrintOrderComplete does not short-circuit on the payments gate when enabled (reaches normal validation)', async () => {
  const env = { PAYMENTS_ENABLED: 'true' }; // no env.DB — normal validation must fail before any DB access
  const req = new Request('https://amitphotos.com/api/print/order-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}), // missing tx / itemNumber
  });
  const res = await handlePrintOrderComplete(req, env);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.notEqual(body.error, 'PAYMENTS_TEMPORARILY_DISABLED');
});

// ===== handleDownload — must NOT be blocked; old verified tokens keep working =====

test('handleDownload still serves an already-issued valid token when payments are globally disabled', async () => {
  const fakeObject = {
    body: 'fake-bytes',
    httpMetadata: { contentType: 'image/jpeg' },
  };
  const env = {
    PAYMENTS_ENABLED: 'false',
    DB: {
      prepare(sql) {
        return {
          bind: (...bindArgs) => ({
            first: async () => {
              if (sql.includes('FROM download_tokens')) {
                return { token: 'tok1', photo_ids: JSON.stringify(['photo1']), used: 0, expires_at: Math.floor(Date.now() / 1000) + 3600 };
              }
              if (sql.includes('FROM photos')) {
                return { r2_key: 'photo1.webp', title: 'Test Photo' };
              }
              return null;
            },
            run: async () => ({ success: true }),
          }),
        };
      },
    },
    PHOTOS: { get: async () => fakeObject },
  };
  const req = new Request('https://amitphotos.com/api/download/tok1');
  const res = await handleDownload(req, env, 'tok1');
  assert.equal(res.status, 200);
});
