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
    'Access-Control-Allow-Headers': 'Content-Type,Idempotency-Key',
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

function payerApprovalUrl(order) {
  if (!Array.isArray(order?.links)) return null;
  return order.links.find(link => link.rel === 'approve')?.href
    || order.links.find(link => link.rel === 'payer-action')?.href
    || null;
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

function validIdempotencyKey(value) {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= 64
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function enforcePayPalRateLimit(request, env, action, limit, windowSeconds = 60) {
  // Admin-only sandbox hooks are already authenticated and are not public
  // commerce traffic, so they can opt out at the call site.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = await sha256Hex(ip);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;

  await env.DB.prepare(
    `INSERT INTO paypal_rate_limits (rate_key, action, window_start, count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(rate_key, action, window_start)
     DO UPDATE SET count = count + 1`
  ).bind(rateKey, action, windowStart).run();

  const row = await env.DB.prepare(
    'SELECT count FROM paypal_rate_limits WHERE rate_key=? AND action=? AND window_start=?'
  ).bind(rateKey, action, windowStart).first();

  if ((row?.count || 0) > limit) {
    return jsonRes({ error: 'RATE_LIMITED' }, 429, request);
  }

  // Lazy bounded cleanup. Failure must never make checkout unavailable.
  env.DB.prepare(
    'DELETE FROM paypal_rate_limits WHERE window_start < ?'
  ).bind(now - 3600).run().catch(() => {});

  return null;
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

export async function handlePayPalSandboxStatus(request, env) {
  if (request.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405, request);
  try {
    await getPayPalAccessToken(env);
    return jsonRes({
      ok: true,
      environment: 'sandbox',
      paymentsEnabled: env.PAYMENTS_ENABLED === 'true',
      credentialsConfigured: true,
    }, 200, request);
  } catch {
    return jsonRes({
      ok: false,
      environment: 'sandbox',
      paymentsEnabled: env.PAYMENTS_ENABLED === 'true',
      credentialsConfigured: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
      error: 'PayPal Sandbox authentication failed',
    }, 502, request);
  }
}

function paypalWebhookHeaders(request) {
  return {
    auth_algo: request.headers.get('PAYPAL-AUTH-ALGO'),
    cert_url: request.headers.get('PAYPAL-CERT-URL'),
    transmission_id: request.headers.get('PAYPAL-TRANSMISSION-ID'),
    transmission_sig: request.headers.get('PAYPAL-TRANSMISSION-SIG'),
    transmission_time: request.headers.get('PAYPAL-TRANSMISSION-TIME'),
  };
}

function validWebhookHeaders(headers) {
  return Object.values(headers).every(value => typeof value === 'string' && value.length > 0);
}

async function verifyPayPalWebhook(request, env, rawBody) {
  if (!env.PAYPAL_WEBHOOK_ID) return { ok: false, error: 'PAYPAL_WEBHOOK_ID_MISSING' };

  const headers = paypalWebhookHeaders(request);
  if (!validWebhookHeaders(headers)) return { ok: false, error: 'PAYPAL_WEBHOOK_HEADERS_MISSING' };

  let webhookEvent;
  try {
    webhookEvent = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'PAYPAL_WEBHOOK_INVALID_JSON' };
  }

  const accessToken = await getPayPalAccessToken(env);
  const response = await fetch(paypalApiBase() + '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      ...headers,
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: webhookEvent,
    }),
  });
  const verification = await response.json().catch(() => ({}));
  if (!response.ok || verification.verification_status !== 'SUCCESS') {
    return { ok: false, error: 'PAYPAL_WEBHOOK_SIGNATURE_INVALID' };
  }
  return { ok: true, event: webhookEvent, accessToken };
}

const PAYPAL_WEBHOOK_LEASE_SECONDS = 120;

async function markWebhookProcessed(env, eventId) {
  await env.DB.prepare(
    "UPDATE paypal_webhook_events SET processed=1, processing_started_at=NULL WHERE event_id=?"
  ).bind(eventId).run();
}

async function releaseWebhookLease(env, eventId) {
  await env.DB.prepare(
    "UPDATE paypal_webhook_events SET processed=0, processing_started_at=NULL WHERE event_id=? AND processed=2"
  ).bind(eventId).run();
}

async function acquireWebhookLease(env, eventId, eventType) {
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - PAYPAL_WEBHOOK_LEASE_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    'INSERT OR IGNORE INTO paypal_webhook_events (event_id, event_type, received_at, processed, processing_started_at, attempts) VALUES (?, ?, ?, 0, NULL, 0)'
  ).bind(eventId, eventType, nowIso).run();

  const existing = await env.DB.prepare(
    'SELECT processed, processing_started_at, attempts FROM paypal_webhook_events WHERE event_id=?'
  ).bind(eventId).first();

  if (existing?.processed === 1) {
    return { acquired: false, done: true, busy: false };
  }

  const claim = await env.DB.prepare(
    `UPDATE paypal_webhook_events
     SET processed=2, processing_started_at=?, attempts=attempts+1
     WHERE event_id=?
       AND (
         processed=0
         OR (
           processed=2
           AND (processing_started_at IS NULL OR processing_started_at < ?)
         )
       )`
  ).bind(nowIso, eventId, cutoffIso).run();

  if ((claim.meta?.changes || 0) > 0) {
    return { acquired: true, done: false, busy: false };
  }

  const raced = await env.DB.prepare(
    'SELECT processed, processing_started_at, attempts FROM paypal_webhook_events WHERE event_id=?'
  ).bind(eventId).first();
  return {
    acquired: false,
    done: raced?.processed === 1,
    busy: raced?.processed === 2,
  };
}

async function processCompletedCaptureWebhook(request, env, event, accessToken) {
  const resource = event.resource || {};
  const paypalOrderId = resource.supplementary_data?.related_ids?.order_id;
  const captureId = resource.id;
  const captureMinor = moneyToMinorUnits(resource.amount?.value);

  if (
    typeof paypalOrderId !== 'string' ||
    !paypalOrderId ||
    typeof captureId !== 'string' ||
    !captureId ||
    resource.status !== 'COMPLETED'
  ) {
    return { ok: false, status: 400, error: 'PAYPAL_WEBHOOK_CAPTURE_INVALID' };
  }

  let order = await env.DB.prepare(
    'SELECT * FROM paypal_orders WHERE paypal_order_id=?'
  ).bind(paypalOrderId).first();

  // Unknown orders are acknowledged but not fulfilled. This endpoint must not
  // create entitlements for transactions that did not originate locally.
  if (!order) return { ok: true, ignored: true };

  if (
    resource.amount?.currency_code !== order.currency ||
    captureMinor !== order.amount_expected
  ) {
    return { ok: false, status: 409, error: 'PAYPAL_WEBHOOK_AMOUNT_MISMATCH' };
  }

  const orderResponse = await fetch(
    paypalApiBase() + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId),
    {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Accept': 'application/json',
      },
    }
  );
  const authoritative = await orderResponse.json().catch(() => ({}));
  if (!orderResponse.ok) {
    return { ok: false, status: 502, error: 'PAYPAL_WEBHOOK_ORDER_LOOKUP_FAILED' };
  }

  const authoritativeCapture = authoritative.purchase_units?.[0]?.payments?.captures?.find(
    item => item?.id === captureId
  );
  if (
    authoritative.id !== paypalOrderId ||
    authoritative.status !== 'COMPLETED' ||
    authoritative.purchase_units?.[0]?.custom_id !== order.id ||
    authoritativeCapture?.status !== 'COMPLETED' ||
    authoritativeCapture?.amount?.currency_code !== order.currency ||
    moneyToMinorUnits(authoritativeCapture?.amount?.value) !== order.amount_expected
  ) {
    return { ok: false, status: 409, error: 'PAYPAL_WEBHOOK_IDENTITY_MISMATCH' };
  }

  if (order.status === 'COMPLETED' && order.fulfillment_json) {
    return { ok: true, alreadyCompleted: true };
  }

  if (order.order_type !== 'digital') {
    return { ok: true, ignored: true };
  }

  if (order.status !== 'FULFILLING' || !order.paypal_capture_id || !order.fulfillment_token) {
    const fulfillmentToken = crypto.randomUUID();
    const claim = await env.DB.prepare(
      "UPDATE paypal_orders SET status='FULFILLING', paypal_capture_id=?, fulfillment_token=? WHERE paypal_order_id=? AND status NOT IN ('FULFILLING','COMPLETED')"
    ).bind(captureId, fulfillmentToken, paypalOrderId).run();

    if ((claim.meta?.changes || 0) > 0) {
      order = { ...order, status: 'FULFILLING', paypal_capture_id: captureId, fulfillment_token: fulfillmentToken };
    } else {
      order = await env.DB.prepare(
        'SELECT * FROM paypal_orders WHERE paypal_order_id=?'
      ).bind(paypalOrderId).first();
    }
  }

  if (order?.status === 'COMPLETED' && order.fulfillment_json) {
    return { ok: true, alreadyCompleted: true };
  }

  if (
    order?.status !== 'FULFILLING' ||
    order.paypal_capture_id !== captureId ||
    !order.fulfillment_token
  ) {
    return { ok: false, status: 409, error: 'PAYPAL_WEBHOOK_FULFILLMENT_STATE_MISMATCH' };
  }

  const fulfillmentResponse = await finalizeDigitalPayPalOrder(request, env, order);
  if (!fulfillmentResponse.ok) {
    return { ok: false, status: fulfillmentResponse.status, error: 'PAYPAL_WEBHOOK_FULFILLMENT_FAILED' };
  }
  return { ok: true };
}

export async function handlePayPalWebhook(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  const rawBody = await request.text();
  let verified;
  try {
    verified = await verifyPayPalWebhook(request, env, rawBody);
  } catch {
    return jsonRes({ error: 'PayPal webhook verification failed' }, 502, request);
  }
  if (!verified.ok) {
    const status = verified.error === 'PAYPAL_WEBHOOK_SIGNATURE_INVALID' ? 401 : 400;
    return jsonRes({ error: verified.error }, status, request);
  }

  const event = verified.event;
  if (
    typeof event?.id !== 'string' ||
    !event.id ||
    typeof event?.event_type !== 'string' ||
    !event.event_type
  ) {
    return jsonRes({ error: 'PAYPAL_WEBHOOK_EVENT_INVALID' }, 400, request);
  }

  const lease = await acquireWebhookLease(env, event.id, event.event_type);
  if (lease.done) {
    return jsonRes({ ok: true, duplicate: true }, 200, request);
  }
  if (!lease.acquired) {
    // Do not acknowledge an in-flight duplicate with 2xx: if the active worker
    // dies, PayPal must retry later so the stale lease can be reclaimed.
    return jsonRes({ error: 'PAYPAL_WEBHOOK_PROCESSING' }, 409, request);
  }

  try {
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      await markWebhookProcessed(env, event.id);
      return jsonRes({ ok: true, ignored: true }, 200, request);
    }

    const processed = await processCompletedCaptureWebhook(
      request,
      env,
      event,
      verified.accessToken
    );
    if (!processed.ok) {
      await releaseWebhookLease(env, event.id);
      return jsonRes({ error: processed.error }, processed.status || 500, request);
    }

    await markWebhookProcessed(env, event.id);
    return jsonRes({
      ok: true,
      duplicate: false,
      ignored: !!processed.ignored,
      alreadyCompleted: !!processed.alreadyCompleted,
    }, 200, request);
  } catch {
    // Recoverable errors return the event to pending. A hard runtime crash that
    // prevents this line from running is covered by the stale-lease timeout.
    await releaseWebhookLease(env, event.id).catch(() => {});
    return jsonRes({ error: 'PAYPAL_WEBHOOK_PROCESSING_FAILED' }, 500, request);
  }
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


const SANDBOX_ABANDONED_ORDER_RETENTION_DAYS = 7;
const SANDBOX_PROCESSED_WEBHOOK_RETENTION_DAYS = 90;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function handlePayPalSandboxCleanup(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (env.PAYPAL_SANDBOX_CLEANUP_ENABLED !== 'true') {
    return jsonRes({ error: 'PAYPAL_SANDBOX_CLEANUP_DISABLED' }, 403, request);
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const orderCutoff = isoDaysAgo(SANDBOX_ABANDONED_ORDER_RETENTION_DAYS);
  const webhookCutoff = isoDaysAgo(SANDBOX_PROCESSED_WEBHOOK_RETENTION_DAYS);

  const abandoned = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM paypal_orders
     WHERE status='CREATED'
       AND paypal_capture_id IS NULL
       AND fulfillment_token IS NULL
       AND completed_at IS NULL
       AND created_at < ?`
  ).bind(orderCutoff).first();

  const processedWebhooks = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM paypal_webhook_events
     WHERE processed=1
       AND received_at < ?`
  ).bind(webhookCutoff).first();

  const candidates = {
    abandonedOrders: Number(abandoned?.count || 0),
    processedWebhookEvents: Number(processedWebhooks?.count || 0),
  };

  if (!apply) {
    return jsonRes({
      ok: true,
      dryRun: true,
      retentionDays: {
        abandonedOrders: SANDBOX_ABANDONED_ORDER_RETENTION_DAYS,
        processedWebhookEvents: SANDBOX_PROCESSED_WEBHOOK_RETENTION_DAYS,
      },
      cutoffs: { orderCutoff, webhookCutoff },
      candidates,
    }, 200, request);
  }

  const orderDelete = await env.DB.prepare(
    `DELETE FROM paypal_orders
     WHERE status='CREATED'
       AND paypal_capture_id IS NULL
       AND fulfillment_token IS NULL
       AND completed_at IS NULL
       AND created_at < ?`
  ).bind(orderCutoff).run();

  const webhookDelete = await env.DB.prepare(
    `DELETE FROM paypal_webhook_events
     WHERE processed=1
       AND received_at < ?`
  ).bind(webhookCutoff).run();

  return jsonRes({
    ok: true,
    dryRun: false,
    deleted: {
      abandonedOrders: Number(orderDelete?.meta?.changes || 0),
      processedWebhookEvents: Number(webhookDelete?.meta?.changes || 0),
    },
    candidates,
  }, 200, request);
}

export async function handlePayPalCreateOrder(request, env, options = {}) {
  if (!options.allowWhenPaymentsDisabled && env.PAYMENTS_ENABLED !== 'true') return paymentsDisabledResponse(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  if (!options.skipRateLimit) {
    const limited = await enforcePayPalRateLimit(request, env, 'create-order', 8, 60);
    if (limited) return limited;
  }

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!validIdempotencyKey(idempotencyKey)) {
    return jsonRes({ error: 'Idempotency-Key לא תקין' }, 400, request);
  }

  const existing = await env.DB.prepare(
    'SELECT paypal_order_id FROM paypal_orders WHERE client_idempotency_key = ? LIMIT 1'
  ).bind(idempotencyKey).first();
  if (existing?.paypal_order_id) {
    const result = { paypalOrderId: existing.paypal_order_id, reused: true };
    if (options.includeApproveUrl) {
      try {
        const token = await getPayPalAccessToken(env);
        const response = await fetch(
          paypalApiBase() + '/v2/checkout/orders/' + encodeURIComponent(existing.paypal_order_id),
          { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } }
        );
        const order = await response.json().catch(() => ({}));
        if (response.ok) {
          result.approveUrl = payerApprovalUrl(order);
        }
      } catch {}
    }
    return jsonRes(result, 200, request);
  }

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
  const origin = new URL(request.url).origin;
  const paypalResponse = await fetch(paypalApiBase() + '/v2/checkout/orders', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'PayPal-Request-Id': 'amit-create-' + idempotencyKey,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: origin + '/api/paypal/approved',
            cancel_url: origin + '/api/paypal/cancelled',
          },
        },
      },
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
      "INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at, client_idempotency_key) VALUES (?, ?, 'digital', ?, ?, ?, ?, 'CREATED', ?, ?)"
    ).bind(
      localId,
      paypalOrder.id,
      photoId,
      sku,
      pricing.amountExpected,
      pricing.currency,
      new Date().toISOString(),
      idempotencyKey
    ).run();
  } catch {
    // A concurrent request with the same Idempotency-Key may have persisted the
    // same PayPal order first. Return that canonical local row instead of a
    // spurious 500; any other persistence failure remains fail-closed.
    const raced = await env.DB.prepare(
      'SELECT paypal_order_id FROM paypal_orders WHERE client_idempotency_key = ? LIMIT 1'
    ).bind(idempotencyKey).first().catch(() => null);
    if (raced?.paypal_order_id) {
      return jsonRes({ paypalOrderId: raced.paypal_order_id, reused: true }, 200, request);
    }
    return jsonRes({ error: 'Could not persist PayPal order' }, 500, request);
  }

  const approveUrl = payerApprovalUrl(paypalOrder);
  const result = { paypalOrderId: paypalOrder.id };
  if (options.includeApproveUrl) result.approveUrl = approveUrl;
  return jsonRes(result, 201, request);
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

  // Do not report success until the entitlement actually exists. This protects
  // against schema/constraint/DB failures after PayPal has already captured.
  const persistedToken = await env.DB.prepare(
    'SELECT token FROM download_tokens WHERE token = ? AND tx = ? LIMIT 1'
  ).bind(fulfillmentToken, captureId).first();
  if (!persistedToken?.token) {
    return jsonRes({ error: 'Digital fulfillment persistence failed' }, 500, request);
  }

  const photo = await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(order.photo_id).first();
  const fulfillment = {
    url: '/api/download/' + fulfillmentToken,
    title: photo?.title || order.photo_id,
  };

  await env.DB.prepare(
    "UPDATE paypal_orders SET status='COMPLETED', fulfillment_json=?, completed_at=? WHERE paypal_order_id=? AND status='FULFILLING'"
  ).bind(JSON.stringify(fulfillment), new Date().toISOString(), order.paypal_order_id).run();

  const completed = await env.DB.prepare(
    'SELECT status, fulfillment_json FROM paypal_orders WHERE paypal_order_id = ?'
  ).bind(order.paypal_order_id).first();
  if (completed?.status !== 'COMPLETED' || !completed.fulfillment_json) {
    return jsonRes({ error: 'Digital fulfillment completion failed' }, 500, request);
  }

  return jsonRes(fulfillment, 200, request);
}

export async function handlePayPalCaptureOrder(request, env, options = {}) {
  if (!options.allowWhenPaymentsDisabled && env.PAYMENTS_ENABLED !== 'true') return paymentsDisabledResponse(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  if (!options.skipRateLimit) {
    const limited = await enforcePayPalRateLimit(request, env, 'capture-order', 12, 60);
    if (limited) return limited;
  }

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

  const captureUrl = paypalApiBase() + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId) + '/capture';
  const paypalResponse = await fetch(captureUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'PayPal-Request-Id': 'amit-capture-' + order.id,
    },
    body: '{}',
  });

  let capturedOrder = await paypalResponse.json().catch(() => ({}));

  // PayPal can report ORDER_ALREADY_CAPTURED when the first capture succeeded
  // but our server missed the response. Recover by reading the authoritative
  // order state rather than charging again or failing fulfillment permanently.
  const issue = capturedOrder?.details?.[0]?.issue;
  if (!paypalResponse.ok && issue === 'ORDER_ALREADY_CAPTURED') {
    const getResponse = await fetch(
      paypalApiBase() + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId),
      {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'Accept': 'application/json',
        },
      }
    );
    capturedOrder = await getResponse.json().catch(() => ({}));
    if (!getResponse.ok) {
      return jsonRes({ error: 'PayPal capture recovery failed' }, 502, request);
    }
  } else if (!paypalResponse.ok) {
    return jsonRes({ error: 'PayPal capture failed' }, 502, request);
  }

  const purchaseUnit = capturedOrder.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
  const returnedCustomId = purchaseUnit?.custom_id || capture?.custom_id || null;

  if (
    capturedOrder.id !== paypalOrderId ||
    capturedOrder.status !== 'COMPLETED' ||
    (returnedCustomId !== null && returnedCustomId !== order.id)
  ) {
    return jsonRes({ error: 'PayPal capture identity mismatch' }, 502, request);
  }

  const captureMinor = moneyToMinorUnits(capture?.amount?.value);
  if (
    !capture?.id ||
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

export function handlePayPalCheckoutReturn(request, approved) {
  const title = approved ? 'PayPal Sandbox approval complete' : 'PayPal Sandbox checkout cancelled';
  const message = approved
    ? 'Approval completed. You can return to the test terminal and run capture.'
    : 'Checkout was cancelled. No capture was attempted.';
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<main style="font-family:system-ui;max-width:640px;margin:12vh auto;padding:24px">' +
    '<h1>' + title + '</h1><p>' + message + '</p></main>',
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}
