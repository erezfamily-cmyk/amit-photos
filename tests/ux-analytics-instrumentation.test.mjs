import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const analytics = readFileSync(new URL('../assets/js/analytics.js', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../assets/js/nav.js', import.meta.url), 'utf8');

test('analytics helper loads before scripts that emit UX events', () => {
  const analyticsPos = html.indexOf('assets/js/analytics.js');
  assert.notEqual(analyticsPos, -1);
  assert.ok(analyticsPos < html.indexOf('assets/js/i18n.js'));
  assert.ok(analyticsPos < html.indexOf('assets/js/gallery.js'));
});

test('primary homepage journeys expose declarative analytics events', () => {
  // 2026-09-26 homepage-hierarchy redesign dropped the redundant "how to buy?" hero ghost
  // button and the duplicate free-guide banner right below it (same offer as the kept
  // "50 free tips" hero CTA) — hero_purchase_info_click / guide_banner_click no longer exist.
  for (const event of [
    'hero_gallery_click',
    'hero_guide_click',
    'nav_click',
    'contact_intent',
  ]) {
    assert.match(html, new RegExp(`data-analytics-event="${event}"`), `${event} must be instrumented`);
  }
});

test('successful lead and contact submissions emit events only after success', () => {
  assert.match(html, /trackUxEvent\('generate_lead', \{ source: 'homepage_section' \}\)/);
  assert.match(html, /trackUxEvent\('generate_lead', \{ source: 'popup' \}\)/);
  assert.match(gallery, /trackUxEvent\?\.\('contact_form_success'/);
});

test('gallery filters and language changes are measured', () => {
  assert.match(gallery, /trackUxEvent\?\.\('gallery_filter'/);
  assert.match(i18n, /trackUxEvent\?\.\('language_change'/);
});

test('analytics helper allowlists parameters and never forwards personal form fields', () => {
  const calls = [];
  const listeners = new Map();
  const context = {
    window: {
      gtag: (...args) => calls.push(args),
      addEventListener: (type, callback) => listeners.set(type, callback),
      scrollY: 0,
      innerHeight: 800,
    },
    document: {
      readyState: 'loading',
      documentElement: { scrollHeight: 2000 },
      addEventListener: (type, callback) => listeners.set(type, callback),
    },
    location: { pathname: '/' },
    requestAnimationFrame: callback => callback(),
    Set,
  };
  context.window.document = context.document;
  context.window.location = context.location;

  runInNewContext(analytics, context);
  context.window.trackUxEvent('generate_lead', {
    source: 'homepage_section',
    email: 'private@example.com',
    name: 'Private Person',
    message: 'private message',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'event');
  assert.equal(calls[0][1], 'generate_lead');
  assert.equal(calls[0][2].source, 'homepage_section');
  assert.equal(calls[0][2].page_path, '/');
  assert.equal('email' in calls[0][2], false);
  assert.equal('name' in calls[0][2], false);
  assert.equal('message' in calls[0][2], false);
});

test('scroll measurement uses stable one-time milestones', () => {
  assert.match(analytics, /\[25, 50, 75, 90\]/);
  assert.match(analytics, /sentScrollDepths\.has/);
  assert.match(analytics, /trackUxEvent\(`scroll_\$\{milestone\}`/);
});

test('shared subpage navigation loads the same GA and UX measurement layer', () => {
  assert.match(analytics, /G-XM6T3E8QWN/);
  assert.match(analytics, /googletagmanager\.com\/gtag\/js/);
  assert.match(nav, /assets\/js\/analytics\.js\?v=/);
  assert.match(nav, /data-analytics-event="nav_click"/);
});

test('subpage navigation measures language changes and successful guide leads', () => {
  assert.match(nav, /trackUxEvent\?\.\('language_change'/);
  assert.match(nav, /trackUxEvent\?\.\('generate_lead', \{ source: 'subpage_strip' \}\)/);
});

test('navigation choices and internal content links are distinguishable in reports', () => {
  assert.match(analytics, /trackUxEvent\(`nav_\$\{navLabel\}_click`/);
  assert.match(analytics, /trackUxEvent\('content_link_click'/);
});


test('experience journey signals are emitted through anonymous GA4 helper', () => {
  assert.match(gallery, /window\.trackUxEvent\?\.\('experience_path_click', \{ label: pathId, result_count: matches\.length \}\)/);
  assert.ok(gallery.includes('window.trackUxEvent?.(`experience_${pathId}_click`, { label: pathId });'));
  assert.match(gallery, /window\.trackUxEvent\?\.\('experience_photo_view', \{ label: activeExperiencePath, photo_id: String\(photo\.id\) \}\)/);
  assert.ok(gallery.includes('window.trackUxEvent?.(`experience_${activeExperiencePath}_photo_view`, { photo_id: String(photo.id) });'));
  assert.match(gallery, /window\.trackUxEvent\?\.\('wall_preview_open', \{/);
  assert.ok(gallery.includes('window.trackUxEvent?.(`experience_${activeExperiencePath}_wall_open`, { photo_id: String(photo.id) });'));
  assert.match(gallery, /const isExperiencePhoto = origin === 'lightbox'/);
  assert.match(gallery, /if \(weekPhoto\) openWallMockup\(weekPhoto, 'weekly_photo'\)/);
});

test('experience event data includes no personal information', () => {
  const events = [];
  const listeners = new Map();
  const context = {
    window: {
      gtag: (...args) => events.push(args),
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
    document: {
      readyState: 'loading',
      documentElement: { scrollHeight: 2000 },
      addEventListener: (type, listener) => listeners.set(type, listener),
    },
    location: { pathname: '/' },
    Set,
  };
  context.window.document = context.document;
  context.window.location = context.location;
  runInNewContext(analytics, context);
  context.window.trackUxEvent('experience_details_click', {
    label: 'details',
    photo_id: 'safe-public-id',
    email: 'secret@example.org',
    name: 'secret person',
    notes: 'private text',
  });
  assert.equal(events.length, 1);
  assert.equal(events[0][1], 'experience_details_click');
  assert.equal(events[0][2].label, 'details');
  assert.equal(events[0][2].photo_id, 'safe-public-id');
  assert.equal('email' in events[0][2], false);
  assert.equal('name' in events[0][2], false);
  assert.equal('notes' in events[0][2], false);
});
