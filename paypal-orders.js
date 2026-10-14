import { SWITCH_KEY, CLOSE_GRACE_MS, MAX_OPEN_HORIZON_MS, readCheckoutSwitch, checkNewOrderAllowed, checkCaptureAllowed, parseSwitch, effectiveSwitch, capSql } from './paypal-switch.js';
import { paymentHealthSnapshot, sendPaymentAlert, afterSaleAlert, webhookFailingAlert, paymentAlertsEnabled, paymentAlertChannels } from './paypal-monitoring.js';

// Environment is explicit: PAYPAL_ENVIRONMENT = 'sandbox' (default when unset) or 'live'.
// Anything else blocks PayPal entirely. Live is never implied by the other settings.
const PAYPAL_API_BASES = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};
// Hosts PayPal itself uses for resource links INSIDE webhook events. A real Sandbox refund
// event (14.10.2026) links to api.sandbox.paypal.com while API calls go to api-m.*, so each
// environment lists both exact names. No wildcards, and never a host of the other environment.
// Event links are only parsed for an id; PayPal is always called on PAYPAL_API_BASES.
const PAYPAL_EVENT_LINK_HOSTS = {
  sandbox: ['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'],
  live: ['api-m.paypal.com', 'api.paypal.com'],
};
const PAYPAL_APPROVAL_HOSTS = {
  sandbox: 'www.sandbox.paypal.com',
  live: 'www.paypal.com',
};
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

// Resolves and validates the PayPal environment. Pure: no network, no secrets are read
// beyond checking that they exist. Returns { ok, environment, apiBase, approvalHost }
// or { ok: false, reason }. Pass the request to also bind Live to the production origin.
export function resolvePayPalConfig(env, request) {
  const raw = env.PAYPAL_ENVIRONMENT;
  const environment = raw === undefined || raw === null || raw === '' ? 'sandbox' : raw;
  if (environment !== 'sandbox' && environment !== 'live') {
    return { ok: false, reason: 'PAYPAL_ENVIRONMENT_UNKNOWN' };
  }
  const apiBase = PAYPAL_API_BASES[environment];
  // Credentials cannot be inspected, so the environment they belong to is declared.
  const declared = env.PAYPAL_CREDENTIALS_ENVIRONMENT;
  if (environment === 'live' && declared !== 'live') {
    return { ok: false, reason: 'PAYPAL_CREDENTIALS_ENVIRONMENT_MISMATCH' };
  }
  if (environment === 'sandbox' && declared !== undefined && declared !== null && declared !== '' && declared !== 'sandbox') {
    return { ok: false, reason: 'PAYPAL_CREDENTIALS_ENVIRONMENT_MISMATCH' };
  }
  if (env.PAYPAL_API_BASE !== undefined && env.PAYPAL_API_BASE !== null && env.PAYPAL_API_BASE !== '' &&
      env.PAYPAL_API_BASE !== apiBase) {
    return { ok: false, reason: 'PAYPAL_API_BASE_MISMATCH' };
  }
  if (environment === 'live') {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return { ok: false, reason: 'PAYPAL_CREDENTIALS_MISSING' };
    if (!env.PAYPAL_WEBHOOK_ID) return { ok: false, reason: 'PAYPAL_WEBHOOK_ID_MISSING' };
    if (request) {
      let origin = '';
      try { origin = new URL(request.url).origin; } catch {}
      if (!ALLOWED_ORIGINS.includes(origin)) return { ok: false, reason: 'PAYPAL_LIVE_ORIGIN_NOT_ALLOWED' };
    }
  }
  return { ok: true, environment, apiBase, approvalHost: PAYPAL_APPROVAL_HOSTS[environment], eventLinkHosts: PAYPAL_EVENT_LINK_HOSTS[environment] };
}

function paypalApiBase(env) {
  const config = resolvePayPalConfig(env);
  if (!config.ok) throw new Error(config.reason);
  return config.apiBase;
}

// Admin test tools and cleanup exist for Sandbox only, whatever the flags say.
function sandboxToolsBlocked(request, env) {
  const config = resolvePayPalConfig(env, request);
  if (!config.ok) return jsonRes({ error: 'PAYPAL_CONFIGURATION_INVALID', reason: config.reason }, 503, request);
  if (config.environment !== 'sandbox') return jsonRes({ error: 'SANDBOX_TOOLS_DISABLED_IN_LIVE' }, 403, request);
  return null;
}

export function digitalPaymentsEnabled(env, request) {
  return env.PAYMENTS_ENABLED === 'true' && env.DIGITAL_PAYPAL_ENABLED === 'true' &&
    resolvePayPalConfig(env, request).ok;
}

// Read-only product preview. No PayPal call or migration-0002 table access.
export async function handleDigitalCheckoutQuote(request, env) {
  if (request.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405, request);
  const params = new URL(request.url).searchParams;
  const photoId = params.get('photoId');
  const sku = params.get('sku') || 'large';
  const pricing = await resolveDigitalPayPalPrice(env, photoId, sku, 'ILS');
  if (pricing.error) return jsonRes({ error: pricing.error }, pricing.status, request);
  // Flags and configuration first (no database read while payments are off), then the D1 switch.
  const flagsOpen = digitalPaymentsEnabled(env, request);
  const switchOpen = flagsOpen ? (await checkNewOrderAllowed(env, { photoId: photoId ?? '' })).allowed : false;
  const photo = await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(photoId).first();
  return jsonRes({
    photoId, sku, title: photo?.title || photoId,
    amountMinor: pricing.amountExpected, currency: 'ILS',
    license: 'personal', enabled: flagsOpen && switchOpen,
    environment: resolvePayPalConfig(env, request).environment || null,
  }, 200, request);
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
  const response = await fetch(paypalApiBase(env) + '/v1/oauth2/token', {
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
  const blocked = sandboxToolsBlocked(request, env);
  if (blocked) return blocked;
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
  const response = await fetch(paypalApiBase(env) + '/v1/notifications/verify-webhook-signature', {
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

async function processCompletedCaptureWebhook(request, env, event, accessToken, options = {}) {
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

  // A refund or reversal that arrived first wins: never mint a link for it afterwards.
  // Checked before PayPal is asked, because a refunded capture no longer reads COMPLETED.
  if (isTerminalAfterSale(order)) return { ok: true, ignored: true };

  if (
    resource.amount?.currency_code !== order.currency ||
    captureMinor !== order.amount_expected
  ) {
    return { ok: false, status: 409, error: 'PAYPAL_WEBHOOK_AMOUNT_MISMATCH' };
  }

  const orderResponse = await fetch(
    paypalApiBase(env) + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId),
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

  const fulfillmentResponse = await finalizeDigitalPayPalOrder(request, env, order, { payerEmail: authoritative?.payer?.email_address || null, waitUntil: options.waitUntil });
  if (!fulfillmentResponse.ok) {
    return { ok: false, status: fulfillmentResponse.status, error: 'PAYPAL_WEBHOOK_FULFILLMENT_FAILED' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// After-sale handling (migration 0003): refunds, reversals, disputes and the
// admin-only re-issue of a download link for an order that was already paid.
// Nothing here creates an order or a capture, and nothing here refunds money.
// ---------------------------------------------------------------------------
const MAX_REISSUES = 2;
const REISSUE_TTL_SECONDS = 86400;
const REISSUE_IN_PROGRESS_WINDOW_MS = 10 * 60 * 1000;
const AFTER_SALE_RANK = { NONE: 0, REVIEW_REQUIRED: 1, REFUNDED: 2, REVOKED_MANUAL: 2, REVERSED: 3 };
const TERMINAL_AFTER_SALE = new Set(['REFUNDED', 'REVERSED', 'REVOKED_MANUAL']);
const AFTER_SALE_RANK_SQL =
  "CASE after_sale_state WHEN 'REVERSED' THEN 3 WHEN 'REFUNDED' THEN 2 WHEN 'REVOKED_MANUAL' THEN 2 WHEN 'REVIEW_REQUIRED' THEN 1 ELSE 0 END";
const AFTER_SALE_EVENT_TYPES = new Set([
  'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
  'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED',
]);
const ACTION_ID = /^[A-Za-z0-9_-]{8,64}$/;

// Rows from before migration 0003 have no after_sale_state: that means NONE.
function afterSaleStateOf(order) {
  return order?.after_sale_state || 'NONE';
}

export function isTerminalAfterSale(order) {
  return TERMINAL_AFTER_SALE.has(afterSaleStateOf(order));
}

async function raiseAfterSaleState(env, orderRef, state, nowIso) {
  // Monotonic: a late or repeated event can raise the state, never lower it.
  const result = await env.DB.prepare(
    'UPDATE paypal_orders SET after_sale_state = ?, after_sale_updated_at = ? WHERE id = ? AND (' + AFTER_SALE_RANK_SQL + ') < ?'
  ).bind(state, nowIso, orderRef, AFTER_SALE_RANK[state]).run();
  return Number(result?.meta?.changes) > 0;
}

// Unused links only: a link that was already claimed cannot be taken back.
async function revokeUnusedTokens(env, order, captureId, reason, exceptToken = null) {
  const result = await env.DB.prepare(
    'UPDATE download_tokens SET used = 2, revoked_at = ?, revoke_reason = ? WHERE used = 0 AND token != ? AND (paypal_order_ref = ? OR tx = ?)'
  ).bind(Math.floor(Date.now() / 1000), reason, exceptToken || '', order.id, captureId || order.paypal_capture_id || '').run();
  return Number(result?.meta?.changes) || 0;
}

// The capture id comes from the event's "up" link, but the link is only ever PARSED:
// it is never fetched (PayPal is always called on the environment's own API base), so
// no Authorization header can reach a host named by an event. It must still point at
// one of this environment's exact PayPal API host names and exactly /v2/payments/captures/<id>; anything else
// (other host, http, port, credentials, query, fragment, extra path, two "up" links)
// makes the event invalid.
const PAYPAL_ID = /^[A-Za-z0-9_-]{8,64}$/;
function captureIdFromResource(resource, fallbackToId, allowedHosts) {
  const ups = (Array.isArray(resource?.links) ? resource.links : []).filter(link => link?.rel === 'up');
  if (ups.length > 1) return null;
  if (ups.length === 1) {
    let url;
    try { url = new URL(ups[0].href); } catch { return null; }
    if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname) || url.port || url.username ||
        url.password || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/v2\/payments\/captures\/([A-Za-z0-9_-]{8,64})$/);
    return match ? match[1] : null;
  }
  return fallbackToId && typeof resource?.id === 'string' && PAYPAL_ID.test(resource.id) ? resource.id : null;
}

async function fetchAuthoritativeCapture(env, accessToken, captureId) {
  const response = await fetch(
    paypalApiBase(env) + '/v2/payments/captures/' + encodeURIComponent(captureId),
    { method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' } }
  );
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function captureMatchesOrder(capture, captureId, order) {
  return !!capture && capture.id === captureId && capture.custom_id === order.id &&
    capture.amount?.currency_code === order.currency &&
    moneyToMinorUnits(capture.amount?.value) === order.amount_expected;
}

async function findOrderForAfterSale(env, captureId, orderIdHint) {
  let order = captureId
    ? await env.DB.prepare('SELECT * FROM paypal_orders WHERE paypal_capture_id = ?').bind(captureId).first()
    : null;
  if (!order && typeof orderIdHint === 'string' && orderIdHint) {
    order = await env.DB.prepare('SELECT * FROM paypal_orders WHERE paypal_order_id = ?').bind(orderIdHint).first();
  }
  return order || null;
}

async function recordAfterSaleEvent(env, order, event, signal, amountMinor) {
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, amount_minor, created_at, completed_at) VALUES (?, ?, 'AFTER_SALE_EVENT', ?, ?, 'paypal-webhook', ?, ?, ?, ?)"
  ).bind(order.id, order.paypal_order_id, event.id, signal, event.event_type, amountMinor, new Date().toISOString(), new Date().toISOString()).run();
  return Number(result?.meta?.changes) > 0;
}

// Refund / reversal / dispute events. The signature was verified by the caller;
// here the event is tied to a local order AND capture, the capture is re-read from
// PayPal, and state only ever moves forward, so duplicates and out-of-order
// delivery are harmless. Partial refunds and disputes only flag manual review.
async function processAfterSaleWebhook(request, env, event, accessToken) {
  const type = event.event_type;
  const resource = event.resource || {};
  const nowIso = new Date().toISOString();
  let order;
  let signal;
  let amountMinor = null;
  let captureId = null;

  if (type.startsWith('CUSTOMER.DISPUTE.')) {
    const ids = (Array.isArray(resource.disputed_transactions) ? resource.disputed_transactions : [])
      .map(item => item?.seller_transaction_id).filter(id => typeof id === 'string' && id);
    for (const id of ids) {
      order = await findOrderForAfterSale(env, id, null);
      if (order) { captureId = id; break; }
    }
    if (!order) return { ok: true, ignored: true };
    signal = type === 'CUSTOMER.DISPUTE.RESOLVED' || resource.status === 'RESOLVED' ? 'DISPUTE_RESOLVED' : 'DISPUTE_OPEN';
  } else {
    captureId = captureIdFromResource(resource, type === 'PAYMENT.CAPTURE.REVERSED', resolvePayPalConfig(env).eventLinkHosts);
    const orderIdHint = resource.supplementary_data?.related_ids?.order_id;
    if (!captureId) return { ok: false, status: 400, error: 'PAYPAL_WEBHOOK_AFTER_SALE_INVALID' };
    order = await findOrderForAfterSale(env, captureId, orderIdHint);
    // Not one of ours: acknowledge without acting.
    if (!order) return { ok: true, ignored: true };
    if (order.paypal_capture_id && order.paypal_capture_id !== captureId) {
      return { ok: false, status: 409, error: 'PAYPAL_WEBHOOK_IDENTITY_MISMATCH' };
    }
    const capture = await fetchAuthoritativeCapture(env, accessToken, captureId);
    if (!capture) return { ok: false, status: 502, error: 'PAYPAL_WEBHOOK_CAPTURE_LOOKUP_FAILED' };
    if (!captureMatchesOrder(capture, captureId, order)) {
      return { ok: false, status: 409, error: 'PAYPAL_WEBHOOK_IDENTITY_MISMATCH' };
    }
    if (type === 'PAYMENT.CAPTURE.REVERSED') {
      signal = 'REVERSAL';
    } else {
      signal = 'REFUND';
      const refundMinor = resource.status === 'COMPLETED' && resource.amount?.currency_code === order.currency
        ? moneyToMinorUnits(resource.amount?.value) : null;
      amountMinor = refundMinor;
      order = { ...order, _capturePaypalStatus: capture.status };
    }
  }

  await recordAfterSaleEvent(env, order, event, signal, amountMinor);
  let state;
  if (signal === 'REVERSAL') {
    state = 'REVERSED';
  } else if (signal === 'REFUND') {
    const sum = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount_minor), 0) AS total FROM paypal_order_actions WHERE order_ref = ? AND action = 'AFTER_SALE_EVENT' AND status = 'REFUND'"
    ).bind(order.id).first();
    const refunded = Number(sum?.total) || 0;
    await env.DB.prepare('UPDATE paypal_orders SET refunded_minor = ? WHERE id = ?').bind(refunded, order.id).run();
    // Full only on PayPal's own word or when the recorded refunds cover the price.
    state = order._capturePaypalStatus === 'REFUNDED' || refunded >= order.amount_expected ? 'REFUNDED' : 'REVIEW_REQUIRED';
  } else {
    state = 'REVIEW_REQUIRED';
    // Order dispute events by their own timestamp so a late "created" cannot reopen a resolved dispute.
    const at = resource.update_time || event.create_time || null;
    const open = signal === 'DISPUTE_OPEN' ? 1 : 0;
    if (open || at) {
      await env.DB.prepare(
        'UPDATE paypal_orders SET dispute_open = ?, dispute_updated_at = COALESCE(?, dispute_updated_at) WHERE id = ? AND (? IS NULL OR dispute_updated_at IS NULL OR dispute_updated_at <= ?)'
      ).bind(open, at, order.id, at, at).run();
    }
  }
  await raiseAfterSaleState(env, order.id, state, nowIso);
  if (TERMINAL_AFTER_SALE.has(state)) {
    await revokeUnusedTokens(env, order, captureId, state);
  }
  return { ok: true, afterSale: state, paypalOrderId: order.paypal_order_id, orderRef: order.id };
}

function adminActionInput(request, body) {
  const key = request.headers.get('Idempotency-Key') || '';
  const reason = typeof body?.reason === 'string' ? body.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
  const paypalOrderId = typeof body?.paypalOrderId === 'string' ? body.paypalOrderId : '';
  if (!ACTION_ID.test(key)) return { error: 'IDEMPOTENCY_KEY_REQUIRED' };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(paypalOrderId)) return { error: 'PAYPAL_ORDER_ID_INVALID' };
  if (!reason) return { error: 'REASON_REQUIRED' };
  return { key, reason, paypalOrderId };
}

function adminConfigBlocked(request, env) {
  const config = resolvePayPalConfig(env, request);
  if (config.ok) return null;
  return jsonRes({ error: 'PAYPAL_CONFIGURATION_INVALID', reason: config.reason }, 503, request);
}

// Support tool: gives a paid customer a fresh one-time link for the SAME order and
// capture. Runs for the authenticated admin only (the route enforces checkAuth),
// works even while public checkout is closed, never creates an order or a charge.
export async function handlePayPalReissueDownload(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const blocked = adminConfigBlocked(request, env);
  if (blocked) return blocked;
  const input = adminActionInput(request, await request.json().catch(() => ({})));
  if (input.error) return jsonRes({ error: input.error }, 400, request);

  const order = await env.DB.prepare('SELECT * FROM paypal_orders WHERE paypal_order_id = ?').bind(input.paypalOrderId).first();
  if (!order) return jsonRes({ error: 'ORDER_NOT_FOUND' }, 404, request);
  if (order.order_type !== 'digital' || order.status !== 'COMPLETED' || !order.paypal_capture_id) {
    return jsonRes({ error: 'ORDER_NOT_ELIGIBLE' }, 409, request);
  }
  if (afterSaleStateOf(order) !== 'NONE' || Number(order.dispute_open) === 1) {
    return jsonRes({ error: 'ORDER_NOT_ELIGIBLE', reason: 'AFTER_SALE_OPEN' }, 409, request);
  }

  const existing = await env.DB.prepare(
    "SELECT * FROM paypal_order_actions WHERE order_ref = ? AND action = 'REISSUE' AND request_id = ?"
  ).bind(order.id, input.key).first();
  if (existing && existing.status !== 'STARTED') {
    if (existing.status !== 'DONE') return jsonRes({ error: 'REISSUE_NOT_COMPLETED', status: existing.status }, 409, request);
    return reissueReplay(request, env, order, existing);
  }

  // Re-verify the payment with PayPal before spending a re-issue.
  let capture;
  try {
    const accessToken = await getPayPalAccessToken(env);
    const orderResponse = await fetch(
      paypalApiBase(env) + '/v2/checkout/orders/' + encodeURIComponent(order.paypal_order_id),
      { method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' } }
    );
    const authoritative = await orderResponse.json().catch(() => ({}));
    if (!orderResponse.ok) return jsonRes({ error: 'PAYPAL_LOOKUP_FAILED' }, 502, request);
    capture = authoritative.purchase_units?.[0]?.payments?.captures?.find(item => item?.id === order.paypal_capture_id);
    if (authoritative.id !== order.paypal_order_id || authoritative.status !== 'COMPLETED' ||
        authoritative.purchase_units?.[0]?.custom_id !== order.id || !captureMatchesOrder(
          capture && { ...capture, custom_id: order.id }, order.paypal_capture_id, order)) {
      return jsonRes({ error: 'PAYPAL_PAYMENT_NOT_VERIFIED' }, 409, request);
    }
    if (capture.status !== 'COMPLETED') {
      return jsonRes({ error: 'PAYPAL_PAYMENT_NOT_VERIFIED', paypalCaptureStatus: String(capture.status || '') }, 409, request);
    }
  } catch {
    return jsonRes({ error: 'PAYPAL_LOOKUP_FAILED' }, 502, request);
  }

  let action = existing;
  if (!action) {
    const newToken = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const recent = new Date(Date.now() - REISSUE_IN_PROGRESS_WINDOW_MS).toISOString();
    let inserted = false;
    try {
      // One statement: the limit, the "nothing in progress" rule and the order state
      // are checked and the slot is taken together, so parallel requests cannot exceed it.
      const result = await env.DB.prepare(
        `INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, new_token, created_at)
         SELECT ?, ?, 'REISSUE', ?, 'STARTED', 'admin', ?, ?, ?
         WHERE (SELECT COUNT(*) FROM paypal_order_actions WHERE order_ref = ? AND action = 'REISSUE' AND status IN ('STARTED', 'DONE')) < ?
           AND NOT EXISTS (SELECT 1 FROM paypal_order_actions WHERE order_ref = ? AND action = 'REISSUE' AND status = 'STARTED' AND created_at > ?)
           AND EXISTS (SELECT 1 FROM paypal_orders WHERE id = ? AND status = 'COMPLETED' AND after_sale_state = 'NONE' AND dispute_open = 0)`
      ).bind(order.id, order.paypal_order_id, input.key, input.reason, newToken, nowIso, order.id, MAX_REISSUES, order.id, recent, order.id).run();
      inserted = Number(result?.meta?.changes) > 0;
    } catch {
      // Same request id raced in parallel: fall through to the replay lookup below.
    }
    action = await env.DB.prepare(
      "SELECT * FROM paypal_order_actions WHERE order_ref = ? AND action = 'REISSUE' AND request_id = ?"
    ).bind(order.id, input.key).first();
    if (!action) {
      const used = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM paypal_order_actions WHERE order_ref = ? AND action = 'REISSUE' AND status IN ('STARTED', 'DONE')"
      ).bind(order.id).first();
      const reasonCode = Number(used?.n) >= MAX_REISSUES ? 'REISSUE_LIMIT_REACHED' : 'REISSUE_IN_PROGRESS_OR_NOT_ELIGIBLE';
      return jsonRes({ error: reasonCode }, 409, request);
    }
    if (!inserted && action.status === 'DONE') return reissueReplay(request, env, order, action);
  }

  return completeReissue(request, env, order, action);
}

async function reissueReplay(request, env, order, action) {
  const row = action.new_token
    ? await env.DB.prepare('SELECT used, expires_at FROM download_tokens WHERE token = ?').bind(action.new_token).first()
    : null;
  if (!row || row.used !== 0 || Math.floor(Date.now() / 1000) > row.expires_at) {
    return jsonRes({ error: 'REISSUE_LINK_NO_LONGER_USABLE' }, 409, request);
  }
  return reissueSuccess(request, env, order, action, row.expires_at, true);
}

async function reissueSuccess(request, env, order, action, expiresAt, replayed) {
  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM paypal_order_actions WHERE order_ref = ? AND action = 'REISSUE' AND status IN ('STARTED', 'DONE')"
  ).bind(order.id).first();
  return jsonRes({
    ok: true, replayed,
    url: '/api/download/' + action.new_token,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    reissuesUsed: Number(used?.n) || 0,
    reissuesRemaining: Math.max(0, MAX_REISSUES - (Number(used?.n) || 0)),
  }, 200, request);
}

async function completeReissue(request, env, order, action) {
  const now = Math.floor(Date.now() / 1000);
  const captureId = order.paypal_capture_id;
  // Previous links that were never used stop working before the new one exists.
  await revokeUnusedTokens(env, order, captureId, 'REISSUED', action.new_token);
  await env.DB.prepare(
    'INSERT OR IGNORE INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount, paypal_order_ref) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)'
  ).bind(
    action.new_token, JSON.stringify([order.photo_id]), order.sku, captureId + ':R' + action.id,
    now + REISSUE_TTL_SECONDS, now, order.amount_expected / 100, order.id
  ).run();
  const row = await env.DB.prepare('SELECT used, expires_at FROM download_tokens WHERE token = ?').bind(action.new_token).first();
  if (!row) return jsonRes({ error: 'REISSUE_PERSISTENCE_FAILED' }, 500, request);

  // A refund or dispute may have landed while this ran: never leave a live link behind.
  const current = await env.DB.prepare('SELECT * FROM paypal_orders WHERE id = ?').bind(order.id).first();
  if (afterSaleStateOf(current) !== 'NONE' || Number(current?.dispute_open) === 1) {
    await revokeUnusedTokens(env, order, captureId, 'AFTER_SALE_DURING_REISSUE');
    await env.DB.prepare("UPDATE paypal_order_actions SET status = 'REVOKED', completed_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), action.id).run();
    return jsonRes({ error: 'ORDER_NOT_ELIGIBLE', reason: 'AFTER_SALE_OPEN' }, 409, request);
  }
  await env.DB.prepare("UPDATE paypal_order_actions SET status = 'DONE', completed_at = ? WHERE id = ? AND status = 'STARTED'")
    .bind(new Date().toISOString(), action.id).run();
  return reissueSuccess(request, env, order, action, row.expires_at, false);
}

// Manual decision for an order flagged REVIEW_REQUIRED (partial refund or dispute).
// 'release' clears the flag; 'revoke' treats the order as refunded-by-decision.
// The system never decides entitlement or money on its own.
export async function handlePayPalAfterSaleReview(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const blocked = adminConfigBlocked(request, env);
  if (blocked) return blocked;
  const body = await request.json().catch(() => ({}));
  const input = adminActionInput(request, body);
  if (input.error) return jsonRes({ error: input.error }, 400, request);
  if (body.decision !== 'release' && body.decision !== 'revoke') return jsonRes({ error: 'DECISION_INVALID' }, 400, request);

  const order = await env.DB.prepare('SELECT * FROM paypal_orders WHERE paypal_order_id = ?').bind(input.paypalOrderId).first();
  if (!order) return jsonRes({ error: 'ORDER_NOT_FOUND' }, 404, request);

  const nowIso = new Date().toISOString();
  const audit = await env.DB.prepare(
    "INSERT OR IGNORE INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, created_at, completed_at) VALUES (?, ?, 'AFTER_SALE_REVIEW', ?, ?, 'admin', ?, ?, ?)"
  ).bind(order.id, order.paypal_order_id, input.key, body.decision, input.reason, nowIso, nowIso).run();
  if (!(Number(audit?.meta?.changes) > 0)) {
    return jsonRes({ ok: true, replayed: true, state: afterSaleStateOf(order) }, 200, request);
  }

  if (body.decision === 'release') {
    const result = await env.DB.prepare(
      "UPDATE paypal_orders SET after_sale_state = 'NONE', after_sale_updated_at = ? WHERE id = ? AND after_sale_state = 'REVIEW_REQUIRED' AND dispute_open = 0"
    ).bind(nowIso, order.id).run();
    if (!(Number(result?.meta?.changes) > 0)) {
      await env.DB.prepare("UPDATE paypal_order_actions SET status = 'REFUSED' WHERE order_ref = ? AND action = 'AFTER_SALE_REVIEW' AND request_id = ?")
        .bind(order.id, input.key).run();
      return jsonRes({ error: 'RELEASE_NOT_ALLOWED' }, 409, request);
    }
    return jsonRes({ ok: true, state: 'NONE' }, 200, request);
  }
  await raiseAfterSaleState(env, order.id, 'REVOKED_MANUAL', nowIso);
  const revoked = await revokeUnusedTokens(env, order, order.paypal_capture_id, 'REVOKED_MANUAL');
  return jsonRes({ ok: true, state: 'REVOKED_MANUAL', revokedLinks: revoked }, 200, request);
}

// Read-only support view. Never returns link tokens or PayPal secrets.
export async function handlePayPalOrderSupportView(request, env) {
  if (request.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405, request);
  const blocked = adminConfigBlocked(request, env);
  if (blocked) return blocked;
  const paypalOrderId = new URL(request.url).searchParams.get('paypalOrderId') || '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(paypalOrderId)) return jsonRes({ error: 'PAYPAL_ORDER_ID_INVALID' }, 400, request);
  const order = await env.DB.prepare('SELECT * FROM paypal_orders WHERE paypal_order_id = ?').bind(paypalOrderId).first();
  if (!order) return jsonRes({ error: 'ORDER_NOT_FOUND' }, 404, request);
  const actions = await env.DB.prepare(
    'SELECT action, request_id, status, actor, reason, amount_minor, created_at, completed_at FROM paypal_order_actions WHERE order_ref = ? ORDER BY id'
  ).bind(order.id).all();
  return jsonRes({
    paypalOrderId, status: order.status, afterSaleState: afterSaleStateOf(order),
    disputeOpen: Number(order.dispute_open) === 1, refundedMinor: Number(order.refunded_minor) || 0,
    currency: order.currency, amountMinor: order.amount_expected,
    actions: actions?.results || [],
  }, 200, request);
}

// ---------------------------------------------------------------------------
// Download-link e-mail. Sends the order's CURRENT active link to the payer address
// that PayPal reported for the verified transaction. It never creates a token, an
// order or a charge, never decides entitlement (a used, revoked or refunded order
// gets nothing), and a failure here can never fail the payment. No schema change:
// attempts, de-duplication and audit live in paypal_order_actions (action LINK_EMAIL).
// The e-mail points at /checkout/download/#t=<token>: the token sits in the URL
// fragment, which browsers never send to a server, so it cannot reach request logs
// or analytics, and mail scanners that fetch the page cannot consume the one-time link.
// ---------------------------------------------------------------------------
const LINK_EMAIL_MAX_AUTO = 4;
const LINK_EMAIL_MAX_MANUAL = 3;
const LINK_EMAIL_IN_PROGRESS_MS = 5 * 60 * 1000;
// Retries only happen while the provider still remembers our idempotency key (it keeps keys
// for 24 h), so an attempt interrupted AFTER the provider accepted the mail but BEFORE we
// recorded it is re-sent with the same key and payload and answered without a second mail.
const LINK_EMAIL_SWEEP_WINDOW_MS = 20 * 60 * 60 * 1000;
const LINK_EMAIL_SWEEP_LIMIT = 20;
const LINK_EMAIL_TIMEOUT_MS = 8000;

// Stable, non-reversible fingerprint of a link: part of the provider idempotency key so a NEW
// link (after a re-issue) is a new message, while a retry of the SAME link is a duplicate.
async function linkFingerprint(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dl-link:' + token));
  return [...new Uint8Array(digest)].slice(0, 8).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function cleanEmailAddress(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  return /^[^\s@<>,;"'\\()[\]]+@[^\s@<>,;"'\\()[\]]+\.[^\s@<>,;"'\\()[\]]+$/.test(email) ? email : null;
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Off unless explicitly enabled AND a mail key exists, so deploying never starts mailing by itself.
export function downloadEmailEnabled(env) {
  return env.DOWNLOAD_EMAIL_ENABLED === 'true' && !!env.RESEND_API_KEY;
}

// Where the mail may go. Sandbox payers have placeholder addresses, so in Sandbox mail
// goes ONLY to an explicit test recipient. An invalid test recipient blocks everything.
function linkEmailRecipient(env, config, payerEmail) {
  const override = env.DOWNLOAD_EMAIL_OVERRIDE_TO;
  if (override !== undefined && override !== null && override !== '') {
    const test = cleanEmailAddress(override);
    return test ? { to: test, test: true } : { reason: 'TEST_RECIPIENT_INVALID' };
  }
  if (config.environment !== 'live') return { reason: 'SANDBOX_NEEDS_TEST_RECIPIENT' };
  const payer = cleanEmailAddress(payerEmail);
  return payer ? { to: payer, test: false } : { reason: 'NO_PAYER_EMAIL' };
}

function linkEmailOrigin(request, env, config) {
  let origin = null;
  try { origin = request ? new URL(request.url).origin : (env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL).origin : null); } catch {}
  if (!origin || !origin.startsWith('https://')) return null;
  if (config.environment === 'live' && !ALLOWED_ORIGINS.includes(origin)) return null;
  return origin;
}

async function activeDownloadLink(env, order) {
  return env.DB.prepare(
    'SELECT token, expires_at FROM download_tokens WHERE used = 0 AND revoked_at IS NULL AND expires_at > ? AND (paypal_order_ref = ? OR tx = ?) ORDER BY created_at DESC, token LIMIT 1'
  ).bind(Math.floor(Date.now() / 1000), order.id, order.paypal_capture_id || '').first();
}

function linkEmailEligible(order) {
  return !!order && order.order_type === 'digital' && order.status === 'COMPLETED' && !!order.paypal_capture_id &&
    afterSaleStateOf(order) === 'NONE' && Number(order.dispute_open) !== 1;
}

// The payer address of the VERIFIED transaction, read from PayPal (never from the browser).
async function verifiedPayerEmail(env, order) {
  const accessToken = await getPayPalAccessToken(env);
  const response = await fetch(
    paypalApiBase(env) + '/v2/checkout/orders/' + encodeURIComponent(order.paypal_order_id),
    { method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' } }
  );
  const data = await response.json().catch(() => ({}));
  const capture = data.purchase_units?.[0]?.payments?.captures?.find(item => item?.id === order.paypal_capture_id);
  if (!response.ok || data.id !== order.paypal_order_id || data.status !== 'COMPLETED' ||
      data.purchase_units?.[0]?.custom_id !== order.id || capture?.status !== 'COMPLETED') return null;
  return data.payer?.email_address || null;
}

function buildLinkEmail({ link, title, test }) {
  const safeTitle = htmlEscape(title);
  const tag = test ? '[TEST] ' : '';
  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:1.5rem;color:#111">
  <div dir="rtl" style="margin-bottom:1.5rem">
    <h2 style="color:#c8a96e">AMIT PHOTOS</h2>
    <p>תודה על הרכישה! הקובץ "${safeTitle}" מוכן להורדה.</p>
    <p><a href="${link}" style="display:inline-block;background:#c8a96e;color:#111;padding:.7rem 1.6rem;text-decoration:none;font-weight:700">להורדת הקובץ</a></p>
    <p style="color:#666;font-size:.9rem">הקישור חד-פעמי ותקף ל-24 שעות מרגע ההנפקה. אם ההורדה נכשלה, השיבו להודעה זו עם מספר ההזמנה ונשלח קישור חדש, ללא חיוב נוסף.</p>
  </div>
  <hr>
  <div dir="ltr" style="margin-top:1.5rem">
    <p>Thank you for your purchase! Your photo "${safeTitle}" is ready.</p>
    <p><a href="${link}" style="display:inline-block;background:#c8a96e;color:#111;padding:.7rem 1.6rem;text-decoration:none;font-weight:700">Download your file</a></p>
    <p style="color:#666;font-size:.9rem">The link works once and is valid for 24 hours from issue. If the download fails, reply to this email with your order number and we will send a new link at no extra charge.</p>
  </div>
</div>`;
  const text = `${tag}הקובץ "${title}" מוכן להורדה / Your photo "${title}" is ready.\n${link}\nהקישור חד-פעמי / The link works once (24 hours).`;
  return { subject: tag + 'הקובץ שלך מוכן להורדה | Your photo download is ready', html, text };
}

// Returns only a status code: the response body can echo the address and is never kept.
async function postLinkEmail(env, { to, mail, idempotencyKey }) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from: env.FROM_EMAIL || 'Amit Photos <contact@amitphotos.com>', to, subject: mail.subject, html: mail.html, text: mail.text }),
      signal: AbortSignal.timeout(LINK_EMAIL_TIMEOUT_MS),
    });
    return response.ok ? { ok: true } : { ok: false, reason: 'provider_' + response.status };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

async function markLinkEmail(env, order, requestId, status, reason) {
  await env.DB.prepare(
    "UPDATE paypal_order_actions SET status = ?, reason = ?, completed_at = ? WHERE order_ref = ? AND action = 'LINK_EMAIL' AND request_id = ?"
  ).bind(status, reason, new Date().toISOString(), order.id, requestId).run();
}

// kind: 'auto' (payment completion and the retry sweep) or 'manual' (admin, needs a key).
// Never throws and never reports a payment problem; the caller can ignore the result.
export async function sendDownloadLinkEmail(env, request, orderRow, { kind = 'auto', key = null, reason = '', payerEmail = null } = {}) {
  try {
    if (!downloadEmailEnabled(env)) return { status: 'SKIPPED', reason: 'NOT_ENABLED' };
    const config = resolvePayPalConfig(env, request || undefined);
    if (!config.ok) return { status: 'SKIPPED', reason: 'CONFIG_INVALID' };
    const origin = linkEmailOrigin(request, env, config);
    if (!origin) return { status: 'SKIPPED', reason: 'NO_SAFE_ORIGIN' };

    const order = await env.DB.prepare('SELECT * FROM paypal_orders WHERE id = ?').bind(orderRow.id).first();
    if (!linkEmailEligible(order)) return { status: 'SKIPPED', reason: 'ORDER_NOT_ELIGIBLE' };
    const link = await activeDownloadLink(env, order);
    if (!link) return { status: 'SKIPPED', reason: 'NO_ACTIVE_LINK' };

    let recipient = linkEmailRecipient(env, config, payerEmail);
    if (recipient.reason === 'NO_PAYER_EMAIL') {
      recipient = linkEmailRecipient(env, config, await verifiedPayerEmail(env, order).catch(() => null));
    }
    if (!recipient.to) return { status: 'SKIPPED', reason: recipient.reason };

    const nowIso = new Date().toISOString();
    const fresh = new Date(Date.now() - LINK_EMAIL_IN_PROGRESS_MS).toISOString();
    let requestId;
    let inserted = false;
    if (kind === 'manual') {
      requestId = 'manual-' + key;
      const prior = await env.DB.prepare("SELECT status, reason FROM paypal_order_actions WHERE order_ref = ? AND action = 'LINK_EMAIL' AND request_id = ?").bind(order.id, requestId).first();
      if (prior) return { status: prior.status, replayed: true, test: prior.reason === 'test_recipient' };
      try {
        const result = await env.DB.prepare(
          `INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, created_at)
           SELECT ?, ?, 'LINK_EMAIL', ?, 'SENDING', 'admin', ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM paypal_order_actions WHERE order_ref = ? AND action = 'LINK_EMAIL' AND status = 'SENDING' AND created_at > ?)
             AND (SELECT COUNT(*) FROM paypal_order_actions WHERE order_ref = ? AND action = 'LINK_EMAIL' AND request_id LIKE 'manual-%') < ?`
        ).bind(order.id, order.paypal_order_id, requestId, String(reason).slice(0, 200), nowIso, order.id, fresh, order.id, LINK_EMAIL_MAX_MANUAL).run();
        inserted = Number(result?.meta?.changes) > 0;
      } catch { /* same key raced in parallel */ }
    } else {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM paypal_order_actions WHERE order_ref = ? AND action = 'LINK_EMAIL' AND request_id LIKE 'auto-%'").bind(order.id).first();
      const attempt = (Number(count?.n) || 0) + 1;
      if (attempt > LINK_EMAIL_MAX_AUTO) return { status: 'SKIPPED', reason: 'ATTEMPTS_EXHAUSTED' };
      requestId = 'auto-' + attempt;
      try {
        const result = await env.DB.prepare(
          `INSERT INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, created_at)
           SELECT ?, ?, 'LINK_EMAIL', ?, 'SENDING', 'system', 'auto', ?
           WHERE NOT EXISTS (SELECT 1 FROM paypal_order_actions WHERE order_ref = ? AND action = 'LINK_EMAIL' AND request_id LIKE 'auto-%' AND status = 'SENT')
             AND NOT EXISTS (SELECT 1 FROM paypal_order_actions WHERE order_ref = ? AND action = 'LINK_EMAIL' AND status = 'SENDING' AND created_at > ?)`
        ).bind(order.id, order.paypal_order_id, requestId, nowIso, order.id, order.id, fresh).run();
        inserted = Number(result?.meta?.changes) > 0;
      } catch { /* another sender took this attempt number */ }
    }
    if (!inserted) return { status: 'SKIPPED', reason: 'ALREADY_SENT_OR_IN_PROGRESS' };

    // A refund can land between the first check and the claim: look again, then send.
    const latest = await env.DB.prepare('SELECT * FROM paypal_orders WHERE id = ?').bind(order.id).first();
    const stillActive = linkEmailEligible(latest) ? await activeDownloadLink(env, latest) : null;
    if (!stillActive || stillActive.token !== link.token) {
      await markLinkEmail(env, order, requestId, 'SKIPPED', 'link_changed_before_send');
      return { status: 'SKIPPED', reason: 'LINK_CHANGED' };
    }

    const mail = buildLinkEmail({
      link: origin + '/checkout/download/#t=' + link.token,
      title: (await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(order.photo_id).first())?.title || order.photo_id,
      test: recipient.test,
    });
    const idempotencyKey = kind === 'manual'
      ? 'dl-manual-' + order.id + '-' + key
      : 'dl-auto-' + order.id + '-' + await linkFingerprint(link.token);
    const sent = await postLinkEmail(env, { to: recipient.to, mail, idempotencyKey });
    await markLinkEmail(env, order, requestId, sent.ok ? 'SENT' : 'FAILED', sent.ok ? (recipient.test ? 'test_recipient' : 'payer') : sent.reason);
    return sent.ok ? { status: 'SENT', test: recipient.test } : { status: 'FAILED', reason: sent.reason };
  } catch {
    return { status: 'FAILED', reason: 'exception' };
  }
}

// Fire-and-forget after a completed payment; background when the runtime provides it.
function sendLinkEmailInBackground(env, request, order, options) {
  const job = sendDownloadLinkEmail(env, request, order, { kind: 'auto', payerEmail: options?.payerEmail || null }).catch(() => {});
  if (typeof options?.waitUntil === 'function') { options.waitUntil(job); return Promise.resolve(); }
  return job;
}

// Retry sweep (scheduled): paid orders from the last 24 h that still hold an unused link
// and have no delivered mail yet. Recovers a failed or interrupted send. Bounded per run.
export async function retryDownloadLinkEmails(env) {
  if (!downloadEmailEnabled(env) || !resolvePayPalConfig(env).ok) return { checked: 0 };
  const since = new Date(Date.now() - LINK_EMAIL_SWEEP_WINDOW_MS).toISOString();
  const rows = await env.DB.prepare(
    `SELECT o.* FROM paypal_orders o
     WHERE o.order_type = 'digital' AND o.status = 'COMPLETED' AND o.completed_at > ? AND o.after_sale_state = 'NONE' AND o.dispute_open = 0
       AND EXISTS (SELECT 1 FROM download_tokens t WHERE t.used = 0 AND t.revoked_at IS NULL AND t.expires_at > ? AND (t.paypal_order_ref = o.id OR t.tx = o.paypal_capture_id))
       AND NOT EXISTS (SELECT 1 FROM paypal_order_actions a WHERE a.order_ref = o.id AND a.action = 'LINK_EMAIL' AND a.request_id LIKE 'auto-%' AND a.status = 'SENT')
       AND (SELECT COUNT(*) FROM paypal_order_actions a WHERE a.order_ref = o.id AND a.action = 'LINK_EMAIL' AND a.request_id LIKE 'auto-%') < ?
     ORDER BY o.completed_at LIMIT ?`
  ).bind(since, Math.floor(Date.now() / 1000), LINK_EMAIL_MAX_AUTO, LINK_EMAIL_SWEEP_LIMIT).all();
  let checked = 0;
  for (const order of rows?.results || []) {
    checked++;
    await sendDownloadLinkEmail(env, null, order, { kind: 'auto' });
  }
  return { checked };
}

// Support: send the CURRENT active link again (no new token; use reissue first if none is active).
export async function handlePayPalResendLinkEmail(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const blocked = adminConfigBlocked(request, env);
  if (blocked) return blocked;
  const input = adminActionInput(request, await request.json().catch(() => ({})));
  if (input.error) return jsonRes({ error: input.error }, 400, request);
  if (!downloadEmailEnabled(env)) return jsonRes({ error: 'DOWNLOAD_EMAIL_NOT_ENABLED' }, 409, request);
  const order = await env.DB.prepare('SELECT * FROM paypal_orders WHERE paypal_order_id = ?').bind(input.paypalOrderId).first();
  if (!order) return jsonRes({ error: 'ORDER_NOT_FOUND' }, 404, request);
  const result = await sendDownloadLinkEmail(env, request, order, { kind: 'manual', key: input.key, reason: input.reason });
  const status = result.status === 'SENT' ? 200 : (result.status === 'SKIPPED' || result.status === 'FAILED') ? 409 : 200;
  return jsonRes({ ok: result.status === 'SENT', status: result.status, reason: result.reason || null, replayed: !!result.replayed, test: !!result.test }, status, request);
}

// ---------------------------------------------------------------------------
// Read-only readiness check for the selected PayPal environment (admin only; also the
// way to verify Live before any money moves). It only fetches an OAuth token and READS
// the webhook definition: no order, capture, refund or change to PayPal settings.
// It reports NOT_READY with reason codes and never returns a secret, a token or the
// webhook id.
// ---------------------------------------------------------------------------
const REQUIRED_WEBHOOK_EVENTS = [
  'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
  'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED',
];
const WEBHOOK_PATH = '/api/paypal/webhook';

export async function handlePayPalLiveReadiness(request, env) {
  if (request.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405, request);
  const reasons = [];
  const checks = {};
  const config = resolvePayPalConfig(env, request);
  if (!config.ok) {
    return jsonRes({ status: 'NOT_READY', environment: null, reasons: [config.reason], checks: { configValid: false } }, 200, request);
  }
  checks.configValid = true;
  checks.credentialsPresent = !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  checks.webhookIdPresent = !!env.PAYPAL_WEBHOOK_ID;
  checks.paymentFlags = { payments: env.PAYMENTS_ENABLED === 'true', digital: env.DIGITAL_PAYPAL_ENABLED === 'true' };
  if (!checks.credentialsPresent) reasons.push('PAYPAL_CREDENTIALS_MISSING');
  if (!checks.webhookIdPresent) reasons.push('PAYPAL_WEBHOOK_ID_MISSING');

  // Mail settings that would be dangerous or broken in the selected environment.
  const mailOn = env.DOWNLOAD_EMAIL_ENABLED === 'true';
  checks.downloadEmail = { enabled: mailOn, keyPresent: !!env.RESEND_API_KEY, testRecipientSet: !!env.DOWNLOAD_EMAIL_OVERRIDE_TO };
  if (config.environment === 'live' && checks.downloadEmail.testRecipientSet) reasons.push('TEST_RECIPIENT_SET_IN_LIVE');
  checks.paymentAlerts = { enabled: paymentAlertsEnabled(env), channels: paymentAlertChannels(env) };
  const checkoutSwitch = await readCheckoutSwitch(env);
  checks.checkoutSwitch = checkoutSwitch.ok ? { state: checkoutSwitch.config.state, effectiveMode: checkoutSwitch.effective.mode } : { state: 'none', effectiveMode: 'blocked', reason: checkoutSwitch.reason };
  if (!checkoutSwitch.ok && checkoutSwitch.reason !== 'SWITCH_ABSENT') reasons.push('CHECKOUT_SWITCH_INVALID');
  if (config.environment === 'live' && !checks.paymentAlerts.enabled) reasons.push('PAYMENT_ALERTS_NOT_ENABLED');
  if (mailOn && !env.RESEND_API_KEY) reasons.push('EMAIL_ENABLED_WITHOUT_KEY');
  if (mailOn) {
    let base = null;
    try { base = new URL(env.PUBLIC_BASE_URL).origin; } catch {}
    if (!base || !base.startsWith('https://') || (config.environment === 'live' && !ALLOWED_ORIGINS.includes(base))) reasons.push('PUBLIC_BASE_URL_INVALID');
  }

  if (checks.credentialsPresent) {
    let accessToken = null;
    try { accessToken = await getPayPalAccessToken(env); } catch {}
    checks.oauth = !!accessToken;
    if (!accessToken) {
      reasons.push('PAYPAL_OAUTH_FAILED');
    } else if (checks.webhookIdPresent) {
      let webhook = null;
      let status = 0;
      try {
        const response = await fetch(
          paypalApiBase(env) + '/v1/notifications/webhooks/' + encodeURIComponent(env.PAYPAL_WEBHOOK_ID),
          { method: 'GET', headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' } }
        );
        status = response.status;
        webhook = response.ok ? await response.json().catch(() => null) : null;
      } catch {}
      checks.webhookFound = !!webhook;
      if (!webhook) {
        reasons.push(status === 404 ? 'WEBHOOK_NOT_FOUND' : 'WEBHOOK_LOOKUP_FAILED');
      } else {
        let url = null;
        try { url = new URL(webhook.url); } catch {}
        const expectedOrigin = (() => { try { return new URL(request.url).origin; } catch { return null; } })();
        const urlOk = !!url && url.protocol === 'https:' && !url.port && !url.username && url.pathname === WEBHOOK_PATH && !url.search && url.origin === expectedOrigin;
        checks.webhookUrl = url ? { host: url.host, path: url.pathname, matchesThisSite: urlOk } : { matchesThisSite: false };
        if (!urlOk) reasons.push('WEBHOOK_URL_MISMATCH');
        const names = new Set((Array.isArray(webhook.event_types) ? webhook.event_types : []).map(item => item?.name));
        const missing = names.has('*') ? [] : REQUIRED_WEBHOOK_EVENTS.filter(name => !names.has(name));
        checks.webhookEvents = { missing, approvedEventSubscribed: names.has('*') || names.has('CHECKOUT.ORDER.APPROVED') };
        if (missing.length) reasons.push('WEBHOOK_EVENTS_MISSING');
      }
    }
  }
  return jsonRes({ status: reasons.length ? 'NOT_READY' : 'READY', environment: config.environment, reasons, checks }, 200, request);
}

// Alerts must never change a payment or webhook outcome: background when the runtime allows it.
function runBackground(options, job) {
  const safe = Promise.resolve(job).catch(() => {});
  if (typeof options?.waitUntil === 'function') { options.waitUntil(safe); return Promise.resolve(); }
  return safe;
}

// A failing event is announced once it has failed WEBHOOK_FAILING_ATTEMPTS times (PayPal retries it).
async function noteWebhookFailure(env, event, options) {
  try {
    const row = await env.DB.prepare('SELECT attempts FROM paypal_webhook_events WHERE event_id = ?').bind(event.id).first();
    const alert = webhookFailingAlert(event.id, event.event_type, Number(row?.attempts) || 0);
    if (alert) await runBackground(options, sendPaymentAlert(env, alert));
  } catch { /* monitoring never affects the webhook response */ }
}

// Admin: read or change the D1 checkout switch (see paypal-switch.js). Changing it needs the admin
// login (enforced by the route), a unique Idempotency-Key and a reason, and is written to the audit
// table. Closing and freezing never depend on PayPal configuration (they must work in an emergency);
// opening requires a valid PayPal configuration and a closing time. Only this handler and a manual
// D1 statement ever write the switch: a deployment never creates, changes or resets it.
export async function handlePayPalCheckoutSwitch(request, env) {
  if (request.method === 'GET') {
    const state = await readCheckoutSwitch(env);
    return jsonRes(state.ok
      ? { valid: true, state: state.config.state, effectiveMode: state.effective.mode, autoClosed: !!state.effective.autoClosed, config: state.config, graceMinutesAfterClose: CLOSE_GRACE_MS / 60000 }
      : { valid: false, reason: state.reason, effectiveMode: 'blocked', note: 'No valid switch: new orders and charges are blocked.' }, 200, request);
  }
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  const key = request.headers.get('Idempotency-Key') || '';
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 150) : '';
  const desired = body?.state;
  if (!ACTION_ID.test(key)) return jsonRes({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400, request);
  if (!reason) return jsonRes({ error: 'REASON_REQUIRED' }, 400, request);
  if (desired !== 'open' && desired !== 'closed' && desired !== 'frozen') return jsonRes({ error: 'STATE_INVALID' }, 400, request);

  const prior = await env.DB.prepare("SELECT status FROM paypal_order_actions WHERE order_ref = 'SYSTEM' AND action = 'SWITCH' AND request_id = ?").bind(key).first();
  if (prior) {
    const now = await readCheckoutSwitch(env);
    return jsonRes({ ok: true, replayed: true, requestedState: prior.status, currentState: now.ok ? now.config.state : null }, 200, request);
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const current = await readCheckoutSwitch(env, nowMs);
  let next;
  if (desired === 'open') {
    const config = resolvePayPalConfig(env, request);
    if (!config.ok) return jsonRes({ error: 'PAYPAL_CONFIGURATION_INVALID', reason: config.reason }, 503, request);
    if (current.ok && current.config.state === 'frozen') return jsonRes({ error: 'FROZEN_MUST_BE_CLOSED_FIRST' }, 409, request);
    const closesMs = typeof body.closesAt === 'string' ? Date.parse(body.closesAt) : NaN;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(String(body.closesAt)) || !Number.isFinite(closesMs) || closesMs <= nowMs || closesMs > nowMs + MAX_OPEN_HORIZON_MS) {
      return jsonRes({ error: 'CLOSES_AT_INVALID', note: 'ISO UTC time in the future, at most 90 days ahead' }, 400, request);
    }
    next = { state: 'open', openedAt: nowIso, closesAt: new Date(closesMs).toISOString(), maxOrders: body.maxOrders ?? null, photoIds: body.photoIds ?? null, updatedAt: nowIso, updatedBy: 'admin' };
    const check = parseSwitch(JSON.stringify(next));
    if (!check.ok) return jsonRes({ error: check.reason }, 400, request);
    next = { ...check.config, updatedAt: nowIso, updatedBy: 'admin' };
  } else {
    // Keep the ORIGINAL stop time when the checkout was already closed or frozen, so moving from
    // frozen to closed never reopens the 30-minute window for orders from before the emergency.
    const stoppedAt = current.ok && current.effective.mode !== 'open' ? current.effective.closedAt : nowIso;
    next = { state: desired, closedAt: stoppedAt, updatedAt: nowIso, updatedBy: 'admin' };
  }

  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(SWITCH_KEY, JSON.stringify(next)).run();
  const summary = desired === 'open'
    ? ' closesAt=' + next.closesAt + ' maxOrders=' + (next.maxOrders ?? 'none') + ' photos=' + (next.photoIds ? next.photoIds.length : 'any')
    : '';
  await env.DB.prepare(
    "INSERT OR IGNORE INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, created_at, completed_at) VALUES ('SYSTEM', '-', 'SWITCH', ?, ?, 'admin', ?, ?, ?)"
  ).bind(key, desired, (reason + ' | from=' + (current.ok ? current.config.state : current.reason) + ' to=' + desired + summary).slice(0, 400), nowIso, nowIso).run();
  return jsonRes({ ok: true, state: next.state, effectiveMode: effectiveSwitch(next, nowMs).mode, config: next }, 200, request);
}

// Admin: sends ONE harmless test alert through the real channels (no order, no customer data, no
// payment action). The same Idempotency-Key never sends twice, which proves the de-duplication live.
export async function handlePayPalTestAlert(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const blocked = adminConfigBlocked(request, env);
  if (blocked) return blocked;
  const key = request.headers.get('Idempotency-Key') || '';
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100) : '';
  if (!ACTION_ID.test(key)) return jsonRes({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400, request);
  if (!reason) return jsonRes({ error: 'REASON_REQUIRED' }, 400, request);
  if (!paymentAlertsEnabled(env)) return jsonRes({ error: 'PAYMENT_ALERTS_NOT_ENABLED' }, 409, request);
  const environment = resolvePayPalConfig(env, request).environment;
  const result = await sendPaymentAlert(env, {
    kind: 'TEST', key: 'test-' + key,
    text: 'בדיקת התראה (' + environment + '): זו הודעת בדיקה, אין תקלה ואין צורך בפעולה. סיבה: ' + reason,
  });
  if (result.status === 'SENT') return jsonRes({ ok: true, status: 'SENT', channels: result.channels }, 200, request);
  if (result.reason === 'ALREADY_ALERTED') return jsonRes({ ok: true, status: 'SKIPPED', replayed: true }, 200, request);
  return jsonRes({ ok: false, status: result.status, reason: result.reason }, 502, request);
}

// Admin, read-only: stuck payments, failing webhooks, items waiting for a human, mail failures.
export async function handlePayPalHealth(request, env) {
  if (request.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405, request);
  const blocked = adminConfigBlocked(request, env);
  if (blocked) return blocked;
  return jsonRes(await paymentHealthSnapshot(env), 200, request);
}

export async function handlePayPalWebhook(request, env, options = {}) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  const config = resolvePayPalConfig(env, request);
  if (!config.ok) {
    return jsonRes({ error: config.reason === 'PAYPAL_WEBHOOK_ID_MISSING' ? config.reason : 'PAYPAL_CONFIGURATION_INVALID', reason: config.reason },
      config.reason === 'PAYPAL_WEBHOOK_ID_MISSING' ? 400 : 503, request);
  }

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
    if (AFTER_SALE_EVENT_TYPES.has(event.event_type)) {
      const handled = await processAfterSaleWebhook(request, env, event, verified.accessToken);
      if (!handled.ok) {
        await releaseWebhookLease(env, event.id);
        await noteWebhookFailure(env, event, options);
        return jsonRes({ error: handled.error }, handled.status || 500, request);
      }
      await markWebhookProcessed(env, event.id);
      const alert = handled.afterSale ? afterSaleAlert(event.id, handled.afterSale, handled.paypalOrderId, handled.orderRef) : null;
      if (alert) await runBackground(options, sendPaymentAlert(env, alert));
      return jsonRes({ ok: true, duplicate: false, ignored: !!handled.ignored, afterSale: handled.afterSale || null }, 200, request);
    }
    if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
      await markWebhookProcessed(env, event.id);
      return jsonRes({ ok: true, ignored: true }, 200, request);
    }

    const processed = await processCompletedCaptureWebhook(
      request,
      env,
      event,
      verified.accessToken,
      options
    );
    if (!processed.ok) {
      await releaseWebhookLease(env, event.id);
      await noteWebhookFailure(env, event, options);
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
    await noteWebhookFailure(env, event, options);
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
  const blocked = sandboxToolsBlocked(request, env);
  if (blocked) return blocked;
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

// Response for an order that already exists for this Idempotency-Key: the canonical
// local order id plus, when requested, the buyer approval URL read from PayPal.
async function canonicalOrderResponse(request, env, paypalOrderId, options) {
  const result = { paypalOrderId, reused: true };
  if (options.includeApproveUrl) {
    try {
      const token = await getPayPalAccessToken(env);
      const response = await fetch(
        paypalApiBase(env) + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId),
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

export async function handlePayPalCreateOrder(request, env, options = {}) {
  if (options.allowWhenPaymentsDisabled) {
    // Admin test hooks: Sandbox only, even with the flags off.
    const blocked = sandboxToolsBlocked(request, env);
    if (blocked) return blocked;
  } else if (!digitalPaymentsEnabled(env, request)) {
    return paymentsDisabledResponse(request);
  }
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);

  if (!options.skipRateLimit) {
    const limited = await enforcePayPalRateLimit(request, env, 'create-order', 8, 60);
    if (limited) return limited;
  }

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (!validIdempotencyKey(idempotencyKey)) {
    return jsonRes({ error: 'Idempotency-Key לא תקין' }, 400, request);
  }

  // Public checkout confirms the server quote; the client never sets the price.
  let publicBody;
  let switchConfig = null;
  if (options.publicCheckout) {
    publicBody = await request.clone().json().catch(() => ({}));
    // D1 switch: no valid/open switch, a closed or frozen checkout, or a photo outside the canary list = no new order.
    const gate = await checkNewOrderAllowed(env, { photoId: typeof publicBody?.photoId === 'string' ? publicBody.photoId : '' });
    if (!gate.allowed) return paymentsDisabledResponse(request);
    switchConfig = gate.config;
    if (publicBody.licenseAccepted !== true || publicBody.currency !== 'ILS') {
      return jsonRes({ error: 'PERSONAL_LICENSE_ACCEPTANCE_REQUIRED' }, 400, request);
    }
    const quote = await resolveDigitalPayPalPrice(env, publicBody.photoId, publicBody.sku, 'ILS');
    if (quote.error) return jsonRes({ error: quote.error }, quote.status, request);
    if (publicBody.expectedAmountMinor !== quote.amountExpected) {
      return jsonRes({ error: 'PRICE_CHANGED' }, 409, request);
    }
    const prior = await env.DB.prepare(
      'SELECT * FROM paypal_orders WHERE client_idempotency_key = ? LIMIT 1'
    ).bind(idempotencyKey).first();
    if (prior && (prior.photo_id !== publicBody.photoId || prior.sku !== publicBody.sku ||
        prior.currency !== 'ILS' || prior.amount_expected !== quote.amountExpected)) {
      return jsonRes({ error: 'CHECKOUT_ATTEMPT_MISMATCH' }, 409, request);
    }
  }

  const existing = await env.DB.prepare(
    'SELECT paypal_order_id FROM paypal_orders WHERE client_idempotency_key = ? LIMIT 1'
  ).bind(idempotencyKey).first();
  if (existing?.paypal_order_id) {
    return canonicalOrderResponse(request, env, existing.paypal_order_id, options);
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

  // Canary cap, early look (saves a PayPal call when it is already full). The binding check is the
  // atomic INSERT below, which parallel requests cannot get around.
  if (switchConfig?.maxOrders) {
    const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM paypal_orders WHERE order_type = 'digital' AND created_at >= ?").bind(switchConfig.openedAt).first();
    if ((Number(used?.n) || 0) >= switchConfig.maxOrders) return paymentsDisabledResponse(request);
  }

  let accessToken;
  try {
    accessToken = await getPayPalAccessToken(env);
  } catch {
    return jsonRes({ error: 'PayPal authentication failed' }, 502, request);
  }

  const localId = crypto.randomUUID();
  const origin = new URL(request.url).origin;
  // The checkout page language must survive the PayPal round trip. Only the exact
  // value "en" is honoured; anything else keeps the default (Hebrew) URLs unchanged.
  const returnLang = options.publicCheckout && publicBody?.lang === 'en' ? '&lang=en' : '';
  const paypalResponse = await fetch(paypalApiBase(env) + '/v2/checkout/orders', {
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
            return_url: origin + (options.publicCheckout ? '/checkout/?approved=1' + returnLang : '/api/paypal/approved'),
            cancel_url: origin + (options.publicCheckout ? '/checkout/?cancelled=1' + returnLang : '/api/paypal/cancelled'),
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
    const createdAt = new Date().toISOString();
    const values = [localId, paypalOrder.id, photoId, sku, pricing.amountExpected, pricing.currency, createdAt, idempotencyKey];
    let inserted;
    if (switchConfig?.maxOrders) {
      // The count is part of the statement, so concurrent requests cannot exceed the cap.
      inserted = await env.DB.prepare(
        "INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at, client_idempotency_key) SELECT ?, ?, 'digital', ?, ?, ?, ?, 'CREATED', ?, ? WHERE " + capSql(switchConfig.maxOrders)
      ).bind(...values, switchConfig.openedAt, switchConfig.maxOrders).run();
    } else {
      inserted = await env.DB.prepare(
        "INSERT INTO paypal_orders (id, paypal_order_id, order_type, photo_id, sku, amount_expected, currency, status, created_at, client_idempotency_key) VALUES (?, ?, 'digital', ?, ?, ?, ?, 'CREATED', ?, ?)"
      ).bind(...values).run();
    }
    if (!(Number(inserted?.meta?.changes) > 0)) {
      // Cap reached by a parallel request. A retry that already owns a row is not a new order.
      const owned = await env.DB.prepare('SELECT * FROM paypal_orders WHERE client_idempotency_key = ? LIMIT 1').bind(idempotencyKey).first();
      if (owned?.paypal_order_id && owned.photo_id === photoId && owned.sku === sku && owned.currency === pricing.currency && owned.amount_expected === pricing.amountExpected) {
        return canonicalOrderResponse(request, env, owned.paypal_order_id, options);
      }
      return paymentsDisabledResponse(request);
    }
  } catch {
    // A concurrent request with the same Idempotency-Key may have persisted the
    // same PayPal order first. Return that canonical local row instead of a
    // spurious 500; any other persistence failure remains fail-closed.
    const raced = await env.DB.prepare(
      'SELECT * FROM paypal_orders WHERE client_idempotency_key = ? LIMIT 1'
    ).bind(idempotencyKey).first().catch(() => null);
    if (raced?.paypal_order_id) {
      // The winning row must describe the same purchase attempt as this request;
      // never hand back the approval link of a different photo, size or price.
      if (raced.photo_id !== photoId || raced.sku !== sku ||
          raced.currency !== pricing.currency || raced.amount_expected !== pricing.amountExpected) {
        return jsonRes({ error: 'CHECKOUT_ATTEMPT_MISMATCH' }, 409, request);
      }
      // Same response shape as the normal retry path, including the approval URL
      // the browser client needs to continue to PayPal.
      return canonicalOrderResponse(request, env, raced.paypal_order_id, options);
    }
    return jsonRes({ error: 'Could not persist PayPal order' }, 500, request);
  }

  const approveUrl = payerApprovalUrl(paypalOrder);
  const result = { paypalOrderId: paypalOrder.id };
  if (options.includeApproveUrl) result.approveUrl = approveUrl;
  return jsonRes(result, 201, request);
}

async function finalizeDigitalPayPalOrder(request, env, order, extras = {}) {
  const captureId = order.paypal_capture_id;
  const fulfillmentToken = order.fulfillment_token;
  if (!captureId || !fulfillmentToken) {
    return jsonRes({ error: 'PayPal fulfillment state is incomplete' }, 500, request);
  }

  const beforeMint = await env.DB.prepare('SELECT * FROM paypal_orders WHERE id = ?').bind(order.id).first();
  if (isTerminalAfterSale(beforeMint)) return jsonRes({ error: 'ORDER_REFUNDED' }, 409, request);

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

  // A refund may have landed between the check above and the insert: undo the link.
  const afterMint = await env.DB.prepare('SELECT * FROM paypal_orders WHERE id = ?').bind(order.id).first();
  if (isTerminalAfterSale(afterMint)) {
    await revokeUnusedTokens(env, order, captureId, afterSaleStateOf(afterMint));
    return jsonRes({ error: 'ORDER_REFUNDED' }, 409, request);
  }

  const photo = await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(order.photo_id).first();
  const fulfillment = {
    url: '/api/download/' + fulfillmentToken,
    title: photo?.title || order.photo_id,
  };

  const completion = await env.DB.prepare(
    "UPDATE paypal_orders SET status='COMPLETED', fulfillment_json=?, completed_at=? WHERE paypal_order_id=? AND status='FULFILLING'"
  ).bind(JSON.stringify(fulfillment), new Date().toISOString(), order.paypal_order_id).run();

  const completed = await env.DB.prepare(
    'SELECT status, fulfillment_json FROM paypal_orders WHERE paypal_order_id = ?'
  ).bind(order.paypal_order_id).first();
  if (completed?.status !== 'COMPLETED' || !completed.fulfillment_json) {
    return jsonRes({ error: 'Digital fulfillment completion failed' }, 500, request);
  }

  // Only the request that completed the order sends the mail. A mail problem is invisible
  // to the buyer's payment result and is retried by the sweep; the page still shows the link.
  if (Number(completion?.meta?.changes) > 0) await sendLinkEmailInBackground(env, request, order, extras);

  return jsonRes(fulfillment, 200, request);
}

export async function handlePayPalCaptureOrder(request, env, options = {}) {
  if (options.allowWhenPaymentsDisabled) {
    // Admin test hooks: Sandbox only, even with the flags off.
    const blocked = sandboxToolsBlocked(request, env);
    if (blocked) return blocked;
  } else if (!digitalPaymentsEnabled(env, request)) {
    return paymentsDisabledResponse(request);
  }
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
    return finalizeDigitalPayPalOrder(request, env, order, { waitUntil: options.waitUntil });
  }

  // The charge itself. Delivery of orders that are already paid (above) is never blocked by the switch.
  if (!options.allowWhenPaymentsDisabled) {
    const gate = await checkCaptureAllowed(env, order);
    if (!gate.allowed) return paymentsDisabledResponse(request);
  }

  let accessToken;
  try {
    accessToken = await getPayPalAccessToken(env);
  } catch {
    return jsonRes({ error: 'PayPal authentication failed' }, 502, request);
  }

  const captureUrl = paypalApiBase(env) + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId) + '/capture';
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
      paypalApiBase(env) + '/v2/checkout/orders/' + encodeURIComponent(paypalOrderId),
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
    // A definitive funding refusal must not look like a transient server error.
    // Unknown capture failures keep the generic retry/recovery path.
    if (Array.isArray(capturedOrder?.details) && capturedOrder.details.some(detail => detail?.issue === 'INSTRUMENT_DECLINED')) {
      return jsonRes({ error: 'PAYMENT_DECLINED', restartCheckout: true }, 422, request);
    }
    return jsonRes({ error: 'PayPal capture failed' }, 502, request);
  }

  const purchaseUnit = capturedOrder.purchase_units?.[0];
  const capture = purchaseUnit?.payments?.captures?.[0];
  const returnedCustomId = purchaseUnit?.custom_id || capture?.custom_id || null;

  if (capturedOrder.id === paypalOrderId &&
      (returnedCustomId === null || returnedCustomId === order.id) &&
      capture?.status === 'DECLINED') {
    return jsonRes({ error: 'PAYMENT_DECLINED', restartCheckout: true }, 422, request);
  }

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
      return finalizeDigitalPayPalOrder(request, env, order, { waitUntil: options.waitUntil });
    }
    return jsonRes({ error: 'Order is already being processed' }, 409, request);
  }

  order = { ...order, status: 'FULFILLING', paypal_capture_id: capture.id, fulfillment_token: fulfillmentToken };
  if (order.order_type !== 'digital') {
    return jsonRes({ error: 'Print fulfillment is not enabled in this phase' }, 409, request);
  }
  return finalizeDigitalPayPalOrder(request, env, order, { payerEmail: capturedOrder?.payer?.email_address || null, waitUntil: options.waitUntil });
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

