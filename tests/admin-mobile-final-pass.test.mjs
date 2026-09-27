import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const mobileStart = admin.indexOf('/* ===== MOBILE ===== */');
const mobileCss = admin.slice(mobileStart).match(/@media\(max-width:768px\)\{([\s\S]*?)\n\}/)?.[1] || '';

test('Zazzle uses the shared mobile tool layout', () => {
  const section = admin.match(/<section class="section" id="section-zazzle">([\s\S]*?)<section class="section" id="section-reels">/)?.[1] || '';
  assert.match(section, /class="admin-tool-shell"/);
  assert.equal((section.match(/class="admin-tool-card"/g) || []).length, 2);
  assert.match(section, /id="zz-photo-grid" class="mobile-photo-grid"/);
  assert.match(section, /class="marketplace-preview"/);
  assert.match(section, /class="mobile-tool-actions"/);
  assert.match(section, /class="zazzle-product-form-row"/);
});

test('Zazzle fields and product rows stack into touch-friendly mobile controls', () => {
  assert.match(mobileCss, /[^{}]*#section-zazzle input[^{}]*#section-zazzle textarea[^{}]*\{min-height:44px\}/);
  assert.match(mobileCss, /\.zazzle-product-form-row\{display:grid!important;grid-template-columns:1fr/);
  assert.match(mobileCss, /\.zazzle-product-item\{flex-wrap:wrap/);
  assert.match(mobileCss, /\.zazzle-product-action\{width:100%;min-height:44px/);
  assert.match(admin, /class="zazzle-existing-item"[\s\S]{0,500}zzJumpToPhoto/);
  assert.match(admin, /class="zazzle-product-item"/);
  assert.match(admin, /target="_blank" rel="noopener"[^>]*class="zazzle-product-link"/);
});

test('Pinterest publishing dialog fits narrow screens and keeps its action reachable', () => {
  assert.match(admin, /<dialog id="pin-modal" class="mobile-dialog"/);
  assert.match(admin, /class="pin-modal-actions"/);
  assert.match(mobileCss, /#pin-modal\{width:calc\(100vw - 1rem\)!important;[^}]*max-height:calc\(100dvh - 1rem\)/);
  assert.match(mobileCss, /\.pin-modal-actions\{flex-direction:column;align-items:stretch!important/);
  assert.match(mobileCss, /#pin-modal-submit\{width:100%;min-height:44px\}/);
});

test('visual annotation editor becomes a usable stacked workspace on mobile', () => {
  assert.match(mobileCss, /\.ann-ed-body\{flex-direction:column\}/);
  assert.match(mobileCss, /\.ann-ed-sidebar\{width:100%;max-height:46dvh/);
  assert.match(mobileCss, /\.ann-ed-tools\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(mobileCss, /\.ann-ed-tool-btn,.ann-ed-save-btn\{min-height:44px/);
});

test('price popup is viewport-bounded and flips above its trigger near the bottom edge', () => {
  assert.match(mobileCss, /#price-popup\{width:calc\(100vw - 1\.5rem\)!important;min-width:0!important/);
  assert.match(admin, /const popupH = popup\.offsetHeight;/);
  assert.match(admin, /if \(top \+ popupH > window\.innerHeight - 8\)/);
  assert.match(admin, /top = Math\.max\(8, rect\.top - popupH - 6\)/);
});
