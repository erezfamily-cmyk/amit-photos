import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orderPublicPhotosByCuration } from '../worker.js';

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
  assert.match(admin, /פיילוט פרחים/);
  assert.match(admin, /פתח ב-Lightbox/);
  assert.match(admin, /portfolio-curation-owner-review\.json/);
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
  assert.match(admin, /portfolio-curation-scores\.json/);
  assert.match(admin, /curationScoreBadge/);
  assert.match(admin, /ציון משוכלל/);
});


test('owner review queue follows the approved <=85 or material-problem policy', () => {
  const scores = JSON.parse(fs.readFileSync('data/portfolio-curation-scores.json', 'utf8'));
  assert.equal(scores.policy.owner_review_max_score, 85);
  assert.equal(scores.policy.score_above_threshold_requires_owner_review, false);
  assert.match(admin, /_curation:score-review/);
  assert.match(admin, /דורש בדיקה ≤85 \/ בעיה/);
  assert.match(admin, /owner_review_required/);
});


test('owner-review cue is rendered as an image overlay', () => {
  assert.match(admin, /function curationReviewOverlay\(p\)/);
  assert.match(admin, /class="curation-review-overlay"/);
  assert.match(admin, /⚠ לבחינה <strong>/);
  assert.match(admin, /\$\{curationReviewOverlay\(p\)\}/);
  assert.match(admin, /\.curation-review-overlay\{position:absolute;top:\.45rem;left:\.45rem/);
});


test('Review Mode guides only the owner-review queue', () => {
  assert.match(admin, /function getReviewCandidateIds\(\)/);
  assert.match(admin, /function startCurationReview\(startId = null\)/);
  assert.match(admin, /function advanceReviewAfterDecision\(currentId\)/);
  assert.match(admin, /function skipCurationReview\(\)/);
  assert.match(admin, /▶ מצב Review/);
  assert.match(admin, /נבדקו \$\{progress\.reviewed\} מתוך \$\{progress\.total\}/);
  assert.match(admin, /✅ נבדק <strong>/);
  assert.match(admin, /scoreComponentsHtml\(score\)/);
});

test('Review Mode keeps destructive actions explicit', () => {
  assert.match(admin, /if \(!confirm\('להסתיר את התמונה מהאתר\?/);
  assert.match(admin, /if \(!confirm\('מחיקה לצמיתות:/);
  assert.doesNotMatch(admin, /startCurationReview[\s\S]{0,800}published:\s*false/);
});


test('KEEP_SECONDARY moves to the public gallery tail without disturbing order inside tiers', () => {
  const photos = [{id:'a'}, {id:'b'}, {id:'c'}, {id:'d'}, {id:'e'}];
  const decisions = {
    a: { decision: 'KEEP' },
    b: { decision: 'KEEP_SECONDARY' },
    d: { decision: 'KEEP_SECONDARY' },
  };
  const ordered = orderPublicPhotosByCuration(photos, decisions);
  assert.deepEqual(ordered.map(p => p.id), ['a','c','e','b','d']);
  assert.deepEqual(photos.map(p => p.id), ['a','b','c','d','e']);
});

test('curation decision changes invalidate the cached public gallery ordering', () => {
  assert.match(worker, /flower_curation_decisions_v1/);
  assert.match(worker, /orderPublicPhotosByCuration\(photos, curationDecisions\)/);
  const savePos = worker.indexOf("INSERT OR REPLACE INTO settings (key, value)");
  const invalidatePos = worker.indexOf("invalidatePublicPhotosCache(request)", savePos);
  assert.ok(savePos >= 0 && invalidatePos > savePos);
});


test('pending visual components are shown as not reviewed instead of zero', () => {
  const scores = JSON.parse(fs.readFileSync('data/portfolio-curation-scores.json', 'utf8'));
  const pending = scores.items.find(x => x.score_kind === 'pending_visual');
  assert.equal(pending.score, null);
  assert.equal(pending.components.sharpness, null);
  assert.equal(pending.components.composition, null);
  assert.equal(pending.components.light_color, null);
  assert.match(admin, /raw !== null && raw !== undefined/);
  assert.match(admin, /טרם נבדק/);
  assert.doesNotMatch(admin, /Number\.isFinite\(Number\(score\.components\[key\]\)\)\)/);
});


test('admin bulk curation selectors expose under-1000 and visual-score-under-80 queues', () => {
  assert.match(admin, /select-under-1000-btn/);
  assert.match(admin, /select-score-under-80-btn/);
  assert.match(admin, /Math\.min\(w, h\) < 1000/);
  assert.match(admin, /score\?\.score_kind === 'visual_complete' && Number\(score\.score\) < 80/);
  assert.match(admin, /_bulk:under-1000/);
  assert.match(admin, /_bulk:score-under-80/);
});

test('bulk HIDE is reversible and records an owner decision', () => {
  assert.match(admin, /bulk-hide-btn/);
  assert.match(admin, /published: false/);
  assert.match(admin, /הפעולה הפיכה \(published=0\)/);
  assert.match(admin, /saveCurationDecision\(id, 'HIDE'/);
});

test('bulk delete remains explicit and separate from HIDE', () => {
  assert.match(admin, /bulk-delete-btn/);
  assert.match(admin, /למחוק \$\{count\} תמונות\?/);
});


test('bulk and single delete persist tombstones and refresh excludes deleted Drive photos', () => {
  assert.match(admin, /saveCurationDecision\(id, 'DELETE'/);
  assert.match(admin, /curationDecisions\.get\(p\.id\)\?\.decision !== 'DELETE'/);
  assert.match(admin, /לא יחזרו מ-Drive/);
  assert.match(admin, /מחיקה תישמר גם מול Google Drive/);
});


test('bulk score-under-80 selection targets only production R2 photos and HIDE is transactional', () => {
  assert.match(admin, /p\._source === 'r2' && score\?\.score_kind === 'visual_complete' && Number\(score\.score\) < 80/);
  assert.match(admin, /const wasPublished = photo\.published !== 0/);
  assert.match(admin, /saveCurationDecision\(id, 'HIDE'/);
  assert.match(admin, /body: JSON\.stringify\(\{ id, published: true \}\)/);
  assert.match(admin, /bulk hide failed/);
});


test('bulk delete can remove Drive-only cards by tombstone without requiring an R2 row', () => {
  assert.match(admin, /photo\._source === 'drive'/);
  assert.match(admin, /DELETE tombstone for Drive-only photo/);
  assert.match(admin, /if \(photo\._source === 'r2'\)/);
  assert.match(admin, /block re-import/);
});


test('processed bulk curation items are excluded after relogin', () => {
  assert.match(admin, /if \(decision === 'DELETE'\) return false/);
  assert.match(admin, /if \(decision === 'HIDE' \|\| decision === 'DELETE'\) return false/);
  assert.match(admin, /curationDecisions\.get\(p\.id\)\?\.decision !== 'DELETE'/);
  assert.match(admin, /d !== 'HIDE' && d !== 'DELETE'/);
});


test('Drive HIDE sync is reversible, external to Portfolio, and forces a rescan', () => {
  const sync = fs.readFileSync('src/sync_drive_curation.py', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/update-photos.yml', 'utf8');
  assert.match(sync, /DRIVE_HIDDEN_FOLDER_ID/);
  assert.match(sync, /source_parent_id/);
  assert.match(sync, /decision.*HIDE/);
  assert.match(sync, /add_parent=HIDDEN_FOLDER_ID/);
  assert.match(sync, /add_parent=source_parent/);
  assert.match(sync, /LAST_SCAN_FILE\.unlink\(missing_ok=True\)/);
  assert.match(sync, /Google Drive write scope is not authorized/);
  assert.match(workflow, /python src\/sync_drive_curation\.py/);
  assert.match(workflow, /DRIVE_HIDDEN_FOLDER_ID: 1LxJF0lQecSZ5EFxTHu0Njr616CEaOmf5/);
  assert.match(workflow, /data\/drive-curation-state\.json/);
});
