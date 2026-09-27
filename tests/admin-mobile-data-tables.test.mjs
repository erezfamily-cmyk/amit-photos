import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

function mediaBlock(marker) {
  const markerIndex = admin.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} is missing`);
  const start = admin.lastIndexOf('@media(max-width:768px){', markerIndex);
  assert.notEqual(start, -1, `${marker} is not inside the mobile breakpoint`);
  let depth = 0;
  for (let i = start; i < admin.length; i++) {
    if (admin[i] === '{') depth++;
    if (admin[i] === '}' && --depth === 0) return admin.slice(start, i + 1);
  }
  assert.fail('mobile breakpoint is not closed');
}

function sectionBetween(startMarker, endMarker) {
  const start = admin.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} is missing`);
  const end = admin.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} is missing after ${startMarker}`);
  return admin.slice(start, end);
}

test('wide admin data tables opt in to the mobile card layout', () => {
  for (const id of ['funnel-table', 'print-orders-table', 'customers-table', 'purchases-table']) {
    assert.match(admin, new RegExp(`<table[^>]*class="[^"]*mobile-card-table[^"]*"[^>]*id="${id}"|<table[^>]*id="${id}"[^>]*class="[^"]*mobile-card-table[^"]*"`));
  }
});

test('mobile data tables become readable cards without horizontal scrolling', () => {
  const block = mediaBlock('.mobile-card-wrap{');
  assert.match(block, /\.mobile-card-wrap\s*\{[^}]*overflow:\s*visible/);
  assert.match(block, /\.mobile-card-table thead\s*\{[^}]*display:\s*none/);
  assert.match(block, /\.mobile-card-table tr\s*\{[^}]*border:\s*1px solid var\(--border\)/);
  assert.match(block, /\.mobile-card-table td::before\s*\{[^}]*content:\s*attr\(data-label\)/);
  assert.match(block, /\.mobile-card-table td\[colspan\]::before\s*\{[^}]*display:\s*none/);
  assert.match(block, /\.mobile-row-actions[^}]*min-height:\s*44px/);
});

test('analytics rows expose every value label in card view', () => {
  const source = sectionBetween('async function loadPhotoAnalytics()', '// ===== AUTH =====');
  for (const label of ['תמונה', 'קטגוריה', 'צפיות', 'כוונה', '% כוונה', 'רכישות', 'הכנסה', 'המרה']) {
    assert.match(source, new RegExp(`data-label="${label}"`));
  }
});

test('customer rows expose labels and contextual touch actions', () => {
  const source = sectionBetween('const Customers = (() => {', '// ===== PRINT ORDERS =====');
  for (const label of ['שם', 'מייל', 'טלפון', 'תאריך', 'סוג', 'נושא', 'סטטוס', 'הערות', 'פעולות']) {
    assert.match(source, new RegExp(`data-label="${label}"`));
  }
  assert.match(source, /class="mobile-row-actions"/);
  assert.match(source, /aria-label="סטטוס עבור \$\{escHtml\(c\.name\|\|'לקוח'\)\}"/);
  assert.match(source, /aria-label="מחק את \$\{escHtml\(c\.name\|\|'הלקוח'\)\}"/);
});

test('print-order and purchase rows expose mobile labels and accessible actions', () => {
  const orders = sectionBetween('const PrintOrders = (() => {', '/* ===== SOCIAL MEDIA ===== */');
  for (const label of ['תאריך', 'שם לקוח', 'טלפון', 'מייל', 'כתובת', 'מוצר', 'מחיר', 'מספר הזמנה', 'סטטוס', 'החזר']) {
    assert.match(orders, new RegExp(`data-label="${label}"`));
  }
  assert.match(orders, /aria-label="רענן סטטוס הזמנה/);
  assert.match(orders, /aria-label="פתח החזר ב-PayPal/);

  const purchases = sectionBetween('const Purchases = (() => {', '// ===== ניתוח תמונות =====');
  for (const label of ['תמונה', 'גודל', 'סכום', 'תאריך', 'סטטוס', 'txn', 'קישור']) {
    assert.match(purchases, new RegExp(`data-label="${label}"`));
  }
  assert.match(purchases, /class="btn btn-ghost btn-sm mobile-row-action"/);
  assert.match(purchases, /aria-label="העתק קישור הורדה עבור/);
});
