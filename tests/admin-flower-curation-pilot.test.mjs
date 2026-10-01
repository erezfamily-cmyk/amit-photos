import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync('admin.html', 'utf8');
const report = JSON.parse(fs.readFileSync('data/flower-curation-pilot.json', 'utf8'));

test('flower pilot is non-destructive by policy', () => {
  assert.equal(report.pilot, true);
  assert.equal(report.category, 'פרחים וצמחים');
  assert.equal(report.policy.automatic_hide, false);
  assert.equal(report.policy.automatic_delete, false);
  assert.equal(report.policy.final_visual_review_required, true);
});

test('admin exposes flower pilot review controls', () => {
  assert.match(admin, /flower-curation-pilot\.json/);
  assert.match(admin, /פיילוט פרחים/);
  assert.match(admin, /דוח קיורציה/);
  assert.match(admin, /_curation:flagged/);
  assert.match(admin, /_curation:high/);
  assert.match(admin, /_curation:duplicate/);
  assert.match(admin, /_curation:technical/);
});

test('curation dialog requires manual review before destructive action', () => {
  assert.match(admin, /אין הסתרה או מחיקה אוטומטית/);
  assert.match(admin, /לא להסתיר\/למחוק לפני בדיקה ויזואלית/);
  assert.ok(report.items.every(item => item.visual_review_required === true));
});

test('pilot covers only the flower category snapshot', () => {
  assert.equal(report.summary.total, 162);
  assert.equal(report.items.length, 162);
  assert.ok(report.items.every(item => item.photo_id));
});
