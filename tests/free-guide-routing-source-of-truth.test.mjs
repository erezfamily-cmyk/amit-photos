import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../worker.js', import.meta.url)), 'utf8');
const wranglerToml = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8');

// This test exists because the repo contains TWO implementations that could plausibly serve
// /free-guide/: the SSR handler (handleFreeGuide in worker.js) and a static free-guide/index.html
// file. Verified live against production (2026-09-25): the response's markup uses the fg-* id
// scheme (fg-email, fg-consent-privacy, fg-form...), which only handleFreeGuide emits — the
// static file uses a different guide-* id scheme entirely. Also verified live that the explicit
// /free-guide/index.html path 307-redirects to /free-guide/ (Location: /free-guide/), so there is
// no reachable URL that serves the static file's bytes at all. This test locks in the routing
// configuration responsible for that behavior so a future refactor can't silently flip it.

test('the router matches /free-guide and /free-guide/ to handleFreeGuide, before any static-asset fallback', () => {
  const routeLineMatch = src.match(/if \(path === '\/free-guide' \|\| path === '\/free-guide\/'\) return (\w+)\(/);
  assert.ok(routeLineMatch, 'no exact-match route for /free-guide(/) found in the router');
  assert.equal(routeLineMatch[1], 'handleFreeGuide');

  // the static-asset fallback (env.ASSETS.fetch) must appear LATER in the file than this route,
  // confirming the worker route is checked first and returns before ever reaching it
  const routeIndex = src.indexOf(routeLineMatch[0]);
  const assetsFallbackIndex = src.indexOf('await env.ASSETS.fetch(request)');
  assert.ok(assetsFallbackIndex > routeIndex, 'ASSETS.fetch fallback must come after the /free-guide route in the router');
});

test('run_worker_first is enabled — the Worker (and therefore this routing table) takes precedence over static assets for every path', () => {
  assert.match(wranglerToml, /run_worker_first\s*=\s*true/);
});

test('the static free-guide/index.html file exists in the repo but has no reachable route (documented dead code)', () => {
  const fs = readFileSync(fileURLToPath(new URL('../free-guide/index.html', import.meta.url)), 'utf8');
  assert.ok(fs.length > 0, 'static file should still exist in the repo (not deleted, just unreachable)');
  // it uses a different id scheme than the live handleFreeGuide output — confirms it's a
  // distinct, non-synced artifact, not something dynamically kept in lockstep
  assert.match(fs, /id="guide-email"/);
});
