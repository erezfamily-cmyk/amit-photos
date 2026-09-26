import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleSalePhotos } from '../worker.js';

const html = readFileSync(fileURLToPath(new URL('../sale/index.html', import.meta.url)), 'utf8');

test('handleSalePhotos now selects title_en alongside title', async () => {
  const env = { DB: { prepare(sql) { return { all: async () => ({ results: [] }) } } } };
  // capture the SQL actually issued
  let issuedSql = '';
  env.DB.prepare = (sql) => { issuedSql = sql; return { all: async () => ({ results: [] }) }; };
  await handleSalePhotos(new Request('https://amitphotos.com/api/sale-photos'), env);
  assert.match(issuedSql, /\btitle_en\b/);
});

function runSaleScript(storedLang) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const script = scripts.at(-1)?.[1];
  assert.ok(script, 'sale page inline script not found');

  const storage = new Map(storedLang ? [['lang', storedLang]] : []);
  const elements = {};
  const idsUsed = ['s-title','s-sub','cd-days-lbl','cd-hours-lbl','cd-mins-lbl','s-note','s-back',
    'loading','empty','photo-grid','countdown','cd-days','cd-hours','cd-mins'];
  for (const id of idsUsed) elements[id] = { style: {}, textContent: '', innerHTML: '', addEventListener() {} };

  const context = {
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
    },
    document: {
      documentElement: { lang: '', dir: '' },
      body: { style: {} },
      getElementById: (id) => elements[id],
    },
    window: { addEventListener() {}, __salePhotos: null },
    fetch: async () => ({ ok: false }),
    setInterval: () => {},
    Date,
    Math,
    String,
  };
  context.window.__salePhotos = null;
  vm.createContext(context);
  vm.runInContext(script, context);
  return { context, elements };
}

test('formatPrice shows shekels in Hebrew and converts to dollars in English (same 3.7 rate as assets/js/gallery.js)', () => {
  const { context } = runSaleScript('he');
  assert.equal(context.formatPrice(19), '₪19');
  const { context: ctxEn } = runSaleScript('en');
  // assets/js/gallery.js: const ILS_TO_USD = 3.7; formatPrice does Math.round(ils / ILS_TO_USD)
  assert.equal(ctxEn.formatPrice(19), '$5');
  assert.equal(ctxEn.formatPrice(59), '$16');
});

test('renderGrid uses title_en for the alt text in English mode, and falls back to the Hebrew title when title_en is missing', () => {
  const { context, elements } = runSaleScript('en');
  context.renderGrid([
    { id: 'p1', title: 'כתר הציקלמן', title_en: 'Cyclamen Crown', category: 'פרחים וצמחים', thumbnail: '/t1.webp' },
    { id: 'p2', title: 'נוף הרים', category: 'טבע', thumbnail: '/t2.webp' },
  ]);
  assert.match(elements['photo-grid'].innerHTML, /alt="Cyclamen Crown"/);
  assert.match(elements['photo-grid'].innerHTML, /alt="נוף הרים"/, 'falls back to Hebrew title when title_en is absent, does not show an empty alt');
});

test('renderGrid uses the Hebrew title for alt text in Hebrew mode even when title_en exists', () => {
  const { context, elements } = runSaleScript('he');
  context.renderGrid([{ id: 'p1', title: 'כתר הציקלמן', title_en: 'Cyclamen Crown', category: 'פרחים וצמחים', thumbnail: '/t1.webp' }]);
  assert.match(elements['photo-grid'].innerHTML, /alt="כתר הציקלמן"/);
});

test('regression: the shekel sign appears exactly once — inside formatPrice\'s Hebrew branch, not hardcoded into the render template', () => {
  const count = (html.match(/₪/g) || []).length;
  assert.equal(count, 1, `expected exactly one ₪ (inside formatPrice), found ${count}`);
  assert.match(html, /: `₪\$\{ils\}`/);
});
