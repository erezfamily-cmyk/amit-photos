import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminRevenueSummary } from '../worker.js';

function fakeEnv({ authOk = true, digitalRow, printRows, paymentsEnabled = 'false' } = {}) {
  const calls = [];
  return {
    ADMIN_PASSWORD: authOk ? 'secret' : 'secret',
    PAYMENTS_ENABLED: paymentsEnabled,
    DB: {
      prepare(sql) {
        calls.push(sql);
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('download_tokens')) return digitalRow;
                return null;
              },
              async all() {
                if (sql.includes('print_orders')) return { results: printRows || [] };
                return { results: [] };
              },
            };
          },
        };
      },
    },
    _calls: calls,
  };
}

function req(qs = '', headers = {}) {
  return new Request(`https://amitphotos.com/api/admin/revenue-summary${qs}`, { headers });
}

test('requires admin auth', async () => {
  const env = fakeEnv();
  const res = await handleAdminRevenueSummary(req(), env);
  assert.equal(res.status, 401);
});

test('returns digital revenue, print revenue by status, and the live PAYMENTS_ENABLED flag', async () => {
  const env = fakeEnv({
    digitalRow: { count: 3, revenue: 285 },
    printRows: [
      { status: 'in_production', count: 2, revenue: 500 },
      { status: 'shipped', count: 1, revenue: 250 },
      { status: 'cancelled', count: 1, revenue: 300 },
    ],
    paymentsEnabled: 'false',
  });
  const res = await handleAdminRevenueSummary(req('', { 'X-Admin-Password': 'secret' }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.payments_enabled, false);
  assert.equal(body.digital.count, 3);
  assert.equal(body.digital.revenue_ils, 285);
  assert.equal(body.print.total_count, 4);
  assert.equal(body.print.total_revenue_ils, 1050);
  assert.deepEqual(
    body.print.by_status.map(r => r.status).sort(),
    ['cancelled', 'in_production', 'shipped']
  );
});

test('reports payments_enabled: true when the env var is exactly "true"', async () => {
  const env = fakeEnv({ digitalRow: { count: 0, revenue: 0 }, printRows: [], paymentsEnabled: 'true' });
  const res = await handleAdminRevenueSummary(req('', { 'X-Admin-Password': 'secret' }), env);
  const body = await res.json();
  assert.equal(body.payments_enabled, true);
});

test('handles zero activity (nulls from D1 aggregates) without throwing', async () => {
  const env = fakeEnv({ digitalRow: { count: 0, revenue: null }, printRows: [] });
  const res = await handleAdminRevenueSummary(req('', { 'X-Admin-Password': 'secret' }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.digital.revenue_ils, 0);
  assert.equal(body.print.total_revenue_ils, 0);
  assert.equal(body.print.total_count, 0);
});

test('days query param clamps to [1, 90] and defaults to 7', async () => {
  const env = fakeEnv({ digitalRow: { count: 0, revenue: 0 }, printRows: [] });
  const resDefault = await handleAdminRevenueSummary(req('', { 'X-Admin-Password': 'secret' }), env);
  assert.equal((await resDefault.json()).period_days, 7);

  const resClampedHigh = await handleAdminRevenueSummary(req('?days=9999', { 'X-Admin-Password': 'secret' }), env);
  assert.equal((await resClampedHigh.json()).period_days, 90);

  const resClampedLow = await handleAdminRevenueSummary(req('?days=0', { 'X-Admin-Password': 'secret' }), env);
  assert.equal((await resClampedLow.json()).period_days, 1);
});
