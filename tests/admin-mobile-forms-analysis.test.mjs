import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

function mobileBlock() {
  const marker = '.mobile-dialog';
  const markerIndex = admin.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} is missing`);
  const start = admin.lastIndexOf('@media(max-width:768px){', markerIndex);
  let depth = 0;
  for (let i = start; i < admin.length; i++) {
    if (admin[i] === '{') depth++;
    if (admin[i] === '}' && --depth === 0) return admin.slice(start, i + 1);
  }
  assert.fail('mobile breakpoint is not closed');
}

test('subscriber and analysis tables use mobile cards', () => {
  assert.match(admin, /<table class="data-table mobile-card-table" id="subscribers-table"/);
  assert.match(admin, /<table class="data-table mobile-card-table" id="learn-table"/);
});

test('subscriber rows are labeled and destructive actions are contextual', () => {
  const start = admin.indexOf('const Subscribers = (() => {');
  const end = admin.indexOf('// ===== CUSTOMERS =====', start);
  const source = admin.slice(start, end);
  for (const label of ['שם', 'מייל', 'תאריך הצטרפות', 'הערות', 'פעולות']) {
    assert.match(source, new RegExp(`data-label="${label}"`));
  }
  assert.match(source, /class="mobile-row-actions"/);
  assert.match(source, /aria-label="מחק את \$\{escHtml\(s\.name\|\|s\.email\|\|'הנרשם'\)\}"/);
});

test('analysis rows are labeled and expose touch-friendly actions', () => {
  const start = admin.indexOf('async function loadLearn()');
  const end = admin.indexOf('function parseCompHtml', start);
  const source = admin.slice(start, end);
  for (const label of ['תמונה', 'כלל קומפוזיציה', 'פורסם', 'פעולות']) {
    assert.match(source, new RegExp(`data-label="${label}"`));
  }
  assert.match(source, /class="mobile-row-actions"/);
  assert.match(source, /aria-label="ערוך ניתוח עבור \$\{safeTitle\}"/);
  assert.match(source, /target="_blank" rel="noopener"/);
});

test('mobile forms and dialogs fit the viewport and keep actions reachable', () => {
  const block = mobileBlock();
  assert.match(block, /\.form-row\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(block, /\.filter-bar\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(block, /\.mobile-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 1rem\)/);
  assert.match(block, /\.mobile-dialog\[open\]\s*\{[^}]*display:\s*flex/);
  assert.match(block, /\.mobile-dialog \.dialog-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(block, /\.mobile-dialog \.dialog-footer\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(block, /\.mobile-dialog \.dialog-footer \.btn\s*\{[^}]*min-height:\s*44px/);
});

test('standard admin dialogs opt in to the mobile dialog shell', () => {
  for (const id of ['photo-dialog', 'cust-view-dialog', 'reply-dialog', 'cust-dialog', 'learn-edit-dialog']) {
    assert.match(admin, new RegExp(`<dialog[^>]*id="${id}"[^>]*class="[^"]*mobile-dialog[^"]*"|<dialog[^>]*class="[^"]*mobile-dialog[^"]*"[^>]*id="${id}"`));
  }
});
