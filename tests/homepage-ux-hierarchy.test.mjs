import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');

function sliceBetween(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.notEqual(startAt, -1, `missing start marker: ${start}`);
  assert.notEqual(endAt, -1, `missing end marker: ${end}`);
  return source.slice(startAt, endAt);
}

test('homepage navigation keeps six primary destinations', () => {
  const navLinks = sliceBetween(html, '<ul class="nav-links">', '</ul>');
  assert.equal((navLinks.match(/<li>/g) || []).length, 6);
  for (const href of ['#gallery', '/camera/', '/locations/', '#about', '#how-to-buy', '#contact']) {
    assert.match(navLinks, new RegExp(`href="${href.replace('/', '\\/')}"`));
  }
  for (const secondary of ['id="nav-new"', 'id="nav-sale"', '/games/', '/videos/', '/gear/']) {
    assert.doesNotMatch(navLinks, new RegExp(secondary.replace('/', '\\/')));
  }
});

test('hero presents one primary and one secondary action without a duplicate guide banner', () => {
  const heroActions = sliceBetween(html, '<div class="hero-actions">', '</div>');
  assert.equal((heroActions.match(/data-analytics-event=/g) || []).length, 2);
  assert.match(heroActions, /data-analytics-event="hero_gallery_click"/);
  assert.match(heroActions, /data-analytics-event="hero_guide_click"/);
  assert.doesNotMatch(heroActions, /hero_purchase_info_click/);
  assert.doesNotMatch(html, /id="guide-banner"/);
});

test('three visitor journeys appear before the gallery', () => {
  const journeysAt = html.indexOf('id="visitor-journeys"');
  const galleryAt = html.indexOf('id="gallery"');
  assert.ok(journeysAt > 0 && journeysAt < galleryAt);

  const journeys = sliceBetween(html, '<section class="section explore-section journey-section"', '</section>');
  assert.equal((journeys.match(/data-analytics-event="journey_click"/g) || []).length, 3);
  for (const label of ['gallery', 'learn', 'locations']) {
    assert.match(journeys, new RegExp(`data-analytics-label="${label}"`));
  }
});

test('gallery has a clear bilingual introduction', () => {
  for (const key of ['gallery.home.label', 'gallery.home.title', 'gallery.home.subtitle']) {
    assert.match(html, new RegExp(`data-i18n="${key.replace('.', '\\.')}`));
    assert.match(i18n, new RegExp(`'${key.replace('.', '\\.')}':`));
  }
});

test('featured collection is capped at five photos and gallery count uses live data', () => {
  assert.match(gallery, /picks = picks\.slice\(0, 5\)/);
  assert.match(html, /id="photo-count-stat"/);
  assert.match(gallery, /photo-count-stat/);
  assert.match(gallery, /allPhotos\.length\.toLocaleString/);
});
