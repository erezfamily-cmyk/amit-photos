// Runtime on/off switch for DIGITAL PayPal checkout, stored in D1 (settings row
// "digital_checkout_switch"). It is independent of deployments: nothing in the code or the
// deploy pipeline creates, changes or resets it, so a deploy, a rollback or an agent's commit
// can neither open nor re-open checkout. It adds a gate ON TOP of the environment flags and
// readiness checks; it never overrides them.
//
//   no row / invalid row / unreadable database  -> closed to new orders AND charges (fail closed)
//   open    (closesAt required, enforced on every request, no cron needed)
//           -> new orders and charges, within optional caps: maxOrders (atomic), photoIds
//   closed  -> no quotes, no new orders. A charge (capture) is still allowed for an order created
//              BEFORE the closing moment, for 30 minutes after it (graceful close)
//   frozen  -> emergency: no quotes, no new orders, no charge at all
//
// In EVERY state webhooks, delivery of purchases already paid, downloads, re-issue, refund and
// dispute handling, e-mails and alerts keep working. This module imports nothing from
// paypal-orders.js (one-way dependency).

export const SWITCH_KEY = 'digital_checkout_switch';
export const CLOSE_GRACE_MS = 30 * 60 * 1000;
export const MAX_OPEN_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ORDERS_LIMIT = 100000;
const PHOTO_ID = /^[A-Za-z0-9_.-]{1,100}$/;

function isoTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Strict: anything unexpected makes the whole row invalid, which means closed.
export function parseSwitch(raw) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : null; } catch { return { ok: false, reason: 'SWITCH_INVALID_JSON' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'SWITCH_INVALID_SHAPE' };
  const state = value.state;
  if (state !== 'open' && state !== 'closed' && state !== 'frozen') return { ok: false, reason: 'SWITCH_UNKNOWN_STATE' };
  const config = { state, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null, updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : null };
  if (state === 'open') {
    if (isoTime(value.openedAt) === null || isoTime(value.closesAt) === null) return { ok: false, reason: 'SWITCH_OPEN_NEEDS_TIMES' };
    config.openedAt = value.openedAt;
    config.closesAt = value.closesAt;
    if (value.maxOrders !== null && value.maxOrders !== undefined) {
      if (!Number.isSafeInteger(value.maxOrders) || value.maxOrders < 1 || value.maxOrders > MAX_ORDERS_LIMIT) return { ok: false, reason: 'SWITCH_BAD_MAX_ORDERS' };
      config.maxOrders = value.maxOrders;
    } else config.maxOrders = null;
    if (value.photoIds !== null && value.photoIds !== undefined) {
      if (!Array.isArray(value.photoIds) || !value.photoIds.length || value.photoIds.length > 200 ||
          !value.photoIds.every(id => typeof id === 'string' && PHOTO_ID.test(id))) return { ok: false, reason: 'SWITCH_BAD_PHOTO_IDS' };
      config.photoIds = [...value.photoIds];
    } else config.photoIds = null;
  } else {
    if (isoTime(value.closedAt) === null) return { ok: false, reason: 'SWITCH_NEEDS_CLOSED_AT' };
    config.closedAt = value.closedAt;
  }
  return { ok: true, config };
}

// The mode that applies RIGHT NOW (closesAt is enforced here, on every request).
export function effectiveSwitch(config, now = Date.now()) {
  if (config.state === 'open') {
    if (Date.parse(config.closesAt) <= now) return { mode: 'closed', closedAt: config.closesAt, autoClosed: true, config };
    return { mode: 'open', config };
  }
  return { mode: config.state, closedAt: config.closedAt, config };
}

export async function readCheckoutSwitch(env, now = Date.now()) {
  let row;
  try {
    row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(SWITCH_KEY).first();
  } catch {
    return { ok: false, reason: 'SWITCH_UNREADABLE' };
  }
  if (!row || typeof row.value !== 'string') return { ok: false, reason: 'SWITCH_ABSENT' };
  const parsed = parseSwitch(row.value);
  if (!parsed.ok) return parsed;
  return { ok: true, config: parsed.config, effective: effectiveSwitch(parsed.config, now) };
}

// New quotes and new orders.
export async function checkNewOrderAllowed(env, { photoId = null, now = Date.now() } = {}) {
  const state = await readCheckoutSwitch(env, now);
  if (!state.ok) return { allowed: false, reason: state.reason };
  if (state.effective.mode !== 'open') return { allowed: false, reason: 'CHECKOUT_' + state.effective.mode.toUpperCase() };
  const { photoIds } = state.effective.config;
  if (photoId !== null && photoIds && !photoIds.includes(photoId)) return { allowed: false, reason: 'PHOTO_NOT_ALLOWED' };
  return { allowed: true, config: state.effective.config };
}

// The charge itself (PayPal capture). `order.created_at` must be an ISO string.
export async function checkCaptureAllowed(env, order, now = Date.now()) {
  const state = await readCheckoutSwitch(env, now);
  if (!state.ok) return { allowed: false, reason: state.reason };
  const { mode, closedAt } = state.effective;
  if (mode === 'open') return { allowed: true };
  if (mode === 'frozen') return { allowed: false, reason: 'CHECKOUT_FROZEN' };
  const closedMs = Date.parse(closedAt);
  const createdMs = Date.parse(order?.created_at);
  if (!Number.isFinite(createdMs)) return { allowed: false, reason: 'ORDER_TIME_UNKNOWN' };
  if (createdMs >= closedMs) return { allowed: false, reason: 'ORDER_CREATED_AFTER_CLOSE' };
  if (now > closedMs + CLOSE_GRACE_MS) return { allowed: false, reason: 'GRACE_PERIOD_ENDED' };
  return { allowed: true, graceful: true };
}

// Atomic order cap: the INSERT itself carries the count, so parallel requests cannot exceed it.
// Counts every digital order created since the checkout was opened (abandoned ones too).
export function capSql(maxOrders) {
  return maxOrders === null || maxOrders === undefined ? null
    : "(SELECT COUNT(*) FROM paypal_orders WHERE order_type = 'digital' AND created_at >= ?) < ?";
}
