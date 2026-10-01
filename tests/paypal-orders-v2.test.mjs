import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePayPalCreateOrder, handlePayPalCaptureOrder } from '../paypal-orders.js';

function makeDb(options = {}) {
  const state = {
    prices: options.prices || { small: 19, medium: 59, large: 129 },
    photo: options.photo || { id: 'photo-1', published: 1, price_overrides: null, title: 'Test Photo' },
    order: options.order || null,
    token: options.token || null,
    tokenInserts: 0,
    orderInserts: 0,
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
              if (sql.includes('SELECT * FROM paypal_orders')) {
                return state.order;
              }
              if (sql.includes('FROM download_tokens WHERE tx = ?')) {
                return state.token;
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
                state.token = { token: args[0] };
                return { success: true, meta: { changes: 1 } };
              }
              if (sql.includes("SET status='COMPLETED'")) {
                state.order.status = 'COMPLETED';
                state.order.fulfillment_json = args[0];
                state.order.completed_at = args[1];
                return { success: true, meta: { changes: 1 } };
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

function post(path, body) {
  return new Request('https://amitphotos.com' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
