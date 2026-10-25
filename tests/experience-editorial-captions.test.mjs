import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const js = read('assets/js/gallery.js');
const html = read('index.html');
const css = read('assets/css/style.css');
const i18n = read('assets/js/i18n.js');
const catalog = JSON.parse(read('data/photos.json'));
const photos = new Map(catalog.map(p => [String(p.id), p]));

const matched = js.match(/const EXPERIENCE_EDITORIAL_CAPTIONS = Object\.freeze\((\{[\s\S]*?\})\);/);
assert.ok(matched, 'Editorial pilot is an explicit, finite photo allowlist');
const captions = JSON.parse(JSON.stringify(vm.runInNewContext('(' + matched[1] + ')')));

test('eight bilingual editorial captions point to real catalog photographs', () => {
  const ids = Object.keys(captions);
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, 8);
  for (const id of ids) {
    assert.ok(photos.has(id), 'missing catalog photo ' + id);
    assert.equal(typeof captions[id].he, 'string');
    assert.equal(typeof captions[id].en, 'string');
    assert.ok(captions[id].he.length >= 65 && captions[id].he.length <= 240);
    assert.ok(captions[id].en.length >= 70 && captions[id].en.length <= 270);
    assert.ok(photos.get(id).thumbnail, 'no preview for photo ' + id);
  }
});

test('experience text is an optional lightbox enhancement and never a second repeated paragraph', () => {
  assert.match(html, /<div id="lb-experience-story"[^>]*hidden/);
  assert.match(html, /id="lb-experience-story-text"/);
  assert.match(html, /id="lb-experience-wall"/);
  assert.match(html, /data-i18n="experience\.story\.eyebrow"/);
  assert.match(html, /data-i18n="experience\.story\.wall"/);
  assert.match(js, /const available = experiencePublicGalleryVerified && photo/);
  assert.match(js, /allPhotos\.some\(p => String\(p\.id\) === String\(photo\.id\)\)/);
  assert.match(js, /box\.hidden = true/);
  assert.match(js, /box\.hidden = false/);
  assert.match(js, /descEl\.style\.display = !hasEditorialCaption && descText \? 'block' : 'none'/);
  assert.match(js, /const hasEditorialCaption = renderExperienceEditorialCaption\(photo\)/);
  assert.doesNotMatch(html, /<p[^>]*id="lb-experience-story-text"[^>]*>[^<\s]/);
});

test('localized captions change with language and wall CTA calls the existing safe preview', () => {
  assert.match(js, /caption\[getLang\(\) === 'en' \? 'en' : 'he'\]/);
  assert.match(js, /if \(document\.getElementById\('lightbox'\)\?\.classList\.contains\('open'\)/);
  assert.match(js, /document\.getElementById\('lb-wall'\)\?\.click\(\)/);
  for (const key of ['experience.story.eyebrow', 'experience.story.wall', 'experience.story.aria']) {
    assert.equal(i18n.split("'" + key + "':").length, 3, key + ' must have both HE and EN');
  }
});

test('story UI is tasteful, mobile-friendly, hidden without data and respects existing payment guards', () => {
  assert.match(css, /\.lb-experience-story\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /#lb-experience-story-text \{/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(js, /let PURCHASES_ENABLED = false;/);
  assert.doesNotMatch(js.slice(js.indexOf('function renderExperienceEditorialCaption('), js.indexOf('function openLightbox(idx)')), /openBuyModal|fetch\(|PAYMENTS_ENABLED = true/);
});
