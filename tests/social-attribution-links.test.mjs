import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const facebook = readFileSync(new URL('../src/facebook_post.py', import.meta.url), 'utf8');
const threads = readFileSync(new URL('../src/threads_post.py', import.meta.url), 'utf8');
const pinterest = readFileSync(new URL('../src/pinterest_post.py', import.meta.url), 'utf8');

test('worker-generated Pinterest destinations use one UTM helper', () => {
  const start = worker.indexOf('// ===== PINTEREST =====');
  const end = worker.indexOf('// ===== NEWSLETTER', start);
  const section = worker.slice(start, end);
  assert.match(section, /function pinterestCampaignLink\(photoId\)/);
  for (const value of ['pinterest', 'organic_social', 'gallery_pins']) assert.match(section, new RegExp(value));
  assert.doesNotMatch(section, /`https:\/\/amitphotos\.com\/\?photo=\$\{[^}]+\}(?:&buy=1)?`/);
});

test('automated social scripts use campaign URLs instead of unattributed photo links', () => {
  assert.match(facebook, /source="facebook", campaign="photo_posts"/);
  assert.match(threads, /source="threads", campaign="photo_posts"/);
  assert.match(pinterest, /source="pinterest", campaign="gallery_pins"/);
  assert.match(pinterest, /"link": build_campaign_url/);
});
