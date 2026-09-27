import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

function photosHeader() {
  const start = admin.indexOf('<section class="section" id="section-photos">');
  const end = admin.indexOf('<div class="stats-bar" id="photos-stats">', start);
  return admin.slice(start, end);
}

test('add photo is the first and only primary action in the photo header', () => {
  const header = photosHeader();
  const add = header.indexOf('id="add-photo-btn"');
  const maintenance = header.indexOf('class="admin-actions-menu"');
  assert.ok(add > -1 && maintenance > -1);
  assert.ok(add < maintenance, 'the frequent add-photo task must precede maintenance actions');
  assert.equal((header.match(/btn-primary/g) || []).length, 1);
});

test('infrequent photo maintenance actions are grouped in a native disclosure', () => {
  const header = photosHeader();
  assert.match(header, /<details class="admin-actions-menu">/);
  assert.match(header, /<summary[^>]*>\s*פעולות תחזוקה\s*<\/summary>/);
  for (const id of ['import-photos-btn', 'export-photos-btn', 'fill-titles-btn', 'trigger-workflow-btn']) {
    assert.ok(header.indexOf(`id="${id}"`) > header.indexOf('class="admin-actions-panel"'), `${id} must be in the maintenance panel`);
  }
  assert.match(header, /data-action="rotate-sale"/);
});

test('newsletter links do not nest buttons inside anchors', () => {
  const start = admin.indexOf('<section class="section" id="section-newsletter">');
  const end = admin.indexOf('<!-- ANALYTICS SECTION -->', start);
  const newsletter = admin.slice(start, end);
  assert.doesNotMatch(newsletter, /<a[^>]*>[\s\S]*?<button/);
  assert.match(newsletter, /<a[^>]*class="btn btn-primary"[^>]*>\s*📰 פתח ניהול ניוזלטר\s*<\/a>/);
  assert.match(newsletter, /<a[^>]*class="btn btn-ghost"[^>]*>\s*🎁 דף לידים — PDF חינמי\s*<\/a>/);
});

test('mobile layout keeps the primary action full-width and the disclosure compact', () => {
  assert.match(admin, /@media\(max-width:768px\)[\s\S]*?#section-photos \.section-actions/);
  assert.match(admin, /#add-photo-btn\s*\{[^}]*width:\s*100%/);
  assert.match(admin, /\.admin-actions-menu\s*\{[^}]*width:\s*100%/);
});
