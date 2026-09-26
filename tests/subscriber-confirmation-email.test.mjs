import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSubscribers } from '../worker.js';

function makeEnv(existingRow = null) {
  const inserts = [];
  const updates = [];
  return {
    RESEND_API_KEY: 'test-key',
    FROM_EMAIL: 'Amit Photos <contact@amitphotos.com>',
    DB: {
      prepare(sql) {
        return {
          run: async () => ({ success: true }),
          bind: (...args) => ({
            first: async () => existingRow,
            run: async () => {
              if (/^INSERT/i.test(sql.trim())) inserts.push({ sql, args });
              if (/^UPDATE/i.test(sql.trim())) updates.push({ sql, args });
              return { success: true };
            },
          }),
        };
      },
    },
    _inserts: inserts,
    _updates: updates,
  };
}

function signupRequest(source, { lang = 'he', marketing = false } = {}) {
  return new Request(`https://amitphotos.com/api/subscribers?source=${source}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'person@example.com',
      lang,
      consent_privacy: true,
      consent_marketing: marketing,
    }),
  });
}

async function captureEmail(run) {
  const originalFetch = globalThis.fetch;
  const emails = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('api.resend.com/emails')) {
      emails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    await run();
    return emails;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('new homepage newsletter signup receives a newsletter welcome email, not the PDF email', async () => {
  const env = makeEnv();
  const emails = await captureEmail(() => handleSubscribers(
    signupRequest('homepage_section', { marketing: true }),
    env,
  ));

  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /ניוזלטר/);
  assert.doesNotMatch(emails[0].subject, /PDF/i);
  assert.match(emails[0].html, /תודה שנרשמת לניוזלטר/);
  assert.doesNotMatch(emails[0].html, /50 טיפים|50tips/i);
});

test('existing non-marketing subscriber upgraded through the English homepage form receives one newsletter welcome email', async () => {
  const env = makeEnv({ id: 'sub-1', consent_marketing: 0 });
  const emails = await captureEmail(() => handleSubscribers(
    signupRequest('homepage_section', { lang: 'en', marketing: true }),
    env,
  ));

  assert.equal(env._updates.length, 1);
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /newsletter/i);
  assert.doesNotMatch(emails[0].subject, /PDF/i);
  assert.match(emails[0].html, /Thank you for subscribing/);
});

test('new Hebrew guide request without marketing consent receives the PDF without a newsletter promise', async () => {
  const env = makeEnv();
  const emails = await captureEmail(() => handleSubscribers(
    signupRequest('popup', { marketing: false }),
    env,
  ));

  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /PDF/i);
  assert.doesNotMatch(emails[0].html, /תקבל.*ניוזלטר|בנוסף.*ניוזלטר/);
  assert.match(emails[0].html, /בלי לשנות.*העדפות.*דיוור/);
});

test('existing English guide request without marketing consent receives the PDF without a newsletter promise', async () => {
  const env = makeEnv({ id: 'sub-1', consent_marketing: 0 });
  const emails = await captureEmail(() => handleSubscribers(
    signupRequest('lead_magnet', { lang: 'en', marketing: false }),
    env,
  ));

  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /PDF/i);
  assert.doesNotMatch(emails[0].html, /receive.*newsletter/i);
  assert.match(emails[0].html, /without changing.*marketing email preferences/i);
});

test('guide request with explicit marketing consent may confirm the newsletter subscription', async () => {
  const env = makeEnv();
  const emails = await captureEmail(() => handleSubscribers(
    signupRequest('subpage_strip', { lang: 'en', marketing: true }),
    env,
  ));

  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /PDF/i);
  assert.match(emails[0].html, /receive.*newsletter/i);
});

test('already-consented newsletter subscriber is not sent another welcome email on a duplicate signup', async () => {
  const env = makeEnv({ id: 'sub-1', consent_marketing: 1 });
  const emails = await captureEmail(() => handleSubscribers(
    signupRequest('newsletter_issue', { marketing: true }),
    env,
  ));

  assert.equal(env._updates.length, 0);
  assert.equal(emails.length, 0);
});
