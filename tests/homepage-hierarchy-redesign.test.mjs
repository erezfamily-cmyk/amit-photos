import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../assets/css/style.css', import.meta.url)), 'utf8');

// 2026-09-26 homepage-hierarchy redesign: live UX audit found 3 competing hero CTAs plus a
// duplicate free-guide banner right below, 12+ flat nav links, 15 curated "featured" photos,
// and 2 of 3 testimonials clashing with the site's stated "Fine Art Photography" positioning
// (wedding/bar-mitzvah quotes with no such service offered anywhere else on the site).
const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const navSrc = readFileSync(fileURLToPath(new URL('../assets/js/nav.js', import.meta.url)), 'utf8');
const gallerySrc = readFileSync(fileURLToPath(new URL('../assets/js/gallery.js', import.meta.url)), 'utf8');

test('hero keeps exactly one primary CTA and one always-visible secondary CTA', () => {
  const heroStart = html.indexOf('id="hero"');
  const heroEnd = html.indexOf('</section>', heroStart);
  const hero = html.slice(heroStart, heroEnd);
  assert.match(hero, /class="hero-cta"/, 'primary CTA must still exist');
  // the "how to buy?" ghost button was dropped — info still reachable via nav + its own section
  assert.doesNotMatch(hero, /hero\.cta-ghost/);
  // "מבצע השבוע" stays payments-gated (hidden today, reappears when payments turn on) —
  // "50 free tips" is the only secondary CTA visible while payments are off
  assert.match(hero, /class="hero-cta-ghost payments-enabled-only"/);
  assert.match(hero, /hero_guide_click/);
});

test('the duplicate free-guide banner right below the hero is gone', () => {
  assert.doesNotMatch(html, /id="guide-banner"/);
});

test('the testimonials section (event-photography quotes clashing with Fine Art positioning) is removed', () => {
  assert.doesNotMatch(html, /id="testimonials"/);
  assert.doesNotMatch(html, /testimonial-card/);
});

test('homepage static nav: clutter items removed, purchase links merged, rest grouped under "עוד"', () => {
  const navStart = html.indexOf('<nav id="main-nav">');
  const navEnd = html.indexOf('</nav>', navStart);
  const nav = html.slice(navStart, navEnd);
  assert.doesNotMatch(nav, /id="nav-new"/, '"חדש באתר" quick-filter link should be dropped');
  assert.doesNotMatch(nav, /href="#pricing"/, 'pricing link must be merged into the purchase link, not separate');
  assert.match(nav, /data-i18n="nav\.how-to-buy"[^>]*>רכישה/, 'merged purchase link should read "רכישה"');
  const moreStart = nav.indexOf('class="nav-more"');
  assert.notEqual(moreStart, -1, 'a "עוד" grouping must exist');
  const moreMenu = nav.slice(moreStart);
  for (const label of ['nav.challenges', 'nav.videos', 'nav.learn', 'nav.gear']) {
    assert.match(moreMenu, new RegExp(`data-i18n="${label}"`), `${label} should be grouped under "עוד"`);
  }
});

test('the "מבצע" nav link behaves identically on the homepage and on nav.js sub-pages (no cross-copy divergence)', () => {
  // Code review found the homepage's nav-sale link had been changed to a payments-gated
  // /sale/ link while nav.js's copy (34+ sub-pages) still unconditionally scrolled to
  // #gallery — a real behavior split for the same conceptual link, and out of this redesign's
  // approved scope (grouping links under "עוד"), so it's reverted back to matching nav.js.
  const navSaleHomepage = html.slice(html.indexOf('id="nav-sale"') - 40, html.indexOf('</a></li>', html.indexOf('id="nav-sale"')));
  const navSaleSubpage = navSrc.slice(navSrc.indexOf('id="nav-sale"') - 40, navSrc.indexOf('</a></li>', navSrc.indexOf('id="nav-sale"')));
  assert.doesNotMatch(navSaleHomepage, /payments-enabled-only/);
  assert.doesNotMatch(navSaleHomepage, /href="\/sale\/"/);
  assert.match(navSaleHomepage, /href="#gallery"/);
  assert.doesNotMatch(navSaleSubpage, /payments-enabled-only/);
  assert.match(navSaleSubpage, /href="\$\{a\('#gallery'\)\}"/);
});

test('nav.js (shared across sub-pages) mirrors the same reduction', () => {
  assert.doesNotMatch(navSrc, /data-i18n="nav\.new"/);
  assert.match(navSrc, /class="nav-more"/);
  assert.match(navSrc, /howToBuy: 'רכישה'/);
  assert.match(navSrc, /howToBuy: 'Purchase'/);
});

test('the "עוד" dropdown closes on outside click and Escape (both homepage and nav.js)', () => {
  for (const src of [gallerySrc, navSrc]) {
    assert.match(src, /moreDetails\.contains\(e\.target\)/);
    assert.match(src, /e\.key === 'Escape'/);
  }
});

test('initFeatured caps the homepage featured strip at 8 regardless of how many are curated', () => {
  const start = gallerySrc.indexOf('async function initFeatured');
  const end = gallerySrc.indexOf('const grid = document.getElementById', start);
  const block = gallerySrc.slice(start, end);
  assert.match(block, /MAX_FEATURED/);
  assert.match(block, /picks = picks\.slice\(0, MAX_FEATURED\)/);
});

test('.featured-grid mosaic has grid-auto-rows at every breakpoint, so the 6th-8th item (raised by MAX_FEATURED) get a defined cell height instead of collapsing to auto/intrinsic size', () => {
  // Found in code review: the mosaic's explicit template only ever laid out 5 (desktop) / 3
  // (<=768px) / 4 (<=480px) items — raising the cap to 8 without this would leave items beyond
  // that falling into an undefined implicit row, breaking the uniform-tile look this section
  // exists for. grid-auto-rows must match each breakpoint's own explicit row height.
  function block(afterIndex) {
    const start = css.indexOf('.featured-grid', afterIndex);
    return { text: css.slice(start, css.indexOf('}', start) + 1), end: css.indexOf('}', start) + 1 };
  }
  const desktop = block(0);
  assert.match(desktop.text, /grid-template-rows:\s*280px 280px/);
  assert.match(desktop.text, /grid-auto-rows:\s*280px/);

  const tablet = block(desktop.end);
  assert.match(tablet.text, /grid-template-rows:\s*180px 180px/);
  assert.match(tablet.text, /grid-auto-rows:\s*180px/);

  const mobile = block(tablet.end);
  assert.match(mobile.text, /grid-template-rows:\s*repeat\(4, 200px\)/);
  assert.match(mobile.text, /grid-auto-rows:\s*200px/);
});
