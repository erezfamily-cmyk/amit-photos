import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const start = src.indexOf('let _lang = (function');
const end = src.indexOf('})();', start) + 5;
assert.ok(start !== -1 && end > start, '_lang initializer exists');
const initCode = src.slice(start, end).replace('let _lang =', 'result =');

function run(search, stored) {
  const store = new Map(stored ? [['lang', stored]] : []);
  const ctx = {
    result: null,
    location: { search },
    URLSearchParams,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
  };
  vm.runInNewContext(initCode, ctx);
  return { lang: ctx.result, stored: store.get('lang') };
}

test('?lang=en overrides a stored Hebrew preference and persists', () => {
  assert.deepEqual(run('?lang=en', 'he'), { lang: 'en', stored: 'en' });
});
test('?lang=he overrides a stored English preference', () => {
  assert.deepEqual(run('?lang=he', 'en'), { lang: 'he', stored: 'he' });
});
test('invalid ?lang is ignored; stored preference or Hebrew default is used', () => {
  assert.equal(run('?lang=fr', 'en').lang, 'en');
  assert.equal(run('?lang=<x>', null).lang, 'he');
  assert.equal(run('', null).lang, 'he');
});
