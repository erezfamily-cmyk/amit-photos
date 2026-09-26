import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Found live via device-emulated screenshots of the real admin panel (screenshot from the user
// plus a follow-up mobile audit): #admin-ui.visible is `display:flex` (a row: sidebar | topbar |
// main-content) with no flex-direction override at any breakpoint. .mobile-topbar is `display:none`
// on desktop so it never joins that row there — but at <=980px it becomes `display:flex` and
// unexpectedly becomes a THIRD flex-row item alongside .main-content (since .sidebar is
// position:fixed and out of flow), rendering as a tall narrow strip stretched to the content's
// height instead of a horizontal app bar. This broke the entire admin shell on every mobile page,
// not just one section. Separately, the photos section's #photos-stats category-chip row
// (~30-40 chips, one per category/source) wrapped into a huge wall of rows on mobile, forcing a
// long scroll before reaching the upload zone — the exact friction point in the "add photo" flow.
const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

function mediaBlockContaining(innerMarker, fromIndex = 0) {
  const innerIdx = admin.indexOf(innerMarker, fromIndex);
  assert.notEqual(innerIdx, -1, `"${innerMarker}" not found in admin.html (from ${fromIndex}) — has it moved?`);
  const start = admin.lastIndexOf('@media(max-width:768px){', innerIdx);
  assert.notEqual(start, -1, 'no enclosing @media(max-width:768px) block found before it');
  let depth = 0, i = start;
  for (; i < admin.length; i++) {
    if (admin[i] === '{') depth++;
    else if (admin[i] === '}') { depth--; if (depth === 0) break; }
  }
  return admin.slice(start, i + 1);
}

function mediaBlock980() {
  const start = admin.indexOf('@media(max-width:980px){');
  assert.notEqual(start, -1, '@media(max-width:980px) block not found — has it moved?');
  let depth = 0, i = start;
  for (; i < admin.length; i++) {
    if (admin[i] === '{') depth++;
    else if (admin[i] === '}') { depth--; if (depth === 0) break; }
  }
  return admin.slice(start, i + 1);
}

test('the mobile shell stacks the topbar above the content instead of beside it', () => {
  const block = mediaBlock980();
  assert.match(block, /#admin-ui\.visible\s*\{\s*flex-direction:\s*column\s*\}/,
    'without this, .mobile-topbar becomes a second flex-row item next to .main-content and renders as a tall vertical strip, not a top app bar');
});

test('the photos-section category chip row scrolls horizontally on mobile instead of wrapping into a wall of rows', () => {
  const block = mediaBlockContaining('.login-card{', admin.indexOf('@media(max-width:980px){'));
  assert.match(block, /\.stats-bar\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(block, /\.stats-bar\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(block, /\.stat-chip\s*\{[^}]*flex-shrink:\s*0/, 'chips must not be allowed to shrink, or the horizontal scroll degrades into squished/wrapped text');
});
