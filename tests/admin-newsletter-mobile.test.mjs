import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const worker = readFileSync(fileURLToPath(new URL('../worker.js', import.meta.url)), 'utf8');

function functionSource(name, nextName) {
  const start = worker.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} is missing`);
  const end = worker.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(end, -1, `${nextName} is missing after ${name}`);
  return worker.slice(start, end);
}

const listPage = functionSource('handleAdminNlList', 'handleAdminNlEditor');
const editorPage = functionSource('handleAdminNlEditor', 'handleAdminNlGenerate');

test('newsletter list returns to the canonical admin page', () => {
  assert.match(listPage, /href="\/admin\.html"[^>]*class="btn btn-back"/);
  assert.doesNotMatch(listPage, /href="\/admin\/"/);
});

test('newsletter list becomes touch-friendly cards on narrow screens', () => {
  assert.match(listPage, /@media\(max-width:700px\)/);
  assert.match(listPage, /thead\s*\{\s*display:none/);
  assert.match(listPage, /td::before\s*\{[^}]*content:attr\(data-label\)/);
  assert.match(listPage, /min-height:44px/);
  assert.match(listPage, /safe-area-inset-bottom/);
  assert.match(listPage, /class="row-actions"/);
  for (const label of ['מספר', 'סטטוס', 'סוג', 'כותרת', 'תאריך', 'פעולות']) {
    assert.match(listPage, new RegExp(`data-label="${label}"`));
  }
});

test('newsletter list separates its destructive action from frequent actions', () => {
  assert.match(listPage, /class="action-link danger"[^>]*>מחק ויצור מחדש<\/a>/);
  assert.match(listPage, /aria-label="מחק ויצור מחדש:/);
});

test('newsletter editor fields have explicit label associations', () => {
  assert.match(editorPage, /<label for="\$\{escXml\(fieldId\)\}">/);
  assert.match(editorPage, /<textarea id="\$\{escXml\(fieldId\)\}"/);
  assert.match(editorPage, /<label for="hero-photo-id">Photo ID<\/label>/);
  assert.match(editorPage, /<label for="guide-slug">Slug<\/label>/);
  assert.match(editorPage, /<label for="issue-number">מספר גיליון<\/label>/);
  assert.match(editorPage, /id="guide-step-\$\{i\}-title"/);
  assert.match(editorPage, /id="guide-step-\$\{i\}-text"/);
});

test('newsletter editor keeps its primary actions reachable on mobile', () => {
  assert.match(editorPage, /class="actions editor-actions"/);
  assert.match(editorPage, /@media\(max-width:700px\)/);
  assert.match(editorPage, /\.editor-actions\s*\{[^}]*position:fixed[^}]*bottom:0/);
  assert.match(editorPage, /safe-area-inset-bottom/);
  assert.match(editorPage, /min-height:44px/);
});

test('newsletter admin pages do not nest buttons inside links', () => {
  assert.doesNotMatch(listPage, /<a[^>]*>\s*<button/);
  assert.doesNotMatch(editorPage, /<a[^>]*>\s*<button/);
});
