import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const headers = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_headers'), 'utf8');

test('HSTS is enforced with a 1-year max-age', () => {
  assert.match(headers, /Strict-Transport-Security:\s*max-age=31536000/);
});

test('CSP is Report-Only, not enforcing (deliberate staged rollout)', () => {
  assert.match(headers, /Content-Security-Policy-Report-Only:/);
  assert.doesNotMatch(headers, /\n\s*Content-Security-Policy:/);
});

test('unsafe-eval is deliberately omitted (no eval()/new Function() found anywhere client-side)', () => {
  assert.doesNotMatch(headers, /unsafe-eval/);
});

test('includes the two connect-src domains actually fetched from client-side code', () => {
  assert.match(headers, /https:\/\/api\.web3forms\.com/);
  assert.match(headers, /https:\/\/raw\.githubusercontent\.com/);
});

test('pre-existing security headers are still present (regression guard)', () => {
  assert.match(headers, /X-Frame-Options:\s*DENY/);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/);
  assert.match(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
  assert.match(headers, /Permissions-Policy:/);
});
