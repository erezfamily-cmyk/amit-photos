import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 404.html existed and was well-built (bilingual, styled, a way back home) but was never
// actually served: wrangler.toml's [assets] block had no not_found_handling setting, so
// Cloudflare's default ("none") returned a bare empty-body 404 for any unmatched path —
// confirmed live against a nonexistent URL.
const wranglerToml = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('../404.html', import.meta.url)), 'utf8');

test('wrangler.toml tells Cloudflare to serve 404.html for unmatched paths', () => {
  const assetsBlock = wranglerToml.slice(wranglerToml.indexOf('[assets]'));
  assert.match(assetsBlock, /not_found_handling\s*=\s*"404-page"/);
});

test('regression: 404.html only references absolute paths, since Cloudflare serves its content at whatever (possibly nested) URL the visitor actually requested', () => {
  // a relative href/src would resolve against the mistyped request path's directory, not
  // against /404.html's own location — e.g. a 404 at /camera/typo/ with a relative
  // "index.html" link would point at /camera/typo/index.html, not the real homepage.
  assert.doesNotMatch(html, /src="assets\//, '404.html script src must be absolute (start with /)');
  assert.doesNotMatch(html, /href="index\.html"/, '404.html back-home link must be absolute, not relative');
  assert.match(html, /src="\/assets\/js\/i18n\.js"/);
  assert.match(html, /href="\/"/);
});

test('404.html has both Hebrew and English copy wired through the existing i18n system', () => {
  assert.match(html, /data-i18n="404\.title"/);
  assert.match(html, /data-i18n="404\.p"/);
  assert.match(html, /data-i18n="404\.btn"/);
});
