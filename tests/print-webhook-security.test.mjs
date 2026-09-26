import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePrintOrderComplete, handlePrintWebhook } from '../worker.js';

function webhookRequest(body) {
  return new Request('https://amitphotos.com/api/print/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function makeWebhookEnv(order, updateChanges = 1) {
  const calls = { selects: 0, updates: 0, emails: [] };
  const env = {
    RESEND_API_KEY: 'resend-test-key',
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                calls.selects += 1;
                calls.lastSelect = { sql, args };
                return order;
              },
              async run() {
                calls.updates += 1;
                calls.lastUpdate = { sql, args };
                return { success: true, meta: { changes: updateChanges } };
              },
            };
          },
        };
      },
    },
  };
  return { env, calls };
}

async function withFetchStub(fn) {
  const originalFetch = globalThis.fetch;
  const emails = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('api.resend.com')) {
      emails.push(JSON.parse(options.body));
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    return await fn(emails);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('webhook rejects malformed and structurally invalid payloads before touching D1', async () => {
  const invalidBodies = [
    '{not json',
    null,
    [],
    {},
    { orderId: 42, fulfillmentStatus: 'shipped' },
    { orderId: 'gelato-1', fulfillmentStatus: 42 },
    { orderId: 'x'.repeat(201), fulfillmentStatus: 'shipped' },
    { orderId: 'gelato-1', fulfillmentStatus: 'unknown' },
    { orderId: 'gelato-1', fulfillmentStatus: 'shipped', items: {} },
    { orderId: 'gelato-1', fulfillmentStatus: 'shipped', items: [{ fulfillments: {} }] },
    { orderId: 'gelato-1', fulfillmentStatus: 'shipped', items: [{ fulfillments: [{ trackingCode: 42 }] }] },
    { orderId: 'gelato-1', fulfillmentStatus: 'shipped', items: [{ fulfillments: [{ trackingCode: 'x'.repeat(501) }] }] },
  ];

  for (const body of invalidBodies) {
    const { env, calls } = makeWebhookEnv(null);
    const response = await handlePrintWebhook(webhookRequest(body), env);
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.equal(calls.selects, 0);
    assert.equal(calls.updates, 0);
  }
});

test('webhook ignores an unknown Gelato order without updating D1 or sending email', async () => {
  const { env, calls } = makeWebhookEnv(null);
  await withFetchStub(async emails => {
    const response = await handlePrintWebhook(webhookRequest({
      orderId: 'unknown-order', fulfillmentStatus: 'shipped',
    }), env);
    assert.equal(response.status, 200);
    assert.equal(calls.selects, 1);
    assert.equal(calls.updates, 0);
    assert.equal(emails.length, 0);
  });
});

test('webhook ignores status changes for a locally cancelled order', async () => {
  const { env, calls } = makeWebhookEnv({
    id: 'local-1', prodigi_order_id: 'gelato-1', status: 'cancelled', customer_email: 'buyer@example.com',
  });
  await withFetchStub(async emails => {
    const response = await handlePrintWebhook(webhookRequest({
      orderId: 'gelato-1', fulfillmentStatus: 'shipped',
    }), env);
    assert.equal(response.status, 200);
    assert.equal(calls.updates, 0);
    assert.equal(emails.length, 0);
  });
});

test('duplicate shipped and delivered webhooks do not update or resend shipping email', async () => {
  for (const fulfillmentStatus of ['shipped', 'delivered']) {
    const { env, calls } = makeWebhookEnv({
      id: 'local-1', prodigi_order_id: 'gelato-1', status: 'shipped', customer_email: 'buyer@example.com',
    });
    await withFetchStub(async emails => {
      const response = await handlePrintWebhook(webhookRequest({
        orderId: 'gelato-1', fulfillmentStatus,
      }), env);
      assert.equal(response.status, 200);
      assert.equal(calls.updates, 0);
      assert.equal(emails.length, 0);
    });
  }
});

test('a real transition to shipped updates conditionally and sends one safely escaped email', async () => {
  const order = {
    id: 'local-1',
    prodigi_order_id: 'gelato-1',
    status: 'in_production',
    customer_email: 'buyer@example.com',
    customer_name: '<img src=x onerror=alert(1)>',
    product_label: '<script>alert(2)</script>',
    address_line1: '<b>street</b>',
    address_city: 'City & Town',
    address_zip: '12<34',
  };
  const { env, calls } = makeWebhookEnv(order, 1);

  await withFetchStub(async emails => {
    const response = await handlePrintWebhook(webhookRequest({
      orderId: 'gelato-1',
      fulfillmentStatus: 'shipped',
      items: [{ fulfillments: [{ trackingCode: '<svg onload=alert(3)>&' }] }],
    }), env);

    assert.equal(response.status, 200);
    assert.equal(calls.updates, 1);
    assert.match(calls.lastUpdate.sql, /status\s*=\s*\?/i);
    assert.match(calls.lastUpdate.sql, /prodigi_order_id\s*=\s*\?.*status\s*=\s*\?/i);
    assert.deepEqual(calls.lastUpdate.args, ['shipped', 'gelato-1', 'in_production']);
    assert.equal(emails.length, 1);
    const html = emails[0].html;
    for (const unsafe of ['<img', '<script', '<b>', '<svg']) assert.equal(html.includes(unsafe), false);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
    assert.match(html, /&lt;svg onload=alert\(3\)&gt;&amp;/);
    assert.match(html, /City &amp; Town/);
  });
});

test('a lost conditional-update race does not send a duplicate shipping email', async () => {
  const { env, calls } = makeWebhookEnv({
    id: 'local-1', prodigi_order_id: 'gelato-1', status: 'in_production', customer_email: 'buyer@example.com',
  }, 0);
  await withFetchStub(async emails => {
    const response = await handlePrintWebhook(webhookRequest({
      orderId: 'gelato-1', fulfillmentStatus: 'shipped',
    }), env);
    assert.equal(response.status, 200);
    assert.equal(calls.updates, 1);
    assert.equal(emails.length, 0);
  });
});

test('print-order confirmation escapes a catalog-miss SKU in customer and admin email HTML', async () => {
  const maliciousSku = '<img src=x onerror=alert(9)>';
  const custom = Buffer.from(JSON.stringify({
    name: 'Buyer', email: 'buyer@example.com', phone: '0500000000',
    line1: 'Main 1', city: 'Test', zip: '12345',
  })).toString('base64');
  const allParams = new URLSearchParams({
    payment_status: 'Completed', receiver_id: 'merchant', mc_currency: 'USD', mc_gross: '49', custom,
  }).toString();
  const db = {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('paypal_tx')) return null;
              if (sql.includes('FROM photos')) return { url: '/photos/test.webp' };
              return null;
            },
            async run() { return { success: true, meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
  const env = {
    PAYMENTS_ENABLED: 'true', PAYPAL_RECEIVER_ID: 'merchant', GELATO_API_KEY: 'gelato-key',
    RESEND_API_KEY: 'resend-key', DB: db,
  };
  const request = new Request('https://amitphotos.com/api/print/order-complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx: 'tx-1', itemNumber: `PRINT_photo-1_${maliciousSku}`, allParams }),
  });

  const originalFetch = globalThis.fetch;
  const emails = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/orders')) return Response.json({ id: 'gelato-1' });
    if (String(url).includes('api.resend.com')) {
      emails.push(JSON.parse(options.body));
      return Response.json({ id: 'email-1' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const response = await handlePrintOrderComplete(request, env);
    assert.equal(response.status, 200);
    assert.equal(emails.length, 2);
    for (const email of emails) {
      assert.equal(email.html.includes(maliciousSku), false);
      assert.match(email.html, /&lt;img src=x onerror=alert\(9\)&gt;/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
