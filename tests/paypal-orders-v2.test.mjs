import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handlePayPalCreateOrder, handlePayPalCaptureOrder, handlePayPalSandboxStatus } from '../worker.js';

function makeDb(options = {}) {
  const state = {
    prices: options.prices || { small: 19, medium: 59, large: 129 },
    photo: options.photo || { id: 'photo-1', published: 1, price_overrides: null, title: 'Test Photo' },
    order: options.order || null,
    token: options.token || null,
    tokenInserts: 0,
    orderInserts: 0,
    rateLimits: new Map(),
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
