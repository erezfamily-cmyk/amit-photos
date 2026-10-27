import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');

test('lightbox backdrop is fully opaque so page text does not ghost through', () => {
  const block = css.match(/^\.lightbox \{[^}]*\}/m);
  assert.ok(block, '.lightbox rule exists');
  assert.match(block[0], /background:\s*#000\s*;/);
  assert.doesNotMatch(block[0], /background:\s*rgba\(0,\s*0,\s*0,\s*0\.\d+\)/);
});
