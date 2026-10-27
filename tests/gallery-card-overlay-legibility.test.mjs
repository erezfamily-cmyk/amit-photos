import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const rule = (sel) => {
  const i = css.indexOf(sel + ' {');
  assert.ok(i >= 0, sel + ' rule exists');
  return css.slice(i, css.indexOf('}', i));
};

test('card title and location are explicitly light, not inherited page text colour', () => {
  assert.match(rule('.gallery-item-info h3'), /color:\s*#fff\s*;/);
  assert.match(rule('.gallery-item-info span'), /color:\s*#e4bd7a\s*;/);
});

test('card watermark is English on the English page and laid out LTR in both languages', () => {
  assert.match(css, /html\[lang="en"\] \.gallery-item::after \{ content: '© Amit Erez';/);
  assert.match(rule('.gallery-item::after'), /direction:\s*ltr\s*;/);
});

test('card watermark sits in the corner opposite the title in English, title/category gap is tight', () => {
  assert.match(css, /html\[lang="en"\] \.gallery-item::after \{[^}]*left:\s*auto;[^}]*right:\s*10px;/);
  assert.match(rule('.gallery-item-info h3'), /line-height:\s*1\.25\s*;/);
  assert.match(rule('.gallery-item-info span:first-of-type'), /display:\s*block\s*;/);
});
