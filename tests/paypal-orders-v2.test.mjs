import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handlePayPalCreateOrder, handlePayPalCaptureOrder, handlePayPalSandboxStatus, handlePayPalWebhook, handlePayPalSandboxCleanup } from '../worker.js';

function makeDb(options = {}) {
  const state = {
    prices: options.prices || { small: 19, medium: 59, large: 129 },
    photo: options.photo || { id: 'photo-1', published: 1, price_overrides: null, title: 'Test Photo' },
    order: options.order || null,
    token: options.token || null,
    tokenInserts: 0,
    orderInserts: 0,
    rateLimits: new Map(),
    webhookEvents: new Map(),
  };

  return {
    state,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM settings WHERE key='prices'")) {
                return { value: JSON.stringify(state.prices) };
              }
              if (sql.includes('FROM photos WHERE id = ?') && sql.includes('price_overrides')) {
                return state.photo;
              }
              if (sql.includes('SELECT paypal_order_id FROM paypal_orders WHERE client_idempotency_key')) {
                if (state.order?.client_idempotency_key === args[0]) {
                  return { paypal_order_id: state.order.paypal_order_id };
                }
                return null;
              }
              if (sql.includes('SELECT * FROM paypal_orders')) {
                return state.order;
              }
              if (sql.includes('SELECT count FROM paypal_rate_limits')) {
                const key = args.join('|');
                return { count: state.rateLimits.get(key) || 0 };
              }
              if (sql.includes('SELECT processed') && sql.includes('FROM paypal_webhook_events')) {
                const row = state.webhookEvents.get(args[0]);
                return row ? {
                  processed: row.processed,
                  processing_started_at: row.processing_started_at || null,
                  attempts: row.attempts || 0,
                } : null;
              }
              if (sql.includes('FROM download_tokens WHERE tx = ?')) {
                return state.token;
              }
              if (sql.includes('FROM download_tokens WHERE token = ? AND tx = ?')) {
                return state.token;
              }
              if (sql.includes('SELECT status, fulfillment_json FROM paypal_orders')) {
                return state.order ? { status: state.order.status, fulfillment_json: state.order.fulfillment_json } : null;
              }
              if (sql.includes('SELECT title FROM photos')) {
                return { title: state.photo.title };
              }
              return null;
            },
            async run() {
              if (sql.includes('INSERT INTO paypal_orders')) {
                state.orderInserts += 1;
                state.order = {
                  id: args[0],
                  paypal_order_id: args[1],
                  order_type: 'digital',
                  photo_id: args[2],
                  sku: args[3],
                  amount_expected: args[4],
                  currency: args[5],
                  status: 'CREATED',
                  created_at: args[6],
                  client_idempotency_key: args[7],
                  fulfillment_json: null,
                  fulfillment_token: null,
                  paypal_capture_id: null,
                };
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes("SET status='FULFILLING'")) {
                if (state.order.status === 'FULFILLING' || state.order.status === 'COMPLETED') {
                  return { success: true, meta: { changes: 0 } };
                }
                state.order.status = 'FULFILLING';
                state.order.paypal_capture_id = args[0];
                state.order.fulfillment_token = args[1];
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes('INSERT OR IGNORE INTO download_tokens')) {
                state.tokenInserts += 1;
                if (!options.failTokenPersist) state.token = { token: args[0], tx: args[3] };
                return { success: true, meta: { changes: options.failTokenPersist ? 0 : 1 } };
              }
              if (sql.includes("SET status='COMPLETED'")) {
                if (options.failCompletePersist) return { success: true, meta: { changes: 0 } };
                state.order.status = 'COMPLETED';
                state.order.fulfillment_json = args[0];
                state.order.completed_at = args[1];
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes('INSERT INTO paypal_rate_limits')) {
                const key = args.join('|');
                state.rateLimits.set(key, (state.rateLimits.get(key) || 0) + 1);
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes('DELETE FROM paypal_rate_limits')) {
                return { success: true, meta: { changes: 0 } };
              }
              if (sql.includes('INSERT OR IGNORE INTO paypal_webhook_events')) {
                if (!state.webhookEvents.has(args[0])) {
                  state.webhookEvents.set(args[0], {
                    event_type: args[1],
                    received_at: args[2],
                    processed: 0,
                    processing_started_at: null,
                    attempts: 0,
                  });
                  return { success: true, meta: { changes: 1 } };
                }
                return { success: true, meta: { changes: 0 } };
              }
              if (sql.includes("SET processed=2")) {
                const row = state.webhookEvents.get(args[1]);
                if (!row) return { success: true, meta: { changes: 0 } };
                const cutoff = args[2];
                const stale = row.processed === 2 && (!row.processing_started_at || row.processing_started_at < cutoff);
                if (row.processed === 0 || stale) {
                  row.processed = 2;
                  row.processing_started_at = args[0];
                  row.attempts = (row.attempts || 0) + 1;
                  return { success: true, meta: { changes: 1 } };
                }
                return { success: true, meta: { changes: 0 } };
              }
              if (sql.includes("SET processed=1")) {
                const row = state.webhookEvents.get(args[0]);
                if (row) {
                  row.processed = 1;
                  row.processing_started_at = null;
                }
                return { success: true, meta: { changes: row ? 1 : 0 } };
              }
              if (sql.includes("SET processed=0")) {
                const row = state.webhookEvents.get(args[0]);
                if (row && row.processed === 2) {
                  row.processed = 0;
                  row.processing_started_at = null;
                  return { success: true, meta: { changes: 1 } };
                }
                return { success: true, meta: { changes: 0 } };
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
        async first() {
          if (sql.includes("FROM settings WHERE key='prices'")) {
            return { value: JSON.stringify(state.prices) };
          }
          return null;
        },
      };
    },
  };
}

function post(path, body, extraHeaders = {}) {
  return new Request('https://amitphotos.com' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'test-idempotency-0001',
      'CF-Connecting-IP': '203.0.113.10',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

test('create-order is fail-closed while payments are disabled', async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('must not fetch');
  };
  try {
    const response = await handlePayPalCreateOrder(
      post('/api/paypal/create-order', { type: 'digital', photoId: 'photo-1', sku: 'small' }),
      { PAYMENTS_ENABLED: 'false' }
    );
    assert.equal(response.status, 503);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('create-order ignores client amount and sends the server-side D1 price to PayPal', async () => {
  const db = makeDb();
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  const paypalBodies = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (String(url).endsWith('/v2/checkout/orders')) {
      paypalBodies.push(JSON.parse(options.body));
      return Response.json({ id: 'PAYPALORDER123', status: 'CREATED' }, { status: 201 });
    }
    throw new Error('unexpected fetch ' + url);
  };

  try {
    const response = await handlePayPalCreateOrder(
      post('/api/paypal/create-order', {
        type: 'digital',
        photoId: 'photo-1',
        sku: 'small',
        currency: 'ILS',
        amount: '0.01',
      }),
      env
    );
    assert.equal(response.status, 201);
    assert.equal(paypalBodies.length, 1);
    assert.equal(paypalBodies[0].purchase_units[0].amount.currency_code, 'ILS');
    assert.equal(paypalBodies[0].purchase_units[0].amount.value, '19.00');
    assert.equal(db.state.order.amount_expected, 1900);
    assert.equal(db.state.orderInserts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('create-order preserves the existing rounded USD conversion rule', async () => {
  const db = makeDb();
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  let createBody;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    createBody = JSON.parse(options.body);
    return Response.json({ id: 'PAYPALORDERUSD1', status: 'CREATED' }, { status: 201 });
  };

  try {
    const response = await handlePayPalCreateOrder(
      post('/api/paypal/create-order', {
        type: 'digital',
        photoId: 'photo-1',
        sku: 'small',
        currency: 'USD',
      }),
      env
    );
    assert.equal(response.status, 201);
    assert.equal(createBody.purchase_units[0].amount.value, '5.00');
    assert.equal(db.state.order.amount_expected, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('create-order reuses an existing order for the same Idempotency-Key without creating another PayPal order', async () => {
  const db = makeDb({
    order: {
      id: 'local-existing',
      paypal_order_id: 'PAYPALEXISTING123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      created_at: new Date().toISOString(),
      client_idempotency_key: 'test-idempotency-0001',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  let createCalls = 0;
  globalThis.fetch = async () => {
    createCalls += 1;
    throw new Error('PayPal must not be called for an existing idempotency key');
  };
  try {
    const response = await handlePayPalCreateOrder(
      post('/api/paypal/create-order', { type: 'digital', photoId: 'photo-1', sku: 'small' }),
      env
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      paypalOrderId: 'PAYPALEXISTING123',
      reused: true,
    });
    assert.equal(createCalls, 0);
    assert.equal(db.state.orderInserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('create-order rate limits repeated public attempts by hashed IP', async () => {
  const db = makeDb();
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    return Response.json({ id: 'PAYPALRATE123', status: 'CREATED' }, { status: 201 });
  };

  try {
    // Pre-load the current create-order bucket above the configured limit.
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / 60) * 60;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('203.0.113.10'));
    const rateKey = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    db.state.rateLimits.set([rateKey, 'create-order', windowStart].join('|'), 8);

    const response = await handlePayPalCreateOrder(
      post('/api/paypal/create-order', { type: 'digital', photoId: 'photo-1', sku: 'small' }),
      env
    );
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, 'RATE_LIMITED');
    assert.equal(db.state.orderInserts, 0);
    assert.equal([...db.state.rateLimits.keys()].some(key => key.includes('203.0.113.10')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('capture-order rejects a completed PayPal capture when the amount does not exactly match', async () => {
  const db = makeDb({
    order: {
      id: 'local-1',
      paypal_order_id: 'PAYPALORDER123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    return Response.json({
      id: 'PAYPALORDER123',
      status: 'COMPLETED',
      purchase_units: [{
        custom_id: 'local-1',
        payments: {
          captures: [{
            id: 'CAPTURE1',
            status: 'COMPLETED',
            amount: { currency_code: 'ILS', value: '18.00' },
          }],
        },
      }],
    }, { status: 201 });
  };

  try {
    const response = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALORDER123' }),
      env
    );
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, 'PayPal capture amount mismatch');
    assert.equal(db.state.tokenInserts, 0);
    assert.equal(db.state.order.status, 'CREATED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('successful capture creates one download token and a duplicate callback reuses fulfillment', async () => {
  const db = makeDb({
    order: {
      id: 'local-1',
      paypal_order_id: 'PAYPALORDER123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    fetchCalls += 1;
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    return Response.json({
      id: 'PAYPALORDER123',
      status: 'COMPLETED',
      purchase_units: [{
        custom_id: 'local-1',
        payments: {
          captures: [{
            id: 'CAPTURE1',
            status: 'COMPLETED',
            amount: { currency_code: 'ILS', value: '19.00' },
          }],
        },
      }],
    }, { status: 201 });
  };

  try {
    const first = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALORDER123' }),
      env
    );
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.match(firstBody.url, /^\/api\/download\//);
    assert.equal(db.state.tokenInserts, 1);
    assert.equal(db.state.order.status, 'COMPLETED');

    const callsAfterFirst = fetchCalls;
    const second = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALORDER123' }),
      env
    );
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.deepEqual(secondBody, firstBody);
    assert.equal(db.state.tokenInserts, 1);
    assert.equal(fetchCalls, callsAfterFirst, 'duplicate callback must not contact PayPal again');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('resume from FULFILLING reuses the locked fulfillment token without calling PayPal', async () => {
  const db = makeDb({
    order: {
      id: 'local-2',
      paypal_order_id: 'PAYPALORDER456',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'FULFILLING',
      fulfillment_json: null,
      fulfillment_token: 'locked-token-123',
      paypal_capture_id: 'CAPTURE2',
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('must not call PayPal while resuming local fulfillment');
  };

  try {
    const response = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALORDER456' }),
      env
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.url, '/api/download/locked-token-123');
    assert.equal(db.state.tokenInserts, 1);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test('capture-order rejects a PayPal response that is not bound to the local order identity', async () => {
  const db = makeDb({
    order: {
      id: 'local-1',
      paypal_order_id: 'PAYPALORDER123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    return Response.json({
      id: 'PAYPALORDER123',
      status: 'COMPLETED',
      purchase_units: [{
        custom_id: 'different-local-order',
        payments: {
          captures: [{
            id: 'CAPTURE-ID-MISMATCH',
            status: 'COMPLETED',
            amount: { currency_code: 'ILS', value: '19.00' },
          }],
        },
      }],
    }, { status: 201 });
  };

  try {
    const response = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALORDER123' }),
      env
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'PayPal capture identity mismatch');
    assert.equal(db.state.tokenInserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('capture-order does not mark the order completed if the download entitlement was not persisted', async () => {
  const db = makeDb({
    failTokenPersist: true,
    order: {
      id: 'local-1',
      paypal_order_id: 'PAYPALORDER123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    return Response.json({
      id: 'PAYPALORDER123',
      status: 'COMPLETED',
      purchase_units: [{
        custom_id: 'local-1',
        payments: {
          captures: [{
            id: 'CAPTURE-PERSIST-FAIL',
            status: 'COMPLETED',
            amount: { currency_code: 'ILS', value: '19.00' },
          }],
        },
      }],
    }, { status: 201 });
  };

  try {
    const response = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALORDER123' }),
      env
    );
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'Digital fulfillment persistence failed');
    assert.equal(db.state.order.status, 'FULFILLING');
    assert.equal(db.state.order.fulfillment_json, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('capture-order recovers from ORDER_ALREADY_CAPTURED by reading the authoritative PayPal order', async () => {
  const db = makeDb({
    order: {
      id: 'local-1',
      paypal_order_id: 'PAYPALORDER123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  let orderGets = 0;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (target.endsWith('/capture')) {
      return Response.json({
        name: 'UNPROCESSABLE_ENTITY',
        details: [{ issue: 'ORDER_ALREADY_CAPTURED' }],
      }, { status: 422 });
    }
    if (target.endsWith('/v2/checkout/orders/PAYPALORDER123') && options.method === 'GET') {
      orderGets += 1;
      return Response.json({
        id: 'PAYPALORDER123',
        status: 'COMPLETED',
        purchase_units: [{
          custom_id: 'local-1',
          payments: {
            captures: [{
              id: 'CAPTURE-RECOVERED',
              status: 'COMPLETED',
              amount: { currency_code: 'ILS', value: '19.00' },
            }],
          },
        }],
      });
    }
    throw new Error('unexpected fetch ' + target);
  };

  try {
    const response = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALORDER123' }),
      env
    );
    assert.equal(response.status, 200);
    assert.match((await response.json()).url, /^\/api\/download\//);
    assert.equal(orderGets, 1);
    assert.equal(db.state.order.status, 'COMPLETED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('legacy PayPal public endpoints stay permanently retired even if PAYMENTS_ENABLED is true', async () => {
  const env = { PAYMENTS_ENABLED: 'true' };
  for (const path of ['/api/verify-payment', '/api/print/order-complete']) {
    const response = await worker.fetch(
      new Request('https://amitphotos.com' + path, { method: 'POST' }),
      env,
      { waitUntil() {} }
    );
    assert.equal(response.status, 410, path);
    assert.equal((await response.json()).error, 'LEGACY_PAYMENT_ENDPOINT_REMOVED');
  }
});


test('PayPal responses never reflect an untrusted Origin and CORS allows the idempotency header', async () => {
  const response = await handlePayPalCreateOrder(
    post(
      '/api/paypal/create-order',
      { type: 'digital', photoId: 'photo-1', sku: 'small' },
      { Origin: 'https://evil.example' }
    ),
    { PAYMENTS_ENABLED: 'false' }
  );
  assert.equal(response.status, 503);
  assert.notEqual(response.headers.get('Access-Control-Allow-Origin'), 'https://evil.example');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://amitphotos.com');
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /Idempotency-Key/);

  const preflight = await worker.fetch(
    new Request('https://amitphotos.com/api/paypal/create-order', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,idempotency-key',
      },
    }),
    {},
    { waitUntil() {} }
  );
  assert.equal(preflight.status, 204);
  assert.notEqual(preflight.headers.get('Access-Control-Allow-Origin'), 'https://evil.example');
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /Idempotency-Key/);
});


function paypalWebhookRequest(event) {
  return new Request('https://amitphotos.com/api/paypal/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
      'PAYPAL-CERT-URL': 'https://api-m.sandbox.paypal.com/certs/test.pem',
      'PAYPAL-TRANSMISSION-ID': 'transmission-123',
      'PAYPAL-TRANSMISSION-SIG': 'signature-123',
      'PAYPAL-TRANSMISSION-TIME': '2026-10-01T09:15:00Z',
    },
    body: JSON.stringify(event),
  });
}

test('webhook rejects an invalid PayPal signature before touching fulfillment', async () => {
  const db = makeDb();
  const env = {
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    PAYPAL_WEBHOOK_ID: 'WH-TEST',
    DB: db,
  };

  const event = {
    id: 'WH-EVENT-1',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {},
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (String(url).endsWith('/v1/notifications/verify-webhook-signature')) {
      return Response.json({ verification_status: 'FAILURE' });
    }
    throw new Error('unexpected fetch ' + url);
  };

  try {
    const response = await handlePayPalWebhook(paypalWebhookRequest(event), env);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'PAYPAL_WEBHOOK_SIGNATURE_INVALID');
    assert.equal(db.state.webhookEvents.size, 0);
    assert.equal(db.state.tokenInserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook deduplicates an already processed PayPal event', async () => {
  const db = makeDb();
  db.state.webhookEvents.set('WH-EVENT-2', {
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    received_at: new Date().toISOString(),
    processed: 1,
  });

  const env = {
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    PAYPAL_WEBHOOK_ID: 'WH-TEST',
    DB: db,
  };

  const event = {
    id: 'WH-EVENT-2',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {},
  };

  const originalFetch = globalThis.fetch;
  let orderLookups = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (String(url).endsWith('/v1/notifications/verify-webhook-signature')) {
      return Response.json({ verification_status: 'SUCCESS' });
    }
    if (String(url).includes('/v2/checkout/orders/')) {
      orderLookups += 1;
    }
    throw new Error('unexpected fetch ' + url);
  };

  try {
    const response = await handlePayPalWebhook(paypalWebhookRequest(event), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, duplicate: true });
    assert.equal(orderLookups, 0);
    assert.equal(db.state.tokenInserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test('stale webhook processing lease is reclaimed and processed on PayPal retry', async () => {
  const db = makeDb({
    order: {
      id: 'local-1',
      paypal_order_id: 'PAYPALORDER123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  db.state.webhookEvents.set('WH-STALE', {
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    received_at: new Date(Date.now() - 300000).toISOString(),
    processed: 2,
    processing_started_at: new Date(Date.now() - 300000).toISOString(),
    attempts: 1,
  });

  const env = {
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    PAYPAL_WEBHOOK_ID: 'WH-TEST',
    DB: db,
  };

  const event = {
    id: 'WH-STALE',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAPTURE-STALE',
      status: 'COMPLETED',
      amount: { currency_code: 'ILS', value: '19.00' },
      supplementary_data: { related_ids: { order_id: 'PAYPALORDER123' } },
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'access-token' });
    if (target.endsWith('/v1/notifications/verify-webhook-signature')) {
      return Response.json({ verification_status: 'SUCCESS' });
    }
    if (target.endsWith('/v2/checkout/orders/PAYPALORDER123')) {
      return Response.json({
        id: 'PAYPALORDER123',
        status: 'COMPLETED',
        purchase_units: [{
          custom_id: 'local-1',
          payments: {
            captures: [{
              id: 'CAPTURE-STALE',
              status: 'COMPLETED',
              amount: { currency_code: 'ILS', value: '19.00' },
            }],
          },
        }],
      });
    }
    throw new Error('unexpected fetch ' + target);
  };

  try {
    const response = await handlePayPalWebhook(paypalWebhookRequest(event), env);
    assert.equal(response.status, 200);
    assert.equal(db.state.webhookEvents.get('WH-STALE').processed, 1);
    assert.equal(db.state.webhookEvents.get('WH-STALE').attempts, 2);
    assert.equal(db.state.order.status, 'COMPLETED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook processing failure releases the lease so a later PayPal retry can recover', async () => {
  const db = makeDb({
    order: {
      id: 'local-1',
      paypal_order_id: 'PAYPALORDER123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });

  const env = {
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    PAYPAL_WEBHOOK_ID: 'WH-TEST',
    DB: db,
  };

  const event = {
    id: 'WH-FAIL-RETRY',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAPTURE-FAIL',
      status: 'COMPLETED',
      amount: { currency_code: 'ILS', value: '19.00' },
      supplementary_data: { related_ids: { order_id: 'PAYPALORDER123' } },
    },
  };

  const originalFetch = globalThis.fetch;
  let orderLookupCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'access-token' });
    if (target.endsWith('/v1/notifications/verify-webhook-signature')) {
      return Response.json({ verification_status: 'SUCCESS' });
    }
    if (target.endsWith('/v2/checkout/orders/PAYPALORDER123')) {
      orderLookupCalls += 1;
      if (orderLookupCalls === 1) return Response.json({ error: 'temporary' }, { status: 503 });
      return Response.json({
        id: 'PAYPALORDER123',
        status: 'COMPLETED',
        purchase_units: [{
          custom_id: 'local-1',
          payments: {
            captures: [{
              id: 'CAPTURE-FAIL',
              status: 'COMPLETED',
              amount: { currency_code: 'ILS', value: '19.00' },
            }],
          },
        }],
      });
    }
    throw new Error('unexpected fetch ' + target);
  };

  try {
    const first = await handlePayPalWebhook(paypalWebhookRequest(event), env);
    assert.equal(first.status, 502);
    assert.equal(db.state.webhookEvents.get('WH-FAIL-RETRY').processed, 0);

    const second = await handlePayPalWebhook(paypalWebhookRequest(event), env);
    assert.equal(second.status, 200);
    assert.equal(db.state.webhookEvents.get('WH-FAIL-RETRY').processed, 1);
    assert.equal(db.state.webhookEvents.get('WH-FAIL-RETRY').attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent duplicate webhook delivery does not process an in-flight event twice', async () => {
  const db = makeDb();
  db.state.webhookEvents.set('WH-EVENT-RACE', {
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    received_at: new Date().toISOString(),
    processed: 2,
    processing_started_at: new Date().toISOString(),
    attempts: 1,
  });

  const env = {
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    PAYPAL_WEBHOOK_ID: 'WH-TEST',
    DB: db,
  };

  const event = {
    id: 'WH-EVENT-RACE',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAPTURE-RACE',
      status: 'COMPLETED',
      amount: { currency_code: 'ILS', value: '19.00' },
      supplementary_data: {
        related_ids: { order_id: 'PAYPAL-RACE-ORDER' },
      },
    },
  };

  const originalFetch = globalThis.fetch;
  let orderLookups = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (target.endsWith('/v1/notifications/verify-webhook-signature')) {
      return Response.json({ verification_status: 'SUCCESS' });
    }
    if (target.includes('/v2/checkout/orders/')) orderLookups += 1;
    throw new Error('unexpected fetch ' + target);
  };

  try {
    const response = await handlePayPalWebhook(paypalWebhookRequest(event), env);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'PAYPAL_WEBHOOK_PROCESSING',
    });
    assert.equal(orderLookups, 0);
    assert.equal(db.state.tokenInserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verified completed-capture webhook recovers a local digital order and fulfills exactly once', async () => {
  const db = makeDb({
    order: {
      id: 'local-webhook-1',
      paypal_order_id: 'PAYPALWEBHOOK123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });

  const env = {
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    PAYPAL_WEBHOOK_ID: 'WH-TEST',
    DB: db,
  };

  const event = {
    id: 'WH-EVENT-3',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAPTURE-WH-1',
      status: 'COMPLETED',
      amount: { currency_code: 'ILS', value: '19.00' },
      supplementary_data: {
        related_ids: { order_id: 'PAYPALWEBHOOK123' },
      },
    },
  };

  const originalFetch = globalThis.fetch;
  let verifyCalls = 0;
  let orderCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (target.endsWith('/v1/notifications/verify-webhook-signature')) {
      verifyCalls += 1;
      return Response.json({ verification_status: 'SUCCESS' });
    }
    if (target.endsWith('/v2/checkout/orders/PAYPALWEBHOOK123')) {
      orderCalls += 1;
      return Response.json({
        id: 'PAYPALWEBHOOK123',
        status: 'COMPLETED',
        purchase_units: [{
          custom_id: 'local-webhook-1',
          payments: {
            captures: [{
              id: 'CAPTURE-WH-1',
              status: 'COMPLETED',
              amount: { currency_code: 'ILS', value: '19.00' },
            }],
          },
        }],
      });
    }
    throw new Error('unexpected fetch ' + target);
  };

  try {
    const first = await handlePayPalWebhook(paypalWebhookRequest(event), env);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.duplicate, false);
    assert.equal(db.state.order.status, 'COMPLETED');
    assert.equal(db.state.tokenInserts, 1);
    assert.equal(db.state.webhookEvents.get('WH-EVENT-3')?.processed, 1);
    assert.equal(verifyCalls, 1);
    assert.equal(orderCalls, 1);

    const second = await handlePayPalWebhook(paypalWebhookRequest(event), env);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { ok: true, duplicate: true });
    assert.equal(db.state.tokenInserts, 1);
    assert.equal(orderCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sandbox status authenticates against PayPal while payments stay disabled', async () => {
  const env = {
    PAYMENTS_ENABLED: 'false',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
  };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    assert.match(String(url), /api-m\.sandbox\.paypal\.com\/v1\/oauth2\/token$/);
    return Response.json({ access_token: 'access-token' });
  };
  try {
    const response = await handlePayPalSandboxStatus(
      new Request('https://amitphotos.com/api/admin/paypal/sandbox-status'),
      env
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      environment: 'sandbox',
      paymentsEnabled: false,
      credentialsConfigured: true,
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin sandbox route rejects unauthenticated callers before contacting PayPal', async () => {
  const env = {
    PAYMENTS_ENABLED: 'false',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: {
      prepare() {
        return {
          bind() {
            return { first: async () => null };
          },
        };
      },
    },
  };

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('must not contact PayPal');
  };
  try {
    const response = await worker.fetch(
      new Request('https://amitphotos.com/api/admin/paypal/sandbox-status'),
      env,
      { waitUntil() {} }
    );
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin create-order can use Sandbox while the public payment flag remains false', async () => {
  const db = makeDb();
  const env = {
    PAYMENTS_ENABLED: 'false',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    return Response.json({
      id: 'PAYPALADMIN123',
      status: 'CREATED',
      links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALADMIN123' }],
    }, { status: 201 });
  };

  try {
    const publicResponse = await handlePayPalCreateOrder(
      post('/api/paypal/create-order', { type: 'digital', photoId: 'photo-1', sku: 'small' }),
      env
    );
    assert.equal(publicResponse.status, 503);

    const adminResponse = await handlePayPalCreateOrder(
      post('/api/admin/paypal/create-order', { type: 'digital', photoId: 'photo-1', sku: 'small' }),
      env,
      { allowWhenPaymentsDisabled: true, includeApproveUrl: true }
    );
    assert.equal(adminResponse.status, 201);
    const body = await adminResponse.json();
    assert.equal(body.paypalOrderId, 'PAYPALADMIN123');
    assert.match(body.approveUrl, /^https:\/\/www\.sandbox\.paypal\.com\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('create-order sends a complete PayPal approval experience', async () => {
  const db = makeDb();
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  let createPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    createPayload = JSON.parse(options.body);
    return Response.json({
      id: 'PAYPALAPPROVE123',
      status: 'CREATED',
      links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALAPPROVE123' }],
    }, { status: 201 });
  };

  try {
    const response = await handlePayPalCreateOrder(
      post('/api/admin/paypal/create-order', {
        type: 'digital',
        photoId: 'photo-1',
        sku: 'small',
        currency: 'ILS',
      }),
      env,
      { allowWhenPaymentsDisabled: true, includeApproveUrl: true, skipRateLimit: true }
    );
    assert.equal(response.status, 201);
    assert.equal(createPayload.payment_source.paypal.experience_context.shipping_preference, 'NO_SHIPPING');
    assert.equal(createPayload.payment_source.paypal.experience_context.user_action, 'PAY_NOW');
    assert.equal(
      createPayload.payment_source.paypal.experience_context.return_url,
      'https://amitphotos.com/api/paypal/approved'
    );
    assert.equal(
      createPayload.payment_source.paypal.experience_context.cancel_url,
      'https://amitphotos.com/api/paypal/cancelled'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('create-order accepts payer-action links from PayPal', async () => {
  const db = makeDb();
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    return Response.json({
      id: 'PAYPALPAYERACTION123',
      status: 'PAYER_ACTION_REQUIRED',
      links: [{
        rel: 'payer-action',
        href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALPAYERACTION123',
      }],
    }, { status: 201 });
  };

  try {
    const response = await handlePayPalCreateOrder(
      post('/api/admin/paypal/create-order', {
        type: 'digital',
        photoId: 'photo-1',
        sku: 'small',
        currency: 'ILS',
      }),
      env,
      { allowWhenPaymentsDisabled: true, includeApproveUrl: true, skipRateLimit: true }
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(
      body.approveUrl,
      'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALPAYERACTION123'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('PayPal return routes render without worker exceptions', async () => {
  for (const path of ['/api/paypal/approved', '/api/paypal/cancelled']) {
    const response = await worker.fetch(
      new Request('https://amitphotos.com' + path),
      {},
      { waitUntil() {} }
    );
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('Content-Type') || '', /text\/html/);
    const html = await response.text();
    assert.match(html, /PayPal Sandbox/);
  }
});


test('capture-order accepts a completed capture when PayPal omits optional custom_id', async () => {
  const db = makeDb({
    order: {
      id: 'local-1',
      paypal_order_id: 'PAYPALORDER123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    return Response.json({
      id: 'PAYPALORDER123',
      status: 'COMPLETED',
      purchase_units: [{
        payments: {
          captures: [{
            id: 'CAPTURE-NO-CUSTOM-ID',
            status: 'COMPLETED',
            amount: { currency_code: 'ILS', value: '19.00' },
          }],
        },
      }],
    }, { status: 201 });
  };

  try {
    const response = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALORDER123' }),
      env
    );
    assert.equal(response.status, 200);
    assert.match((await response.json()).url, /^\/api\/download\//);
    assert.equal(db.state.order.status, 'COMPLETED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('capture-order rejects malformed and unknown order IDs without calling PayPal', async () => {
  const db = makeDb();
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('PayPal must not be called');
  };

  try {
    const malformed = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'bad' }),
      env
    );
    assert.equal(malformed.status, 400);

    const unknown = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'UNKNOWNORDER123' }),
      env
    );
    assert.equal(unknown.status, 404);

    assert.equal(fetchCalls, 0);
    assert.equal(db.state.tokenInserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('capture-order leaves an unapproved PayPal order untouched', async () => {
  const db = makeDb({
    order: {
      id: 'local-unapproved',
      paypal_order_id: 'PAYPALUNAPPROVED123',
      order_type: 'digital',
      photo_id: 'photo-1',
      sku: 'small',
      amount_expected: 1900,
      currency: 'ILS',
      status: 'CREATED',
      fulfillment_json: null,
      fulfillment_token: null,
      paypal_capture_id: null,
    },
  });
  const env = {
    PAYMENTS_ENABLED: 'true',
    PAYPAL_CLIENT_ID: 'sandbox-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-secret',
    DB: db,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth2/token')) {
      return Response.json({ access_token: 'access-token' });
    }
    if (target.endsWith('/capture')) {
      return Response.json({
        name: 'UNPROCESSABLE_ENTITY',
        details: [{ issue: 'ORDER_NOT_APPROVED' }],
      }, { status: 422 });
    }
    throw new Error('unexpected fetch ' + target);
  };

  try {
    const response = await handlePayPalCaptureOrder(
      post('/api/paypal/capture-order', { paypalOrderId: 'PAYPALUNAPPROVED123' }),
      env
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'PayPal capture failed');
    assert.equal(db.state.order.status, 'CREATED');
    assert.equal(db.state.order.paypal_capture_id, null);
    assert.equal(db.state.order.fulfillment_token, null);
    assert.equal(db.state.tokenInserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('sandbox cleanup is disabled unless explicitly enabled', async () => {
  const response = await handlePayPalSandboxCleanup(
    post('/api/admin/paypal/cleanup', { apply: false }),
    { PAYPAL_SANDBOX_CLEANUP_ENABLED: 'false' }
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'PAYPAL_SANDBOX_CLEANUP_DISABLED');
});

test('sandbox cleanup dry-run reports candidates and performs no deletes', async () => {
  const seenSql = [];
  const db = {
    prepare(sql) {
      seenSql.push(sql);
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM paypal_orders')) return { count: 3 };
              if (sql.includes('FROM paypal_webhook_events')) return { count: 7 };
              return null;
            },
            async run() {
              throw new Error('dry-run must not delete');
            },
          };
        },
      };
    },
  };

  const response = await handlePayPalSandboxCleanup(
    post('/api/admin/paypal/cleanup', { apply: false }),
    { PAYPAL_SANDBOX_CLEANUP_ENABLED: 'true', DB: db }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dryRun, true);
  assert.deepEqual(body.candidates, { abandonedOrders: 3, processedWebhookEvents: 7 });
  assert.equal(body.retentionDays.abandonedOrders, 7);
  assert.equal(body.retentionDays.processedWebhookEvents, 90);
  assert.equal(seenSql.some(sql => sql.startsWith('DELETE')), false);
});

test('sandbox cleanup apply deletes only safe abandoned orders and processed webhooks', async () => {
  const deleteSql = [];
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM paypal_orders')) return { count: 2 };
              if (sql.includes('FROM paypal_webhook_events')) return { count: 4 };
              return null;
            },
            async run() {
              deleteSql.push(sql);
              return { success: true, meta: { changes: sql.includes('paypal_orders') ? 2 : 4 } };
            },
          };
        },
      };
    },
  };

  const response = await handlePayPalSandboxCleanup(
    post('/api/admin/paypal/cleanup', { apply: true }),
    { PAYPAL_SANDBOX_CLEANUP_ENABLED: 'true', DB: db }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dryRun, false);
  assert.deepEqual(body.deleted, { abandonedOrders: 2, processedWebhookEvents: 4 });

  assert.equal(deleteSql.length, 2);
  assert.match(deleteSql[0], /DELETE FROM paypal_orders/);
  assert.match(deleteSql[0], /status='CREATED'/);
  assert.match(deleteSql[0], /paypal_capture_id IS NULL/);
  assert.match(deleteSql[0], /fulfillment_token IS NULL/);
  assert.match(deleteSql[0], /completed_at IS NULL/);
  assert.doesNotMatch(deleteSql[0], /COMPLETED|FULFILLING/);
  assert.match(deleteSql[1], /DELETE FROM paypal_webhook_events/);
  assert.match(deleteSql[1], /processed=1/);
  assert.equal(deleteSql.some(sql => /download_tokens/.test(sql)), false);
});
