// Payment monitoring and alerts (read-only snapshot + once-only owner notifications).
// Off unless PAYMENT_ALERTS_ENABLED="true" AND a channel exists (CallMeBot Telegram, which the
// site already uses for purchase notices, and/or the existing Resend admin mail). Alerts carry
// only a kind, a PayPal order or event id and a hint: never a download link, an e-mail address,
// a secret, an amount or a name. Each alert key is claimed once in paypal_order_actions
// (action ALERT), so retries, redeliveries and repeated scheduled runs never repeat it.
// This module imports nothing from paypal-orders.js (one-way dependency).

const ALERT_ACTION = 'ALERT';
const STUCK_FULFILLING_MS = 2 * 60 * 60 * 1000;     // captured but fulfilment not completed (no fulfilment timestamp exists)
const WEBHOOK_UNPROCESSED_MS = 15 * 60 * 1000;       // PayPal retries with back-off; still unprocessed after this = failing
const WEBHOOK_FAILING_ATTEMPTS = 3;
const LIST_LIMIT = 10;
const ALERT_TIMEOUT_MS = 8000;

export function paymentAlertsEnabled(env) {
  return env.PAYMENT_ALERTS_ENABLED === 'true' && !!(env.CALLMEBOT_TELEGRAM_USER || env.RESEND_API_KEY);
}

export function paymentAlertChannels(env) {
  return { telegram: !!env.CALLMEBOT_TELEGRAM_USER, email: !!env.RESEND_API_KEY };
}

async function safeAll(env, sql, args, problems, label) {
  try {
    return (await env.DB.prepare(sql).bind(...args).all())?.results || [];
  } catch {
    problems.push(label);
    return [];
  }
}

// Read-only. Lists carry PayPal ids only (never tokens, e-mails or amounts).
export async function paymentHealthSnapshot(env, now = Date.now()) {
  const problems = [];
  const iso = ms => new Date(now - ms).toISOString();
  const dayAgo = iso(24 * 60 * 60 * 1000);
  const weekAgo = iso(7 * 24 * 60 * 60 * 1000);

  const stuckFulfilling = await safeAll(env,
    "SELECT paypal_order_id AS id FROM paypal_orders WHERE status = 'FULFILLING' AND created_at < ? ORDER BY created_at LIMIT ?",
    [iso(STUCK_FULFILLING_MS), LIST_LIMIT], problems, 'stuckFulfilling');
  const unprocessedWebhooks = await safeAll(env,
    'SELECT event_id AS id, event_type AS type, attempts FROM paypal_webhook_events WHERE processed != 1 AND received_at < ? ORDER BY received_at LIMIT ?',
    [iso(WEBHOOK_UNPROCESSED_MS), LIST_LIMIT], problems, 'unprocessedWebhooks');
  const reviewRequired = await safeAll(env,
    "SELECT paypal_order_id AS id FROM paypal_orders WHERE after_sale_state = 'REVIEW_REQUIRED' ORDER BY after_sale_updated_at LIMIT ?",
    [LIST_LIMIT], problems, 'reviewRequired');
  const openDisputes = await safeAll(env,
    'SELECT paypal_order_id AS id FROM paypal_orders WHERE dispute_open = 1 ORDER BY dispute_updated_at LIMIT ?',
    [LIST_LIMIT], problems, 'openDisputes');
  const emailExhausted = await safeAll(env,
    `SELECT o.paypal_order_id AS id FROM paypal_orders o
     WHERE o.status = 'COMPLETED' AND o.order_type = 'digital' AND o.completed_at > ? AND o.after_sale_state = 'NONE'
       AND NOT EXISTS (SELECT 1 FROM paypal_order_actions a WHERE a.order_ref = o.id AND a.action = 'LINK_EMAIL' AND a.request_id LIKE 'auto-%' AND a.status = 'SENT')
       AND (SELECT COUNT(*) FROM paypal_order_actions a WHERE a.order_ref = o.id AND a.action = 'LINK_EMAIL' AND a.request_id LIKE 'auto-%' AND a.status != 'SENDING') >= 4
     ORDER BY o.completed_at LIMIT ?`,
    [dayAgo, LIST_LIMIT], problems, 'emailExhausted');
  const paidWithoutLink = await safeAll(env,
    `SELECT o.paypal_order_id AS id FROM paypal_orders o
     WHERE o.status = 'COMPLETED' AND o.order_type = 'digital' AND o.completed_at > ?
       AND NOT EXISTS (SELECT 1 FROM download_tokens t WHERE t.tx = o.paypal_capture_id OR t.paypal_order_ref = o.id)
     ORDER BY o.completed_at LIMIT ?`,
    [weekAgo, LIST_LIMIT], problems, 'paidWithoutLink');

  const lists = { stuckFulfilling, unprocessedWebhooks, reviewRequired, openDisputes, emailExhausted, paidWithoutLink };
  const counts = Object.fromEntries(Object.entries(lists).map(([key, rows]) => [key, rows.length]));
  return {
    generatedAt: new Date(now).toISOString(),
    healthy: problems.length === 0 && Object.values(counts).every(n => n === 0),
    schemaProblems: problems,
    counts,
    items: lists,
    thresholds: { stuckFulfillingMinutes: STUCK_FULFILLING_MS / 60000, webhookUnprocessedMinutes: WEBHOOK_UNPROCESSED_MS / 60000, listLimit: LIST_LIMIT },
    alerts: { enabled: paymentAlertsEnabled(env), channels: paymentAlertChannels(env) },
  };
}

async function postTelegram(env, text) {
  if (!env.CALLMEBOT_TELEGRAM_USER) return false;
  try {
    const url = 'https://api.callmebot.com/text.php?user=@' + encodeURIComponent(env.CALLMEBOT_TELEGRAM_USER) + '&text=' + encodeURIComponent(text);
    const response = await fetch(url, { signal: AbortSignal.timeout(ALERT_TIMEOUT_MS) });
    return response.ok;
  } catch { return false; }
}

async function postEmail(env, subject, text) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.FROM_EMAIL || 'Amit Photos <contact@amitphotos.com>', to: env.ADMIN_EMAIL || 'contact@amitphotos.com', subject, text }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    return response.ok;
  } catch { return false; }
}

// kind: short code; key: unique per condition (order/event); never throws.
export async function sendPaymentAlert(env, { kind, key, orderRef = null, paypalOrderId = null, text }) {
  try {
    if (!paymentAlertsEnabled(env)) return { status: 'SKIPPED', reason: 'NOT_ENABLED' };
    const claim = await env.DB.prepare(
      "INSERT OR IGNORE INTO paypal_order_actions (order_ref, paypal_order_id, action, request_id, status, actor, reason, created_at) VALUES (?, ?, 'ALERT', ?, 'SENDING', 'system', ?, ?)"
    ).bind(orderRef || 'SYSTEM', paypalOrderId || '-', key, kind, new Date().toISOString()).run();
    if (!(Number(claim?.meta?.changes) > 0)) return { status: 'SKIPPED', reason: 'ALREADY_ALERTED' };

    const message = '[Amit Photos | תשלומים] ' + text;
    const channels = [];
    if (await postTelegram(env, message)) channels.push('telegram');
    if (await postEmail(env, '[Amit Photos] התראת תשלומים: ' + kind, message)) channels.push('email');
    if (!channels.length) {
      // Nothing delivered: release the claim so the next run (or event retry) tries again.
      await env.DB.prepare("DELETE FROM paypal_order_actions WHERE order_ref = ? AND action = 'ALERT' AND request_id = ?").bind(orderRef || 'SYSTEM', key).run();
      return { status: 'FAILED', reason: 'NO_CHANNEL_DELIVERED' };
    }
    await env.DB.prepare("UPDATE paypal_order_actions SET status = 'SENT', reason = ?, completed_at = ? WHERE order_ref = ? AND action = 'ALERT' AND request_id = ?")
      .bind(kind + ':' + channels.join('+'), new Date().toISOString(), orderRef || 'SYSTEM', key).run();
    return { status: 'SENT', channels };
  } catch {
    return { status: 'FAILED', reason: 'EXCEPTION' };
  }
}

// Texts name the condition and the PayPal id and point at the existing admin read routes.
const KINDS = {
  stuckFulfilling: id => ({ kind: 'STUCK_FULFILLING', key: 'stuck-' + id, paypalOrderId: id, text: `הזמנה ${id}: התשלום נקלט אך המסירה לא הושלמה מעל שעתיים. בדקו GET /api/admin/paypal/order?paypalOrderId=${id} והפעילו הנפקה מחדש לאחר אימות.` }),
  unprocessedWebhooks: row => ({ kind: 'WEBHOOK_FAILING', key: 'wh-' + row.id, text: `אירוע webhook ${row.id} (${row.type}) לא עובד אחרי ${row.attempts} ניסיונות. יש לבדוק את ה-Worker ולבצע Resend מלוח PayPal אחרי התיקון.` }),
  reviewRequired: id => ({ kind: 'REVIEW_REQUIRED', key: 'review-' + id, paypalOrderId: id, text: `הזמנה ${id} ממתינה להחלטה ידנית (החזר חלקי או מחלוקת). פעולה: after-sale-review (release או revoke).` }),
  openDisputes: id => ({ kind: 'DISPUTE_OPEN', key: 'dispute-' + id, paypalOrderId: id, text: `מחלוקת פתוחה בהזמנה ${id}. יש תאריכי יעד לתגובה ב-PayPal: בדקו בהקדם.` }),
  emailExhausted: id => ({ kind: 'LINK_EMAIL_EXHAUSTED', key: 'mail-' + id, paypalOrderId: id, text: `הזמנה ${id}: שליחת קישור ההורדה במייל נכשלה 4 פעמים. הלקוח עדיין רואה את הקישור בדף; שלחו ידנית (resend-link-email) לאחר בדיקת ספק המייל.` }),
  paidWithoutLink: id => ({ kind: 'PAID_WITHOUT_LINK', key: 'nolink-' + id, paypalOrderId: id, text: `הזמנה ${id} הושלמה אך אין לה קישור הורדה כלל. דורש בדיקה מיידית (אי-עקביות).` }),
};

export async function runPaymentHealthCheck(env) {
  if (!paymentAlertsEnabled(env)) return { checked: false };
  const snapshot = await paymentHealthSnapshot(env);
  const results = [];
  for (const [list, build] of Object.entries(KINDS)) {
    for (const item of snapshot.items[list] || []) {
      results.push(await sendPaymentAlert(env, build(list === 'unprocessedWebhooks' ? item : item.id)));
    }
  }
  if (snapshot.schemaProblems.length) {
    // A missing table or column means migrations are behind the code: say so once a day.
    const day = new Date().toISOString().slice(0, 10);
    results.push(await sendPaymentAlert(env, { kind: 'SCHEMA_BEHIND', key: 'schema-' + day, text: 'בדיקת הבריאות נתקלה בטבלה/עמודה חסרה (' + snapshot.schemaProblems.join(', ') + '). יש לוודא שמיגרציות 0002 ו-0003 הורצו.' }));
  }
  return { checked: true, healthy: snapshot.healthy, sent: results.filter(r => r.status === 'SENT').length, failed: results.filter(r => r.status === 'FAILED').length };
}

// Real-time notices from the webhook path (each event id alerts at most once).
export function afterSaleAlert(eventId, state, paypalOrderId, orderRef) {
  const text = {
    REFUNDED: `הזמנה ${paypalOrderId}: התקבל החזר מלא. קישורים שלא נוצלו בוטלו אוטומטית.`,
    REVERSED: `הזמנה ${paypalOrderId}: התקבל היפוך חיוב (chargeback). קישורים שלא נוצלו בוטלו. יש לבדוק ב-PayPal.`,
    REVIEW_REQUIRED: `הזמנה ${paypalOrderId}: החזר חלקי או מחלוקת. נדרשת החלטה ידנית; ההנפקה מחדש חסומה עד אז.`,
  }[state];
  return text ? { kind: 'AFTER_SALE_' + state, key: 'evt-' + eventId, orderRef, paypalOrderId, text } : null;
}

export function webhookFailingAlert(eventId, eventType, attempts) {
  return attempts >= WEBHOOK_FAILING_ATTEMPTS
    ? { kind: 'WEBHOOK_FAILING', key: 'wh-' + eventId, text: `אירוע webhook ${eventId} (${eventType}) נכשל ${attempts} פעמים ברצף. PayPal ינסה שוב; יש לבדוק את ה-Worker.` }
    : null;
}
