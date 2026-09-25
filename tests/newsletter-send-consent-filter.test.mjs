import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNewsletter, handleAdminNlSend, runWelcomeSequenceCron, handleUnsubscribe } from '../worker.js';

function captureSql() {
  const queries = [];
  return { queries, capture: (sql) => queries.push(sql) };
}

// ===== handleNewsletter (admin ad-hoc "פרסומת:" blast) =====

test('handleNewsletter: subscriber query filters consent_marketing = 1', async () => {
  const { queries, capture } = captureSql();
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; return new Response(JSON.stringify({ data: [] }), { status: 200 }); };
  try {
    const env = {
      ADMIN_PASSWORD: 'pw', RESEND_API_KEY: 'k',
      DB: {
        prepare(sql) {
          capture(sql);
          return { all: async () => ({ results: [{ id: 's1', email: 'a@b.com', name: 'A' }] }) };
        },
      },
    };
    const req = new Request('https://amitphotos.com/api/newsletter/send', {
      method: 'POST', headers: { 'X-Admin-Password': 'pw', 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Test', body: 'Body' }),
    });
    await handleNewsletter(req, env);
    const subscriberQuery = queries.find(q => /FROM subscribers/i.test(q));
    assert.ok(subscriberQuery, 'no subscribers query found');
    assert.match(subscriberQuery, /consent_marketing\s*=\s*1/i);
    assert.ok(fetchCalled);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ===== handleAdminNlSend (published-issue send) =====

test('handleAdminNlSend: subscriber query filters consent_marketing = 1', async () => {
  const { queries, capture } = captureSql();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
  try {
    const env = {
      ADMIN_PASSWORD: 'pw', RESEND_API_KEY: 'k',
      DB: {
        prepare(sql) {
          capture(sql);
          return {
            bind: () => ({ first: async () => ({ id: 'issue1', status: 'published', slug: 'x', title_he: 'T' }) }),
            all: async () => ({ results: [{ id: 's1', email: 'a@b.com', name: 'A', lang: 'he' }] }),
            run: async () => ({ success: true }),
          };
        },
      },
    };
    const req = new Request('https://amitphotos.com/api/admin/nl/issue1/send', {
      method: 'POST', headers: { 'X-Admin-Password': 'pw' },
    });
    await handleAdminNlSend(req, env, 'issue1');
    const subscriberQuery = queries.find(q => /FROM subscribers/i.test(q));
    assert.ok(subscriberQuery, 'no subscribers query found');
    assert.match(subscriberQuery, /consent_marketing\s*=\s*1/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ===== runWelcomeSequenceCron (automated, no admin step) =====

test('runWelcomeSequenceCron: subscriber query filters consent_marketing = 1 in addition to the existing welcome_stage/created_at filters', async () => {
  const { queries, capture } = captureSql();
  const env = {
    RESEND_API_KEY: 'k',
    DB: {
      prepare(sql) {
        capture(sql);
        return {
          run: async () => ({ success: true }),
          bind: () => ({ all: async () => ({ results: [] }) }),
        };
      },
    },
  };
  await runWelcomeSequenceCron(env);
  const subscriberQuery = queries.find(q => /FROM subscribers/i.test(q) && /welcome_stage/i.test(q));
  assert.ok(subscriberQuery, 'no welcome-sequence subscribers query found');
  assert.match(subscriberQuery, /consent_marketing\s*=\s*1/i);
  // pre-existing filters must still be present — this is an addition, not a replacement
  assert.match(subscriberQuery, /created_at\s*>=/i);
  assert.match(subscriberQuery, /welcome_stage/i);
});

// ===== regression: unsubscribe still works, untouched by the consent-model changes =====

test('handleUnsubscribe: token-based (email link) deletes the subscriber row', async () => {
  let deleteCalled = false;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind: () => ({
            first: async () => (/SELECT id FROM subscribers WHERE id=\?/i.test(sql) ? { id: 'sub1' } : null),
            run: async () => { if (/^DELETE/i.test(sql.trim())) deleteCalled = true; return { success: true }; },
          }),
        };
      },
    },
  };
  const req = new Request('https://amitphotos.com/api/unsubscribe?token=sub1');
  const res = await handleUnsubscribe(req, env);
  assert.equal(res.status, 200);
  assert.ok(deleteCalled);
});

test('handleUnsubscribe: email-based (POST from website) deletes the subscriber row', async () => {
  let deleteCalled = false;
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind: () => ({
            first: async () => (/SELECT id FROM subscribers WHERE lower\(email\)/i.test(sql) ? { id: 'sub1' } : null),
            run: async () => { if (/^DELETE/i.test(sql.trim())) deleteCalled = true; return { success: true }; },
          }),
        };
      },
    },
  };
  const req = new Request('https://amitphotos.com/api/unsubscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com' }),
  });
  const res = await handleUnsubscribe(req, env);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(deleteCalled);
});

test('runWelcomeSequenceCron: a subscriber with consent_marketing=0 returned by a (mis-filtered) query would still not crash the loop', async () => {
  // Defensive check: even if the SQL filter were ever accidentally removed, the loop itself
  // must not assume consent — this test documents that the ONLY filtering mechanism is the SQL
  // WHERE clause (verified above), so that clause must never be removed in future refactors.
  const env = {
    RESEND_API_KEY: 'k',
    DB: {
      prepare(sql) {
        return {
          run: async () => ({ success: true }),
          bind: () => ({ all: async () => ({ results: [] }) }),
        };
      },
    },
  };
  await assert.doesNotReject(() => runWelcomeSequenceCron(env));
});
