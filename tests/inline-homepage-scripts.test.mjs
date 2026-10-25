import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('every executable inline homepage script parses without a JavaScript syntax error', () => {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let n = 0;
  for (const match of html.matchAll(re)) {
    const [, attrs, code] = match;
    if (/\bsrc\s*=/.test(attrs) || /\btype\s*=\s*["'](?:application\/ld\+json|application\/json|importmap)["']/.test(attrs)) continue;
    if (!code.trim()) continue;
    n++;
    assert.doesNotThrow(() => new Script(code, { filename: 'index.html inline script #' + n }));
  }
  assert.ok(n > 0, 'must inspect at least one executable inline script');
});
