import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const analytics = readFileSync(new URL('../assets/js/analytics.js', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');

test('analytics helper loads before scripts that emit UX events', () => {
  const analyticsPos = html.indexOf('assets/js/analytics.js');
  assert.notEqual(analyticsPos, -1);
  assert.ok(analyticsPos < html.indexOf('assets/js/i18n.js'));
  assert.ok(analyticsPos < html.indexOf('assets/js/gallery.js'));
});

test('primary homepage journeys expose declarative analytics events', () => {
  for (const event of [
    'hero_gallery_click',
    'hero_purchase_info_click',
    'hero_guide_click',
    'guide_banner_click',
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
