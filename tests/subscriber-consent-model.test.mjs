import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleSubscribers, getConsentBackfillDiagnostics, GUIDE_SOURCES, NEWSLETTER_SOURCES, CONSENT_POLICY_VERSION } from '../worker.js';

function fakeEnv({ existingRow = null, adminOk = true } = {}) {
  const inserts = [];
  const updates = [];
  return {
    ADMIN_PASSWORD: 'test-pw',
    DB: {
      prepare(sql) {
        return {
          bind: (...args) => ({
            first: async () => existingRow,
            run: async () => {
              if (/^INSERT/i.test(sql.trim())) inserts.push({ sql, args });
              if (/^UPDATE/i.test(sql.trim())) updates.push({ sql, args });
              return { success: true };
            },
            all: async () => ({ results: [] }),
          }),
          run: async () => ({ success: true }), // bare .run() for ALTER TABLE (no .bind())
        };
      },
    },
    _inserts: inserts,
    _updates: updates,
  };
}

function req(source, body) {
  return new Request(`https://amitphotos.com/api/subscribers?source=${encodeURIComponent(source)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ===== source allowlist =====

test('rejects a request with no source', async () => {
  const env = fakeEnv();
  const r = new Request('https://amitphotos.com/api/subscribers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', consent_privacy: true }),
  });
  const res = await handleSubscribers(r, env);
  assert.equal(res.status, 400);
  assert.equal(env._inserts.length, 0);
});

test('rejects an unknown source', async () => {
  const env = fakeEnv();
  const res = await handleSubscribers(req('totally_made_up', { email: 'a@b.com', consent_privacy: true, consent_marketing: true }), env);
  assert.equal(res.status, 400);
  assert.equal(env._inserts.length, 0);
});

test('every GUIDE_SOURCES entry is accepted; every NEWSLETTER_SOURCES entry is accepted', () => {
  for (const s of [...GUIDE_SOURCES, ...NEWSLETTER_SOURCES]) {
    assert.ok(typeof s === 'string' && s.length > 0);
  }
  assert.deepEqual(GUIDE_SOURCES, ['popup', 'lead_magnet', 'subpage_strip']);
  assert.deepEqual(NEWSLETTER_SOURCES, ['homepage_section', 'newsletter_issue']);
});

// ===== guide sources: privacy required, marketing optional, guide still delivered =====

for (const source of ['popup', 'lead_magnet', 'subpage_strip']) {
  test(`guide source "${source}": privacy=false is rejected regardless of marketing`, async () => {
    const env = fakeEnv();
    const res = await handleSubscribers(req(source, { email: 'a@b.com', consent_privacy: false, consent_marketing: true }), env);
    assert.equal(res.status, 400);
    assert.equal(env._inserts.length, 0);
  });

  test(`guide source "${source}": privacy=true, marketing=false still creates the subscriber (guide delivery unaffected)`, async () => {
    const env = fakeEnv();
    const res = await handleSubscribers(req(source, { email: 'a@b.com', consent_privacy: true, consent_marketing: false }), env);
    assert.equal(res.status, 200);
    assert.equal(env._inserts.length, 1);
    const [, , , , srcArg, , , , consentMarketing, consentMarketingAt, consentMarketingSource, policyVersion] = env._inserts[0].args;
    assert.equal(consentMarketing, 0);
    assert.equal(consentMarketingAt, null);
    assert.equal(consentMarketingSource, null);
    assert.equal(policyVersion, null);
  });

  test(`guide source "${source}": privacy=true, marketing=true stores full consent metadata`, async () => {
    const env = fakeEnv();
    const res = await handleSubscribers(req(source, { email: 'a@b.com', consent_privacy: true, consent_marketing: true }), env);
    assert.equal(res.status, 200);
    const [, , , , , , , , consentMarketing, consentMarketingAt, consentMarketingSource, policyVersion] = env._inserts[0].args;
    assert.equal(consentMarketing, 1);
    assert.ok(consentMarketingAt); // server-set timestamp, non-null
    assert.equal(consentMarketingSource, source);
    assert.equal(policyVersion, CONSENT_POLICY_VERSION);
  });
}

// ===== newsletter sources: both required, no row created without explicit marketing consent =====

for (const source of ['homepage_section', 'newsletter_issue']) {
  test(`newsletter source "${source}": marketing=false is rejected, no subscriber created`, async () => {
    const env = fakeEnv();
    const res = await handleSubscribers(req(source, { email: 'a@b.com', consent_privacy: true, consent_marketing: false }), env);
    assert.equal(res.status, 400);
    assert.equal(env._inserts.length, 0);
  });

  test(`newsletter source "${source}": both true creates subscriber with consent_marketing=1`, async () => {
    const env = fakeEnv();
    const res = await handleSubscribers(req(source, { email: 'a@b.com', consent_privacy: true, consent_marketing: true }), env);
    assert.equal(res.status, 200);
    const [, , , , , , , , consentMarketing] = env._inserts[0].args;
    assert.equal(consentMarketing, 1);
  });
}

// ===== the four upgrade/downgrade scenarios =====

test('scenario (a): existing consent_marketing=1, guide-form resubmit with marketing=false does NOT downgrade', async () => {
  const env = fakeEnv({ existingRow: { id: 'sub1', consent_marketing: 1 } });
  const res = await handleSubscribers(req('popup', { email: 'a@b.com', consent_privacy: true, consent_marketing: false }), env);
  assert.equal(res.status, 200);
  assert.equal(env._updates.length, 0, 'must not run any UPDATE when marketing consent is not being upgraded');
});

test('scenario (b): existing consent_marketing=0, resubmit with marketing=true upgrades to 1 with fresh metadata', async () => {
  const env = fakeEnv({ existingRow: { id: 'sub1', consent_marketing: 0 } });
  const res = await handleSubscribers(req('popup', { email: 'a@b.com', consent_privacy: true, consent_marketing: true }), env);
  assert.equal(res.status, 200);
  assert.equal(env._updates.length, 1);
  const [consentMarketingAt, consentMarketingSource, policyVersion, id] = env._updates[0].args;
  assert.ok(consentMarketingAt);
  assert.equal(consentMarketingSource, 'popup');
  assert.equal(policyVersion, CONSENT_POLICY_VERSION);
  assert.equal(id, 'sub1');
});

test('scenario (b continued): existing consent_marketing=NULL (legacy/unknown), resubmit with marketing=true upgrades to 1', async () => {
  const env = fakeEnv({ existingRow: { id: 'sub1', consent_marketing: null } });
  const res = await handleSubscribers(req('subpage_strip', { email: 'a@b.com', consent_privacy: true, consent_marketing: true }), env);
  assert.equal(res.status, 200);
  assert.equal(env._updates.length, 1);
});

test('scenario (c): brand-new email, guide form, marketing=false creates a fresh row with consent_marketing=0 (not blocked)', async () => {
  const env = fakeEnv({ existingRow: null });
  const res = await handleSubscribers(req('lead_magnet', { email: 'new@b.com', consent_privacy: true, consent_marketing: false }), env);
  assert.equal(res.status, 200);
  assert.equal(env._inserts.length, 1);
  assert.equal(env._updates.length, 0);
});

test('scenario (d): previously-unsubscribed email (row deleted) resubmitting a guide form with marketing=false creates a fresh row at 0, not reactivated into marketing', async () => {
  // Unsubscribe deletes the row entirely — from the endpoint's perspective this is indistinguishable
  // from a brand-new signup. The important assertion: no code path defaults a fresh row to
  // consent_marketing=1 just because the email existed at some point in the past.
  const env = fakeEnv({ existingRow: null });
  const res = await handleSubscribers(req('popup', { email: 'formerly-unsubscribed@b.com', consent_privacy: true, consent_marketing: false }), env);
  assert.equal(res.status, 200);
  const [, , , , , , , , consentMarketing] = env._inserts[0].args;
  assert.equal(consentMarketing, 0);
});

test('existing subscriber already at consent_marketing=1 resubmitting with marketing=true again does not issue a redundant UPDATE', async () => {
  const env = fakeEnv({ existingRow: { id: 'sub1', consent_marketing: 1 } });
  await handleSubscribers(req('popup', { email: 'a@b.com', consent_privacy: true, consent_marketing: true }), env);
  assert.equal(env._updates.length, 0);
});

// ===== server never trusts client-supplied consent metadata =====

test('client-supplied consent_marketing_at / consent_policy_version / mode fields are ignored entirely', async () => {
  const env = fakeEnv();
  const res = await handleSubscribers(req('popup', {
    email: 'a@b.com', consent_privacy: true, consent_marketing: true,
    consent_marketing_at: '1999-01-01T00:00:00.000Z',
    consent_policy_version: 'FAKE-VERSION',
    mode: 'admin-override',
  }), env);
  assert.equal(res.status, 200);
  const [, , , , , , , , , consentMarketingAt, , policyVersion] = env._inserts[0].args;
  assert.notEqual(consentMarketingAt, '1999-01-01T00:00:00.000Z');
  assert.notEqual(policyVersion, 'FAKE-VERSION');
  assert.equal(policyVersion, CONSENT_POLICY_VERSION);
});

// ===== backfill diagnostics: internal helper only, no HTTP route, read-only, no PII =====

test('is not wired to any HTTP route (no path in the router references it)', () => {
  const src = readFileSync(fileURLToPath(new URL('../worker.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /path === '[^']*consent-backfill[^']*'/);
  assert.doesNotMatch(src, /getConsentBackfillDiagnostics\(request/); // never called with an HTTP request
});

test('never issues an UPDATE, only reads, and proposes zero automatic candidates', async () => {
  const env = fakeEnv();
  env.DB.prepare = (sql) => {
    assert.doesNotMatch(sql, /UPDATE/i);
    return {
      bind: () => ({ all: async () => ({ results: [] }) }),
      all: async () => ({ results: [{ source: 'popup', count: 5, earliest_created_at: '2026-06-01T00:00:00.000Z', latest_created_at: '2026-08-01T00:00:00.000Z' }] }),
    };
  };
  const report = await getConsentBackfillDiagnostics(env);
  assert.deepEqual(report.candidates_for_backfill, []);
  assert.equal(report.null_consent_by_source.length, 1);
  assert.equal(report.null_consent_by_source[0].source, 'popup');
});

test('report never includes email addresses or any other PII field — only source/count/date-range', async () => {
  const env = fakeEnv();
  env.DB.prepare = () => ({
    all: async () => ({ results: [{ source: 'lead_magnet', count: 3, earliest_created_at: '2026-06-01', latest_created_at: '2026-07-01' }] }),
  });
  const report = await getConsentBackfillDiagnostics(env);
  const json = JSON.stringify(report);
  assert.doesNotMatch(json, /@/); // no email addresses anywhere in the serialized report
  const keys = Object.keys(report.null_consent_by_source[0]);
  assert.deepEqual(keys.sort(), ['count', 'earliest_created_at', 'is_known_source', 'latest_created_at', 'source']);
});

test('source code of the diagnostics helper contains no UPDATE statement', () => {
  assert.doesNotMatch(getConsentBackfillDiagnostics.toString(), /UPDATE\s+subscribers/i);
});
