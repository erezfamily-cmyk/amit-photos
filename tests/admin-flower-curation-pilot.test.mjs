import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync('admin.html', 'utf8');
const worker = fs.readFileSync('worker.js', 'utf8');
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
  assert.match(admin, /אין הסתרה או מחיקה אוטומטית/);
  assert.match(admin, /בדיקה ויזואלית/);
  assert.ok(report.items.every(item => item.visual_review_required === true));
});

test('pilot covers only the flower category snapshot', () => {
  assert.equal(report.summary.total, 162);
  assert.equal(report.items.length, 162);
  assert.ok(report.items.every(item => item.photo_id));
});


test('owner decisions are persisted separately from recommendation data', () => {
  assert.match(worker, /flower_curation_decisions_v1/);
  assert.match(worker, /KEEP_SECONDARY/);
  assert.match(worker, /CHANGE_CATEGORY/);
  assert.match(worker, /\/api\/admin\/curation-decisions/);
  assert.match(admin, /curationDecisions/);
  assert.match(admin, /final_owner_decision/);
});

test('admin exposes all manual owner decisions and full report export', () => {
  for (const decision of ['KEEP', 'KEEP_SECONDARY', 'HIDE', 'DELETE', 'CHANGE_CATEGORY']) {
    assert.match(admin, new RegExp("applyCurationDecision\\('" + decision + "'\\)"));
  }
  assert.match(admin, /פיילוט קיורציה — פרחים וצמחים/);
  assert.match(admin, /פתח ב-Lightbox/);
  assert.match(admin, /flower-curation-owner-review\.json/);
  assert.match(admin, /current_published_status/);
});

test('hide is reversible and delete stays explicitly destructive', () => {
  assert.match(admin, /published: false/);
  assert.match(admin, /הפעולה הפיכה ותשמור published=0/);
  assert.match(admin, /מחיקה לצמיתות/);
  assert.match(admin, /לא ניתן לבטל/);
});


test('Drive sync preserves hidden photos and DELETE curation decisions', () => {
  const importer = fs.readFileSync('src/auto_import_new_photos.py', 'utf8');
  assert.match(importer, /\/api\/photos\?admin=1/);
  assert.match(importer, /X-Admin-Password/);
  assert.match(importer, /fetch_curation_delete_ids/);
  assert.match(importer, /Curation DELETE tombstones/);
  assert.match(importer, /סומן DELETE בקיורציה/);
  assert.match(admin, /שומרים קודם tombstone של DELETE/);
  assert.match(admin, /לא תיובא מחדש מ-Drive/);
});


test('admin inline scripts have valid JavaScript syntax', () => {
  const scripts = [...admin.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach((script, index) => {
    assert.doesNotThrow(
      () => new Function(script),
      `inline admin script ${index} must parse`
    );
  });
});


test('critical admin navigation is bootstrapped before feature modules', () => {
  const utilsPos = admin.indexOf('const $ = id => document.getElementById(id);');
  const bootstrapPos = admin.indexOf('bootstrapAdminNav');
  const photosPos = admin.indexOf('const Photos = (() =>');
  assert.ok(utilsPos >= 0);
  assert.ok(bootstrapPos > utilsPos);
  assert.ok(photosPos > bootstrapPos);
  assert.match(admin, /navBootstrapBound/);
  assert.match(admin, /document\.title = 'AMIT PHOTOS — ניהול ⚠ '/);
});


test('all flower photos receive a bounded pilot score', () => {
  const scores = JSON.parse(fs.readFileSync('data/flower-curation-scores.json', 'utf8'));
  assert.equal(scores.category, 'פרחים וצמחים');
  assert.equal(scores.total, 162);
  assert.equal(scores.items.length, 162);
  assert.equal(scores.summary.visual_complete, 12);
  assert.equal(scores.summary.technical_provisional, 150);
  assert.ok(scores.items.every(x => Number.isFinite(x.pilot_score) && x.pilot_score >= 0 && x.pilot_score <= 100));
  assert.ok(scores.items.every(x => ['visual_complete','technical_provisional'].includes(x.score_kind)));
});

test('production curation action plan is reversible HIDE only', () => {
  const actions = JSON.parse(fs.readFileSync('data/flower-curation-actions-v1.json', 'utf8'));
  assert.equal(actions.actions.length, 4);
  assert.ok(actions.actions.every(x => x.action === 'HIDE'));
  assert.ok(actions.actions.every(x => !/DELETE/.test(x.action)));
  assert.match(admin, /flower-curation-scores\.json/);
  assert.match(admin, /curationScoreBadge/);
  assert.match(admin, /ציון פיילוט/);
});
