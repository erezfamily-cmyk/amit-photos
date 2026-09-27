import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const admin = readFileSync(fileURLToPath(new URL('../admin.html', import.meta.url)), 'utf8');

function breakpoint(marker) {
  const markerIndex = admin.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} is missing`);
  const start = admin.lastIndexOf('@media(max-width:768px){', markerIndex);
  assert.notEqual(start, -1, 'mobile breakpoint is missing');
  let depth = 0;
  for (let i = start; i < admin.length; i++) {
    if (admin[i] === '{') depth++;
    if (admin[i] === '}' && --depth === 0) return admin.slice(start, i + 1);
  }
  assert.fail('mobile breakpoint is not closed');
}

test('media tools use shared responsive shells and photo grids', () => {
  for (const section of ['redbubble', 'reels', 'breakdown', 'videos']) {
    assert.match(admin, new RegExp(`id="section-${section}"[\\s\\S]{0,2000}<div class="admin-tool-shell"`));
  }
  for (const id of ['rb-photo-grid', 'reel-photo-grid', 'bd-photo-grid']) {
    assert.match(admin, new RegExp(`id="${id}"[^>]*class="mobile-photo-grid"|class="mobile-photo-grid"[^>]*id="${id}"`));
  }
});

test('mobile media tools collapse dense grids and actions without horizontal overflow', () => {
  const block = breakpoint('.admin-tool-card{');
  assert.match(block, /\.admin-tool-card\s*\{[^}]*padding:\s*1rem!important/);
  assert.match(block, /\.mobile-photo-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)!important/);
  assert.match(block, /\.mobile-tool-actions\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(block, /\.mobile-tool-actions[^}]*>\s*\*\s*\{[^}]*min-width:\s*0!important/);
  assert.match(block, /\.marketplace-preview\s*\{[^}]*flex-direction:\s*column/);
  assert.match(block, /\.mobile-media-item\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('Pinterest action groups become full-width touch targets', () => {
  assert.ok((admin.match(/class="pinterest-action-grid"/g) || []).length >= 3);
  const block = breakpoint('.pinterest-action-grid{');
  assert.match(block, /\.pinterest-action-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(block, /\.pinterest-action-grid button\s*\{[^}]*min-height:\s*44px[^}]*width:\s*100%/);
  assert.match(admin, /id="pinterest-connect-btn"[^>]*class="mobile-primary-action"/);
});

test('video upload works with keyboard as well as touch', () => {
  const uploadTag = admin.match(/<div id="video-upload-zone"[\s\S]*?>/)?.[0] || '';
  assert.match(uploadTag, /role="button"/);
  assert.match(uploadTag, /tabindex="0"/);
  assert.match(uploadTag, /aria-label="העלה סרטון"/);
  assert.match(uploadTag, /onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)/);
});

test('generated video rows use responsive item classes and safe external links', () => {
  const start = admin.indexOf('window.bdLoadVideos = async function()');
  const source = admin.slice(start);
  assert.ok((source.match(/class="mobile-media-item"/g) || []).length >= 3);
  assert.match(source, /target="_blank" rel="noopener"[^>]*class="mobile-media-action"/);
});
