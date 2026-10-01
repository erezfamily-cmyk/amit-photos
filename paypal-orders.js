const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const DIGITAL_SIZES = new Set(['small', 'medium', 'large']);
const DIGITAL_CURRENCIES = new Set(['ILS', 'USD']);
const DIGITAL_ILS_TO_USD = 3.7;
const ALLOWED_ORIGINS = ['https://amitphotos.com', 'https://www.amitphotos.com'];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}

function jsonRes(data, status, request) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

function paymentsDisabledResponse(request) {
  return jsonRes({
    error: 'PAYMENTS_TEMPORARILY_DISABLED',
    message: {
      he: 'אפשרות הרכישה נמצאת בשדרוג אבטחה ותחזור בקרוב',
      en: 'Purchasing is temporarily unavailable while we upgrade payment security.',
    },
  }, 503, request);
}

function paypalApiBase() {
  // Phase 1 is intentionally sandbox-only. Live is a separate go-live step.
  return PAYPAL_SANDBOX_API;
}

function moneyToMinorUnits(value) {
  const text = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const minor = Math.round(Number(text) * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function minorUnitsToPayPalValue(minor) {
  return (minor / 100).toFixed(2);
}

async function getGlobalPrices(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key='prices'").first();
  if (row?.value) {
    try { return JSON.parse(row.value); } catch {}
  }
  return { small: 19, medium: 59, large: 129 };
}

async function getPayPalAccessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PAYPAL_CREDENTIALS_MISSING');
  }
  const auth = btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET);
  const response = await fetch(paypalApiBase() + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error('PAYPAL_OAUTH_FAILED');
  const data = await response.json().catch(() => ({}));
  if (!data.access_token) throw new Error('PAYPAL_OAUTH_INVALID_RESPONSE');
  return data.access_token;
}

async function resolveDigitalPayPalPrice(env, photoId, size, currency) {
  if (!photoId || typeof photoId !== 'string' || photoId.length > 200) return { error: 'photoId לא תקין', status: 400 };
  if (!DIGITAL_SIZES.has(size)) return { error: 'גודל לא תקין', status: 400 };
  if (!DIGITAL_CURRENCIES.has(currency)) return { error: 'מטבע לא תקין', status: 400 };

  const photo = await env.DB.prepare(
    'SELECT id, price_overrides, published FROM photos WHERE id = ?'
  ).bind(photoId).first();
  if (!photo || photo.published === 0) return { error: 'תמונה לא נמצאה', status: 404 };

  const prices = await getGlobalPrices(env);
  let priceIls = Number(prices[size]);
  if (photo.price_overrides) {
    try {
      const overrides = JSON.parse(photo.price_overrides);
      if (overrides[size] != null) priceIls = Number(overrides[size]);
    } catch {}
  }
  if (!Number.isFinite(priceIls) || priceIls < 0) return { error: 'מחיר לא תקין', status: 500 };

  // Preserve the current storefront rule for English checkout. The client may
  // choose the currency, but it never supplies the amount.
  const major = currency === 'USD' ? Math.round(priceIls / DIGITAL_ILS_TO_USD) : priceIls;
  const amountExpected = Math.round(major * 100);
  if (!Number.isSafeInteger(amountExpected) || amountExpected < 0) return { error: 'מחיר לא תקין', status: 500 };

  return { amountExpected, currency };
}

export async function handlePayPalCreateOrder(request, env) {
  if (env.PAYMENTS_ENABLED !== 'true') return paymentsDisabledResponse(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  const body = await request.json().catch(() => ({}));
  if (body.type !== 'digital') {
    return jsonRes({ error: 'בשלב זה Orders v2 מופעל רק לרכישה דיגיטלית' }, 400, request);
  }

  const photoId = body.photoId;
  const sku = body.sku;
  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : 'ILS';
  const pricing = await resolveDigitalPayPalPrice(env, photoId, sku, currency);
  if (pricing.error) return jsonRes({ error: pricing.error }, pricing.status, request);

  let accessToken;
  try {
    accessToken = await getPayPalAccessToken(env);
  } catch {
    return jsonRes({ error: 'PayPal authentication failed' }, 502, request);
  }

  const localId = crypto.randomUUID();
  const paypalResponse = await fetch(paypalApiBase() + '/v2/checkout/orders', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'PayPal-Request-Id': 'amit-create-' + localId,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: localId,
        description: 'Amit Photos digital license (' + sku + ')',
        amount: {
          currency_code: pricing.currency,
          value: minorUnitsToPayPalValue(pricing.amountExpected),
        },
      }],
    }),
  });

  const paypalOrder = await paypalResponse.json().catch(() => ({}));
  if (!paypalResponse.ok || !paypalOrder.id) {
    return jsonRes({ error: 'PayPal create-order failed' }, 502, request);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at) VALUES (?, ?, 'digital', ?, ?, ?, ?, 'CREATED', ?)"
    ).bind(
      localId,
      paypalOrder.id,
      photoId,
      sku,
      pricing.amountExpected,
      pricing.currency,
      new Date().toISOString()
    ).run();
  } catch {
    return jsonRes({ error: 'Could not persist PayPal order' }, 500, request);
  }

  return jsonRes({ paypalOrderId: paypalOrder.id }, 201, request);
}

async function finalizeDigitalPayPalOrder(request, env, order) {
  const captureId = order.paypal_capture_id;
  const fulfillmentToken = order.fulfillment_token;
  if (!captureId || !fulfillmentToken) {
    return jsonRes({ error: 'PayPal fulfillment state is incomplete' }, 500, request);
  }

  const now = Math.floor(Date.now() / 1000);
  const expires = now + 86400;
  await env.DB.prepare(
    'INSERT OR IGNORE INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
  ).bind(
    fulfillmentToken,
    JSON.stringify([order.photo_id]),
    order.sku,
    captureId,
    expires,
    now,
    order.amount_expected / 100
  ).run();

  const photo = await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(order.photo_id).first();
  const fulfillment = {
    url: '/api/download/' + fulfillmentToken,
    title: photo?.title || order.photo_id,
  };

  await env.DB.prepare(
    "UPDATE paypal_orders SET status='COMPLETED', fulfillment_json=?, completed_at=? WHERE paypal_order_id=?"
  ).bind(JSON.stringify(fulfillment), new Date().toISOString(), order.paypal_order_id).run();

  return jsonRes(fulfillment, 200, request);
}

export async function handlePayPalCaptureOrder(request, env) {
  if (env.PAYMENTS_ENABLED !== 'true') return paymentsDisabledResponse(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  const body = await request.json().catch(() => ({}));
  const paypalOrderId = body.paypalOrderId;
  if (typeof paypalOrderId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(paypalOrderId)) {
    return jsonRes({ error: 'paypalOrderId לא תקין' }, 400, request);
  }

  let order = await env.DB.prepare(
    'SELECT * FROM paypal_orders WHERE paypal_order_id = ?'
  ).bind(paypalOrderId).first();
  if (!order) return jsonRes({ error: 'הזמנה לא נמצאה' }, 404, request);

  if (order.status === 'COMPLETED' && order.fulfillment_json) {
    try { return jsonRes(JSON.parse(order.fulfillment_json), 200, request); }
    catch { return jsonRes({ error: 'Stored fulfillment is invalid' }, 500, request); }
  }

  // A prior request may have captured successfully but been interrupted during
  // local fulfillment. Resume locally without charging again.
  if (order.status === 'FULFILLING' && order.paypal_capture_id && order.fulfillment_token && order.order_type === 'digital') {
    return finalizeDigitalPayPalOrder(request, env, order);
  }

  let accessToken;
  try {
    accessToken = await getPayPalAccessToken(env);
  } catch {
    return jsonRes({ error: 'PayPal authentication failed' }, 502, request);
  }

  const paypalResponse = await fetch(
    paypalApiBase() + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId) + '/capture',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'PayPal-Request-Id': 'amit-capture-' + order.id,
      },
      body: '{}',
    }
  );

  const capturedOrder = await paypalResponse.json().catch(() => ({}));
  if (!paypalResponse.ok || capturedOrder.status !== 'COMPLETED') {
    return jsonRes({ error: 'PayPal capture failed' }, 502, request);
  }

  const capture = capturedOrder.purchase_units?.[0]?.payments?.captures?.[0];
  const captureMinor = moneyToMinorUnits(capture?.amount?.value);
  if (
    capture?.status !== 'COMPLETED' ||
    capture?.amount?.currency_code !== order.currency ||
    captureMinor !== order.amount_expected
  ) {
    return jsonRes({ error: 'PayPal capture amount mismatch' }, 502, request);
  }

  const fulfillmentToken = crypto.randomUUID();
  const claim = await env.DB.prepare(
    "UPDATE paypal_orders SET status='FULFILLING', paypal_capture_id=?, fulfillment_token=? WHERE paypal_order_id=? AND status NOT IN ('FULFILLING','COMPLETED')"
  ).bind(capture.id, fulfillmentToken, paypalOrderId).run();

  if ((claim.meta?.changes || 0) === 0) {
    order = await env.DB.prepare('SELECT * FROM paypal_orders WHERE paypal_order_id = ?').bind(paypalOrderId).first();
    if (order?.status === 'COMPLETED' && order.fulfillment_json) {
      return jsonRes(JSON.parse(order.fulfillment_json), 200, request);
    }
    if (order?.status === 'FULFILLING' && order.paypal_capture_id && order.fulfillment_token && order.order_type === 'digital') {
      return finalizeDigitalPayPalOrder(request, env, order);
    }
    return jsonRes({ error: 'Order is already being processed' }, 409, request);
  }

  order = { ...order, status: 'FULFILLING', paypal_capture_id: capture.id, fulfillment_token: fulfillmentToken };
  if (order.order_type !== 'digital') {
    return jsonRes({ error: 'Print fulfillment is not enabled in this phase' }, 409, request);
  }
  return finalizeDigitalPayPalOrder(request, env, order);
}
