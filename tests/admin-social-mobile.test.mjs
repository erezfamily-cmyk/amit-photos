import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

function socialSource() {
  const start = admin.indexOf('const SocialSection = (() => {');
  const end = admin.indexOf('// ===== PURCHASES =====', start);
  assert.notEqual(start, -1, 'SocialSection is missing');
  assert.notEqual(end, -1, 'SocialSection end marker is missing');
  return admin.slice(start, end);
}

test('social schedule and activity tables opt in to mobile cards', () => {
  assert.match(admin, /class="table-wrap mobile-card-wrap"[^>]*>\s*<table class="data-table mobile-card-table social-schedule-table" id="social-schedule-table"/);
  assert.match(admin, /class="table-wrap mobile-card-wrap" id="social-activity-wrap"[^>]*>\s*<table class="data-table mobile-card-table" id="social-activity-table"/);
});

test('static schedule cards get useful labels without duplicating every cell attribute', () => {
  for (const [column, label] of [['1', 'יום'], ['2', 'שעה'], ['3', 'פלטפורמה'], ['4', 'תוכן']]) {
    assert.match(admin, new RegExp(`\\.social-schedule-table td:nth-child\\(${column}\\)::before\\{content:"${label}"\\}`));
  }
});

test('dynamic social tables use card wrappers and label every value', () => {
  const source = socialSource();
  assert.match(source, /class="table-wrap mobile-card-wrap social-posts-table-wrap"/);
  assert.match(source, /class="data-table mobile-card-table social-posts-table"/);
  for (const label of ['תאריך', 'כיתוב', 'לייקים', 'תגובות']) {
    assert.match(source, new RegExp(`data-label="${label}"`));
  }

  assert.match(source, /class="table-wrap mobile-card-wrap social-history-table-wrap"/);
  assert.match(source, /class="data-table mobile-card-table social-history-table"/);
  for (const label of ['שבוע', 'עוקבי IG', 'פוסטים IG', 'לייקים IG', 'ממוצע', 'מעורבות', 'עוקבי FB', 'לייקים FB']) {
    assert.match(source, new RegExp(`data-label="${label}"`));
  }
});

test('activity cards are labeled and external run links are safe and descriptive', () => {
  const source = socialSource();
  for (const label of ['תאריך', 'שעה', 'תוכן', 'סטטוס']) {
    assert.match(source, new RegExp(`data-label="${label}"`));
  }
  assert.match(source, /target="_blank" rel="noopener"/);
  assert.match(source, /aria-label="פתח ריצת \$\{escHtml\(run\.name\|\|'סושיאל'\)\}"/);
});
