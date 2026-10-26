import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');

const categoryStart = i18n.indexOf('const CATEGORY_MAP = {');
const categoryEnd = i18n.indexOf('};', categoryStart);
assert.ok(categoryStart >= 0 && categoryEnd > categoryStart);
const categoryMap = vm.runInNewContext(i18n.slice(categoryStart, categoryEnd + 2) + '\nCATEGORY_MAP;');

const helpersStart = gallery.indexOf('function hasHebrewText(');
const helpersEnd = gallery.indexOf('function isNew(', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart);
let lang = 'en';
const helpers = vm.runInNewContext(
  gallery.slice(helpersStart, helpersEnd) + '\n({ localizedPhotoTitle, localizedPhotoDescription, localizedPhotoAlt });',
  {
    getLang: () => lang,
    getCategoryLabel: category => lang === 'en' ? (categoryMap[category] || category) : category,
  }
);

test('English photo title, description and alt never fall back to Hebrew text', () => {
  const photo = {
    title: 'חלון עתיק בגג סלובקי',
    description: 'תיאור בעברית',
    alt: 'חלון עתיק',
    category: 'סלובקיה',
  };
  assert.equal(helpers.localizedPhotoTitle(photo), 'Slovakia photograph');
  assert.equal(helpers.localizedPhotoDescription(photo), '');
  assert.equal(helpers.localizedPhotoAlt(photo), 'Slovakia photograph');
  const translated = { ...photo, title_en: 'Old Attic Window in Slovakia', description_en: 'An old window.', alt_en: 'Old window in roof' };
  assert.equal(helpers.localizedPhotoTitle(translated), translated.title_en);
  assert.equal(helpers.localizedPhotoDescription(translated), translated.description_en);
  assert.equal(helpers.localizedPhotoAlt(translated), translated.alt_en);
});

test('category names have English fallback labels, including Georgia and night photography', () => {
  for (const [hebrew, english] of [
    ['גאורגיה', 'Georgia'], ['צילומי לילה', 'Night Photography'],
  ]) {
    assert.equal(categoryMap[hebrew], english);
    assert.equal(helpers.localizedPhotoTitle({ title: 'כותרת', category: hebrew }), english + ' photograph');
  }
});

test('Hebrew remains intact in the Hebrew interface', () => {
  lang = 'he';
  const photo = { title: 'פרח', description: 'צילום פרח', alt: 'פרח ורוד', category: 'פרחים וצמחים' };
  assert.equal(helpers.localizedPhotoTitle(photo), photo.title);
  assert.equal(helpers.localizedPhotoDescription(photo), photo.description);
  assert.equal(helpers.localizedPhotoAlt(photo), photo.alt);
  lang = 'en';
});

test('gallery cards use localized visible text and accessible labels', () => {
  assert.match(gallery, /item\.setAttribute\('aria-label', `\$\{localizedPhotoTitle\(photo\)\}/);
  assert.match(gallery, /alt="\$\{localizedPhotoAlt\(photo\)\}"/);
  assert.match(gallery, /aria-label="\$\{t\('gallery\.wishlist\.save'\)\}"/);
  assert.equal((i18n.match(/'gallery\.wishlist\.save':/g) || []).length, 2);
});

test('D1 empty English translation fields preserve curated JSON translations', () => {
  assert.match(gallery, /\['title_en', 'description_en', 'alt_en'\]/);
  assert.match(gallery, /!String\(p\[field\] \|\| ''\)\.trim\(\)/);
  assert.match(gallery, /merged\[field\] = j\[field\]/);
});
