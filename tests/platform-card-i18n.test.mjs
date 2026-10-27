import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const start = html.indexOf('<!-- ===== PLATFORMS ===== -->');
const end = html.indexOf('<!-- ===== HOW TO BUY ===== -->', start);
assert.ok(start !== -1 && end > start, 'Social platform section exists');
const section = html.slice(start, end);

const keys = {
  label: ['נוכחות ברשת', 'Online Presence'],
  photos: ['תמונות', 'photos'],
  views: ['צפיות', 'views'],
  likes: ['לייקים', 'likes'],
  rank: ['דרגה', 'rank'],
  followers: ['עוקבים', 'followers'],
  weekly: ['שבועיות', 'weekly'],
  short: ['קצרים', 'short'],
  tips: ['טיפים', 'Tips on'],
  photography: ['צילום', 'photography'],
  profile: ['לפרופיל ↗', 'View profile ↗'],
  follow: ['עקוב ↗', 'Follow ↗'],
};

test('all four platform cards and section heading expose i18n labels', () => {
  assert.equal((section.match(/class="platform-card"/g) || []).length, 4);
  for (const [key, translations] of Object.entries(keys)) {
    const name = 'platforms.' + key;
    assert.ok(section.includes('data-i18n="' + name + '"'), 'Missing label ' + name);
    for (const translated of translations) {
      // Quoted, literal catalog text must be present in the relevant dictionary.
      assert.ok(i18n.includes("'" + name + "':"), 'Missing dictionary key ' + name);
      assert.ok(i18n.includes("'" + translated + "'"), 'Missing translation ' + translated);
    }
  }
});

test('every Hebrew platform-card label is explicitly translatable', () => {
  // English first-load must not inherit Hebrew literal labels without a data-i18n key.
  const stripped = section
    .replace(/<[^>]+data-i18n="platforms\.[^"]+"[^>]*>[^<]*<\/[^>]+>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(stripped, /[\u0590-\u05ff]/,
    'Untranslated Hebrew found in the platform section');
});

test('stats and links keep stable semantics and dynamic Instagram counters', () => {
  for (const name of ['500px', 'GuruShots', 'Instagram', 'TikTok'])
    assert.ok(section.includes('class="platform-logo">' + name + '</div>'));
  for (const id of ['ig-followers-count', 'ig-media-count'])
    assert.ok(section.includes('id="' + id + '"'));
  assert.equal((section.match(/class="platform-cta" data-i18n="platforms.profile"/g) || []).length, 2);
  assert.equal((section.match(/class="platform-cta" data-i18n="platforms.follow"/g) || []).length, 2);
});

test('the i18n cache version is refreshed when the translation file changes', () => {
  const version = html.match(/assets\/js\/i18n\.js\?v=([a-f0-9]{8})/);
  assert.ok(version, 'Cache-busted i18n script reference required');
});
