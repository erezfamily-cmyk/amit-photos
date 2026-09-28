import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

test('analytics admin exposes a dedicated UX decision panel', () => {
  assert.match(admin, /id="ux-decision-box"/);
  assert.match(admin, /id="ux-report-freshness"[^>]*role="status"/);
  assert.match(admin, /id="ux-kpi-grid"[^>]*aria-live="polite"/);
  assert.match(admin, /המדידה החדשה החלה ב־26\.09\.2026/);
});

test('UX decision panel uses the design KPIs and excludes disabled purchase KPIs', () => {
  const start = admin.indexOf('function renderUxDecisionPanel');
  const end = admin.indexOf('async function loadGaReports', start);
  const block = admin.slice(start, end);
  for (const event of ['hero_gallery_click', 'photo_view', 'scroll_50', 'contact_intent', 'photo_contact_click', 'contact_form_success', 'generate_lead']) {
    assert.match(block, new RegExp(event));
  }
  assert.doesNotMatch(block, /purchase_intent|print_intent|\bpurchase\b/);
});

test('UX recommendation waits for a meaningful sample before suggesting design work', () => {
  assert.match(admin, /const readyForDecision = measurementDays >= 14/);
  assert.match(admin, /!readyForDecision \|\| sessions < 30/);
  assert.match(admin, /המדגם עדיין קטן מדי לשינוי עיצוב נוסף/);
  assert.match(admin, /reportEnd < measurementStart/);
  assert.match(admin, /הדוח האחרון קדם למדידת ה־UX החדשה/);
});

test('UX panel exposes mobile, traffic source and landing-page context', () => {
  assert.match(admin, /const deviceNames = \{ mobile: 'מובייל', desktop: 'מחשב', tablet: 'טאבלט' \}/);
  assert.match(admin, /latest\.sources\?\.\[0\]/);
  assert.match(admin, /latest\.landing_pages\?\.\[0\]/);
});
