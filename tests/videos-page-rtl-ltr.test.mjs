import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Confirmed live: localStorage.lang='en' correctly translated all text on /videos/ (title,
// tab labels, card content all switched to English via the existing t()/data-en wiring), but
// document.documentElement.dir/lang and body direction never changed from the hardcoded
// <html lang="he" dir="rtl"> — the whole page stayed right-to-left while showing English text
// (visible artifact: a leading ". ..." on an English sentence, nav mirrored to the wrong side).
const html = readFileSync(fileURLToPath(new URL('../videos/index.html', import.meta.url)), 'utf8');

function runVideosScript(storedLang) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script = scripts.at(-1)?.[1];
  assert.ok(script, 'videos page inline script not found');

  const storage = new Map(storedLang ? [['lang', storedLang]] : []);
  const gridEls = {
    'tutorials-grid': { innerHTML: '', closest: () => null },
    'galleries-grid': { innerHTML: '', closest: () => null },
    'reels-grid': { innerHTML: '', closest: () => null },
  };
  const titleEl = { dataset: { he: 'הסרטונים שלי — Amit Photos', en: 'My Videos — Amit Photos' }, textContent: '', closest: () => null };
  const documentElement = { lang: 'he', dir: 'rtl' };
  const body = { style: { direction: 'rtl' } };
  const context = {
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: {
      documentElement,
      body,
      getElementById: (id) => gridEls[id] || null,
      querySelectorAll: (sel) => (sel === '[data-he]' ? [titleEl] : []),
    },
    window: {},
    fetch: async () => ({ ok: false, json: async () => { throw new Error('no network in test'); } }),
    console,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  return { context, documentElement, body, titleEl };
}

test('regression: initial load with a stored English preference switches direction to ltr, not just the text', () => {
  // the real page's initial rebuildAll() runs off the videos.json fetch's .then/.catch, which
  // is async — call it directly here so the assertion doesn't race that microtask.
  const { context, documentElement, body } = runVideosScript('en');
  context.rebuildAll();
  assert.equal(documentElement.lang, 'en');
  assert.equal(documentElement.dir, 'ltr');
  assert.equal(body.style.direction, 'ltr');
});

test('Hebrew (default/no stored preference) stays rtl', () => {
  const { documentElement, body } = runVideosScript(null);
  assert.equal(documentElement.lang, 'he');
  assert.equal(documentElement.dir, 'rtl');
  assert.equal(body.style.direction, 'rtl');
});

test('setLang(\'en\') switches an already-rtl page to ltr (the nav-triggered same-tab path)', () => {
  const { context, documentElement, body } = runVideosScript('he');
  assert.equal(documentElement.dir, 'rtl');
  context.setLang('en');
  assert.equal(documentElement.lang, 'en');
  assert.equal(documentElement.dir, 'ltr');
  assert.equal(body.style.direction, 'ltr');
});

test('setLang(\'he\') switches back to rtl', () => {
  const { context, documentElement, body } = runVideosScript('en');
  context.setLang('he');
  assert.equal(documentElement.lang, 'he');
  assert.equal(documentElement.dir, 'rtl');
  assert.equal(body.style.direction, 'rtl');
});

test('all 45 video records have both title_en and (when title_he exists) summary_en, so the language switch never falls back to blank text', () => {
  const videos = JSON.parse(readFileSync(fileURLToPath(new URL('../data/videos.json', import.meta.url)), 'utf8'));
  const missingTitleEn = videos.filter(v => !v.title_en);
  const missingSummaryEn = videos.filter(v => v.summary_he && !v.summary_en);
  assert.deepEqual(missingTitleEn.map(v => v.id), []);
  assert.deepEqual(missingSummaryEn.map(v => v.id), []);
});
