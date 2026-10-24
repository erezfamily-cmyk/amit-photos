import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePayPalLiveReadiness } from '../paypal-orders.js';

// Read-only readiness check. Fake PayPal; fake non-secret values only; no network.
// What matters: it only fetches an OAuth token and READS the webhook definition,
// reports NOT_READY with reason codes, and never returns a secret, token or webhook id.

const SECRET = 'fake-client-secret-value';
const TOKEN = 'fake-access-token-value';
const WEBHOOK_ID = 'FAKEWEBHOOKID0001';
const ALL_EVENTS = ['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
  'CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED', 'CHECKOUT.ORDER.APPROVED'];

const NO_SWITCH_DB = { prepare: () => ({ bind: () => ({ first: async () => null }) }) };   // no switch row = closed
const SANDBOX_ENV = { DB: NO_SWITCH_DB, PAYPAL_CLIENT_ID: 'fake-id', PAYPAL_CLIENT_SECRET: SECRET, PAYPAL_WEBHOOK_ID: WEBHOOK_ID, PAYMENTS_ENABLED: 'false', DIGITAL_PAYPAL_ENABLED: 'false' };
const ALERTS = { PAYMENT_ALERTS_ENABLED: 'true', CALLMEBOT_TELEGRAM_USER: 'fake-telegram-user' };
const LIVE_ENV = { ...SANDBOX_ENV, ...ALERTS, PAYPAL_ENVIRONMENT: 'live', PAYPAL_CREDENTIALS_ENVIRONMENT: 'live' };

function fakePayPal({ oauth = 200, webhook = { url: 'https://amitphotos.com/api/paypal/webhook', event_types: ALL_EVENTS.map(name => ({ name })) }, webhookStatus = 200 } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(String(url));
    calls.push({ method: options.method || 'GET', host: u.host, path: u.pathname });
    if (u.pathname === '/v1/oauth2/token') return oauth === 200 ? Response.json({ access_token: TOKEN }) : Response.json({ error: 'invalid_client' }, { status: oauth });
    if (u.pathname === '/v1/notifications/webhooks/' + WEBHOOK_ID) return webhookStatus === 200 ? Response.json(webhook) : Response.json({}, { status: webhookStatus });
    return Response.json({}, { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}
const check = async (env, origin = 'https://amitphotos.com', method = 'GET') => {
  const response = await handlePayPalLiveReadiness(new Request(origin + '/api/admin/paypal/live-readiness', { method }), env);
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
};
const reasons = r => r.body.reasons;

test('READY in Sandbox and in Live when credentials, webhook URL and events all match; only OAuth and a webhook READ are used', async () => {
  for (const [env, host, environment] of [[SANDBOX_ENV, 'api-m.sandbox.paypal.com', 'sandbox'], [LIVE_ENV, 'api-m.paypal.com', 'live']]) {
    const net = fakePayPal();
    try {
      const result = await check(env);
      assert.equal(result.body.status, 'READY', JSON.stringify(result.body));
      assert.equal(result.body.environment, environment);
      assert.deepEqual(result.body.reasons, []);
      assert.deepEqual(net.calls, [
        { method: 'POST', host, path: '/v1/oauth2/token' },
        { method: 'GET', host, path: '/v1/notifications/webhooks/' + WEBHOOK_ID },
      ], 'no order, capture, refund or settings call');
      assert.equal(result.body.checks.webhookUrl.matchesThisSite, true);
    } finally { net.restore(); }
  }
});

test('the response never contains a secret, an access token, the webhook id or a client id', async () => {
  const net = fakePayPal();
  try {
    const result = await check({ ...LIVE_ENV, DOWNLOAD_EMAIL_OVERRIDE_TO: 'qa@example.com', RESEND_API_KEY: 'fake-mail-key' });
    for (const needle of [SECRET, TOKEN, WEBHOOK_ID, 'fake-id', 'fake-mail-key', 'qa@example.com', 'fake-telegram-user']) assert.ok(!result.text.includes(needle), needle);
  } finally { net.restore(); }
});

test('missing credentials or webhook id: NOT_READY without calling PayPal for what is absent', async () => {
  let net = fakePayPal();
  try {
    let result = await check({ ...LIVE_ENV, PAYPAL_CLIENT_SECRET: '' });
    assert.deepEqual(reasons(result), ['PAYPAL_CREDENTIALS_MISSING']);
    assert.equal(result.body.status, 'NOT_READY');
    assert.deepEqual(net.calls, [], 'no PayPal call without credentials');
    result = await check({ ...LIVE_ENV, PAYPAL_WEBHOOK_ID: undefined });
    assert.deepEqual(reasons(result), ['PAYPAL_WEBHOOK_ID_MISSING']);
    assert.deepEqual(net.calls, [], 'Live refuses at configuration level: no PayPal call at all');
    net.calls.length = 0;
    result = await check({ ...SANDBOX_ENV, PAYPAL_WEBHOOK_ID: undefined });
    assert.deepEqual(reasons(result), ['PAYPAL_WEBHOOK_ID_MISSING']);
    assert.deepEqual(net.calls.map(c => c.path), ['/v1/oauth2/token'], 'Sandbox: OAuth only, no webhook read without an id');
    result = await check({ ...SANDBOX_ENV, PAYPAL_CLIENT_ID: undefined });
    assert.deepEqual(reasons(result), ['PAYPAL_CREDENTIALS_MISSING', 'PAYPAL_WEBHOOK_ID_MISSING'].slice(0, 1));
  } finally { net.restore(); }
});

test('OAuth rejected (wrong environment or secret): NOT_READY and the webhook is not read', async () => {
  const net = fakePayPal({ oauth: 401 });
  try {
    const result = await check(LIVE_ENV);
    assert.deepEqual(reasons(result), ['PAYPAL_OAUTH_FAILED']);
    assert.deepEqual(net.calls.map(c => c.path), ['/v1/oauth2/token']);
  } finally { net.restore(); }
});

test('webhook problems: not found, lookup failure, other host / scheme / path / port / query, missing events (wildcard accepted)', async () => {
  const good = { event_types: ALL_EVENTS.map(name => ({ name })) };
  const cases = [
    ['not found', { webhookStatus: 404 }, 'WEBHOOK_NOT_FOUND'],
    ['lookup failed', { webhookStatus: 500 }, 'WEBHOOK_LOOKUP_FAILED'],
    ['other host', { webhook: { ...good, url: 'https://example.com/api/paypal/webhook' } }, 'WEBHOOK_URL_MISMATCH'],
    ['sandbox preview host in Live', { webhook: { ...good, url: 'https://feature-x.erez-family.workers.dev/api/paypal/webhook' } }, 'WEBHOOK_URL_MISMATCH'],
    ['http', { webhook: { ...good, url: 'http://amitphotos.com/api/paypal/webhook' } }, 'WEBHOOK_URL_MISMATCH'],
    ['wrong path', { webhook: { ...good, url: 'https://amitphotos.com/api/paypal/webhooks' } }, 'WEBHOOK_URL_MISMATCH'],
    ['port', { webhook: { ...good, url: 'https://amitphotos.com:8443/api/paypal/webhook' } }, 'WEBHOOK_URL_MISMATCH'],
    ['query', { webhook: { ...good, url: 'https://amitphotos.com/api/paypal/webhook?x=1' } }, 'WEBHOOK_URL_MISMATCH'],
    ['credentials', { webhook: { ...good, url: 'https://user:pw@amitphotos.com/api/paypal/webhook' } }, 'WEBHOOK_URL_MISMATCH'],
    ['no url', { webhook: { event_types: good.event_types } }, 'WEBHOOK_URL_MISMATCH'],
    ['events missing', { webhook: { url: 'https://amitphotos.com/api/paypal/webhook', event_types: [{ name: 'PAYMENT.CAPTURE.COMPLETED' }] } }, 'WEBHOOK_EVENTS_MISSING'],
  ];
  for (const [label, options, expected] of cases) {
    const net = fakePayPal(options);
    try {
      const result = await check(LIVE_ENV);
      assert.equal(result.body.status, 'NOT_READY', label);
      assert.ok(reasons(result).includes(expected), label + ' -> ' + reasons(result).join());
    } finally { net.restore(); }
  }
  const net = fakePayPal({ webhook: { url: 'https://amitphotos.com/api/paypal/webhook', event_types: [{ name: '*' }] } });
  try { assert.equal((await check(LIVE_ENV)).body.status, 'READY', 'wildcard subscription covers every event'); } finally { net.restore(); }
  const missing = fakePayPal({ webhook: { url: 'https://amitphotos.com/api/paypal/webhook', event_types: [{ name: 'PAYMENT.CAPTURE.COMPLETED' }] } });
  try {
    const result = await check(LIVE_ENV);
    assert.deepEqual(result.body.checks.webhookEvents.missing, ALL_EVENTS.filter(n => !['PAYMENT.CAPTURE.COMPLETED', 'CHECKOUT.ORDER.APPROVED'].includes(n)));
    assert.equal(result.body.checks.webhookEvents.approvedEventSubscribed, false);
  } finally { missing.restore(); }
});

test('the webhook URL must belong to the site the check runs on (Preview host in Sandbox, production host in Live)', async () => {
  const preview = 'https://feature-x-amit-photos-paypal-sandbox.erez-family.workers.dev';
  const net = fakePayPal({ webhook: { url: preview + '/api/paypal/webhook', event_types: ALL_EVENTS.map(name => ({ name })) } });
  try {
    assert.equal((await check(SANDBOX_ENV, preview)).body.status, 'READY');
    assert.ok(reasons(await check(SANDBOX_ENV, 'https://www.amitphotos.com')).includes('WEBHOOK_URL_MISMATCH'));
  } finally { net.restore(); }
});

test('Live flags a leftover test mail recipient and half-configured mail; an invalid configuration is NOT_READY without any PayPal call', async () => {
  const net = fakePayPal();
  try {
    let result = await check({ ...LIVE_ENV, DOWNLOAD_EMAIL_OVERRIDE_TO: 'qa@example.com' });
    assert.ok(reasons(result).includes('TEST_RECIPIENT_SET_IN_LIVE'));
    result = await check({ ...LIVE_ENV, DOWNLOAD_EMAIL_ENABLED: 'true' });
    assert.ok(reasons(result).includes('EMAIL_ENABLED_WITHOUT_KEY'));
    assert.ok(reasons(result).includes('PUBLIC_BASE_URL_INVALID'));
    result = await check({ ...LIVE_ENV, DOWNLOAD_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'k', PUBLIC_BASE_URL: 'https://amitphotos.com' });
    assert.equal(result.body.status, 'READY');
    result = await check({ ...LIVE_ENV, DOWNLOAD_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'k', PUBLIC_BASE_URL: 'https://evil.example' });
    assert.ok(reasons(result).includes('PUBLIC_BASE_URL_INVALID'));
    net.calls.length = 0;
    for (const bad of [{ PAYPAL_ENVIRONMENT: 'prod' }, { PAYPAL_CREDENTIALS_ENVIRONMENT: 'sandbox' }, { PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com' }]) {
      const invalid = await check({ ...LIVE_ENV, ...bad });
      assert.equal(invalid.body.status, 'NOT_READY');
      assert.equal(invalid.body.environment, null);
    }
    assert.deepEqual(net.calls, []);
    const wrongOrigin = await check(LIVE_ENV, 'https://feature-x.erez-family.workers.dev');
    assert.deepEqual(wrongOrigin.body.reasons, ['PAYPAL_LIVE_ORIGIN_NOT_ALLOWED']);
    assert.deepEqual(net.calls, []);
  } finally { net.restore(); }
});

test('only GET is accepted, and the payment flags are reported but not required to be off or on', async () => {
  const net = fakePayPal();
  try {
    const post = await handlePayPalLiveReadiness(new Request('https://amitphotos.com/x', { method: 'POST', body: '{}' }), LIVE_ENV);
    assert.equal(post.status, 405);
    const open = await check({ ...LIVE_ENV, PAYMENTS_ENABLED: 'true', DIGITAL_PAYPAL_ENABLED: 'true' });
    assert.deepEqual(open.body.checks.paymentFlags, { payments: true, digital: true });
    assert.equal(open.body.status, 'READY');
  } finally { net.restore(); }
});

test('Live is NOT_READY until payment alerts are enabled with a channel; Sandbox does not need them', async () => {
  const net = fakePayPal();
  try {
    const { PAYMENT_ALERTS_ENABLED, CALLMEBOT_TELEGRAM_USER, ...liveWithoutAlerts } = LIVE_ENV;
    let result = await check(liveWithoutAlerts);
    assert.deepEqual(reasons(result), ['PAYMENT_ALERTS_NOT_ENABLED']);
    result = await check({ ...liveWithoutAlerts, PAYMENT_ALERTS_ENABLED: 'true' });
    assert.deepEqual(reasons(result), ['PAYMENT_ALERTS_NOT_ENABLED', 'ALERT_NO_USABLE_CHANNEL'], 'enabled flag without any channel is not enough, and says why');
    result = await check({ ...liveWithoutAlerts, PAYMENT_ALERTS_ENABLED: 'true', RESEND_API_KEY: 'k' });
    assert.equal(result.body.status, 'READY');
    assert.deepEqual(result.body.checks.paymentAlerts, { enabled: true, channels: { telegram: false, email: true }, problems: [] });
    assert.equal((await check(SANDBOX_ENV)).body.status, 'READY');
  } finally { net.restore(); }
});

test('alerts switched on but with a missing or invalid e-mail channel: NOT_READY in Live with the exact cause, and flagged in every environment', async () => {
  const net = fakePayPal();
  try {
    const { CALLMEBOT_TELEGRAM_USER, ...base } = LIVE_ENV;                       // no Telegram: e-mail is the only channel
    const emailOnly = { ...base, PAYMENT_ALERTS_ENABLED: 'true', PAYMENT_ALERT_CHANNELS: 'email' };
    let result = await check({ ...emailOnly });                                   // key missing
    assert.equal(result.body.status, 'NOT_READY');
    assert.deepEqual(reasons(result), ['PAYMENT_ALERTS_NOT_ENABLED', 'ALERT_EMAIL_KEY_MISSING', 'ALERT_NO_USABLE_CHANNEL']);
    for (const recipient of ['not-an-email', 'a@b', 'two words@example.com', 'a@example.com,b@example.com', '<x>@example.com']) {
      result = await check({ ...emailOnly, RESEND_API_KEY: 'k', PAYMENT_ALERT_EMAIL: recipient });
      assert.equal(result.body.status, 'NOT_READY', recipient);
      assert.deepEqual(reasons(result), ['PAYMENT_ALERTS_NOT_ENABLED', 'ALERT_EMAIL_RECIPIENT_INVALID', 'ALERT_NO_USABLE_CHANNEL'], recipient);
      assert.ok(!result.text.includes(recipient.replace(/[<>]/g, '')), 'the response never echoes the address');
    }
    result = await check({ ...emailOnly, RESEND_API_KEY: 'k', PAYMENT_ALERT_CHANNELS: 'sms' });
    assert.deepEqual(reasons(result), ['PAYMENT_ALERTS_NOT_ENABLED', 'ALERT_CHANNELS_UNKNOWN', 'ALERT_NO_USABLE_CHANNEL']);
    result = await check({ ...emailOnly, RESEND_API_KEY: 'k', PAYMENT_ALERT_EMAIL: 'alerts@example.com' });
    assert.equal(result.body.status, 'READY', 'the sound e-mail setup passes');
    // Sandbox does not need alerts, but alerts that are switched on and broken are still reported there
    const sandboxBroken = await check({ ...SANDBOX_ENV, PAYMENT_ALERTS_ENABLED: 'true', PAYMENT_ALERT_CHANNELS: 'email' });
    assert.equal(sandboxBroken.body.status, 'NOT_READY');
    assert.deepEqual(reasons(sandboxBroken), ['ALERT_EMAIL_KEY_MISSING', 'ALERT_NO_USABLE_CHANNEL']);
    assert.equal((await check(SANDBOX_ENV)).body.status, 'READY', 'alerts not switched on: nothing to report');
  } finally { net.restore(); }
});
