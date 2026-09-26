import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// User feedback: admin work is mostly done on mobile and "there's no order" — specifically (1)
// the sidebar nav is 17 flat items with no grouping, hard to scan on a small screen, and (2) the
// Photos section buries the add-photo upload zone below three unrelated global settings panels
// (default download prices, "new" badge threshold, week-photo picker) that have nothing to do
// with adding/managing a specific photo.
const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

function sidebarNavBlock() {
  const start = admin.indexOf('<nav class="sidebar-nav">');
  const end = admin.indexOf('</nav>', start);
  return admin.slice(start, end);
}

test('the sidebar nav is organized into labeled groups, not one flat list', () => {
  const nav = sidebarNavBlock();
  const groups = ['ראשי', 'מכירות ולקוחות', 'תוכן האתר', 'שיווק וסושיאל', 'אנליטיקה'];
  for (const g of groups) {
    assert.match(nav, new RegExp(`<div class="nav-group-label">${g}</div>`), `missing group "${g}"`);
  }
  // every original section must still be present exactly once — grouping must not drop or duplicate a page
  const sections = [
    'dashboard', 'photos', 'subscribers', 'customers', 'analytics', 'newsletter',
    'print-orders', 'social', 'purchases', 'learn', 'pinterest', 'locations',
    'reels', 'breakdown', 'redbubble', 'zazzle', 'videos',
  ];
  for (const sec of sections) {
    const count = nav.split(`data-section="${sec}"`).length - 1;
    assert.equal(count, 1, `data-section="${sec}" should appear exactly once, found ${count}`);
  }
});

test('each group actually precedes the nav-items it is meant to label', () => {
  const nav = sidebarNavBlock();
  const idx = (s) => { const i = nav.indexOf(s); assert.notEqual(i, -1, `"${s}" not found`); return i; };
  // spot-check one item per group sits after that group's label and before the next label
  assert.ok(idx('nav-group-label">ראשי') < idx('data-section="dashboard"'));
  assert.ok(idx('data-section="photos"') < idx('nav-group-label">מכירות ולקוחות'));
  assert.ok(idx('nav-group-label">מכירות ולקוחות') < idx('data-section="purchases"'));
  assert.ok(idx('data-section="customers"') < idx('nav-group-label">תוכן האתר'));
  assert.ok(idx('nav-group-label">תוכן האתר') < idx('data-section="locations"'));
  assert.ok(idx('data-section="newsletter"') < idx('nav-group-label">שיווק וסושיאל'));
  assert.ok(idx('nav-group-label">שיווק וסושיאל') < idx('data-section="social"'));
  assert.ok(idx('data-section="zazzle"') < idx('nav-group-label">אנליטיקה'));
  assert.ok(idx('nav-group-label">אנליטיקה') < idx('data-section="analytics"'));
});

function photosSectionBlock() {
  const start = admin.indexOf('<section class="section" id="section-photos">');
  const end = admin.indexOf('<!-- SUBSCRIBERS SECTION -->', start);
  return admin.slice(start, end);
}

test('the add-photo upload zone comes right after the category filter, not after three unrelated settings panels', () => {
  const block = photosSectionBlock();
  const idx = (s) => { const i = block.indexOf(s); assert.notEqual(i, -1, `"${s}" not found in the photos section`); return i; };
  const statsIdx = idx('id="photos-stats"');
  const toolbarIdx = idx('class="photos-toolbar"');
  const uploadIdx = idx('id="upload-zone"');
  const gridIdx = idx('id="photos-grid"');
  const priceSettingsIdx = idx('id="price-small"');
  const badgeSettingsIdx = idx('id="new-badge-days-select"');
  const weekBoxIdx = idx('id="week-photo-box"');

  assert.ok(statsIdx < toolbarIdx, 'category filter must come before the toolbar');
  assert.ok(toolbarIdx < uploadIdx, 'toolbar must come before the upload zone');
  assert.ok(uploadIdx < gridIdx, 'upload zone must come before the grid');
  // the three unrelated global-settings panels must now sit AFTER the grid, not between the
  // filter and the add-photo flow
  assert.ok(gridIdx < priceSettingsIdx, 'price defaults must come after the grid, not block the add flow');
  assert.ok(gridIdx < badgeSettingsIdx, '"new" badge settings must come after the grid');
  assert.ok(gridIdx < weekBoxIdx, 'week-photo picker must come after the grid');
});
